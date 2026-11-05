#!/usr/bin/env node
// Obtém o yt-dlp fixado em scripts/binarios.lock para o target triple do host e o grava
// como sidecar do Tauri em src-tauri/binaries/. Uso: `pnpm binarios` (ou `node scripts/obter-binarios.mjs`).
//
// Opções:
//   --target <triple>   força o triple (padrão: `rustc -vV`; também via CLIPORA_TARGET)
//   --exigir-gpg        falha se o gpg não estiver disponível (recomendado no CI)
//
// O script é idempotente: se o arquivo já existir com o SHA-256 do lock, nada é baixado.
// Verificações: SHA-256 do SHA2-256SUMS (fixado no lock) + assinatura GPG dele (chave fixada
// por fingerprint, chaveiro temporário isolado) + SHA-256 do binário (lock E SHA2-256SUMS).
// O FFmpeg é compilado por scripts/compilar-ffmpeg.mjs (build mínimo LGPL).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// O QUE O NÚCLEO (Ferrugem) PRECISA CONFIGURAR — etapa 3
// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. src-tauri/tauri.conf.json → bundle.externalBin (caminhos relativos a src-tauri/):
//        "externalBin": ["binaries/clipora-yt-dlp", "binaries/clipora-ffmpeg", "binaries/clipora-ffprobe"]
//    O Tauri espera os arquivos `<nome>-<target-triple>[.exe]`, que estes scripts geram:
//        src-tauri/binaries/clipora-yt-dlp-<triple>[.exe]
//        src-tauri/binaries/clipora-ffmpeg-<triple>[.exe]
//        src-tauri/binaries/clipora-ffprobe-<triple>[.exe]
//    No pacote, o sufixo do triple é removido (ex.: Contents/MacOS/clipora-yt-dlp). O prefixo
//    "clipora-" evita conflito com /usr/bin/yt-dlp e /usr/bin/ffmpeg nos pacotes .deb/.rpm.
//    Em `tauri dev` e `tauri build` os arquivos precisam existir antes: rode `pnpm binarios`
//    e `node scripts/compilar-ffmpeg.mjs`.
// 2. Executar a partir do Rust (`app.shell().sidecar("clipora-yt-dlp")`, plugin shell, ou
//    resolvendo o caminho ao lado do executável). Não conceder permissão de shell à webview.
//    Passar argumentos como vetor, nunca por shell.
// 3. Sempre passar ao yt-dlp:
//        --ffmpeg-location <caminho ABSOLUTO de clipora-ffmpeg[.exe]>
//            (o yt-dlp acha clipora-ffprobe trocando "ffmpeg" por "ffprobe" no nome do arquivo)
//        --ignore-config   (não ler configurações do yt-dlp do usuário/sistema)
//        --no-update       (sem verificação ou aviso de atualização pelo próprio yt-dlp)
// 4. NUNCA usar `yt-dlp -U` / `--update` / `--update-to`: eles atualizam no próprio lugar
//    (dentro do pacote assinado ou somente leitura) e não verificam a assinatura GPG. A
//    atualização deve gravar a nova cópia em app_local_data_dir()/bin/clipora-yt-dlp[.exe],
//    verificada (GPG + SHA-256), mantendo o sidecar embutido como fallback
//    (docs/distribuicao.md §6).
// 5. src-tauri/binaries/ está no .gitignore: os binários não são versionados.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import {
  DIR_BINARIOS,
  DIR_SCRIPTS,
  ErroBinarios,
  RAIZ,
  avisarSemGpg,
  baixar,
  detectarTriple,
  extensaoExe,
  lerLock,
  log,
  aviso,
  principal,
  sha256Arquivo,
  temFlag,
  verificarAssinaturaGpg,
} from './comum.mjs';

async function obterYtDlp(lock, triple) {
  const yt = lock.ytDlp;
  const alvo = yt.alvos[triple];
  if (!alvo) {
    throw new ErroBinarios(
      `Target "${triple}" não está em scripts/binarios.lock. Suportados: ${Object.keys(yt.alvos).join(', ')}`,
    );
  }
  const destino = join(DIR_BINARIOS, `clipora-yt-dlp-${triple}${extensaoExe(triple)}`);
  const rel = relative(RAIZ, destino);

  if (existsSync(destino) && (await sha256Arquivo(destino)) === alvo.sha256) {
    await chmod(destino, 0o755);
    log(`yt-dlp ${yt.versao} já presente e íntegro (SHA-256 confere): ${rel}. Nada a baixar.`);
    return;
  }

  await mkdir(DIR_BINARIOS, { recursive: true });
  const trabalho = await mkdtemp(join(tmpdir(), 'clipora-ytdlp-'));
  try {
    // 1. SHA2-256SUMS: hash fixado no lock + assinatura GPG.
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

    // 2. O hash do asset no SHA2-256SUMS assinado tem de coincidir com o lock.
    const linha = (await readFile(somas, 'utf8'))
      .split('\n')
      .map((l) => l.trim().split(/\s+/))
      .find(([, nome]) => nome === alvo.asset);
    if (!linha || linha[0] !== alvo.sha256) {
      throw new ErroBinarios(`SHA-256 de ${alvo.asset} no SHA2-256SUMS (${linha?.[0]}) difere do lock (${alvo.sha256}).`);
    }

    // 3. Asset: baixar, conferir e trocar atomicamente.
    const temporario = `${destino}.novo`;
    log(`baixando ${alvo.url}`);
    await baixar(alvo.url, temporario);
    const h = await sha256Arquivo(temporario);
    if (h !== alvo.sha256) {
      await rm(temporario, { force: true });
      throw new ErroBinarios(`SHA-256 de ${alvo.asset} divergente: obtido ${h}, esperado ${alvo.sha256}.`);
    }
    await chmod(temporario, 0o755);
    await rename(temporario, destino);
    log(`yt-dlp ${yt.versao} (${alvo.asset}) gravado em ${rel} — SHA-256 ${h}`);
  } finally {
    await rm(trabalho, { recursive: true, force: true });
  }
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
  const triple = detectarTriple();
  log(`target triple: ${triple}`);
  await obterYtDlp(lock, triple);
  conferirFfmpeg(triple);
});
