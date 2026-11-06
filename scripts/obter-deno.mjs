#!/usr/bin/env node
// Obtém somente os ZIPs oficiais fixados no lock e prepara o recurso executável Deno do Tauri.
// Uso: node scripts/obter-deno.mjs [--target <triple>] [--assinar-com <identidade>]

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import zlib from 'node:zlib';
import { DIR_BINARIOS, DIR_SCRIPTS, ErroBinarios, RAIZ, argumento, detectarTriple, lerLock, log, principal, temFlag } from './comum.mjs';

const VERSAO_FIXA = '2.7.0';
const BASE_URL = `https://github.com/denoland/deno/releases/download/v${VERSAO_FIXA}/`;
const TRIPLES_MAC = ['aarch64-apple-darwin', 'x86_64-apple-darwin'];
const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFLNK = 0o120000;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function validarAssetDeno(lock, triple) {
  const deno = lock?.deno;
  if (deno?.versao !== VERSAO_FIXA) throw new ErroBinarios(`Deno deve estar fixado em ${VERSAO_FIXA}.`);
  const alvo = deno.alvos?.[triple];
  if (!alvo) throw new ErroBinarios(`Não há alvo Deno fixado para ${triple}.`);
  const esperado = `deno-${triple}.zip`;
  if (alvo.arquivo !== esperado || alvo.url !== `${BASE_URL}${esperado}`) {
    throw new ErroBinarios(`Origem Deno inválida para ${triple}; use o asset oficial ${esperado}.`);
  }
  if (!/^[a-f0-9]{64}$/.test(alvo.sha256 ?? '')) throw new ErroBinarios(`SHA-256 inválido no lock Deno para ${triple}.`);
  return alvo;
}

function acharFimDiretorio(bytes) {
  const inicio = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= inicio; i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      const comentario = bytes.readUInt16LE(i + 20);
      if (i + 22 + comentario === bytes.length) return i;
    }
  }
  throw new ErroBinarios('ZIP Deno inválido: diretório final ausente.');
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function lerZip(bytes, nomeEsperado) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 22) throw new ErroBinarios('ZIP Deno inválido ou vazio.');
  const fim = acharFimDiretorio(bytes);
  const disco = bytes.readUInt16LE(fim + 4);
  const discoCentral = bytes.readUInt16LE(fim + 6);
  const nestaParte = bytes.readUInt16LE(fim + 8);
  const total = bytes.readUInt16LE(fim + 10);
  const tamCentral = bytes.readUInt32LE(fim + 12);
  const inicioCentral = bytes.readUInt32LE(fim + 16);
  if (disco || discoCentral || nestaParte !== total || total === 0xffff || tamCentral === 0xffffffff || inicioCentral === 0xffffffff) {
    throw new ErroBinarios('ZIP Deno dividido ou ZIP64 não suportado.');
  }
  if (inicioCentral + tamCentral > fim) throw new ErroBinarios('ZIP Deno inválido: diretório central truncado.');
  const entradas = [];
  let pos = inicioCentral;
  for (let i = 0; i < total; i++) {
    if (pos + 46 > fim || bytes.readUInt32LE(pos) !== 0x02014b50) throw new ErroBinarios('ZIP Deno inválido: entrada central.');
    const sistema = bytes.readUInt8(pos + 5);
    const flags = bytes.readUInt16LE(pos + 8);
    const metodo = bytes.readUInt16LE(pos + 10);
    const crc = bytes.readUInt32LE(pos + 16);
    const tamanhoComprimido = bytes.readUInt32LE(pos + 20);
    const tamanhoOriginal = bytes.readUInt32LE(pos + 24);
    const nomeLen = bytes.readUInt16LE(pos + 28);
    const extraLen = bytes.readUInt16LE(pos + 30);
    const comentarioLen = bytes.readUInt16LE(pos + 32);
    const discoInicio = bytes.readUInt16LE(pos + 34);
    const atributos = bytes.readUInt32LE(pos + 38);
    const localOffset = bytes.readUInt32LE(pos + 42);
    const fimEntrada = pos + 46 + nomeLen + extraLen + comentarioLen;
    if (fimEntrada > inicioCentral + tamCentral) throw new ErroBinarios('ZIP Deno inválido: registro central truncado.');
    const nome = bytes.toString(flags & 0x800 ? 'utf8' : 'latin1', pos + 46, pos + 46 + nomeLen);
    pos = fimEntrada;
    if (discoInicio !== 0 || tamanhoComprimido === 0xffffffff || tamanhoOriginal === 0xffffffff || localOffset === 0xffffffff) {
      throw new ErroBinarios(`ZIP Deno inválido ou ZIP64 não suportado: ${nome}`);
    }
    if ((flags & 1) !== 0) throw new ErroBinarios(`ZIP Deno criptografado não suportado: ${nome}`);
    if (nome.includes('\\') || nome.includes('\0') || nome.startsWith('/') || /^[a-z]:/i.test(nome) || nome.split('/').some((p) => p === '..' || p === '.')) {
      throw new ErroBinarios(`ZIP Deno com caminho inseguro: ${nome}`);
    }
    const modo = sistema === 3 ? atributos >>> 16 : 0;
    if ((modo & S_IFMT) === S_IFLNK) throw new ErroBinarios(`ZIP Deno contém link simbólico: ${nome}`);
    if (nome.endsWith('/') || ((modo & S_IFMT) !== 0 && (modo & S_IFMT) !== S_IFREG)) {
      throw new ErroBinarios(`ZIP Deno contém arquivo extra ou tipo não regular: ${nome}`);
    }
    if (nome !== nomeEsperado) throw new ErroBinarios(`ZIP Deno contém arquivo extra ou nome inesperado: ${nome}`);
    if (metodo !== 0 && metodo !== 8) throw new ErroBinarios(`Método ZIP Deno não suportado: ${metodo}`);
    entradas.push({ nome, flags, metodo, crc, tamanhoComprimido, tamanhoOriginal, localOffset });
  }
  if (pos !== inicioCentral + tamCentral || entradas.length !== 1) throw new ErroBinarios('ZIP Deno deve conter somente o executável regular esperado.');
  const entrada = entradas[0];
  const local = entrada.localOffset;
  if (local + 30 > inicioCentral || bytes.readUInt32LE(local) !== 0x04034b50) throw new ErroBinarios('ZIP Deno inválido: cabeçalho local ausente.');
  const localFlags = bytes.readUInt16LE(local + 6);
  const localMetodo = bytes.readUInt16LE(local + 8);
  const nomeLocalLen = bytes.readUInt16LE(local + 26);
  const extraLocalLen = bytes.readUInt16LE(local + 28);
  const nomeLocal = bytes.toString(localFlags & 0x800 ? 'utf8' : 'latin1', local + 30, local + 30 + nomeLocalLen);
  const inicioDados = local + 30 + nomeLocalLen + extraLocalLen;
  const fimDados = inicioDados + entrada.tamanhoComprimido;
  if (nomeLocal !== entrada.nome || localMetodo !== entrada.metodo || localFlags !== entrada.flags || fimDados > inicioCentral) {
    throw new ErroBinarios('ZIP Deno inválido: cabeçalhos local e central divergem.');
  }
  const comprimido = bytes.subarray(inicioDados, fimDados);
  let executavel;
  try {
    executavel = entrada.metodo === 0 ? Buffer.from(comprimido) : zlib.inflateRawSync(comprimido, { maxOutputLength: 512 * 1024 * 1024 });
  } catch (e) {
    throw new ErroBinarios(`Não foi possível extrair o executável Deno: ${e.message}`);
  }
  if (executavel.length !== entrada.tamanhoOriginal || crc32(executavel) !== entrada.crc) {
    throw new ErroBinarios('ZIP Deno inválido: tamanho ou CRC-32 do executável divergente.');
  }
  if (executavel.length === 0) throw new ErroBinarios('O executável Deno extraído está vazio.');
  return executavel;
}

export function validarZipDeno(bytes, nomeExecutavel) {
  if (!['deno', 'deno.exe'].includes(nomeExecutavel)) throw new ErroBinarios(`Nome de executável Deno não permitido: ${nomeExecutavel}`);
  return lerZip(bytes, nomeExecutavel);
}

export function argumentosCodesignDeno(identity, entitlementsPath) {
  if (!identity || !entitlementsPath) throw new ErroBinarios('Assinatura Deno exige identidade e arquivo de entitlements.');
  const timestamp = identity === '-' ? ['--timestamp=none'] : ['--timestamp'];
  return ['--force', '--options', 'runtime', ...timestamp, '--entitlements', entitlementsPath, '--sign', identity];
}

function manifesto({ triple, executavel, assets, origemZip, sha256Zip }) {
  return {
    formato: 1,
    versao: VERSAO_FIXA,
    triple,
    sha256Executavel: sha256(executavel),
    origemZip: origemZip ?? (assets.length === 1 ? assets[0].url : assets.map((a) => a.url)),
    sha256Zip: sha256Zip ?? (assets.length === 1 ? assets[0].sha256 : assets.map((a) => a.sha256)),
  };
}

export async function instalarZipDeno({ lock, triple, bytes, raiz }) {
  const asset = validarAssetDeno(lock, triple);
  if (sha256(bytes) !== asset.sha256) throw new ErroBinarios(`SHA-256 do ZIP Deno divergente para ${triple}; instalação cancelada.`);
  const executavel = validarZipDeno(bytes, triple.includes('windows') ? 'deno.exe' : 'deno');
  const nome = `clipora-deno-${triple}${triple.includes('windows') ? '.exe' : ''}`;
  const temp = await mkdtemp(join(raiz, '.deno-validado-'));
  try {
    const temporario = join(temp, nome);
    await writeFile(temporario, executavel, { mode: 0o755 });
    if (!triple.includes('windows')) await chmod(temporario, 0o755);
    const json = manifesto({ triple, executavel, assets: [asset] });
    const manifestoTmp = join(temp, 'clipora-deno.json');
    await writeFile(manifestoTmp, `${JSON.stringify(json, null, 2)}\n`);
    await rename(temporario, join(raiz, nome));
    await rename(manifestoTmp, join(raiz, 'clipora-deno.json'));
    return { nome, manifesto: json };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function baixarZip(asset) {
  const response = await fetch(asset.url, { redirect: 'follow', headers: { 'User-Agent': 'clipora-build-scripts' } });
  const destino = new URL(response.url);
  if (!response.ok || !response.body || destino.protocol !== 'https:' || !['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(destino.hostname)) {
    throw new ErroBinarios(`Download Deno não veio de um endpoint HTTPS oficial: ${response.status} ${response.url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function executar(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) throw new ErroBinarios(`${cmd} falhou: ${result.error?.message ?? result.stderr ?? result.status}`);
  return result.stdout;
}

async function obterAlvo(lock, triple, opcoes = {}) {
  const asset = validarAssetDeno(lock, triple);
  const bytes = opcoes.bytes ?? await baixarZip(asset);
  if (sha256(bytes) !== asset.sha256) throw new ErroBinarios(`SHA-256 do ZIP Deno divergente para ${triple}; instalação cancelada.`);
  const executableName = triple.includes('windows') ? 'deno.exe' : 'deno';
  const executable = validarZipDeno(bytes, executableName);
  return { asset, executable };
}

async function gravarAtomico(destino, bytes, mode = 0o644) {
  const temporario = `${destino}.tmp-${process.pid}`;
  await writeFile(temporario, bytes, { mode });
  await rename(temporario, destino);
}

async function jaInstalado(lock, triple, finalPath, manifestPath) {
  if (!existsSync(finalPath) || !existsSync(manifestPath)) return false;
  try {
    const executavel = await readFile(finalPath);
    const atual = JSON.parse(await readFile(manifestPath, 'utf8'));
    const alvos = triple === 'universal-apple-darwin' ? TRIPLES_MAC : [triple];
    const assets = alvos.map((t) => validarAssetDeno(lock, t));
    const esperado = manifesto({ triple, executavel, assets });
    return JSON.stringify(atual) === JSON.stringify(esperado);
  } catch {
    return false;
  }
}

async function assinarInstalado(lock, triple, identity, entitlementsPath) {
  if (!triple.includes('apple-darwin')) throw new ErroBinarios('--assinar-instalado só é válido para macOS.');
  const executablePath = join(DIR_BINARIOS, 'deno', 'clipora-deno');
  const manifestPath = join(DIR_BINARIOS, 'deno', 'clipora-deno.json');
  if (!existsSync(executablePath) || !existsSync(manifestPath)) throw new ErroBinarios(`Recurso/manifesto Deno ausente para assinatura: ${triple}.`);
  const atual = JSON.parse(await readFile(manifestPath, 'utf8'));
  const binario = await readFile(executablePath);
  if (atual.triple !== triple || atual.versao !== VERSAO_FIXA || atual.sha256Executavel !== sha256(binario)) {
    throw new ErroBinarios('Manifesto Deno inválido antes da assinatura; não assinei o executável.');
  }
  const alvos = triple === 'universal-apple-darwin' ? TRIPLES_MAC : [triple];
  const assets = alvos.map((t) => validarAssetDeno(lock, t));
  const esperado = manifesto({ triple, executavel: binario, assets });
  if (JSON.stringify(atual) !== JSON.stringify(esperado)) throw new ErroBinarios('Origem/hash do ZIP no manifesto divergente antes da assinatura.');
  const stage = await mkdtemp(join(tmpdir(), 'clipora-deno-assinar-'));
  try {
    const staged = join(stage, basename(executablePath));
    await writeFile(staged, binario, { mode: 0o755 });
    await chmod(staged, 0o755);
    executar('codesign', [...argumentosCodesignDeno(identity, entitlementsPath), staged]);
    const assinado = await readFile(staged);
    const atualizado = manifesto({ triple, executavel: assinado, assets });
    await gravarAtomico(executablePath, assinado, 0o755);
    await gravarAtomico(manifestPath, Buffer.from(`${JSON.stringify(atualizado, null, 2)}\n`));
    log(`Recurso Deno assinado; manifesto atualizado para os bytes assinados (${atualizado.sha256Executavel}).`);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

async function obter(lock, triple, identity, entitlementsPath) {
  const triples = triple === 'universal-apple-darwin' ? TRIPLES_MAC : [triple];
  const assets = triples.map((t) => validarAssetDeno(lock, t));
  const identidadeFinal = triple.includes('apple-darwin') ? (identity ?? '-') : identity;
  if (identidadeFinal && !entitlementsPath) throw new ErroBinarios('Assinatura macOS de Deno exige --entitlements para preservar o runtime JavaScript.');
  const extensao = triple.includes('windows') ? '.exe' : '';
  const cacheNome = `clipora-deno-${triple}${extensao}`;
  const cachePath = join(DIR_BINARIOS, cacheNome);
  const manifestDir = join(DIR_BINARIOS, 'deno');
  const resourceExe = join(manifestDir, `clipora-deno${extensao}`);
  const manifestPath = join(manifestDir, 'clipora-deno.json');
  if (await jaInstalado(lock, triple, resourceExe, manifestPath)) {
    log(`Deno ${VERSAO_FIXA} ${triple} já preparado no recurso e manifesto validado; nada a fazer.`);
    if (identity) await assinarInstalado(lock, triple, identity, entitlementsPath);
    return;
  }
  const stage = await mkdtemp(join(tmpdir(), 'clipora-deno-'));
  try {
    const executaveis = [];
    for (const asset of assets) {
      const resultado = await obterAlvo(lock, asset.url.match(/deno-([^/]+)\.zip$/)[1]);
      const caminho = join(stage, asset.url.match(/deno-([^/]+)\.zip$/)[1] + (asset.url.includes('windows') ? '.exe' : ''));
      await writeFile(caminho, resultado.executable, { mode: 0o755 });
      if (!asset.url.includes('windows')) await chmod(caminho, 0o755);
      executaveis.push({ ...resultado, caminho });
      log(`Deno ${VERSAO_FIXA} ${basename(asset.arquivo)}: ZIP SHA-256 conferido.`);
    }
    let finalBytes;
    const stagedFinal = join(stage, cacheNome);
    if (triple === 'universal-apple-darwin') {
      executar('lipo', ['-create', ...executaveis.map((e) => e.caminho), '-output', stagedFinal]);
      const archs = executar('lipo', ['-archs', stagedFinal]).trim().split(/\s+/).sort();
      if (archs.join(',') !== 'arm64,x86_64') throw new ErroBinarios(`Deno universal contém arquiteturas inesperadas: ${archs.join(',')}`);
      finalBytes = await readFile(stagedFinal);
    } else {
      finalBytes = executaveis[0].executable;
      await writeFile(stagedFinal, finalBytes, { mode: 0o755 });
      if (!triple.includes('windows')) await chmod(stagedFinal, 0o755);
    }
    await mkdir(DIR_BINARIOS, { recursive: true });
    await mkdir(manifestDir, { recursive: true });
    await gravarAtomico(cachePath, finalBytes, 0o755);
    if (!triple.includes('windows')) await chmod(cachePath, 0o755);
    if (identidadeFinal) {
      if (!triple.includes('apple-darwin')) throw new ErroBinarios('--assinar-com só é válido para macOS.');
      executar('codesign', [...argumentosCodesignDeno(identidadeFinal, entitlementsPath), stagedFinal]);
      finalBytes = await readFile(stagedFinal);
      log(`Recurso Deno assinado com ${identidadeFinal}; manifesto usa os bytes assinados.`);
    }
    const json = manifesto({ triple, executavel: finalBytes, assets });
    await gravarAtomico(resourceExe, finalBytes, 0o755);
    if (!triple.includes('windows')) await chmod(resourceExe, 0o755);
    await gravarAtomico(join(manifestDir, 'clipora-deno.json'), Buffer.from(`${JSON.stringify(json, null, 2)}\n`));
    log(`gravado ${relative(RAIZ, resourceExe)} (${json.sha256Executavel})`);
    log(`cache validado ${relative(RAIZ, cachePath)}`);
    log(`gravado binaries/deno/clipora-deno.json`);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal(async () => {
    const lock = await lerLock();
    const triple = argumento('target') ?? detectarTriple();
    const identity = argumento('assinar-com');
    const entitlementsPath = argumento('entitlements') ?? (triple.includes('apple-darwin') ? join(DIR_SCRIPTS, 'deno.entitlements.plist') : undefined);
    if (temFlag('assinar-instalado')) {
      if (!identity || !entitlementsPath) throw new ErroBinarios('--assinar-instalado exige --assinar-com <identidade> e --entitlements <plist>.');
      await assinarInstalado(lock, triple, identity, entitlementsPath);
      return;
    }
    if (!lock.deno || lock.deno.versao !== VERSAO_FIXA) throw new ErroBinarios('scripts/binarios.lock ainda não fixa Deno 2.7.0.');
    await obter(lock, triple, identity, entitlementsPath);
  });
}
