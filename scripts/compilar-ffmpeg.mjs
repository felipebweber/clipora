#!/usr/bin/env node
// Compila o FFmpeg mínimo LGPL do Clipora (apenas remux: ffmpeg + ffprobe) a partir do tarball
// oficial fixado em scripts/binarios.lock, verificado por SHA-256 e assinatura GPG.
// Gera src-tauri/binaries/clipora-ffmpeg-<triple>[.exe] e clipora-ffprobe-<triple>[.exe], além de
// src-tauri/binaries/ffmpeg-build-info-<triple>.txt (obrigação LGPL: versão + configure).
//
// Uso: node scripts/compilar-ffmpeg.mjs [--target <triple>] [--forcar] [--exigir-gpg]
//
// Alvos suportados:
//   - aarch64-apple-darwin, x86_64-apple-darwin, universal-apple-darwin — em host macOS (x86_64
//     cruzado com clang -arch x86_64; universal = lipo das duas arquiteturas).
//   - x86_64-unknown-linux-gnu / aarch64-unknown-linux-gnu — compilação nativa em Linux da mesma
//     arquitetura (gcc/clang + make + xz). Liga só a glibc do sistema; a glibc mínima é a do host de
//     build (CI: Ubuntu 22.04 → glibc 2.35).
//   - x86_64-pc-windows-msvc / aarch64-pc-windows-msvc — compilação CRUZADA em host Linux ou macOS
//     com llvm-mingw (clang + mingw-w64, UCRT), versão e SHA-256 fixados em binarios.lock
//     (llvmMingw). O toolchain é baixado e verificado automaticamente; para usar outro, aponte
//     CLIPORA_LLVM_MINGW=<diretório que contém bin/>. O executável gerado é PE nativo, ligado
//     estaticamente ao runtime mingw; depende só de DLLs do Windows (KERNEL32, UCRT api-ms-win-crt-*).
//     O sufixo "-msvc" é só o nome que o Tauri espera para o sidecar (triple do app Rust).
//
// Idempotente: se os binários existem, o registro de build tem o mesmo carimbo de configuração e os
// SHA-256 registrados conferem, nada é recompilado (use --forcar para recompilar). Isso também
// funciona para alvos cruzados, que não podem ser executados no host.
//
// Licença: o build NÃO usa --enable-gpl nem --enable-nonfree e não liga bibliotecas externas
// (--disable-autodetect), portanto é LGPL-2.1-or-later. As flags estão documentadas em
// docs/licencas.md §3.4 — mantenha os dois em sincronia.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import { delimiter, join, relative } from 'node:path';
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
  '--enable-parser=vp8,vp9,av1,h264,hevc,aac,opus,mpegaudio,ac3',
  '--enable-bsf=vp9_superframe,vp9_superframe_split,aac_adtstoasc,extract_extradata,h264_mp4toannexb,hevc_mp4toannexb,av1_frame_merge,av1_frame_split,setts,null',
  // Decodificadores apenas para obter parâmetros durante a análise do fluxo; nenhum codificador:
  //  - aac, mp3: sample rate de AAC/MP3 em MPEG-TS (fixup de HLS: "sample rate not set" sem eles);
  //  - vp9: formato de pixel do VP9. Sem ele, o muxer mp4 grava um 'vpcC' vazio ("Unsupported pixel
  //    format (-1)") e o arquivo final não abre ("Empty VP Codec Configuration box") — visto com
  //    VP9 em MP4 do Instagram em 2026-11-05.
  '--enable-decoder=aac,mp3,vp9',
];

/** Flags específicas por arquitetura/sistema. Não incluem caminhos locais (entram no carimbo). */
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
  if (sistema === 'windows') {
    const prefixo = `${arch}-w64-mingw32-`;
    const f = [
      `--arch=${arch}`,
      '--target-os=mingw32',
      '--enable-cross-compile',
      `--cross-prefix=${prefixo}`,
      `--cc=${prefixo}clang`,
      // Threads nativas do Windows (sem libwinpthread) e runtime mingw estático: o .exe depende só
      // de DLLs do sistema.
      '--enable-w32threads',
      '--extra-ldflags=-static',
    ];
    if (arch === 'x86_64') f.push('--disable-x86asm');
    return f;
  }
  return arch === 'x86_64' ? ['--disable-x86asm'] : [];
}

const archHost = () => (process.arch === 'arm64' ? 'aarch64' : process.arch === 'x64' ? 'x86_64' : process.arch);

function plano(triple) {
  const m = /^(aarch64|x86_64|universal)-(apple-darwin|unknown-linux-gnu|pc-windows-msvc)$/.exec(triple);
  if (!m) throw new ErroBinarios(`Target não suportado: ${triple}`);
  const [, arch, resto] = m;
  if (resto === 'pc-windows-msvc') {
    if (arch === 'universal') throw new ErroBinarios('Não existe universal para Windows.');
    if (!['linux', 'darwin'].includes(process.platform)) {
      throw new ErroBinarios('O FFmpeg para Windows é compilado de forma cruzada em host Linux ou macOS (llvm-mingw).');
    }
    return { sistema: 'windows', archs: [arch], executavel: false, ext: '.exe' };
  }
  if (resto === 'apple-darwin') {
    if (process.platform !== 'darwin') throw new ErroBinarios('Alvos macOS só podem ser compilados em host macOS.');
    const archs = arch === 'universal' ? ['aarch64', 'x86_64'] : [arch];
    // Executável no host se a arquitetura do host estiver entre as compiladas (ou houver Rosetta, não presumido).
    return { sistema: 'darwin', archs, executavel: archs.includes(archHost()), ext: '' };
  }
  if (process.platform !== 'linux' || archHost() !== arch) {
    throw new ErroBinarios(`Alvo ${triple} exige compilação nativa em Linux ${arch}.`);
  }
  return { sistema: 'linux', archs: [arch], executavel: true, ext: '' };
}

/** Garante o toolchain llvm-mingw (fixado no lock) e devolve o diretório bin/. */
async function toolchainMingw(lock, cache, archs) {
  const proprio = process.env.CLIPORA_LLVM_MINGW;
  if (proprio) {
    const bin = join(proprio, 'bin');
    log(`usando llvm-mingw de CLIPORA_LLVM_MINGW: ${bin}`);
    return bin;
  }
  const lm = lock.llvmMingw;
  if (!lm) throw new ErroBinarios('binarios.lock sem a seção llvmMingw.');
  const chaveHost = `${process.platform}-${process.arch}`;
  const asset = lm.hosts[chaveHost];
  if (!asset) {
    throw new ErroBinarios(`llvm-mingw sem build fixado para o host ${chaveHost}. Hosts: ${Object.keys(lm.hosts).join(', ')}`);
  }
  const arquivo = join(cache, asset.arquivo);
  const raiz = join(cache, asset.arquivo.replace(/\.tar\.xz$/, ''));
  const bin = join(raiz, 'bin');
  const marca = join(raiz, '.clipora-verificado');
  if (existsSync(marca) && (await readFile(marca, 'utf8')).trim() === asset.sha256) {
    log(`llvm-mingw ${lm.versao} em cache: ${raiz}`);
  } else {
    if (!existsSync(arquivo) || (await sha256Arquivo(arquivo)) !== asset.sha256) {
      log(`baixando ${asset.url}`);
      await baixar(asset.url, arquivo, 6);
    }
    const h = await sha256Arquivo(arquivo);
    if (h !== asset.sha256) {
      await rm(arquivo, { force: true });
      throw new ErroBinarios(`SHA-256 do llvm-mingw divergente: obtido ${h}, esperado ${asset.sha256}.`);
    }
    log(`SHA-256 do llvm-mingw confere (${h}).`);
    await rm(raiz, { recursive: true, force: true });
    executar('tar', ['-xJf', arquivo, '-C', cache]);
    if (!existsSync(bin)) throw new ErroBinarios(`llvm-mingw extraído sem ${bin}.`);
    await writeFile(marca, `${asset.sha256}\n`);
  }
  for (const a of archs) {
    if (!existsSync(join(bin, `${a}-w64-mingw32-clang`))) {
      throw new ErroBinarios(`${a}-w64-mingw32-clang não encontrado em ${bin}.`);
    }
  }
  return bin;
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
  // A assinatura fica em cache junto do tarball (o ffmpeg.org às vezes derruba conexões);
  // ela é verificada a cada execução e baixada de novo se faltar ou não validar.
  const verificar = () =>
    verificarAssinaturaGpg({
      arquivo: tarball,
      assinatura: asc,
      chave: join(DIR_SCRIPTS, ff.chaveGpg.arquivo),
      fingerprint: ff.chaveGpg.fingerprint,
    });
  if (!existsSync(asc)) await baixar(ff.tarball.assinaturaUrl, asc, 6);
  let gpg;
  try {
    gpg = await verificar();
  } catch (e) {
    log(`assinatura em cache não validou (${e.message.split('\n')[0]}); baixando de novo.`);
    await rm(asc, { force: true });
    await baixar(ff.tarball.assinaturaUrl, asc, 6);
    gpg = await verificar();
  }
  if (gpg === 'ok') log(`assinatura GPG do tarball válida (chave ${ff.chaveGpg.fingerprint}).`);
  else if (temFlag('exigir-gpg')) throw new ErroBinarios('gpg não encontrado e --exigir-gpg foi informado.');
  else avisarSemGpg(`ffmpeg-${ff.versao}.tar.xz`);

  const fonte = join(cache, `ffmpeg-${ff.versao}`);
  await rm(fonte, { recursive: true, force: true });
  executar('tar', ['-xJf', tarball, '-C', cache]);
  return fonte;
}

function compilarArch(fonte, cache, arch, sistema, ext, env) {
  const build = join(cache, `build-${sistema}-${arch}`);
  spawnSync('rm', ['-rf', build]);
  spawnSync('mkdir', ['-p', build]);
  const flags = [...FLAGS_COMUNS, ...flagsAlvo(arch, sistema)];
  log(`configure (${sistema}/${arch}): ${flags.join(' ')}`);
  executar(join(fonte, 'configure'), flags, { cwd: build, env });
  // Os alvos do make levam o sufixo de executável do sistema (ffmpeg.exe no Windows).
  executar('make', [`-j${availableParallelism()}`, `ffmpeg${ext}`, `ffprobe${ext}`], { cwd: build, env });
  return { ffmpeg: join(build, `ffmpeg${ext}`), ffprobe: join(build, `ffprobe${ext}`), flags };
}

/** Lê o SHA-256 registrado de um programa no arquivo de informações de build. */
const shaRegistrado = (info, prog) => new RegExp(`^SHA-256 clipora-${prog}: ([0-9a-f]{64})$`, 'm').exec(info)?.[1];

principal(async () => {
  const lock = await lerLock();
  const triple = detectarTriple();
  const { sistema, archs, executavel, ext } = plano(triple);
  log(`target triple: ${triple} (arquiteturas: ${archs.join(', ')})`);

  const destinos = {
    ffmpeg: join(DIR_BINARIOS, `clipora-ffmpeg-${triple}${ext}`),
    ffprobe: join(DIR_BINARIOS, `clipora-ffprobe-${triple}${ext}`),
  };
  // Carimbo da configuração: versão + hash do tarball + flags (+ toolchain fixado, no Windows).
  const carimbo = createHash('sha256')
    .update(
      JSON.stringify({
        v: lock.ffmpeg.versao,
        s: lock.ffmpeg.tarball.sha256,
        f: archs.map((a) => flagsAlvo(a, sistema)),
        c: FLAGS_COMUNS,
        ...(sistema === 'windows' ? { t: lock.llvmMingw?.versao } : {}),
      }),
    )
    .digest('hex');
  const arqInfo = join(DIR_BINARIOS, `ffmpeg-build-info-${triple}.txt`);
  const infoAtual = existsSync(arqInfo) ? await readFile(arqInfo, 'utf8') : '';
  if (!temFlag('forcar') && infoAtual.includes(`Carimbo: ${carimbo}`)) {
    let integro = true;
    for (const prog of ['ffmpeg', 'ffprobe']) {
      const esperado = shaRegistrado(infoAtual, prog);
      if (!existsSync(destinos[prog]) || !esperado || (await sha256Arquivo(destinos[prog])) !== esperado) integro = false;
    }
    if (integro && executavel) {
      integro = !!versaoInstalada(destinos.ffmpeg)?.includes(`ffmpeg version ${lock.ffmpeg.versao}-clipora`);
    }
    if (integro) {
      log(`FFmpeg ${lock.ffmpeg.versao} já compilado com a configuração atual: ${relative(RAIZ, destinos.ffmpeg)}. Nada a fazer.`);
      return;
    }
  }

  const cache = join(tmpdir(), `clipora-ffmpeg-${lock.ffmpeg.versao}`);
  await mkdir(cache, { recursive: true });
  let env = process.env;
  let compilador = sistema === 'darwin' ? ['clang', '--version'] : ['cc', '--version'];
  if (sistema === 'windows') {
    const bin = await toolchainMingw(lock, cache, archs);
    env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ''}` };
    compilador = [join(bin, `${archs[0]}-w64-mingw32-clang`), '--version'];
  }
  const fonte = await obterFonte(lock, cache);
  const resultados = archs.map((a) => compilarArch(fonte, cache, a, sistema, ext, env));

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
  const versaoCompilador = spawnSync(compilador[0], compilador.slice(1), { encoding: 'utf8', env }).stdout;
  const info = [
    `Clipora — FFmpeg mínimo (remux) — ${triple}`,
    `Licença: LGPL-2.1-or-later (sem --enable-gpl, sem --enable-nonfree, sem bibliotecas externas)`,
    `Código-fonte: ${lock.ffmpeg.tarball.url}`,
    `SHA-256 do código-fonte: ${lock.ffmpeg.tarball.sha256}`,
    `Assinatura: ${lock.ffmpeg.tarball.assinaturaUrl} (chave ${lock.ffmpeg.chaveGpg.fingerprint})`,
    `Modificações no código-fonte: nenhuma (changes.diff vazio)`,
    ...resultados.map((r, i) => `configure (${archs[i]}): ./configure ${r.flags.map((f) => (f.includes(' ') ? `'${f}'` : f)).join(' ')}`),
    `Compilado com: make -j${availableParallelism()} ffmpeg ffprobe`,
    `Compilador: ${(versaoCompilador ?? '').split('\n')[0]}`,
    ...(sistema === 'windows' && !process.env.CLIPORA_LLVM_MINGW
      ? [`Toolchain: llvm-mingw ${lock.llvmMingw.versao} (${lock.llvmMingw.hosts[`${process.platform}-${process.arch}`].url})`]
      : []),
    `SHA-256 clipora-ffmpeg: ${await sha256Arquivo(destinos.ffmpeg)}`,
    `SHA-256 clipora-ffprobe: ${await sha256Arquivo(destinos.ffprobe)}`,
    `Carimbo: ${carimbo}`,
    '',
  ].join('\n');
  await writeFile(arqInfo, info);
  log(`registro de build: ${relative(RAIZ, arqInfo)}`);
});
