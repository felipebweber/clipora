import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

export const RUSTY_V8_COMMIT = 'e6a88b35dd3d7f2849a0df33a71d338701c55316';
export const V8_COMMIT = '8defb67673c5483ae56258a2de01b07e947dc921';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const isNotice = (name) => /^(license|copying|notice|patents)(?:$|[._-])|^readme\.chromium$/i.test(name);
const required = [
  'v8/LICENSE', 'v8/LICENSE.v8', 'v8/LICENSE.fdlibm', 'v8/LICENSE.strongtalk',
  'third_party/abseil-cpp/LICENSE', 'third_party/icu/LICENSE',
  'third_party/libc++/src/LICENSE.TXT', 'third_party/libc++abi/src/LICENSE.TXT',
  'third_party/libunwind/src/LICENSE.TXT', 'third_party/simdutf/LICENSE',
];

function git(source, args) {
  const result = spawnSync('git', ['-C', source, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} falhou: ${result.stderr || result.error?.message || 'erro desconhecido'}`);
  return result.stdout.trim();
}

async function listFiles(root, source, out = []) {
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.git') continue;
    const full = join(root, entry.name);
    const rel = relative(source, full).split(sep).join('/');
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) await listFiles(full, source, out);
    else if (entry.isFile() && isNotice(entry.name)) out.push({ full, rel });
  }
  return out;
}

export async function gerarAvisosV8(source) {
  const rootCommit = git(source, ['rev-parse', 'HEAD']);
  if (rootCommit !== RUSTY_V8_COMMIT) throw new Error(`Rusty V8 deve estar no commit ${RUSTY_V8_COMMIT}; encontrado ${rootCommit}.`);
  const links = git(source, ['ls-tree', '-r', 'HEAD']).split('\n')
    .map((line) => line.match(/^160000 commit ([0-9a-f]{40})\t(.+)$/))
    .filter(Boolean)
    .map((match) => ({ commit: match[1], path: match[2] }))
    .filter(({ path }) => path === 'v8' || path.startsWith('third_party/'))
    .sort((a, b) => a.path.localeCompare(b.path));
  const status = git(source, ['submodule', 'status', '--', 'third_party', 'v8']).split('\n').filter(Boolean);
  const checkedOut = new Map(status.map((line) => {
    const match = line.match(/^([ +\-U]?)([0-9a-f]{40})\s+(.+?)(?:\s+\(.+\))?$/);
    if (!match) throw new Error(`Saída inválida de git submodule status: ${line}`);
    return [match[3], { prefix: match[1], commit: match[2] }];
  }));
  const missing = links.filter(({ path, commit }) => {
    const actual = checkedOut.get(path);
    return !actual || actual.prefix !== ' ' && actual.prefix !== '' || actual.commit !== commit;
  });
  if (missing.length) throw new Error(`Submódulos V8 ausentes ou em revisão divergente: ${missing.map((x) => x.path).join(', ')}`);

  const found = [];
  for (const base of ['v8', 'third_party']) {
    const full = join(source, base);
    await listFiles(full, source, found);
  }
  const records = [];
  const groups = new Map();
  for (const file of found) {
    const info = await lstat(file.full);
    if (info.size === 0 || info.size > 5 * 1024 * 1024) continue;
    const bytes = await readFile(file.full);
    if (bytes.includes(0)) continue;
    const text = bytes.toString('utf8').replace(/\r\n/g, '\n').trim();
    if (!text) continue;
    const digest = hash(Buffer.from(text, 'utf8'));
    records.push({ path: file.rel, sha256: hash(bytes), textSha256: digest });
    const group = groups.get(digest) ?? { text, paths: [] };
    group.paths.push(file.rel);
    groups.set(digest, group);
  }
  const names = new Set(records.map((record) => record.path));
  const absent = required.filter((path) => !names.has(path));
  if (absent.length) throw new Error(`Avisos obrigatórios ausentes da fonte Rusty V8: ${absent.join(', ')}`);
  if (records.length < 20 || groups.size < 10) throw new Error(`Coleta V8 suspeita: ${records.length} arquivos em ${groups.size} textos distintos.`);

  const blocks = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([digest, group], index) => [
    '-'.repeat(100),
    `Texto/metadata V8 ${index + 1} — SHA-256 ${digest}`,
    'Arquivos de origem (path relativo e SHA-256 do arquivo fonte):',
    ...group.paths.sort((a, b) => a.localeCompare(b)).map((path) => `- ${path} — ${records.find((record) => record.path === path).sha256}`),
    '',
    group.text,
    '',
  ].join('\n'));
  const text = [
    '='.repeat(100),
    'V8 145.0.0 — avisos coletados da árvore de fonte fixada do Rusty V8',
    '='.repeat(100),
    `Rusty V8 commit: ${rootCommit}`,
    `V8 submodule commit: ${V8_COMMIT}`,
    `Arquivos License/Copying/Notice/Patents/README.chromium coletados: ${records.length}; textos idênticos deduplicados em ${groups.size} grupos.`,
    'Escopo: arquivos de aviso encontrados sob v8/ e third_party/ nos gitlinks fixados pela tag. Inclui componentes de build/test e possíveis componentes condicionais não usados em todo alvo; a coleta por nome não prova quais objetos foram ligados em cada binário e pode não encontrar avisos com nomes não convencionais. Não é apresentada como lista de completude legal do upstream.',
    '',
    ...blocks,
  ].join('\n');
  return {
    text,
    records,
    links,
    rustyv8Commit: rootCommit,
    v8Commit: V8_COMMIT,
    noticeCount: records.length,
    uniqueTexts: groups.size,
    sha256: hash(Buffer.from(`${text}\n`, 'utf8')),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const source = process.argv[2];
    const output = process.argv[3];
    if (!source || !output) throw new Error('Uso: node scripts/licencas/deno/gerar-v8-avisos.mjs <checkout-rusty-v8-v145-com-submodules> <saida-V8-THIRD_PARTY_LICENSES.txt>');
    const result = await gerarAvisosV8(source);
    await writeFile(output, `${result.text}\n`);
    await writeFile(output.replace(/\.txt$/, '.sources.json'), `${JSON.stringify({
      format: 1,
      rustyV8Commit: result.rustyv8Commit,
      v8Commit: result.v8Commit,
      licenseLikeFileCount: result.noticeCount,
      distinctTextCount: result.uniqueTexts,
      textSha256: result.sha256,
      gitlinks: result.links,
      files: result.records,
    }, null, 2)}\n`);
    console.log(`coletados ${result.noticeCount} arquivos em ${result.uniqueTexts} textos; gravado ${output}`);
  } catch (error) {
    console.error(`[deno-avisos-v8] ${error.message}`);
    process.exitCode = 1;
  }
}
