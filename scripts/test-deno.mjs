import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { argumentosCodesignDeno, validarAssetDeno, validarZipDeno } from './obter-deno.mjs';
import { validarManifestoDeno, versaoDenoPermitida } from './conferir-pacote.mjs';
import { lerLock } from './comum.mjs';

const lock = await lerLock();
const triples = [
  'aarch64-apple-darwin',
  'x86_64-apple-darwin',
  'x86_64-pc-windows-msvc',
  'aarch64-pc-windows-msvc',
  'x86_64-unknown-linux-gnu',
  'aarch64-unknown-linux-gnu',
];

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, mode = 0o100755, system = 3 } of entries) {
    const nameBytes = Buffer.from(name);
    const checksum = crc32(data);
    const local = Buffer.alloc(30 + nameBytes.length + data.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);
    data.copy(local, 30 + nameBytes.length);
    locals.push(local);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt8(system, 5);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(20, 8);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(((mode << 16) >>> 0), 38);
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);
    centrals.push(central);
    offset += local.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDirectory, end]);
}

test('lock cobre os seis alvos Deno com URLs oficiais e hashes SHA-256', () => {
  assert.deepEqual(Object.keys(lock.deno.alvos).sort(), [...triples].sort());
  assert.equal(lock.deno.versao, '2.7.0');
  for (const triple of triples) {
    assert.deepEqual(validarAssetDeno(lock, triple), lock.deno.alvos[triple]);
  }
  assert.throws(() => validarAssetDeno(lock, 'universal-apple-darwin'), /alvo Deno/);
  assert.throws(() => validarAssetDeno({ deno: { ...lock.deno, alvos: { ...lock.deno.alvos, 'x86_64-unknown-linux-gnu': { ...lock.deno.alvos['x86_64-unknown-linux-gnu'], sha256: 'bad' } } } }, 'x86_64-unknown-linux-gnu'), /SHA-256/);
});

test('hash divergente recusa a instalação antes de gravar qualquer executável', async () => {
  const { mkdtemp, readdir, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { instalarZipDeno } = await import('./obter-deno.mjs');
  const raiz = await mkdtemp(join(tmpdir(), 'deno-hash-red-'));
  try {
    const bytes = zip([{ name: 'deno', data: Buffer.from('deno test executable') }]);
    await assert.rejects(instalarZipDeno({ lock, triple: 'aarch64-apple-darwin', bytes, raiz }), /SHA-256.*divergente/);
    assert.deepEqual(await readdir(raiz), []);
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test('ZIP Deno aceita o executável regular único e recusa extras, symlinks e caminhos inseguros', () => {
  const executavel = Buffer.from('deno test executable');
  assert.deepEqual(validarZipDeno(zip([{ name: 'deno', data: executavel }]), 'deno'), executavel);
  assert.throws(() => validarZipDeno(zip([{ name: 'deno', data: executavel }, { name: 'README', data: Buffer.from('extra') }]), 'deno'), /extra|único/i);
  assert.throws(() => validarZipDeno(zip([{ name: 'deno', data: executavel, mode: 0o120777 }]), 'deno'), /simbólico/i);
  assert.throws(() => validarZipDeno(zip([{ name: '../deno', data: executavel }]), 'deno'), /inseguro|caminho/i);
});

test('ZIP validado instala somente o executável e grava manifesto com a soma dos bytes instalados', async () => {
  const { mkdtemp, readFile, readdir, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { instalarZipDeno } = await import('./obter-deno.mjs');
  const bytes = zip([{ name: 'deno', data: Buffer.from('deno synthetic executable') }]);
  const trip = 'aarch64-apple-darwin';
  const asset = lock.deno.alvos[trip];
  const lockTeste = {
    ...lock,
    deno: { ...lock.deno, alvos: { [trip]: { ...asset, sha256: sha256(bytes) } } },
  };
  const raiz = await mkdtemp(join(tmpdir(), 'deno-install-green-'));
  try {
    await instalarZipDeno({ lock: lockTeste, triple: trip, bytes, raiz });
    const exe = await readFile(join(raiz, 'clipora-deno-aarch64-apple-darwin'));
    const manifest = JSON.parse(await readFile(join(raiz, 'clipora-deno.json'), 'utf8'));
    assert.equal(manifest.sha256Executavel, sha256(exe));
    assert.deepEqual((await readdir(raiz)).sort(), ['clipora-deno-aarch64-apple-darwin', 'clipora-deno.json']);
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test('manifesto Deno confere alvo, origem/hash do ZIP e SHA-256 do executável empacotado', () => {
  const executavel = Buffer.from('bytes finais do deno');
  const manifesto = {
    formato: 1,
    versao: '2.7.0',
    triple: 'aarch64-apple-darwin',
    sha256Executavel: sha256(executavel),
    origemZip: lock.deno.alvos['aarch64-apple-darwin'].url,
    sha256Zip: lock.deno.alvos['aarch64-apple-darwin'].sha256,
  };
  assert.deepEqual(validarManifestoDeno(manifesto, executavel, 'aarch64-apple-darwin', lock), []);
  assert.ok(validarManifestoDeno(manifesto, Buffer.from('alterado'), 'aarch64-apple-darwin', lock).includes('SHA-256 do executável divergente'));
  assert.ok(validarManifestoDeno({ ...manifesto, triple: 'x86_64-apple-darwin' }, executavel, 'aarch64-apple-darwin', lock).includes('triple divergente'));
  assert.ok(validarManifestoDeno({ ...manifesto, sha256Zip: '0'.repeat(64) }, executavel, 'aarch64-apple-darwin', lock).includes('SHA-256 do ZIP Deno divergente do lock'));
});

test('manifesto universal registra as duas origens oficiais e seus hashes, sem asset universal inventado', () => {
  const executavel = Buffer.from('universal bytes');
  const manifesto = {
    formato: 1,
    versao: '2.7.0',
    triple: 'universal-apple-darwin',
    sha256Executavel: sha256(executavel),
    origemZip: ['aarch64-apple-darwin', 'x86_64-apple-darwin'].map((triple) => lock.deno.alvos[triple].url),
    sha256Zip: ['aarch64-apple-darwin', 'x86_64-apple-darwin'].map((triple) => lock.deno.alvos[triple].sha256),
  };
  assert.deepEqual(validarManifestoDeno(manifesto, executavel, 'universal-apple-darwin', lock), []);
  assert.throws(() => validarAssetDeno(lock, 'universal-apple-darwin'), /alvo Deno/);
});

test('Tauri empacota o executável Deno e o manifesto juntos como recurso dedicado', () => {
  const conf = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  assert.ok(!conf.bundle.externalBin.some((bin) => bin.includes('deno')));
  assert.equal(conf.bundle.resources['binaries/deno/'], 'deno/');
  assert.ok(!Object.keys(conf.bundle.resources).some((origem) => /clipora-deno/.test(origem)));
});

test('assinatura endurecida do Deno sempre recebe entitlements explícitos', () => {
  assert.deepEqual(argumentosCodesignDeno('Developer ID Application: Clipora', 'scripts/deno.entitlements.plist'), [
    '--force', '--options', 'runtime', '--timestamp', '--entitlements', 'scripts/deno.entitlements.plist',
    '--sign', 'Developer ID Application: Clipora',
  ]);
  assert.deepEqual(argumentosCodesignDeno('-', 'scripts/deno.entitlements.plist'), [
    '--force', '--options', 'runtime', '--timestamp=none', '--entitlements', 'scripts/deno.entitlements.plist',
    '--sign', '-',
  ]);
  assert.throws(() => argumentosCodesignDeno('-', undefined), /entitlements/);
  const entitlements = readFileSync(new URL('./deno.entitlements.plist', import.meta.url), 'utf8');
  assert.match(entitlements, /<key>com\.apple\.security\.cs\.allow-jit<\/key>\s*<true\/>/);
  assert.deepEqual([...entitlements.matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]), ['com.apple.security.cs.allow-jit']);
});

const dirBinarios = fileURLToPath(new URL('../src-tauri/binaries/', import.meta.url));
const dirDeno = join(dirBinarios, 'deno');
const denoExecutavel = join(dirDeno, process.platform === 'win32' ? 'clipora-deno.exe' : 'clipora-deno');
const caminhoSolver = join(dirBinarios, 'yt-dlp', '_internal', 'yt_dlp_ejs', 'yt', 'solver');
let tripleDeno = null;
try {
  tripleDeno = JSON.parse(readFileSync(join(dirDeno, 'clipora-deno.json'), 'utf8')).triple;
} catch {}
const archHost = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
const hostTriple = process.platform === 'darwin' ? `${archHost}-apple-darwin`
  : process.platform === 'win32' ? `${archHost}-pc-windows-msvc`
    : process.platform === 'linux' ? `${archHost}-unknown-linux-gnu` : '';
const hostNative = existsSync(denoExecutavel) &&
  (tripleDeno === hostTriple || (process.platform === 'darwin' && tripleDeno === 'universal-apple-darwin'));

test('Deno empacotado executa JavaScript e o solver EJS N/SIG com JIT local', { skip: !hostNative }, () => {
  const version = spawnSync(denoExecutavel, ['--version'], { encoding: 'utf8', timeout: 15_000 });
  assert.equal(version.status, 0, version.stderr);
  assert.ok(versaoDenoPermitida(version.stdout, '2.7.0', tripleDeno), version.stdout);
  const manifesto = JSON.parse(readFileSync(join(dirDeno, 'clipora-deno.json'), 'utf8'));
  assert.deepEqual(validarManifestoDeno(manifesto, readFileSync(denoExecutavel), tripleDeno, lock), []);
  if (process.platform === 'darwin') {
    const verify = spawnSync('codesign', ['--verify', '--strict', denoExecutavel], { encoding: 'utf8', timeout: 15_000 });
    assert.equal(verify.status, 0, verify.stderr);
    const entitlements = spawnSync('codesign', ['-d', '--entitlements', ':-', denoExecutavel], { encoding: 'utf8', timeout: 15_000 });
    assert.equal(entitlements.status, 0, entitlements.stderr);
    assert.match(`${entitlements.stdout}\n${entitlements.stderr}`, /<key>com\.apple\.security\.cs\.allow-jit<\/key>\s*<true\/>/);
    assert.equal(([...`${entitlements.stdout}\n${entitlements.stderr}`.matchAll(/<key>[^<]+<\/key>/g)]).length, 1);
  }

  const args = ['run', '--ext=js', '--no-code-cache', '--no-prompt', '--no-remote', '--no-lock', '--node-modules-dir=none', '--no-config', '--no-npm', '--cached-only', '-'];
  const js = spawnSync(denoExecutavel, args, { input: 'console.log(42);', encoding: 'utf8', timeout: 20_000, maxBuffer: 1024 * 1024 });
  assert.equal(js.status, 0, js.stderr);
  assert.equal(js.stdout.trim(), '42');

  const libPath = join(caminhoSolver, 'lib.min.js');
  const corePath = join(caminhoSolver, 'core.min.js');
  assert.ok(existsSync(libPath), `solver lib ausente: ${libPath}`);
  assert.ok(existsSync(corePath), `solver core ausente: ${corePath}`);
  const lib = readFileSync(libPath, 'utf8');
  const core = readFileSync(corePath, 'utf8');
  const input = {
    type: 'preprocessed',
    preprocessed_player: '_result.n = (n) => n.split("").reverse().join(""); _result.sig = (sig) => "ok:" + sig;',
    requests: [{ type: 'n', challenges: ['abc'] }, { type: 'sig', challenges: ['abc'] }],
  };
  const smoke = `${lib}\nObject.assign(globalThis, lib);\n${core}\nconsole.log(JSON.stringify(jsc(${JSON.stringify(input)})));\n`;
  const solver = spawnSync(denoExecutavel, args, { input: smoke, encoding: 'utf8', timeout: 20_000, maxBuffer: 1024 * 1024 });
  assert.equal(solver.status, 0, solver.stderr);
  const resultado = JSON.parse(solver.stdout.trim());
  assert.deepEqual(resultado.responses.map((r) => r.data), [{ abc: 'cba' }, { abc: 'ok:abc' }]);
});
