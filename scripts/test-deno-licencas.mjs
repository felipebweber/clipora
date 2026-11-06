import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { validarInsumosDenoAvisos } from './licencas/deno/validar-insumos.mjs';
import { renderCargoAbout } from './licencas/deno/render-cargo-about.mjs';
import { lerLock, RAIZ } from './comum.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const lock = await lerLock();
const dir = join(RAIZ, 'scripts/licencas/deno');
const actual = {
  license: await readFile(join(dir, 'LICENSE.md')),
  cargo: await readFile(join(dir, 'CARGO-THIRD_PARTY_LICENSES.txt')),
  cargoSources: await readFile(join(dir, 'CARGO-THIRD_PARTY_LICENSES.sources.json')),
  v8: await readFile(join(dir, 'V8-THIRD_PARTY_LICENSES.txt')),
  sources: await readFile(join(dir, 'V8-THIRD_PARTY_LICENSES.sources.json')),
  denoSource: await readFile(join(dir, 'DENO-SOURCE-THIRD_PARTY_LICENSES.txt')),
  denoSourceSources: await readFile(join(dir, 'DENO-SOURCE-THIRD_PARTY_LICENSES.sources.json')),
  typescriptApache: await readFile(join(dir, 'TYPESCRIPT-APACHE-2.0.txt')),
};

test('avisos Deno vendorizados correspondem aos hashes e à proveniência fixados', () => {
  const result = validarInsumosDenoAvisos(lock, actual);
  assert.ok(result.cargoPackages >= 100);
  assert.ok(result.v8SourceFiles >= 20);
  assert.ok(result.v8DistinctTexts >= 10);
  assert.ok(result.denoSourceFiles >= 3);
  assert.equal(result.typescriptVersion, '5.9.2');
});

test('Git preserva bytes dos insumos de licença com core.autocrlf=true', () => {
  const byteStable = [
    'scripts/licencas/deno/LICENSE.md',
    'scripts/licencas/deno/CARGO-THIRD_PARTY_LICENSES.txt',
    'scripts/licencas/deno/CARGO-THIRD_PARTY_LICENSES.sources.json',
    'scripts/licencas/deno/V8-THIRD_PARTY_LICENSES.txt',
    'scripts/licencas/deno/V8-THIRD_PARTY_LICENSES.sources.json',
    'scripts/licencas/deno/DENO-SOURCE-THIRD_PARTY_LICENSES.txt',
    'scripts/licencas/deno/DENO-SOURCE-THIRD_PARTY_LICENSES.sources.json',
    'scripts/licencas/deno/TYPESCRIPT-APACHE-2.0.txt',
  ];
  const rawAttr = execFileSync('git', ['check-attr', 'text', 'whitespace', '--', ...byteStable], {
    cwd: RAIZ,
    encoding: 'utf8',
  });
  const attrs = new Map(rawAttr.trim().split('\n').map((line) => {
    const [path, name, value] = line.split(': ');
    return [`${path}:${name}`, value];
  }));

  for (const path of byteStable) assert.equal(attrs.get(`${path}:text`), 'unset', `${path} precisa de -text`);
  for (const path of byteStable.filter((path) => path.endsWith('.txt') || path.endsWith('LICENSE.md'))) {
    assert.equal(attrs.get(`${path}:whitespace`), 'unset', `${path} precisa preservar whitespace legal`);
  }
  for (const path of byteStable.filter((path) => path.endsWith('.sources.json'))) {
    assert.equal(attrs.get(`${path}:whitespace`), 'unspecified', `${path} deve manter checagem normal de whitespace`);
  }

  for (const path of byteStable) {
    const filtered = execFileSync('git', ['-c', 'core.autocrlf=true', 'hash-object', `--path=${path}`, path], {
      cwd: RAIZ,
      encoding: 'utf8',
    }).trim();
    const raw = execFileSync('git', ['hash-object', '--no-filters', path], {
      cwd: RAIZ,
      encoding: 'utf8',
    }).trim();
    assert.equal(filtered, raw, `${path} mudou com autocrlf habilitado`);
  }
});

test('gerador de avisos falha quando qualquer arquivo obrigatório está ausente', () => {
  for (const field of Object.keys(actual)) {
    assert.throws(() => validarInsumosDenoAvisos(lock, { ...actual, [field]: undefined }), /ausente|invalido|inválido|não comprova/i, field);
  }
});

test('gerador de avisos falha em texto alterado, manifesto de fonte inválido ou lock sem hash', () => {
  const alterado = { ...actual, v8: Buffer.from(`${actual.v8.toString('utf8')}\nextra`) };
  assert.throws(() => validarInsumosDenoAvisos(lock, alterado), /Hash.*divergente/);
  const lockSemHash = structuredClone(lock);
  lockSemHash.deno.avisosTerceiros.cargoNoticeSha256 = '0'.repeat(64);
  assert.throws(() => validarInsumosDenoAvisos(lockSemHash, actual), /Hash.*divergente/);
  const sourcesRuins = Buffer.from(JSON.stringify({ format: 1, rustyV8Commit: 'x' }));
  const lockAjustado = structuredClone(lock);
  lockAjustado.deno.avisosTerceiros.v8.sourcesSha256 = sha256(sourcesRuins);
  assert.throws(() => validarInsumosDenoAvisos(lockAjustado, { ...actual, sources: sourcesRuins }), /não comprova/);
});

test('renderizador deduplica textos idênticos sem perder associação pacote/versão/licença/autores', () => {
  const crate = (name, version, author) => ({ package: { name, version, authors: [author], id: `registry#${name}@${version}`, license: 'MIT' } });
  const text = 'MIT License\n\nCopyright (c) Test Authors\nPermission granted.';
  const data = {
    crates: [crate('deno', '2.7.0', 'Deno authors'), crate('alpha', '1.0.0', 'Alice'), crate('beta', '2.0.0', 'Bob')],
    licenses: [{
      id: 'MIT', name: 'MIT License', text,
      used_by: [
        { crate: { name: 'deno', version: '2.7.0', id: 'registry#deno@2.7.0', license: 'MIT', authors: ['Deno authors'] } },
        { crate: { name: 'alpha', version: '1.0.0', id: 'registry#alpha@1.0.0', license: 'MIT', authors: ['Alice'] } },
        { crate: { name: 'beta', version: '2.0.0', id: 'registry#beta@2.0.0', license: 'MIT', authors: ['Bob'] } },
      ],
    }],
  };
  const result = renderCargoAbout(data);
  assert.equal(result.licenseTextCount, 1);
  assert.equal((result.text.match(/Copyright \(c\) Test Authors/g) ?? []).length, 1);
  assert.match(result.text, /alpha 1\.0\.0 — MIT — Alice/);
  assert.match(result.text, /beta 2\.0\.0 — MIT — Bob/);
});

test('renderizador recusa crate sem texto de licença associado', () => {
  assert.throws(() => renderCargoAbout({
    crates: [{ package: { name: 'missing-license', version: '1.0.0', id: 'missing' } }],
    licenses: [{ id: 'MIT', text: 'MIT License', used_by: [] }],
  }), /associação|associa|crates\/licenses/i);
});
