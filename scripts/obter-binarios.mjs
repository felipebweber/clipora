#!/usr/bin/env node
// Obtém o yt-dlp fixado em scripts/binarios.lock para o target triple do host e o grava em
// src-tauri/binaries/. Uso: `pnpm binarios` (ou `node scripts/obter-binarios.mjs`).
//
// Opções:
//   --formato onefile|onedir|ambos  padrão: DETECTADO na configuração base do Tauri (tauri.conf.json):
//       externalBin com "binaries/clipora-yt-dlp" →
//       onefile; referência a "binaries/yt-dlp" → onedir; as duas → ambos. Sem nenhuma → onefile.
//       Também CLIPORA_YTDLP_FORMATO.
//       onefile → src-tauri/binaries/clipora-yt-dlp-<triple>[.exe] (ARQUIVO único): o sidecar que o
//                 bundle.externalBin atual espera. ~14 s por execução no macOS (distribuicao.md §4.2).
//       onedir  → src-tauri/binaries/yt-dlp/ (DIRETÓRIO ESTÁVEL, sem triple no nome; o manifesto
//                 registra o triple e o conteúdo é trocado se o alvo mudar) com o zip oficial extraído:
//                 yt-dlp[.exe]  (executável oficial renomeado para nome fixo)
//                 _internal/    (Python e bibliotecas)
//                 clipora-yt-dlp.json (manifesto: versão, asset, SHA-256 do zip e de cada arquivo)
//       Os dois formatos coexistem (caminhos diferentes).
//   --target <triple>   força o triple (padrão: `rustc -vV`; também CLIPORA_TARGET)
//   --exigir-gpg        falha se o gpg não estiver disponível (recomendado no CI)
//   CLIPORA_GPG=<caminho>|nenhum   escolhe o gpg ou simula a ausência
//
// Idempotente: se o destino já confere com o lock (e, no onedir, cada arquivo com o manifesto),
// nada é baixado. Verificações: SHA-256 do SHA2-256SUMS (fixado no lock) + assinatura GPG dele
// (chave fixada por fingerprint, chaveiro temporário isolado) + SHA-256 do asset (lock E SHA2-256SUMS).
// O FFmpeg é compilado por scripts/compilar-ffmpeg.mjs (build mínimo LGPL).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// O QUE O NÚCLEO (Ferrugem) PRECISA CONFIGURAR — detalhes em docs/distribuicao.md §4.5 e §6
// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. FFmpeg continua como sidecar (bundle.externalBin): "binaries/clipora-ffmpeg",
//    "binaries/clipora-ffprobe" → arquivos clipora-ffmpeg-<triple>[.exe], clipora-ffprobe-<triple>[.exe].
//    O prefixo "clipora-" evita conflito com /usr/bin/ffmpeg nos pacotes .deb/.rpm.
// 2. yt-dlp ONEDIR (decisão do projeto) e avisos vão em bundle.resources no tauri.conf.json base:
//      bundle.resources {"binaries/yt-dlp/": "yt-dlp/", "binaries/licencas/": "licencas/"}
//                     → Contents/Resources/yt-dlp/yt-dlp no macOS;
//                       resource_dir()/yt-dlp/yt-dlp[.exe] nos demais sistemas.
//    No macOS cada Mach-O do onedir deve ser pré-assinado antes de tauri build.
//    Em `tauri dev`, resolver por CARGO_MANIFEST_DIR/binaries/yt-dlp/yt-dlp[.exe].
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

import { existsSync, readdirSync, statSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
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
// Diretório estável (sem triple): a configuração do Tauri e o Rust não dependem da arquitetura,
// o que também cobre o universal-apple-darwin (compilado como aarch64 + x86_64).
const DIR_YTDLP = join(DIR_BINARIOS, 'yt-dlp');
// Layout antigo (até 2026-11-05), removido ao rodar: binaries/onedir/clipora-yt-dlp-<triple>/.
const DIR_ONEDIR_ANTIGO = join(DIR_BINARIOS, 'onedir');

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
  if (m.executavel !== nomeExecutavel(triple) || m.triple !== triple) return false;
  // A árvore no disco precisa ser EXATAMENTE a esperada: nada faltando, nada alterado e nenhum
  // arquivo extra (um .dylib/.py a mais seria carregado pelo yt-dlp). Depois de
  // scripts/assinar-yt-dlp.mjs, a referência é o estado assinado (manifesto.assinatura.arquivos:
  // Mach-O reassinados, _CodeSignature/ novos, duplicatas do framework removidas).
  const esperado = m.assinatura?.arquivos ?? m.arquivos ?? {};
  if (!Object.keys(esperado).length) return false;
  const atuais = new Map();
  const percorrer = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (!percorrer(p)) return false;
      } else if (e.isFile()) atuais.set(relative(dir, p).split(sep).join('/'), p);
      else return false; // links simbólicos e outros tipos não fazem parte do onedir
    }
    return true;
  };
  if (!percorrer(dir)) return false;
  atuais.delete(MANIFESTO);
  if (atuais.size !== Object.keys(esperado).length) {
    const extras = [...atuais.keys()].filter((k) => !(k in esperado));
    if (extras.length) aviso(`arquivos extras em ${relative(RAIZ, dir)}/: ${extras.slice(0, 5).join(', ')}${extras.length > 5 ? '…' : ''}`);
    return false;
  }
  for (const [rel, h] of Object.entries(esperado)) {
    const p = atuais.get(rel);
    if (!p || (await sha256Arquivo(p)) !== h) return false;
  }
  return true;
}

async function onedir(yt, triple) {
  const alvo = yt.alvos[triple].onedir;
  const destino = DIR_YTDLP;
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
      triple,
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

/** Lê a configuração base do Tauri e deduz quais formatos a configuração usa. */
async function formatosDaConfig() {
  const arq = join(RAIZ, 'src-tauri', 'tauri.conf.json');
  const texto = existsSync(arq) ? await readFile(arq, 'utf8') : '';
  const formatos = [];
  if (/"binaries\/clipora-yt-dlp"/.test(texto)) formatos.push('onefile');
  if (/"binaries\/yt-dlp\/?"/.test(texto)) formatos.push('onedir');
  return formatos.length ? formatos : ['onefile'];
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
  const pedido = argumento('formato') ?? process.env.CLIPORA_YTDLP_FORMATO;
  if (pedido && !['onedir', 'onefile', 'ambos'].includes(pedido)) throw new ErroBinarios(`--formato inválido: ${pedido}`);
  if (!yt.alvos[triple]) {
    throw new ErroBinarios(
      `Target "${triple}" não está em scripts/binarios.lock. Suportados: ${Object.keys(yt.alvos).join(', ')}`,
    );
  }
  const formatos = pedido === 'ambos' ? ['onefile', 'onedir'] : pedido ? [pedido] : await formatosDaConfig();
  log(`target triple: ${triple}; formato(s) do yt-dlp: ${formatos.join(' + ')}${pedido ? '' : ' (detectado na configuração do Tauri)'}`);
  await mkdir(DIR_BINARIOS, { recursive: true });
  if (formatos.includes('onefile')) await onefile(yt, triple);
  if (formatos.includes('onedir')) await onedir(yt, triple);
  // Restos de versões anteriores deste script.
  if (existsSync(DIR_ONEDIR_ANTIGO)) {
    await rm(DIR_ONEDIR_ANTIGO, { recursive: true, force: true });
    log(`removido layout antigo ${relative(RAIZ, DIR_ONEDIR_ANTIGO)}/ (agora: ${relative(RAIZ, DIR_YTDLP)}/).`);
  }
  await rm(join(DIR_BINARIOS, 'tauri.binarios.json'), { force: true });
  conferirFfmpeg(triple);
});
