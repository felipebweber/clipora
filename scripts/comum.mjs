// Funções compartilhadas pelos scripts de obtenção de binários do Clipora.
// Somente módulos nativos do Node (>= 18): sem dependências novas.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, rename, unlink } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

export const DIR_SCRIPTS = dirname(fileURLToPath(import.meta.url));
export const RAIZ = join(DIR_SCRIPTS, '..');
export const DIR_BINARIOS = join(RAIZ, 'src-tauri', 'binaries');

export const log = (...a) => console.log('[binarios]', ...a);
export const aviso = (...a) => console.warn('[binarios] AVISO:', ...a);

export class ErroBinarios extends Error {}

export async function lerLock() {
  return JSON.parse(await readFile(join(DIR_SCRIPTS, 'binarios.lock'), 'utf8'));
}

/** Lê `--nome valor` ou `--nome=valor` dos argumentos. */
export function argumento(nome) {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${nome}`) return args[i + 1];
    if (args[i].startsWith(`--${nome}=`)) return args[i].slice(nome.length + 3);
  }
  return undefined;
}
export const temFlag = (nome) => process.argv.slice(2).includes(`--${nome}`);

/** Localiza um executável no PATH ou em caminhos extras. */
export function encontrarExecutavel(nome, extras = []) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  const dirs = (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':');
  for (const d of [...dirs, ...extras]) {
    if (!d) continue;
    for (const e of exts) {
      const p = join(d, nome + e);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/**
 * Target triple do host, via `rustc -vV` (mesmo valor que o Tauri usa para os sidecars).
 * Pode ser forçado com `--target <triple>` ou CLIPORA_TARGET.
 */
export function detectarTriple() {
  const forcado = argumento('target') ?? process.env.CLIPORA_TARGET;
  if (forcado) return forcado;
  const rustc = encontrarExecutavel('rustc', [join(homedir(), '.cargo', 'bin')]);
  if (!rustc) {
    throw new ErroBinarios(
      'rustc não encontrado (nem no PATH nem em ~/.cargo/bin). Instale o Rust ou informe --target <triple>.',
    );
  }
  const r = spawnSync(rustc, ['-vV'], { encoding: 'utf8' });
  const m = /^host:\s*(\S+)/m.exec(r.stdout ?? '');
  if (r.status !== 0 || !m) throw new ErroBinarios(`Falha ao executar "${rustc} -vV": ${r.stderr}`);
  return m[1];
}

export const extensaoExe = (triple) => (triple.includes('windows') ? '.exe' : '');

export async function sha256Arquivo(caminho) {
  const h = createHash('sha256');
  await pipeline(createReadStream(caminho), h);
  return h.digest('hex');
}

/** Baixa `url` para `destino` (gravando em `destino.part` e renomeando ao final), com novas tentativas. */
export async function baixar(url, destino, tentativas = 4) {
  const parcial = `${destino}.part`;
  let ultimoErro;
  for (let i = 1; i <= tentativas; i++) {
    try {
      const resp = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'clipora-build-scripts' } });
      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);
      await pipeline(Readable.fromWeb(resp.body), createWriteStream(parcial));
      await rename(parcial, destino);
      return;
    } catch (e) {
      ultimoErro = e;
      await unlink(parcial).catch(() => {});
      if (i < tentativas) {
        aviso(`download falhou (${e.message}); nova tentativa ${i + 1}/${tentativas}: ${url}`);
        await new Promise((r) => setTimeout(r, 1500 * i));
      }
    }
  }
  throw new ErroBinarios(`Não foi possível baixar ${url}: ${ultimoErro?.message}`);
}

/** gpg a usar. CLIPORA_GPG=<caminho> força um executável; CLIPORA_GPG=nenhum simula a ausência. */
export function encontrarGpg() {
  const forcado = process.env.CLIPORA_GPG;
  if (forcado === 'nenhum') return null;
  if (forcado) return forcado;
  return encontrarExecutavel('gpg', [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    'C:\\Program Files (x86)\\GnuPG\\bin',
    'C:\\Program Files\\GnuPG\\bin',
    // Git for Windows (presente nos runners do GitHub) traz o GnuPG.
    'C:\\Program Files\\Git\\usr\\bin',
  ]);
}

/**
 * Verifica uma assinatura destacada com um chaveiro temporário e isolado (não toca no ~/.gnupg do usuário).
 * Exige que a chave primária que assinou tenha exatamente o fingerprint fixado.
 * Retorna 'ok' ou 'sem-gpg'. Lança ErroBinarios se a assinatura for inválida.
 */
export async function verificarAssinaturaGpg({ arquivo, assinatura, chave, fingerprint }) {
  const gpg = encontrarGpg();
  if (!gpg) return 'sem-gpg';
  const home = await mkdtemp(join(tmpdir(), 'clipora-gpg-'));
  try {
    const base = ['--homedir', home, '--batch', '--no-tty', '--no-autostart'];
    const imp = spawnSync(gpg, [...base, '--import', chave], { encoding: 'utf8' });
    if (imp.status !== 0) throw new ErroBinarios(`gpg --import falhou: ${imp.stderr}`);
    const ver = spawnSync(gpg, [...base, '--status-fd', '1', '--verify', assinatura, arquivo], { encoding: 'utf8' });
    const validsig = (ver.stdout ?? '').split('\n').find((l) => l.startsWith('[GNUPG:] VALIDSIG '));
    // VALIDSIG <fpr-da-subchave> ... <fpr-da-chave-primária>
    const primaria = validsig?.trim().split(/\s+/).pop();
    if (ver.status !== 0 || !primaria) {
      throw new ErroBinarios(`Assinatura GPG INVÁLIDA para ${arquivo}:\n${ver.stdout}\n${ver.stderr}`);
    }
    if (primaria.toUpperCase() !== fingerprint.toUpperCase()) {
      throw new ErroBinarios(`Assinatura feita por chave inesperada ${primaria} (esperado ${fingerprint}).`);
    }
    return 'ok';
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

export function avisarSemGpg(oQue) {
  aviso(
    `gpg NÃO encontrado: a assinatura GPG de ${oQue} NÃO foi verificada.\n` +
      '          A integridade foi garantida apenas pelo SHA-256 fixado em scripts/binarios.lock.\n' +
      '          Instale o GnuPG (macOS: brew install gnupg; Debian/Ubuntu: apt install gnupg; Windows: Gpg4win)\n' +
      '          ou use --exigir-gpg (recomendado no CI) para falhar nesse caso.',
  );
}

/** Executa um comando herdando stdout/stderr; lança se falhar. */
export function executar(cmd, args, opcoes = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opcoes });
  if (r.status !== 0) throw new ErroBinarios(`Comando falhou (${r.status ?? r.signal}): ${cmd} ${args.join(' ')}`);
}

export async function principal(fn) {
  try {
    await fn();
  } catch (e) {
    console.error(`[binarios] ERRO: ${e instanceof ErroBinarios ? e.message : e.stack}`);
    process.exit(1);
  }
}
