// Extrator de ZIP mínimo, só com módulos nativos do Node (sem `unzip`/`tar` externos, que variam
// por sistema). Suporta entradas "stored" (0) e "deflate" (8), sem ZIP64, sem criptografia e sem
// links simbólicos — exatamente o que os .zip onedir oficiais do yt-dlp usam (verificado em
// 2026-11-05). Rejeita caminhos absolutos e com `..` (zip-slip). Confere o CRC-32 de cada arquivo.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import zlib from 'node:zlib';
import { ErroBinarios } from './comum.mjs';

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

function localizarFimDiretorio(buf) {
  const minimo = Math.max(0, buf.length - 0xffff - 22);
  for (let i = buf.length - 22; i >= minimo; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new ErroBinarios('ZIP inválido: fim do diretório central não encontrado.');
}

function caminhoSeguro(raiz, nome) {
  if (nome.includes('\\') || nome.startsWith('/') || /^[a-zA-Z]:/.test(nome) || nome.includes('\0')) {
    throw new ErroBinarios(`ZIP com caminho inseguro: ${nome}`);
  }
  const partes = nome.split('/').filter(Boolean);
  if (partes.some((p) => p === '..' || p === '.')) throw new ErroBinarios(`ZIP com caminho inseguro: ${nome}`);
  const destino = resolve(raiz, ...partes);
  if (destino !== resolve(raiz) && !destino.startsWith(resolve(raiz) + sep)) {
    throw new ErroBinarios(`ZIP com caminho fora do destino: ${nome}`);
  }
  return destino;
}

/**
 * Extrai `arquivoZip` para o diretório `raiz` (que deve existir e estar vazio).
 * Retorna a lista de caminhos relativos (com `/`) dos arquivos extraídos.
 */
export async function extrairZip(arquivoZip, raiz) {
  const buf = await readFile(arquivoZip);
  const fim = localizarFimDiretorio(buf);
  const total = buf.readUInt16LE(fim + 10);
  const offsetCentral = buf.readUInt32LE(fim + 16);
  if (total === 0xffff || offsetCentral === 0xffffffff) throw new ErroBinarios('ZIP64 não suportado.');

  const extraidos = [];
  let p = offsetCentral;
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new ErroBinarios('ZIP inválido: entrada do diretório central.');
    const sistemaOrigem = buf.readUInt8(p + 5); // 3 = Unix
    const flags = buf.readUInt16LE(p + 8);
    const metodo = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const tamComprimido = buf.readUInt32LE(p + 20);
    const tamOriginal = buf.readUInt32LE(p + 24);
    const lenNome = buf.readUInt16LE(p + 28);
    const lenExtra = buf.readUInt16LE(p + 30);
    const lenComentario = buf.readUInt16LE(p + 32);
    const atributos = buf.readUInt32LE(p + 38);
    const offsetLocal = buf.readUInt32LE(p + 42);
    const nome = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + lenNome);
    p += 46 + lenNome + lenExtra + lenComentario;

    if (flags & 0x1) throw new ErroBinarios(`ZIP criptografado não suportado: ${nome}`);
    const modoUnix = sistemaOrigem === 3 ? atributos >>> 16 : 0;
    if ((modoUnix & S_IFMT) === S_IFLNK) throw new ErroBinarios(`ZIP com link simbólico não suportado: ${nome}`);

    const destino = caminhoSeguro(raiz, nome);
    if (nome.endsWith('/')) {
      await mkdir(destino, { recursive: true });
      continue;
    }

    if (buf.readUInt32LE(offsetLocal) !== 0x04034b50) throw new ErroBinarios(`ZIP inválido: cabeçalho local de ${nome}`);
    const inicio = offsetLocal + 30 + buf.readUInt16LE(offsetLocal + 26) + buf.readUInt16LE(offsetLocal + 28);
    const bruto = buf.subarray(inicio, inicio + tamComprimido);
    let dados;
    if (metodo === 0) dados = bruto;
    else if (metodo === 8) dados = zlib.inflateRawSync(bruto);
    else throw new ErroBinarios(`Método de compressão ${metodo} não suportado: ${nome}`);
    if (dados.length !== tamOriginal) throw new ErroBinarios(`Tamanho divergente ao extrair ${nome}`);
    if (typeof zlib.crc32 === 'function' && zlib.crc32(dados) >>> 0 !== crc) {
      throw new ErroBinarios(`CRC-32 divergente ao extrair ${nome}`);
    }

    await mkdir(dirname(destino), { recursive: true });
    const executavel = (modoUnix & 0o111) !== 0 || /\.(exe|dll|pyd)$/i.test(nome);
    await writeFile(destino, dados, { mode: executavel ? 0o755 : 0o644 });
    extraidos.push(nome);
  }
  return extraidos;
}
