#!/usr/bin/env node
// Compila o FFmpeg mínimo LGPL do Clipora (apenas remux: ffmpeg + ffprobe) a partir do tarball
// oficial fixado em scripts/binarios.lock, verificado por SHA-256 e assinatura GPG.
// Gera src-tauri/binaries/clipora-ffmpeg-<triple> e clipora-ffprobe-<triple>, além de
// src-tauri/binaries/ffmpeg-build-info-<triple>.txt (obrigação LGPL: versão + configure).
//
// Uso: node scripts/compilar-ffmpeg.mjs [--target <triple>] [--forcar] [--exigir-gpg]
//
// Alvos suportados por este script:
//   - aarch64-apple-darwin, x86_64-apple-darwin, universal-apple-darwin (em host macOS; x86_64 é
//     compilado de forma cruzada com clang -arch x86_64; universal = lipo das duas arquiteturas)
//   - x86_64-unknown-linux-gnu / aarch64-unknown-linux-gnu (somente compilação nativa no host
//     correspondente, com gcc/clang + make + xz)
//   - Windows: AINDA NÃO (pendente: CI com MSYS2/clang; ver docs/distribuicao.md §4.4).
//
// Idempotente: se os binários existem e `-version` mostra exatamente a mesma configuração,
// nada é recompilado (use --forcar para recompilar).
//
// Licença: o build NÃO usa --enable-gpl nem --enable-nonfree e não liga bibliotecas externas
// (--disable-autodetect), portanto é LGPL-2.1-or-later. As flags estão documentadas em
// docs/licencas.md §3.4 — mantenha os dois em sincronia.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  DIR_BINARIOS,
  DIR_SCRIPTS,
  ErroBinarios,
  RAIZ,
  avisarSemGpg,
  baixar,
  detectarTriple,
  executar,
  lerLock,
  log,
  principal,
  sha256Arquivo,
  temFlag,
  verificarAssinaturaGpg,
} from './comum.mjs';

/** Versão mínima do macOS (alinhada à proposta em docs/distribuicao.md §2). */
export const MACOS_MIN = '11.0';

/** Flags comuns a todos os alvos: build mínimo de remux, LGPL, sem dependências externas. */
export const FLAGS_COMUNS = [
  '--disable-gpl',
  '--disable-nonfree',
  '--disable-version3',
  '--disable-autodetect',
  '--disable-everything',
  '--disable-network',
  '--disable-doc',
  '--disable-ffplay',
  '--disable-debug',
  '--enable-ffmpeg',
  '--enable-ffprobe',
  '--enable-static',
  '--disable-shared',
  '--extra-version=clipora',
  '--enable-protocol=file,pipe',
  '--enable-demuxer=mov,matroska,mp3,aac,mpegts,hls,concat',
  '--enable-muxer=mp4,mov,ipod,matroska,webm,mpegts,adts,mp3',
  '--enable-parser=h264,hevc,aac,av1,vp8,vp9,opus,mpegaudio',
  '--enable-bsf=aac_adtstoasc,h264_mp4toannexb,hevc_mp4toannexb,extract_extradata,vp9_superframe,setts,null',
  // Decodificadores de áudio apenas para obter parâmetros (sample rate) de AAC/MP3 em MPEG-TS
  // (fixup de HLS do yt-dlp: "sample rate not set" sem eles). Nenhum codificador é habilitado.
  '--enable-decoder=aac,mp3',
];

/** Flags específicas por arquitetura/sistema. */
function flagsAlvo(arch, sistema) {
  if (sistema === 'darwin') {
    const a = arch === 'aarch64' ? 'arm64' : 'x86_64';
    const f = [
      '--cc=clang',
      `--arch=${arch === 'aarch64' ? 'aarch64' : 'x86_64'}`,
      '--target-os=darwin',
      '--enable-cross-compile',
      `--extra-cflags=-arch ${a} -mmacosx-version-min=${MACOS_MIN}`,
      `--extra-ldflags=-arch ${a} -mmacosx-version-min=${MACOS_MIN}`,
    ];
    // Sem nasm: o remux não usa as rotinas SIMD x86 de codecs.
    if (arch === 'x86_64') f.push('--disable-x86asm');
    return f;
  }
  return arch === 'x86_64' ? ['--disable-x86asm'] : [];
}

function plano(triple) {
  const hostDarwin = process.platform === 'darwin';
  const m = /^(aarch64|x86_64|universal)-(apple-darwin|unknown-linux-gnu|pc-windows-msvc)$/.exec(triple);
  if (!m) throw new ErroBinarios(`Target não suportado: ${triple}`);
  const [, arch, resto] = m;
  if (resto === 'pc-windows-msvc') {
    throw new ErroBinarios('Compilação do FFmpeg para Windows ainda não implementada (pendente: CI com MSYS2/clang).');
  }
  if (resto === 'apple-darwin') {
    if (!hostDarwin) throw new ErroBinarios('Alvos macOS só podem ser compilados em host macOS.');
    return { sistema: 'darwin', archs: arch === 'universal' ? ['aarch64', 'x86_64'] : [arch] };
  }
  const hostArch = process.arch === 'arm64' ? 'aarch64' : process.arch === 'x64' ? 'x86_64' : process.arch;
  if (process.platform !== 'linux' || hostArch !== arch) {
    throw new ErroBinarios(`Alvo ${triple} exige compilação nativa em Linux ${arch}.`);
  }
  return { sistema: 'linux', archs: [arch] };
}

function versaoInstalada(binario) {
  if (!existsSync(binario)) return null;
  const r = spawnSync(binario, ['-hide_banner', '-version'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
}

async function obterFonte(lock, cache) {
  const ff = lock.ffmpeg;
  const tarball = join(cache, `ffmpeg-${ff.versao}.tar.xz`);
  const asc = `${tarball}.asc`;
  if (!existsSync(tarball) || (await sha256Arquivo(tarball)) !== ff.tarball.sha256) {
    log(`baixando ${ff.tarball.url}`);
    await baixar(ff.tarball.url, tarball);
  }
  const h = await sha256Arquivo(tarball);
  if (h !== ff.tarball.sha256) {
    throw new ErroBinarios(`SHA-256 do tarball divergente: obtido ${h}, esperado ${ff.tarball.sha256}.`);
  }
  log(`SHA-256 do tarball confere (${h}).`);
  await baixar(ff.tarball.assinaturaUrl, asc);
  const gpg = await verificarAssinaturaGpg({
    arquivo: tarball,
    assinatura: asc,
    chave: join(DIR_SCRIPTS, ff.chaveGpg.arquivo),
    fingerprint: ff.chaveGpg.fingerprint,
  });
  if (gpg === 'ok') log(`assinatura GPG do tarball válida (chave ${ff.chaveGpg.fingerprint}).`);
  else if (temFlag('exigir-gpg')) throw new ErroBinarios('gpg não encontrado e --exigir-gpg foi informado.');
  else avisarSemGpg(`ffmpeg-${ff.versao}.tar.xz`);

  const fonte = join(cache, `ffmpeg-${ff.versao}`);
  await rm(fonte, { recursive: true, force: true });
  executar('tar', ['-xJf', tarball, '-C', cache]);
  return fonte;
}

function compilarArch(fonte, cache, arch, sistema) {
  const build = join(cache, `build-${sistema}-${arch}`);
  spawnSync('rm', ['-rf', build]);
  spawnSync('mkdir', ['-p', build]);
  const flags = [...FLAGS_COMUNS, ...flagsAlvo(arch, sistema)];
  log(`configure (${sistema}/${arch}): ${flags.join(' ')}`);
  executar(join(fonte, 'configure'), flags, { cwd: build });
  executar('make', [`-j${availableParallelism()}`, 'ffmpeg', 'ffprobe'], { cwd: build });
  return { ffmpeg: join(build, 'ffmpeg'), ffprobe: join(build, 'ffprobe'), flags };
}

principal(async () => {
  const lock = await lerLock();
  const triple = detectarTriple();
  const { sistema, archs } = plano(triple);
  log(`target triple: ${triple} (arquiteturas: ${archs.join(', ')})`);

  const destinos = {
    ffmpeg: join(DIR_BINARIOS, `clipora-ffmpeg-${triple}`),
    ffprobe: join(DIR_BINARIOS, `clipora-ffprobe-${triple}`),
  };
  // Carimbo da configuração: versão + hash do tarball + flags de cada arquitetura.
  const carimbo = createHash('sha256')
    .update(JSON.stringify({ v: lock.ffmpeg.versao, s: lock.ffmpeg.tarball.sha256, f: archs.map((a) => flagsAlvo(a, sistema)), c: FLAGS_COMUNS }))
    .digest('hex');
  const arqInfo = join(DIR_BINARIOS, `ffmpeg-build-info-${triple}.txt`);
  const atual = versaoInstalada(destinos.ffmpeg);
  const infoAtual = existsSync(arqInfo) ? await readFile(arqInfo, 'utf8') : '';
  if (
    !temFlag('forcar') &&
    atual?.includes(`ffmpeg version ${lock.ffmpeg.versao}-clipora`) &&
    versaoInstalada(destinos.ffprobe) &&
    infoAtual.includes(`Carimbo: ${carimbo}`)
  ) {
    log(`FFmpeg ${lock.ffmpeg.versao} já compilado com a configuração atual: ${relative(RAIZ, destinos.ffmpeg)}. Nada a fazer.`);
    return;
  }

  const cache = join(tmpdir(), `clipora-ffmpeg-${lock.ffmpeg.versao}`);
  await mkdir(cache, { recursive: true });
  const fonte = await obterFonte(lock, cache);
  const resultados = archs.map((a) => compilarArch(fonte, cache, a, sistema));

  await mkdir(DIR_BINARIOS, { recursive: true });
  for (const prog of ['ffmpeg', 'ffprobe']) {
    const novo = `${destinos[prog]}.novo`;
    if (resultados.length > 1) {
      executar('lipo', ['-create', ...resultados.map((r) => r[prog]), '-output', novo]);
    } else {
      await copyFile(resultados[0][prog], novo);
    }
    await chmod(novo, 0o755);
    await rename(novo, destinos[prog]);
    log(`gravado ${relative(RAIZ, destinos[prog])} — SHA-256 ${await sha256Arquivo(destinos[prog])}`);
  }

  // Registro exigido pela LGPL: versão exata, origem verificada e linha de configure.
  const compilador = spawnSync(sistema === 'darwin' ? 'clang' : 'cc', ['--version'], { encoding: 'utf8' }).stdout;
  const info = [
    `Clipora — FFmpeg mínimo (remux) — ${triple}`,
    `Licença: LGPL-2.1-or-later (sem --enable-gpl, sem --enable-nonfree, sem bibliotecas externas)`,
    `Código-fonte: ${lock.ffmpeg.tarball.url}`,
    `SHA-256 do código-fonte: ${lock.ffmpeg.tarball.sha256}`,
    `Assinatura: ${lock.ffmpeg.tarball.assinaturaUrl} (chave ${lock.ffmpeg.chaveGpg.fingerprint})`,
    `Modificações no código-fonte: nenhuma (changes.diff vazio)`,
    ...resultados.map((r, i) => `configure (${archs[i]}): ./configure ${r.flags.map((f) => (f.includes(' ') ? `'${f}'` : f)).join(' ')}`),
    `Compilado com: make -j${availableParallelism()} ffmpeg ffprobe`,
    `Compilador: ${(compilador ?? '').split('\n')[0]}`,
    `SHA-256 clipora-ffmpeg: ${await sha256Arquivo(destinos.ffmpeg)}`,
    `SHA-256 clipora-ffprobe: ${await sha256Arquivo(destinos.ffprobe)}`,
    `Carimbo: ${carimbo}`,
    '',
  ].join('\n');
  await writeFile(arqInfo, info);
  log(`registro de build: ${relative(RAIZ, arqInfo)}`);
});
