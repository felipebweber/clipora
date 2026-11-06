import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const isNotice = (name) => /^(license|copying|notice|patents)(?:$|[._-])|^readme\.chromium$/i.test(name);
const isTestPath = (path) => path.split('/').some((part) => /^(test|tests|testdata|test_data|bench|benches)$/i.test(part));
const required = [
  'cli/tsc/dts/node/LICENSE',
  'cli/tsc/dts/node/undici/LICENSE',
  'ext/webgpu/LICENSE.md',
];

async function listFiles(root, source, out = []) {
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.git') continue;
    const full = join(root, entry.name);
    const path = relative(source, full).split(sep).join('/');
    if (entry.isSymbolicLink() || isTestPath(path)) continue;
    if (entry.isDirectory()) await listFiles(full, source, out);
    else if (entry.isFile() && isNotice(entry.name) && path !== 'LICENSE.md') out.push({ full, path });
  }
  return out;
}

export async function gerarAvisosDenoSource(source, typescriptLicense) {
  const requiredFiles = [
    'LICENSE.md', 'Cargo.lock', 'cli/tsc/00_typescript.js', 'cli/tsc/README.md', ...required,
  ];
  const rootFiles = new Set(await readdir(source));
  if (!rootFiles.has('Cargo.lock') || !rootFiles.has('cli') || !rootFiles.has('ext')) {
    throw new Error('Fonte Deno 2.7.0 ausente/incompleta; descompacte o source archive fixado.');
  }
  const files = [];
  for (const path of requiredFiles) {
    const bytes = await readFile(join(source, path)).catch(() => null);
    if (!bytes?.length) throw new Error(`Arquivo obrigatório ausente na fonte Deno: ${path}`);
    files.push({ path, sha256: hash(bytes) });
  }
  const typescript = await readFile(join(source, 'cli/tsc/00_typescript.js'), 'utf8');
  const denoLicense = await readFile(join(source, 'LICENSE.md'));
  const denoLicenseTextSha256 = hash(Buffer.from(denoLicense.toString('utf8').replace(/\r\n/g, '\n').trim()));
  const version = /var version = "([0-9]+\.[0-9]+\.[0-9]+)"/.exec(typescript)?.[1];
  if (!version || !typescript.includes('Copyright (c) Microsoft Corporation') || !typescript.includes('Apache License, Version 2.0')) {
    throw new Error('Snapshot TypeScript embutido sem versão/copyright/licença Apache identificáveis.');
  }
  const apache = await readFile(typescriptLicense);
  if (!apache.toString('utf8').includes('Apache License') || !apache.toString('utf8').includes('Version 2.0, January 2004')) {
    throw new Error('Texto Apache-2.0 da tag TypeScript v5.9.2 ausente ou inválido.');
  }
  files.push({ path: 'microsoft-TypeScript-v5.9.2/LICENSE.txt', sha256: hash(apache) });
  files.push({ path: 'cli/tsc/00_typescript.js', sha256: hash(Buffer.from(typescript)) });
  files.push({ path: 'cli/tsc/README.md', sha256: hash(await readFile(join(source, 'cli/tsc/README.md'))) });

  const collected = await listFiles(source, source);
  const records = [];
  const groups = new Map();
  for (const file of collected) {
    const info = await lstat(file.full);
    if (info.size === 0 || info.size > 5 * 1024 * 1024) continue;
    const bytes = await readFile(file.full);
    if (bytes.includes(0)) continue;
    const text = bytes.toString('utf8').replace(/\r\n/g, '\n').trim();
    if (!text) continue;
    const textSha = hash(Buffer.from(text));
    records.push({ path: file.path, sha256: hash(bytes), textSha256: textSha });
    const group = groups.get(textSha) ?? { text, paths: [] };
    group.paths.push(file.path);
    groups.set(textSha, group);
  }
  const collectedPaths = new Set(records.map((record) => record.path));
  const missing = required.filter((path) => !collectedPaths.has(path));
  if (missing.length) throw new Error(`Avisos Deno runtime ausentes na coleta: ${missing.join(', ')}`);

  const blocks = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([textSha, group], index) => {
    const sameAsDenoLicense = textSha === denoLicenseTextSha256;
    return [
      '-'.repeat(100),
      `Texto/metadata Deno ${index + 1} — SHA-256 ${textSha}`,
      'Arquivos de origem (path relativo e SHA-256 do arquivo fonte):',
      ...group.paths.sort((a, b) => a.localeCompare(b)).map((path) => `- ${path} — ${records.find((record) => record.path === path).sha256}`),
      '',
      sameAsDenoLicense ? '(Texto idêntico ao LICENSE.md do Deno já reproduzido acima; não duplicado.)' : group.text,
      '',
    ].join('\n');
  });
  const text = [
    '='.repeat(100),
    `Avisos de origem do Deno ${version} incorporados ao runtime`,
    '='.repeat(100),
    `Fonte fixada pelo source archive Deno v2.7.0; versão do compilador TypeScript embutido: ${version}.`,
    `cli/tsc/00_typescript.js — SHA-256 ${hash(Buffer.from(typescript))}; upstream de licença: https://github.com/microsoft/TypeScript/tree/v${version}.`,
    `Texto Apache-2.0 oficial TypeScript v${version} — SHA-256 ${hash(apache)}.`,
    `Arquivos de aviso coletados fora de testes: ${records.length}; textos idênticos deduplicados em ${groups.size} grupos.`,
    'Escopo da coleta: arquivos License/Copying/Notice/Patents/README.chromium sob a árvore de runtime, CLI, extensões e bibliotecas; caminhos de teste e benchmark foram excluídos. A licença do TypeScript snapshot, tipos Node/Undici e WebGPU são exigidos explicitamente. A busca por nomes conhecidos não encontra avisos embutidos apenas em comentários de código ou com nomes não convencionais; não representa completude jurídica absoluta.',
    '',
    'Apache License 2.0 (cabeçalho do TypeScript 5.9.2 embutido):',
    apache.toString('utf8').trimEnd(),
    '',
    ...blocks,
  ].join('\n');
  return {
    text,
    records,
    keyFiles: files,
    typescriptVersion: version,
    typescriptFileSha256: hash(Buffer.from(typescript)),
    typescriptLicenseSha256: hash(apache),
    denoLicenseTextSha256,
    noticeCount: records.length,
    distinctTextCount: groups.size,
    sha256: hash(Buffer.from(`${text}\n`)),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const source = process.argv[2];
    const typescriptLicense = process.argv[3];
    const output = process.argv[4];
    if (!source || !typescriptLicense || !output) throw new Error('Uso: node scripts/licencas/deno/gerar-deno-source-avisos.mjs <source-deno-v2.7.0> <LICENSE-TypeScript-v5.9.2> <DENO-SOURCE-THIRD_PARTY_LICENSES.txt>');
    const result = await gerarAvisosDenoSource(source, typescriptLicense);
    await writeFile(output, `${result.text}\n`);
    await writeFile(output.replace(/\.txt$/, '.sources.json'), `${JSON.stringify({
      format: 1,
      typescriptVersion: result.typescriptVersion,
      typescriptFileSha256: result.typescriptFileSha256,
      typescriptLicenseSha256: result.typescriptLicenseSha256,
      denoLicenseTextSha256: result.denoLicenseTextSha256,
      licenseLikeFileCount: result.noticeCount,
      distinctTextCount: result.distinctTextCount,
      textSha256: result.sha256,
      files: result.records,
      keyFiles: result.keyFiles,
    }, null, 2)}\n`);
    console.log(`coletados ${result.noticeCount} arquivos de origem Deno em ${result.distinctTextCount} textos; TypeScript ${result.typescriptVersion}; gravado ${output}`);
  } catch (error) {
    console.error(`[deno-source-avisos] ${error.message}`);
    process.exitCode = 1;
  }
}
