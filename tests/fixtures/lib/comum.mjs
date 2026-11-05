// Utilidades compartilhadas pelos executáveis falsos do Clipora.
// Somente módulos nativos do Node: sem dependências.

import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const ARQUIVO_CONFIG_PASTA = 'clipora-falso.json';

/**
 * Lê `clipora-falso.json` na pasta do executável (a pasta de CLIPORA_BIN_DIR)
 * e aplica suas chaves CLIPORA_* como variáveis de ambiente, sem sobrescrever
 * as já definidas. Permite cenários diferentes por teste em paralelo (testes
 * Rust) sem mexer no ambiente do processo de teste. Os filhos (ffmpeg)
 * herdam o resultado.
 */
export function aplicarConfigDaPasta() {
  const executavel = process.argv[1];
  if (!executavel) return;
  let config;
  try {
    config = JSON.parse(readFileSync(join(dirname(executavel), ARQUIVO_CONFIG_PASTA), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return;
    throw new Error(`${ARQUIVO_CONFIG_PASTA} inválido: ${e.message}`);
  }
  for (const [chave, valor] of Object.entries(config)) {
    if (!chave.startsWith('CLIPORA_')) throw new Error(`${ARQUIVO_CONFIG_PASTA}: chave não suportada ${chave}`);
    if (process.env[chave] === undefined) process.env[chave] = String(valor);
  }
}

export const dormir = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

/** Mantém o processo vivo para sempre (simula processo travado). */
export function travar() {
  setInterval(() => {}, 1 << 30);
  return new Promise(() => {});
}

/**
 * Acrescenta um evento JSON (uma linha) ao arquivo indicado em
 * CLIPORA_FALSO_REGISTRO. Sem a variável, não registra nada.
 */
export function registrar(evento) {
  const arquivo = process.env.CLIPORA_FALSO_REGISTRO;
  if (!arquivo) return;
  const linha = { ts: new Date().toISOString(), pid: process.pid, ppid: process.ppid, ...evento };
  appendFileSync(arquivo, `${JSON.stringify(linha)}\n`);
}

/** Lê o registro JSONL produzido pelos executáveis falsos. */
export async function lerRegistro(arquivo) {
  const { readFile } = await import('node:fs/promises');
  let texto = '';
  try {
    texto = await readFile(arquivo, 'utf8');
  } catch {
    return [];
  }
  return texto.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/** Equivalente aproximado de `format_bytes` do yt-dlp (ex.: "4.00MiB"). */
export function formatarBytes(n) {
  if (n == null) return 'N/A';
  const unidades = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let valor = n;
  let i = 0;
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024;
    i += 1;
  }
  return `${valor.toFixed(2)}${unidades[i]}`;
}

/** Equivalente aproximado de `format_eta`/duração do yt-dlp ("00:03"). */
export function formatarTempo(segundos) {
  if (segundos == null || !Number.isFinite(segundos)) return 'Unknown';
  const s = Math.max(0, Math.round(segundos));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const dd = (x) => String(x).padStart(2, '0');
  return h > 0 ? `${dd(h)}:${dd(m)}:${dd(r)}` : `${dd(m)}:${dd(r)}`;
}

export function inteiroDoAmbiente(nome, padrao) {
  const bruto = process.env[nome];
  if (bruto === undefined || bruto === '') return padrao;
  const n = Number(bruto);
  return Number.isFinite(n) ? n : padrao;
}
