#!/usr/bin/env node
// Monta a pasta com tudo o que vai na release do GitHub de uma tag `v*`. Usado pelo job
// `release` do CI.
//
//   node scripts/montar-release.mjs --artefatos <dir> --saida <dir> [--versao 0.1.0] [--sem-fontes]
//
// <dir> de --artefatos é onde o actions/download-artifact gravou os artefatos do workflow:
//   clipora-<triple>/   instaladores em subpastas (dmg/, nsis/, msi/, deb/, rpm/) + SHA256SUMS
//   ffmpeg-<triple>/    ffmpeg-build-info-<triple>.txt (linha exata do configure)
//
// Resultado em --saida, tudo no mesmo nível:
//   - os instaladores de cada alvo, depois de conferir o SHA256SUMS gerado no build;
//   - SHA256SUMS-<triple>.txt e ffmpeg-build-info-<triple>.txt;
//   - os fontes que as licenças exigem, conferidos contra scripts/binarios.lock:
//     ffmpeg-<versao>.tar.xz(.asc), yt-dlp-<versao>.tar.gz e yt-dlp-THIRD_PARTY_LICENSES.txt.
//
// Sem --versao, usa a de src-tauri/tauri.conf.json. --sem-fontes pula os downloads (testes).
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative, sep } from 'node:path';
import {
  DIR_SCRIPTS,
  ErroBinarios,
  RAIZ,
  argumento,
  baixar,
  log,
  lerLock,
  principal,
  sha256Arquivo,
  temFlag,
  verificarAssinaturaGpg,
} from './comum.mjs';

/** Alvos publicados. Faltar qualquer um interrompe a release. */
export const ALVOS = [
  'aarch64-apple-darwin',
  'universal-apple-darwin',
  'x86_64-pc-windows-msvc',
  'aarch64-pc-windows-msvc',
  'x86_64-unknown-linux-gnu',
  'aarch64-unknown-linux-gnu',
];

const EXTENSOES = ['.dmg', '.exe', '.msi', '.deb', '.rpm'];

/** Lê um SHA256SUMS (`<hash>  ./sub/arquivo`) e devolve [[hash, caminho relativo], ...]. */
export function lerSomas(texto) {
  const linhas = texto.split('\n').filter((l) => l.trim() !== '');
  return linhas.map((l) => {
    const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(l.trim());
    if (!m) throw new ErroBinarios(`linha inválida no SHA256SUMS: ${l}`);
    return [m[1], m[2].replace(/^\.\//, '')];
  });
}

async function listarArquivos(dir) {
  const saida = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) saida.push(...(await listarArquivos(p)));
    else saida.push(p);
  }
  return saida;
}

/**
 * Confere e copia os instaladores e os arquivos de build de cada alvo para `saida`.
 * Devolve os nomes copiados, em ordem.
 */
export async function montarPacotes({ artefatos, saida, versao, alvos = ALVOS }) {
  await mkdir(saida, { recursive: true });
  const copiados = new Map(); // nome publicado -> origem, para detectar colisões
  const copiar = async (origem, nome) => {
    if (copiados.has(nome)) {
      throw new ErroBinarios(`dois arquivos com o mesmo nome na release: ${copiados.get(nome)} e ${origem}`);
    }
    copiados.set(nome, origem);
    await copyFile(origem, join(saida, nome));
  };

  for (const alvo of alvos) {
    const dir = join(artefatos, `clipora-${alvo}`);
    const somasArq = join(dir, 'SHA256SUMS');
    if (!existsSync(somasArq)) throw new ErroBinarios(`faltam os pacotes de ${alvo} (${somasArq})`);
    const somas = lerSomas(await readFile(somasArq, 'utf8'));
    if (somas.length === 0) throw new ErroBinarios(`SHA256SUMS de ${alvo} está vazio`);

    // Todo instalador do artefato precisa constar no SHA256SUMS, e vice-versa.
    const instaladores = (await listarArquivos(dir))
      .filter((p) => EXTENSOES.some((ext) => p.endsWith(ext)))
      .map((p) => relative(dir, p).split(sep).join('/'))
      .sort();
    const listados = somas.map(([, rel]) => rel).sort();
    if (JSON.stringify(instaladores) !== JSON.stringify(listados)) {
      throw new ErroBinarios(
        `os instaladores de ${alvo} não batem com o SHA256SUMS:\n  no artefato: ${instaladores.join(', ')}\n  no SHA256SUMS: ${listados.join(', ')}`,
      );
    }

    for (const [esperado, rel] of somas) {
      const arquivo = join(dir, ...rel.split('/'));
      const obtido = await sha256Arquivo(arquivo);
      if (obtido !== esperado) {
        throw new ErroBinarios(`SHA-256 divergente em ${alvo}/${rel}: obtido ${obtido}, esperado ${esperado}`);
      }
      if (!basename(rel).includes(versao)) {
        throw new ErroBinarios(`${rel} não traz a versão ${versao} no nome; a tag e o app divergem?`);
      }
      await copiar(arquivo, basename(rel));
    }
    await copiar(somasArq, `SHA256SUMS-${alvo}.txt`);

    const info = join(artefatos, `ffmpeg-${alvo}`, `ffmpeg-build-info-${alvo}.txt`);
    if (!existsSync(info)) throw new ErroBinarios(`falta ${info}`);
    await copiar(info, `ffmpeg-build-info-${alvo}.txt`);
    log(`${alvo}: ${somas.length} instalador(es) conferido(s).`);
  }
  return [...copiados.keys()];
}

async function exigirGpg(opcoes, oQue) {
  const r = await verificarAssinaturaGpg(opcoes);
  if (r !== 'ok') throw new ErroBinarios(`gpg não encontrado: não dá para verificar ${oQue}.`);
}

/** Código-fonte do FFmpeg: o mesmo tarball do build (cache do CI ou ffmpeg.org), SHA-256 + GPG. */
async function fonteFfmpeg(lock, saida) {
  const ff = lock.ffmpeg;
  const nome = `ffmpeg-${ff.versao}.tar.xz`;
  // Mesmo diretório que scripts/compilar-ffmpeg.mjs usa, para aproveitar o cache do CI.
  const cache = join(tmpdir(), `clipora-ffmpeg-${ff.versao}`);
  await mkdir(cache, { recursive: true });
  const tarball = join(cache, nome);
  if (!existsSync(tarball) || (await sha256Arquivo(tarball)) !== ff.tarball.sha256) {
    log(`baixando ${ff.tarball.url}`);
    await baixar(ff.tarball.url, tarball, 12);
  }
  const h = await sha256Arquivo(tarball);
  if (h !== ff.tarball.sha256) throw new ErroBinarios(`SHA-256 de ${nome} divergente: ${h}`);
  const asc = `${tarball}.asc`;
  const verificar = () =>
    exigirGpg(
      { arquivo: tarball, assinatura: asc, chave: join(DIR_SCRIPTS, ff.chaveGpg.arquivo), fingerprint: ff.chaveGpg.fingerprint },
      nome,
    );
  if (!existsSync(asc)) await baixar(ff.tarball.assinaturaUrl, asc, 12);
  try {
    await verificar();
  } catch {
    await rm(asc, { force: true });
    await baixar(ff.tarball.assinaturaUrl, asc, 12);
    await verificar();
  }
  await copyFile(tarball, join(saida, nome));
  await copyFile(asc, join(saida, `${nome}.asc`));
  log(`${nome}: SHA-256 e assinatura GPG conferem.`);
}

/** Código-fonte do yt-dlp da versão embutida e os avisos de terceiros do seu build. */
async function fonteYtDlp(lock, saida) {
  const y = lock.ytDlp;
  const tmp = join(tmpdir(), `clipora-release-yt-dlp-${y.versao}`);
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });

  const somas = join(tmp, 'SHA2-256SUMS');
  await baixar(y.somas.url, somas);
  await baixar(y.somas.assinaturaUrl, `${somas}.sig`);
  const hSomas = await sha256Arquivo(somas);
  if (hSomas !== y.somas.sha256) throw new ErroBinarios(`SHA-256 do SHA2-256SUMS do yt-dlp divergente: ${hSomas}`);
  await exigirGpg(
    { arquivo: somas, assinatura: `${somas}.sig`, chave: join(DIR_SCRIPTS, y.chaveGpg.arquivo), fingerprint: y.chaveGpg.fingerprint },
    'SHA2-256SUMS do yt-dlp',
  );
  const tabela = new Map(lerSomas(await readFile(somas, 'utf8')).map(([h, nome]) => [nome, h]));

  const base = y.somas.url.replace(/\/SHA2-256SUMS$/, '');
  const tar = join(tmp, 'yt-dlp.tar.gz');
  await baixar(`${base}/yt-dlp.tar.gz`, tar);
  const hTar = await sha256Arquivo(tar);
  if (!tabela.has('yt-dlp.tar.gz') || hTar !== tabela.get('yt-dlp.tar.gz')) {
    throw new ErroBinarios(`yt-dlp.tar.gz não confere com o SHA2-256SUMS assinado (${hTar})`);
  }
  await copyFile(tar, join(saida, `yt-dlp-${y.versao}.tar.gz`));

  // A release do yt-dlp não publica este arquivo; ele vem da tag da mesma versão.
  const avisos = join(saida, 'yt-dlp-THIRD_PARTY_LICENSES.txt');
  await baixar(`https://raw.githubusercontent.com/yt-dlp/yt-dlp/${y.versao}/THIRD_PARTY_LICENSES.txt`, avisos);
  if ((await stat(avisos)).size === 0) throw new ErroBinarios('THIRD_PARTY_LICENSES.txt do yt-dlp veio vazio');
  await rm(tmp, { recursive: true, force: true });
  log(`yt-dlp ${y.versao}: código-fonte conferido com o SHA2-256SUMS assinado.`);
}

async function main() {
  const artefatos = argumento('artefatos');
  const saida = argumento('saida');
  if (!artefatos || !saida) {
    console.error('uso: montar-release.mjs --artefatos <dir> --saida <dir> [--versao X] [--sem-fontes]');
    process.exit(2);
  }
  const conf = JSON.parse(await readFile(join(RAIZ, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  const versao = argumento('versao') ?? conf.version;
  if (versao !== conf.version) {
    throw new ErroBinarios(`a tag pede a versão ${versao}, mas src-tauri/tauri.conf.json está em ${conf.version}`);
  }
  await rm(saida, { recursive: true, force: true });
  const nomes = await montarPacotes({ artefatos, saida, versao });
  if (!temFlag('sem-fontes')) {
    const lock = await lerLock();
    await fonteFfmpeg(lock, saida);
    await fonteYtDlp(lock, saida);
  }
  const total = (await readdir(saida)).length;
  log(`release ${versao}: ${total} arquivo(s) em ${saida} (${nomes.length} de pacotes e builds).`);
}

if (import.meta.url === `file://${process.argv[1]}`) await principal(main);
