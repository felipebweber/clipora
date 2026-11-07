#!/usr/bin/env node
// Gera o PKGBUILD e o .SRCINFO do pacote AUR `clipora-bin` a partir dos .deb publicados.
//
//   node scripts/gerar-pkgbuild.mjs --deb-x86_64 <arquivo.deb> --deb-aarch64 <arquivo.deb> \
//     [--versao 0.1.0] [--saida packaging/aur/clipora-bin] [--url-base <url>]
//
// Sem --versao, usa a versão de src-tauri/tauri.conf.json. Sem --url-base, aponta para a
// release `v<versao>` do GitHub. Os SHA-256 vêm dos próprios .deb, então o resultado só vale
// para exatamente esses arquivos.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { RAIZ, argumento, sha256Arquivo } from './comum.mjs';

const REPO = 'https://github.com/felipebweber/clipora';

export function gerarPkgbuild(modelo, v) {
  const valores = {
    VERSAO: v.versao,
    URL_X86_64: v.urlX86_64,
    URL_AARCH64: v.urlAarch64,
    SHA256_X86_64: v.sha256X86_64,
    SHA256_AARCH64: v.sha256Aarch64,
  };
  const texto = modelo.replace(/@([A-Z0-9_]+)@/g, (m, chave) => {
    if (!(chave in valores)) throw new Error(`marcador desconhecido no modelo: ${m}`);
    return valores[chave];
  });
  return texto;
}

/** Equivalente ao `makepkg --printsrcinfo` para este PKGBUILD (campos fixos do modelo). */
export function gerarSrcinfo(v) {
  const debX = `Clipora_${v.versao}_amd64.deb`;
  const debA = `Clipora_${v.versao}_arm64.deb`;
  return [
    'pkgbase = clipora-bin',
    '\tpkgdesc = Download one public video at a time from Instagram Reels, TikTok and YouTube',
    `\tpkgver = ${v.versao}`,
    '\tpkgrel = 1',
    `\turl = ${REPO}`,
    '\tarch = x86_64',
    '\tarch = aarch64',
    '\tlicense = GPL-3.0-or-later',
    '\tdepends = gtk3',
    '\tdepends = webkit2gtk-4.1',
    '\tdepends = hicolor-icon-theme',
    '\tprovides = clipora',
    '\tconflicts = clipora',
    `\tnoextract = ${debX}`,
    `\tnoextract = ${debA}`,
    '\toptions = !strip',
    '\toptions = !debug',
    `\tsource_x86_64 = ${debX}::${v.urlX86_64}`,
    `\tsha256sums_x86_64 = ${v.sha256X86_64}`,
    `\tsource_aarch64 = ${debA}::${v.urlAarch64}`,
    `\tsha256sums_aarch64 = ${v.sha256Aarch64}`,
    '',
    'pkgname = clipora-bin',
    '',
  ].join('\n');
}

async function main() {
  const debX = argumento('deb-x86_64');
  const debA = argumento('deb-aarch64');
  if (!debX || !debA) {
    console.error('uso: gerar-pkgbuild.mjs --deb-x86_64 <deb> --deb-aarch64 <deb> [--versao X] [--saida dir] [--url-base url]');
    process.exit(2);
  }
  const conf = JSON.parse(await readFile(join(RAIZ, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  const versao = argumento('versao') ?? conf.version;
  const base = (argumento('url-base') ?? `${REPO}/releases/download/v${versao}`).replace(/\/$/, '');
  const v = {
    versao,
    urlX86_64: `${base}/Clipora_${versao}_amd64.deb`,
    urlAarch64: `${base}/Clipora_${versao}_arm64.deb`,
    sha256X86_64: await sha256Arquivo(debX),
    sha256Aarch64: await sha256Arquivo(debA),
  };
  for (const [deb, sufixo] of [[debX, 'amd64'], [debA, 'arm64']]) {
    if (basename(deb) !== `Clipora_${versao}_${sufixo}.deb`) {
      console.error(`aviso: ${basename(deb)} não segue o nome esperado Clipora_${versao}_${sufixo}.deb`);
    }
  }
  const saida = argumento('saida') ?? join(RAIZ, 'packaging', 'aur', 'clipora-bin');
  await mkdir(saida, { recursive: true });
  const modelo = await readFile(join(RAIZ, 'packaging', 'aur', 'PKGBUILD.in'), 'utf8');
  await writeFile(join(saida, 'PKGBUILD'), gerarPkgbuild(modelo, v));
  await writeFile(join(saida, '.SRCINFO'), gerarSrcinfo(v));
  console.log(`PKGBUILD e .SRCINFO de clipora-bin ${versao} em ${saida}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
