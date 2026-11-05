#!/usr/bin/env node
// Gera os avisos de licença de terceiros do Clipora para UM alvo:
//   src-tauri/binaries/licencas/THIRD_PARTY_LICENSES.txt  (texto completo, vai no pacote)
//   src-tauri/binaries/licencas/licencas.json             (resumo para a tela “Sobre / Licenças”)
//
// Uso: node scripts/gerar-licencas.mjs [--target <triple>] [--sem-crates]
//
// Fontes (todas locais, depois de `pnpm binarios` e do build do FFmpeg):
//   - yt-dlp: versão/URLs do scripts/binarios.lock; texto da GPLv3 (scripts/licencas/GPL-3.0.txt);
//     THIRD_PARTY_LICENSES.txt do próprio build PyInstaller (src-tauri/binaries/yt-dlp/_internal/).
//   - FFmpeg: ffmpeg-build-info-<triple>.txt (fonte exata, SHA-256, configure) + LGPL-2.1
//     (scripts/licencas/LGPL-2.1.txt).
//   - Crates Rust: `cargo about generate --format json` para o alvo (exige cargo-about; no CI é
//     instalado pelo workflow). Configuração em scripts/licencas/about.toml.
//   - npm (produção, empacotado pelo Vite): `pnpm licenses list --prod --json` + arquivo LICENSE
//     de cada pacote.
// Os textos de licença vendorizados vêm de fontes verificadas (ver scripts/licencas/LEIAME.md).
// O tauri.conf.json inclui este diretório via bundle.resources; conferir sua presença no pacote.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import {
  DIR_BINARIOS,
  DIR_SCRIPTS,
  ErroBinarios,
  RAIZ,
  aviso,
  detectarTriple,
  encontrarExecutavel,
  lerLock,
  log,
  principal,
  temFlag,
} from './comum.mjs';

const DIR_TEXTOS = join(DIR_SCRIPTS, 'licencas');
const DIR_SAIDA = join(DIR_BINARIOS, 'licencas');
const LINHA = '='.repeat(100);
const linha = '-'.repeat(100);

const lerTexto = (arq) => readFile(arq, 'utf8').then((t) => t.replace(/\r\n/g, '\n').trimEnd());

function rodar(cmd, args, opcoes = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opcoes });
  if (r.error || r.status !== 0) {
    throw new ErroBinarios(`Falhou: ${cmd} ${args.join(' ')}\n${r.error?.message ?? ''}${r.stderr ?? ''}`);
  }
  return r.stdout;
}

// ── yt-dlp ─────────────────────────────────────────────────────────────────────────────────
async function secaoYtDlp(lock, triple) {
  const yt = lock.ytDlp;
  const alvo = yt.alvos[triple];
  const fonte = `https://github.com/yt-dlp/yt-dlp/releases/download/${yt.versao}/yt-dlp.tar.gz`;
  const terceiros = join(DIR_BINARIOS, 'yt-dlp', '_internal', 'THIRD_PARTY_LICENSES.txt');
  let textoTerceiros;
  if (existsSync(terceiros)) {
    // O arquivo vem do onedir extraído; ele precisa ser da mesma versão fixada no lock.
    const manifesto = JSON.parse(await readFile(join(DIR_BINARIOS, 'yt-dlp', 'clipora-yt-dlp.json'), 'utf8'));
    if (manifesto.versao !== yt.versao) {
      throw new ErroBinarios(`yt-dlp extraído é ${manifesto.versao}, mas o lock fixa ${yt.versao}: rode pnpm binarios.`);
    }
    if (manifesto.triple !== triple) {
      aviso(`THIRD_PARTY_LICENSES.txt do yt-dlp lido do onedir de ${manifesto.triple} (mesma release ${yt.versao}); no CI, rode pnpm binarios --target ${triple} antes.`);
    }
    textoTerceiros = await lerTexto(terceiros);
  } else {
    aviso(`${relative(RAIZ, terceiros)} ausente (rode pnpm binarios); usando só a referência por URL.`);
    textoTerceiros = `Ver https://github.com/yt-dlp/yt-dlp/blob/${yt.versao}/THIRD_PARTY_LICENSES.txt`;
  }
  const resumo = {
    id: 'yt-dlp',
    nome: 'yt-dlp',
    versao: yt.versao,
    licenca: 'GPL-3.0-or-later (executável PyInstaller; código do yt-dlp: Unlicense)',
    papel: 'Obtém o vídeo público a partir do link.',
    binario: alvo?.onedir?.url ?? alvo?.onefile?.url,
    codigoFonte: fonte,
    projeto: 'https://github.com/yt-dlp/yt-dlp',
  };
  const texto = [
    LINHA,
    `yt-dlp ${yt.versao}`,
    LINHA,
    'O código-fonte do yt-dlp é Unlicense (domínio público). O executável distribuído com o Clipora é o',
    'build PyInstaller oficial, que inclui componentes GPLv3+; a obra combinada é GPL-3.0-or-later.',
    `Binário: ${resumo.binario}`,
    `Código-fonte correspondente: ${fonte}`,
    `Build oficial (workflow): https://github.com/yt-dlp/yt-dlp/blob/${yt.versao}/.github/workflows/build.yml`,
    'O Clipora não modifica o yt-dlp. Você pode redistribuí-lo e modificá-lo nos termos da GPLv3.',
    '',
    linha,
    'Componentes incluídos no executável (THIRD_PARTY_LICENSES.txt do próprio yt-dlp):',
    linha,
    textoTerceiros,
    '',
    linha,
    'GNU GENERAL PUBLIC LICENSE, versão 3',
    linha,
    await lerTexto(join(DIR_TEXTOS, 'GPL-3.0.txt')),
  ].join('\n');
  return { resumo, texto };
}

// ── FFmpeg ─────────────────────────────────────────────────────────────────────────────────
async function secaoFfmpeg(lock, triple) {
  const ff = lock.ffmpeg;
  const arqInfo = join(DIR_BINARIOS, `ffmpeg-build-info-${triple}.txt`);
  if (!existsSync(arqInfo)) {
    throw new ErroBinarios(`${relative(RAIZ, arqInfo)} ausente: compile o FFmpeg (node scripts/compilar-ffmpeg.mjs --target ${triple}).`);
  }
  const info = await lerTexto(arqInfo);
  // Só as linhas de configure (a linha “Licença:” cita as flags em negativo).
  const configure = info.split('\n').filter((l) => l.startsWith('configure'));
  if (!configure.length || configure.some((l) => /--enable-(gpl|nonfree|version3)\b/.test(l))) throw new ErroBinarios('Build do FFmpeg com flag GPL/nonfree: não distribuir.');
  const resumo = {
    id: 'ffmpeg',
    nome: 'FFmpeg (ffmpeg e ffprobe)',
    versao: ff.versao,
    licenca: 'LGPL-2.1-or-later',
    papel: 'Junta vídeo e áudio sem recodificar (remux).',
    codigoFonte: ff.tarball.url,
    sha256Fonte: ff.tarball.sha256,
    projeto: 'https://ffmpeg.org/',
  };
  const texto = [
    LINHA,
    `FFmpeg ${ff.versao} (build mínimo do Clipora: ffmpeg e ffprobe)`,
    LINHA,
    'This software uses code of FFmpeg (https://ffmpeg.org) licensed under the LGPLv2.1,',
    `and its source can be downloaded here: ${ff.tarball.url}`,
    'Este programa usa código do FFmpeg, licenciado sob a LGPLv2.1; o código-fonte exato está no link acima.',
    'O FFmpeg roda como programa separado e pode ser substituído por outro build compatível.',
    '',
    'Registro do build (versão, origem verificada, linha de configure):',
    info,
    '',
    linha,
    'GNU LESSER GENERAL PUBLIC LICENSE, versão 2.1',
    linha,
    await lerTexto(join(DIR_TEXTOS, 'LGPL-2.1.txt')),
  ].join('\n');
  return { resumo, texto };
}

// ── Crates Rust (cargo-about) ──────────────────────────────────────────────────────────────
async function secaoCrates(triple) {
  if (temFlag('sem-crates')) {
    aviso('--sem-crates: avisos das crates Rust OMITIDOS (não distribuir assim).');
    return { resumo: [], texto: '' };
  }
  const cargo = encontrarExecutavel('cargo', [join(process.env.HOME ?? '', '.cargo', 'bin')]) ?? 'cargo';
  // O universal junta as dependências das duas fatias.
  const alvos = triple === 'universal-apple-darwin' ? ['aarch64-apple-darwin', 'x86_64-apple-darwin'] : [triple];
  const alvoRust = alvos.join(' + ');
  const saida = rodar(cargo, [
    'about',
    'generate',
    '--format',
    'json',
    '--config',
    join(DIR_TEXTOS, 'about.toml'),
    '--manifest-path',
    join(RAIZ, 'src-tauri', 'Cargo.toml'),
    ...alvos.flatMap((a) => ['--target', a]),
  ]);
  const dados = JSON.parse(saida);
  const resumo = [];
  const blocos = [];
  for (const lic of dados.licenses ?? []) {
    // O próprio Clipora não é componente de terceiros.
    const usadoPor = (lic.used_by ?? []).filter((u) => u.crate.name !== 'clipora');
    if (!usadoPor.length) continue;
    const usados = usadoPor.map((u) => `${u.crate.name} ${u.crate.version}`);
    for (const u of usadoPor) {
      // Uma crate com várias licenças aparece em vários blocos; no resumo, uma vez só.
      if (!resumo.some((r) => r.nome === u.crate.name && r.versao === u.crate.version)) {
        resumo.push({ nome: u.crate.name, versao: u.crate.version, licenca: u.crate.license ?? lic.id });
      }
    }
    blocos.push([linha, `${lic.name} (${lic.id}) — usada por: ${usados.join(', ')}`, linha, lic.text.trimEnd(), ''].join('\n'));
  }
  const texto = [LINHA, `Crates Rust compiladas no executável do Clipora (${alvoRust})`, LINHA, ...blocos].join('\n');
  return { resumo, texto };
}

// ── npm (produção) ─────────────────────────────────────────────────────────────────────────
async function secaoNpm() {
  const pnpm = encontrarExecutavel('pnpm') ?? 'pnpm';
  const dados = JSON.parse(rodar(pnpm, ['licenses', 'list', '--prod', '--json'], { cwd: RAIZ, shell: process.platform === 'win32' }));
  const resumo = [];
  const blocos = [];
  const pacotes = Object.entries(dados).flatMap(([lic, lista]) => lista.map((p) => ({ ...p, licenca: p.license ?? lic })));
  pacotes.sort((a, b) => a.name.localeCompare(b.name));
  for (const p of pacotes) {
    for (const [i, versao] of (p.versions ?? []).entries()) {
      const dir = p.paths?.[i] ?? p.paths?.[0];
      const arq = dir && readdirSync(dir).find((n) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(n));
      const textoLicenca = arq ? await lerTexto(join(dir, arq)) : `(arquivo de licença não encontrado; licença declarada: ${p.licenca})`;
      resumo.push({ nome: p.name, versao, licenca: p.licenca, projeto: p.homepage });
      blocos.push([linha, `${p.name} ${versao} — ${p.licenca}`, linha, textoLicenca, ''].join('\n'));
    }
  }
  const texto = [LINHA, 'Pacotes npm incluídos na interface (dependências de produção)', LINHA, ...blocos].join('\n');
  return { resumo, texto };
}

principal(async () => {
  const lock = await lerLock();
  const triple = detectarTriple();
  const pkg = JSON.parse(await readFile(join(RAIZ, 'package.json'), 'utf8'));
  log(`gerando avisos de licença para ${triple}`);

  const yt = await secaoYtDlp(lock, triple);
  const ff = await secaoFfmpeg(lock, triple);
  const crates = await secaoCrates(triple);
  const npm = await secaoNpm();

  const cabecalho = [
    `Clipora ${pkg.version} — avisos de licença de terceiros (${triple})`,
    `Gerado em ${new Date().toISOString().slice(0, 10)} por scripts/gerar-licencas.mjs.`,
    '',
    'O Clipora executa o yt-dlp e o FFmpeg como programas separados. Este arquivo reúne as licenças e',
    'os avisos exigidos de todos os componentes de terceiros distribuídos com o aplicativo.',
    '',
    'Conteúdo: 1. yt-dlp  2. FFmpeg  3. Crates Rust  4. Pacotes npm',
    '',
  ].join('\n');
  await mkdir(DIR_SAIDA, { recursive: true });
  const arqTxt = join(DIR_SAIDA, 'THIRD_PARTY_LICENSES.txt');
  await writeFile(arqTxt, `${[cabecalho, yt.texto, '', ff.texto, '', crates.texto, '', npm.texto].join('\n')}\n`);
  const arqJson = join(DIR_SAIDA, 'licencas.json');
  const json = {
    formato: 1,
    app: { nome: 'Clipora', versao: pkg.version },
    alvo: triple,
    componentes: [yt.resumo, ff.resumo],
    crates: crates.resumo,
    npm: npm.resumo,
    arquivoCompleto: 'THIRD_PARTY_LICENSES.txt',
  };
  await writeFile(arqJson, `${JSON.stringify(json, null, 2)}\n`);
  log(`gravado ${relative(RAIZ, arqTxt)} (${crates.resumo.length} crates, ${npm.resumo.length} pacotes npm)`);
  log(`gravado ${relative(RAIZ, arqJson)}`);
});
