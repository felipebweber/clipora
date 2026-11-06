import assert from 'node:assert/strict';
import test from 'node:test';
import { arquiteturaPe, classificarSeloCodesign, validarInfoFfmpeg, versaoDenoPermitida } from './conferir-pacote.mjs';

const triple = 'x86_64-pc-windows-msvc';
const lock = {
  ffmpeg: {
    versao: '8.1.3',
    tarball: { url: 'https://ffmpeg.org/releases/ffmpeg-8.1.3.tar.xz', sha256: 'abc123' },
  },
};
const info = [
  `Clipora — FFmpeg mínimo (remux) — ${triple}`,
  'Licença: LGPL-2.1-or-later',
  `Código-fonte: ${lock.ffmpeg.tarball.url}`,
  `SHA-256 do código-fonte: ${lock.ffmpeg.tarball.sha256}`,
  'configure (x86_64): ./configure --disable-gpl --disable-nonfree --disable-version3 --enable-ffmpeg',
].join('\n');

test('registro FFmpeg válido bate no alvo, versão fixada, fonte e flags LGPL', () => {
  assert.deepEqual(validarInfoFfmpeg(info, triple, lock), []);
});

test('registro FFmpeg rejeita versão/fonte diferente e flags GPL/nonfree', () => {
  const ruim = info
    .replace('ffmpeg-8.1.3.tar.xz', 'ffmpeg-9.0.tar.xz')
    .replace('--disable-gpl', '--enable-gpl')
    .replace('--disable-nonfree', '--enable-nonfree');
  const erros = validarInfoFfmpeg(ruim, triple, lock);
  assert.ok(erros.includes('origem não corresponde a binarios.lock'));
  assert.ok(erros.includes('configure sem --disable-gpl'));
  assert.ok(erros.includes('configure sem --disable-nonfree'));
  assert.ok(erros.includes('configure contém flag GPL/nonfree/version3 proibida'));
});

test('leitor PE reconhece x64 e ARM64 e rejeita arquivo inválido', () => {
  const pe = (machine) => {
    const b = Buffer.alloc(0x80);
    b.write('MZ', 0, 'ascii');
    b.writeUInt32LE(0x40, 0x3c);
    b.write('PE\0\0', 0x40, 'ascii');
    b.writeUInt16LE(machine, 0x44);
    return b;
  };
  assert.equal(arquiteturaPe(pe(0x8664)), 'x86_64');
  assert.equal(arquiteturaPe(pe(0xaa64)), 'aarch64');
  assert.equal(arquiteturaPe(Buffer.from('MZ')), null);
});

test('codesign só classifica como unsigned com evidência reconhecida', () => {
  assert.equal(classificarSeloCodesign(1, 'Sealed Resources=none'), 'unsigned');
  assert.equal(classificarSeloCodesign(1, 'Info.plist=not bound'), 'unsigned');
  assert.equal(classificarSeloCodesign(1, 'resource envelope is obsolete'), 'unknown-error');
  assert.equal(classificarSeloCodesign(0, 'Authority=Developer ID Application'), 'signed');
});

test('Deno reconhece somente a base 2.7.0 e metadado SemVer permitido', () => {
  const real = 'deno 2.7.0+fb4db33 (canary, release, aarch64-apple-darwin)\ntypescript 5.9.2';
  assert.equal(versaoDenoPermitida(real, '2.7.0', 'aarch64-apple-darwin'), '2.7.0+fb4db33');
  assert.equal(versaoDenoPermitida('deno 2.7.0', '2.7.0', 'aarch64-apple-darwin'), '2.7.0');
  assert.equal(versaoDenoPermitida('deno 2.7.0 (stable, release, x86_64-apple-darwin)', '2.7.0', 'aarch64-apple-darwin'), '2.7.0');
  for (const target of ['aarch64-apple-darwin', 'x86_64-apple-darwin', 'x86_64-pc-windows-msvc', 'aarch64-pc-windows-msvc', 'x86_64-unknown-linux-gnu', 'aarch64-unknown-linux-gnu']) {
    assert.equal(versaoDenoPermitida(`deno 2.7.0+fb4db33 (stable, release, ${target})`, '2.7.0', target), '2.7.0+fb4db33');
  }
  for (const line of [
    'deno 2.7.01+fb4db33 (canary, release, aarch64-apple-darwin)',
    'deno 2.7.0-rc.1 (canary, release, aarch64-apple-darwin)',
    'deno 2.7.0+fb4db33 (rc, release, aarch64-apple-darwin)',
    'deno 2.9.8+fb4db33 (canary, release, aarch64-apple-darwin)',
    'xdeno 2.7.0+fb4db33 (canary, release, aarch64-apple-darwin)',
    'deno 2.7.0+fb4db33 arbitrary suffix',
    'deno 2.7.0+bad_metadata (canary, release, aarch64-apple-darwin)',
    'deno 2.7.0+fb4db33 (canary, release, aarch64-foo-bar)',
    'deno 2.7.0+fb4db33 (canary, debug, aarch64-apple-darwin)',
    'deno 2.7.0+fb4db33 (unknown, release, aarch64-apple-darwin)',
  ]) assert.equal(versaoDenoPermitida(line, '2.7.0', 'aarch64-apple-darwin'), null, line);
});
