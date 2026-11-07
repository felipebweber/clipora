// @vitest-environment node
// Montagem da pasta da release a partir dos artefatos do CI (scripts/montar-release.mjs):
// confere os SHA256SUMS de cada alvo e achata os instaladores num só nível.

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lerSomas, montarPacotes } from '../../scripts/montar-release.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const alvos = ['aarch64-apple-darwin', 'x86_64-unknown-linux-gnu'];
const pacotes = {
  'aarch64-apple-darwin': ['dmg/Clipora_1.2.3_aarch64.dmg'],
  'x86_64-unknown-linux-gnu': ['deb/Clipora_1.2.3_amd64.deb', 'rpm/Clipora-1.2.3-1.x86_64.rpm'],
};

let raiz;
let artefatos;
let saida;

function escrever(caminho, conteudo) {
  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, conteudo);
}

function criarArtefatos() {
  for (const alvo of alvos) {
    const dir = join(artefatos, `clipora-${alvo}`);
    const linhas = pacotes[alvo].map((rel) => {
      escrever(join(dir, rel), `conteúdo de ${rel}`);
      return `${sha(`conteúdo de ${rel}`)}  ./${rel}`;
    });
    escrever(join(dir, 'SHA256SUMS'), `${linhas.join('\n')}\n`);
    escrever(join(artefatos, `ffmpeg-${alvo}`, `ffmpeg-build-info-${alvo}.txt`), `configure de ${alvo}\n`);
  }
}

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), 'clipora-montar-release-'));
  artefatos = join(raiz, 'artefatos');
  saida = join(raiz, 'saida');
  criarArtefatos();
});

afterEach(() => rmSync(raiz, { recursive: true, force: true }));

describe('montar a release', () => {
  it('lê o SHA256SUMS com ou sem ./ no caminho', () => {
    expect(lerSomas(`${'a'.repeat(64)}  ./dmg/x.dmg\n${'b'.repeat(64)} *y.deb\n`)).toEqual([
      ['a'.repeat(64), 'dmg/x.dmg'],
      ['b'.repeat(64), 'y.deb'],
    ]);
    expect(() => lerSomas('lixo\n')).toThrow(/linha inválida/);
  });

  it('achata instaladores, somas e build-info de cada alvo', async () => {
    const nomes = await montarPacotes({ artefatos, saida, versao: '1.2.3', alvos });
    expect(readdirSync(saida).sort()).toEqual(nomes.slice().sort());
    expect(nomes.sort()).toEqual(
      [
        'Clipora_1.2.3_aarch64.dmg',
        'SHA256SUMS-aarch64-apple-darwin.txt',
        'ffmpeg-build-info-aarch64-apple-darwin.txt',
        'Clipora_1.2.3_amd64.deb',
        'Clipora-1.2.3-1.x86_64.rpm',
        'SHA256SUMS-x86_64-unknown-linux-gnu.txt',
        'ffmpeg-build-info-x86_64-unknown-linux-gnu.txt',
      ].sort(),
    );
  });

  it('recusa um instalador alterado depois do build', async () => {
    escrever(join(artefatos, 'clipora-aarch64-apple-darwin', 'dmg', 'Clipora_1.2.3_aarch64.dmg'), 'adulterado');
    await expect(montarPacotes({ artefatos, saida, versao: '1.2.3', alvos })).rejects.toThrow(/SHA-256 divergente/);
  });

  it('recusa instalador fora do SHA256SUMS', async () => {
    escrever(join(artefatos, 'clipora-aarch64-apple-darwin', 'dmg', 'Extra_1.2.3.dmg'), 'x');
    await expect(montarPacotes({ artefatos, saida, versao: '1.2.3', alvos })).rejects.toThrow(/não batem/);
  });

  it('recusa quando falta um alvo', async () => {
    rmSync(join(artefatos, 'clipora-x86_64-unknown-linux-gnu'), { recursive: true });
    await expect(montarPacotes({ artefatos, saida, versao: '1.2.3', alvos })).rejects.toThrow(/faltam os pacotes/);
  });

  it('recusa pacotes de outra versão', async () => {
    await expect(montarPacotes({ artefatos, saida, versao: '9.9.9', alvos })).rejects.toThrow(/não traz a versão/);
  });
});
