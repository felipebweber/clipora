#!/usr/bin/env node
// Obtém o yt-dlp fixado em scripts/binarios.lock para o target triple do host e o grava em
// src-tauri/binaries/. Uso: `pnpm binarios` (ou `node scripts/obter-binarios.mjs`).
//
// Opções:
//   --formato onefile|onedir  padrão: onefile (lock: ytDlp.formatoPadrao; também CLIPORA_YTDLP_FORMATO)
//       onefile → src-tauri/binaries/clipora-yt-dlp-<triple>[.exe] (ARQUIVO único): o sidecar que o
//                 bundle.externalBin atual espera. ~14 s por execução no macOS (distribuicao.md §4.2).
//       onedir  → src-tauri/binaries/onedir/clipora-yt-dlp-<triple>/ (DIRETÓRIO, decisão do projeto,
//                 a integrar na etapa 6) com o zip oficial extraído:
//                 yt-dlp[.exe]  (executável oficial renomeado para nome fixo)
//                 _internal/    (Python e bibliotecas)
//                 clipora-yt-dlp.json (manifesto: versão, asset, SHA-256 do zip e de cada arquivo)
//       Os dois formatos coexistem (caminhos diferentes); rode o script uma vez para cada.
//   --target <triple>   força o triple (padrão: `rustc -vV`; também CLIPORA_TARGET)
//   --exigir-gpg        falha se o gpg não estiver disponível (recomendado no CI)
//   CLIPORA_GPG=<caminho>|nenhum   escolhe o gpg ou simula a ausência
//
// Idempotente: se o destino já confere com o lock (e, no onedir, cada arquivo com o manifesto),
// nada é baixado. Verificações: SHA-256 do SHA2-256SUMS (fixado no lock) + assinatura GPG dele
// (chave fixada por fingerprint, chaveiro temporário isolado) + SHA-256 do asset (lock E SHA2-256SUMS).
// Também grava src-tauri/binaries/tauri.binarios.json: sobreposição de configuração sugerida para
// `tauri dev|build --config src-tauri/binaries/tauri.binarios.json` (proposta; ver distribuicao.md §4.5).
// O FFmpeg é compilado por scripts/compilar-ffmpeg.mjs (build mínimo LGPL).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// O QUE O NÚCLEO (Ferrugem) PRECISA CONFIGURAR — detalhes em docs/distribuicao.md §4.5 e §6
// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. FFmpeg continua como sidecar (bundle.externalBin): "binaries/clipora-ffmpeg",
//    "binaries/clipora-ffprobe" → arquivos clipora-ffmpeg-<triple>[.exe], clipora-ffprobe-<triple>[.exe].
//    O prefixo "clipora-" evita conflito com /usr/bin/ffmpeg nos pacotes .deb/.rpm.
// 2. yt-dlp ONEDIR (decisão do projeto) NÃO vai em externalBin (é um diretório):
//      macOS:         bundle.macOS.files {"Helpers/yt-dlp": "binaries/clipora-yt-dlp-<triple>"}
//                     → Clipora.app/Contents/Helpers/yt-dlp/yt-dlp (pré-assinar cada Mach-O!)
//      Windows/Linux: bundle.resources {"binaries/clipora-yt-dlp-<triple>/": "yt-dlp/"}
//                     → resource_dir()/yt-dlp/yt-dlp[.exe]
//    O tauri.binarios.json gerado por este script contém exatamente isso para o triple atual.
//    Em `tauri dev`, resolver pelo caminho de desenvolvimento src-tauri/binaries/clipora-yt-dlp-<triple>/.
// 3. Ordem de resolução no Rust: cópia atualizada válida em app_local_data_dir()/bin/yt-dlp/<versao>/
//    (ponteiro 'atual') → cópia embutida → (debug) src-tauri/binaries. O executável dentro do
//    diretório tem nome fixo: yt-dlp (yt-dlp.exe no Windows).
// 4. Sempre passar ao yt-dlp:
//        --ffmpeg-location <caminho ABSOLUTO de clipora-ffmpeg[.exe]>
//            (o yt-dlp acha clipora-ffprobe trocando "ffmpeg" por "ffprobe" no nome do arquivo)
//        --ignore-config   (não ler configurações do yt-dlp do usuário/sistema)
//        --no-update       (sem verificação/aviso de atualização pelo próprio yt-dlp)
// 5. NUNCA usar `yt-dlp -U` / `--update` / `--update-to`: atualizam no próprio lugar e só conferem
//    o hash, sem GPG. A atualização (etapa 6) é feita pelo app (distribuicao.md §6).
// 6. src-tauri/binaries/ está no .gitignore: os binários não são versionados.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import { existsSync, statSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import {
  DIR_BINARIOS,
  DIR_SCRIPTS,
  ErroBinarios,
  RAIZ,
  argumento,
  aviso,
  avisarSemGpg,
  baixar,
  detectarTriple,
  extensaoExe,
  lerLock,
  log,
  principal,
  sha256Arquivo,
  temFlag,
  verificarAssinaturaGpg,
} from './comum.mjs';
import { extrairZip } from './zip.mjs';

const MANIFESTO = 'clipora-yt-dlp.json';
// O onedir fica num subdiretório próprio: em src-tauri/binaries/clipora-yt-dlp-<triple> o Tauri
// (externalBin) espera um ARQUIVO, e um diretório ali quebra `tauri dev`/`tauri build`.
const DIR_ONEDIR = join(DIR_BINARIOS, 'onedir');

/** Baixa e valida o SHA2-256SUMS (hash do lock + GPG). Retorna Map asset → sha256. */
async function somasVerificadas(yt, trabalho) {
  const somas = join(trabalho, 'SHA2-256SUMS');
  const sig = join(trabalho, 'SHA2-256SUMS.sig');
  log(`baixando ${yt.somas.url}`);
  await baixar(yt.somas.url, somas);
  await baixar(yt.somas.assinaturaUrl, sig);
  const hSomas = await sha256Arquivo(somas);
  if (hSomas !== yt.somas.sha256) {
    throw new ErroBinarios(`SHA2-256SUMS divergente: obtido ${hSomas}, esperado ${yt.somas.sha256}.`);
  }
  const gpg = await verificarAssinaturaGpg({
    arquivo: somas,
    assinatura: sig,
    chave: join(DIR_SCRIPTS, yt.chaveGpg.arquivo),
    fingerprint: yt.chaveGpg.fingerprint,
  });
  if (gpg === 'ok') log(`assinatura GPG do SHA2-256SUMS válida (chave ${yt.chaveGpg.fingerprint}).`);
  else if (temFlag('exigir-gpg')) throw new ErroBinarios('gpg não encontrado e --exigir-gpg foi informado.');
  else avisarSemGpg('SHA2-256SUMS do yt-dlp');
  const mapa = new Map();
  for (const l of (await readFile(somas, 'utf8')).split('\n')) {
    const [h, nome] = l.trim().split(/\s+/);
    if (h && nome) mapa.set(nome, h);
  }
  return mapa;
}

/** Baixa um asset e confere o SHA-256 contra o lock e contra o SHA2-256SUMS assinado. */
async function baixarAssetVerificado(asset, somas, destino) {
  if (somas.get(asset.asset) !== asset.sha256) {
    throw new ErroBinarios(
      `SHA-256 de ${asset.asset} no SHA2-256SUMS (${somas.get(asset.asset)}) difere do lock (${asset.sha256}).`,
    );
  }
  log(`baixando ${asset.url}`);
  await baixar(asset.url, destino);
  const h = await sha256Arquivo(destino);
  if (h !== asset.sha256) {
    await rm(destino, { force: true });
    throw new ErroBinarios(`SHA-256 de ${asset.asset} divergente: obtido ${h}, esperado ${asset.sha256}.`);
  }
  return h;
}

/** Substitui `destino` (arquivo ou diretório) por `novo` com renomeações; remove o anterior. */
async function trocar(novo, destino) {
  const antigo = `${destino}.antigo`;
  await rm(antigo, { recursive: true, force: true });
  if (existsSync(destino)) await rename(destino, antigo);
  await rename(novo, destino);
  await rm(antigo, { recursive: true, force: true });
}

// ── onefile ──────────────────────────────────────────────────────────────────────────────────
async function onefile(yt, triple) {
  const alvo = yt.alvos[triple].onefile;
  const destino = join(DIR_BINARIOS, `clipora-yt-dlp-${triple}${extensaoExe(triple)}`);
  const rel = relative(RAIZ, destino);
  if (existsSync(destino) && statSync(destino).isFile() && (await sha256Arquivo(destino)) === alvo.sha256) {
    await chmod(destino, 0o755);
    log(`yt-dlp ${yt.versao} (onefile) já presente e íntegro (SHA-256 confere): ${rel}. Nada a baixar.`);
    return;
  }
  const trabalho = await mkdtemp(join(tmpdir(), 'clipora-ytdlp-'));
  try {
    const somas = await somasVerificadas(yt, trabalho);
    const temporario = `${destino}.novo`;
    const h = await baixarAssetVerificado(alvo, somas, temporario);
    await chmod(temporario, 0o755);
    await trocar(temporario, destino);
    log(`yt-dlp ${yt.versao} (onefile, ${alvo.asset}) gravado em ${rel} — SHA-256 ${h}`);
  } finally {
    await rm(trabalho, { recursive: true, force: true });
  }
}

// ── onedir ───────────────────────────────────────────────────────────────────────────────────
const nomeExecutavel = (triple) => `yt-dlp${extensaoExe(triple)}`;

async function onedirIntegro(dir, yt, alvo, triple) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return false;
  let m;
  try {
    m = JSON.parse(await readFile(join(dir, MANIFESTO), 'utf8'));
  } catch {
    return false;
  }
  if (m.versao !== yt.versao || m.asset !== alvo.asset || m.sha256Zip !== alvo.sha256) return false;
  if (m.executavel !== nomeExecutavel(triple)) return false;
  for (const [rel, h] of Object.entries(m.arquivos ?? {})) {
    const p = join(dir, ...rel.split('/'));
    if (!existsSync(p) || (await sha256Arquivo(p)) !== h) return false;
  }
  return Object.keys(m.arquivos ?? {}).length > 0;
}

async function onedir(yt, triple) {
  const alvo = yt.alvos[triple].onedir;
  await mkdir(DIR_ONEDIR, { recursive: true });
  const destino = join(DIR_ONEDIR, `clipora-yt-dlp-${triple}`);
  const rel = relative(RAIZ, destino);
  if (await onedirIntegro(destino, yt, alvo, triple)) {
    await chmod(join(destino, nomeExecutavel(triple)), 0o755);
    log(`yt-dlp ${yt.versao} (onedir) já presente e íntegro (manifesto e SHA-256 de cada arquivo conferem): ${rel}/. Nada a baixar.`);
    return;
  }
  const trabalho = await mkdtemp(join(tmpdir(), 'clipora-ytdlp-'));
  const novo = `${destino}.novo`;
  try {
    const somas = await somasVerificadas(yt, trabalho);
    const zip = join(trabalho, alvo.asset);
    const hZip = await baixarAssetVerificado(alvo, somas, zip);

    await rm(novo, { recursive: true, force: true });
    await mkdir(novo, { recursive: true });
    const arquivos = await extrairZip(zip, novo);
    if (!arquivos.includes(alvo.executavel)) {
      throw new ErroBinarios(`Executável ${alvo.executavel} não encontrado na raiz de ${alvo.asset}.`);
    }
    // Nome fixo do executável: o Rust resolve sempre <dir>/yt-dlp[.exe].
    const exe = nomeExecutavel(triple);
    if (alvo.executavel !== exe) await rename(join(novo, alvo.executavel), join(novo, exe));
    await chmod(join(novo, exe), 0o755);

    const hashes = {};
    for (const a of arquivos) {
      const relArq = a === alvo.executavel ? exe : a;
      hashes[relArq] = await sha256Arquivo(join(novo, ...relArq.split('/')));
    }
    const manifesto = {
      formato: 1,
      versao: yt.versao,
      asset: alvo.asset,
      sha256Zip: hZip,
      executavel: exe,
      executavelOriginal: alvo.executavel,
      origem: alvo.url,
      arquivos: hashes,
    };
    await writeFile(join(novo, MANIFESTO), `${JSON.stringify(manifesto, null, 2)}\n`);
    await trocar(novo, destino);
    log(`yt-dlp ${yt.versao} (onedir, ${alvo.asset}) extraído em ${rel}/ — ${arquivos.length} arquivos, executável ${exe}`);
  } finally {
    await rm(novo, { recursive: true, force: true });
    await rm(trabalho, { recursive: true, force: true });
  }
}

/** Sobreposição de configuração do Tauri sugerida para o triple/formato atuais (não aplicada). */
async function escreverConfigTauri(triple, formato) {
  const ffmpeg = ['binaries/clipora-ffmpeg', 'binaries/clipora-ffprobe'];
  let bundle;
  if (formato === 'onefile') bundle = { externalBin: ['binaries/clipora-yt-dlp', ...ffmpeg] };
  else if (triple.endsWith('apple-darwin')) {
    bundle = { externalBin: ffmpeg, macOS: { files: { 'Helpers/yt-dlp': `binaries/onedir/clipora-yt-dlp-${triple}` } } };
  } else bundle = { externalBin: ffmpeg, resources: { [`binaries/onedir/clipora-yt-dlp-${triple}/`]: 'yt-dlp/' } };
  const arq = join(formato === 'onedir' ? DIR_ONEDIR : DIR_BINARIOS, 'tauri.binarios.json');
  await writeFile(arq, `${JSON.stringify({ bundle }, null, 2)}\n`);
  log(`sobreposição sugerida para o Tauri: ${relative(RAIZ, arq)} (uso: tauri build --config ${relative(RAIZ, arq)})`);
}

function conferirFfmpeg(triple) {
  const ext = extensaoExe(triple);
  const faltando = ['clipora-ffmpeg', 'clipora-ffprobe']
    .map((n) => join(DIR_BINARIOS, `${n}-${triple}${ext}`))
    .filter((p) => !existsSync(p));
  if (faltando.length) {
    aviso(
      `FFmpeg ausente para ${triple}: ${faltando.map((p) => relative(RAIZ, p)).join(', ')}.\n` +
        '          Compile com: node scripts/compilar-ffmpeg.mjs',
    );
  } else {
    log(`FFmpeg presente para ${triple} (clipora-ffmpeg, clipora-ffprobe).`);
  }
}

principal(async () => {
  const lock = await lerLock();
  const yt = lock.ytDlp;
  const triple = detectarTriple();
  const formato = argumento('formato') ?? process.env.CLIPORA_YTDLP_FORMATO ?? yt.formatoPadrao ?? 'onefile';
  if (!['onedir', 'onefile'].includes(formato)) throw new ErroBinarios(`--formato inválido: ${formato}`);
  if (!yt.alvos[triple]) {
    throw new ErroBinarios(
      `Target "${triple}" não está em scripts/binarios.lock. Suportados: ${Object.keys(yt.alvos).join(', ')}`,
    );
  }
  log(`target triple: ${triple}; formato do yt-dlp: ${formato}`);
  await mkdir(DIR_BINARIOS, { recursive: true });
  if (formato === 'onedir') await onedir(yt, triple);
  else await onefile(yt, triple);
  await escreverConfigTauri(triple, formato);
  conferirFfmpeg(triple);
});
