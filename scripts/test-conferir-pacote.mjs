import assert from 'node:assert/strict';
import test from 'node:test';
import { arquiteturaPe, classificarSeloCodesign, validarInfoFfmpeg } from './conferir-pacote.mjs';

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
