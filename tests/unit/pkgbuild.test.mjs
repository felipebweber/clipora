// @vitest-environment node
// O PKGBUILD do AUR (clipora-bin) é gerado de packaging/aur/PKGBUILD.in; o .SRCINFO é escrito
// à mão pelo gerador e precisa refletir os mesmos campos.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { gerarPkgbuild, gerarSrcinfo } from '../../scripts/gerar-pkgbuild.mjs';

const raiz = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const modelo = readFileSync(join(raiz, 'packaging', 'aur', 'PKGBUILD.in'), 'utf8');
const v = {
  versao: '1.2.3',
  urlX86_64: 'https://exemplo/Clipora_1.2.3_amd64.deb',
  urlAarch64: 'https://exemplo/Clipora_1.2.3_arm64.deb',
  sha256X86_64: 'a'.repeat(64),
  sha256Aarch64: 'b'.repeat(64),
};

describe('PKGBUILD do AUR', () => {
  const pkgbuild = gerarPkgbuild(modelo, v);
  const srcinfo = gerarSrcinfo(v);

  it('preenche todos os marcadores', () => {
    expect(pkgbuild).not.toMatch(/@[A-Z0-9_]+@/);
    expect(pkgbuild).toContain('pkgver=1.2.3');
    expect(pkgbuild).toContain(`sha256sums_x86_64=('${'a'.repeat(64)}')`);
    expect(pkgbuild).toContain(`sha256sums_aarch64=('${'b'.repeat(64)}')`);
  });

  it('não faz strip, para não alterar o yt-dlp e o Deno conferidos por hash', () => {
    expect(pkgbuild).toMatch(/^options=\(.*'!strip'.*\)$/m);
    expect(srcinfo).toContain('\toptions = !strip');
  });

  it('o .SRCINFO repete versão, fontes, hashes e dependências do PKGBUILD', () => {
    expect(srcinfo).toContain('\tpkgver = 1.2.3');
    expect(srcinfo).toContain('\tsource_x86_64 = Clipora_1.2.3_amd64.deb::https://exemplo/Clipora_1.2.3_amd64.deb');
    expect(srcinfo).toContain(`\tsha256sums_aarch64 = ${'b'.repeat(64)}`);
    const deps = pkgbuild.match(/^depends=\((.*)\)$/m)[1].match(/'([^']+)'/g).map((d) => d.slice(1, -1));
    expect(deps.length).toBeGreaterThan(0);
    for (const d of deps) expect(srcinfo).toContain(`\tdepends = ${d}`);
  });

  it('recusa marcador desconhecido', () => {
    expect(() => gerarPkgbuild('@NADA@', v)).toThrow(/marcador desconhecido/);
  });
});
