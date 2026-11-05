#!/usr/bin/env node
// Monta uma pasta para CLIPORA_BIN_DIR com variações dos executáveis falsos.
//
// Uso (CLI):
//   node tests/fixtures/preparar-bin.mjs <destino> [--sem-ytdlp] [--sem-ffmpeg] [--sem-ffprobe] [--ytdlp-nao-executavel]
//        [--cenario <nome>] [--registro <arquivo.jsonl>] [--ffmpeg <sucesso|falha|quebrado>] [--atraso-ms <n>]
// Uso (módulo):
//   import { prepararBin } from './preparar-bin.mjs';
//   const dir = await prepararBin({ semFfmpeg: true });   // cria pasta temporária
//
// Os wrappers gerados apontam para tests/fixtures/lib por caminho absoluto, então
// a pasta pode ficar em qualquer lugar (por exemplo, no tmp de um teste Rust).

import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ARQUIVO_CONFIG_PASTA } from './lib/comum.mjs';

const RAIZ_FIXTURES = dirname(fileURLToPath(import.meta.url));
const LIB = join(RAIZ_FIXTURES, 'lib');

export const PASTA_BIN_PADRAO = join(RAIZ_FIXTURES, 'bin');

function wrapper(modulo, chamada) {
  const url = pathToFileURL(join(LIB, modulo)).href;
  return `#!/usr/bin/env node
// Gerado por tests/fixtures/preparar-bin.mjs (fixture de teste do Clipora).
import(${JSON.stringify(url)})
  .then((m) => ${chamada})
  .catch((e) => { process.stderr.write(String(e && e.stack ? e.stack : e) + '\\n'); process.exitCode = 70; });
`;
}

export async function prepararBin(opcoes = {}) {
  const destino = opcoes.destino ? resolve(opcoes.destino) : await mkdtemp(join(tmpdir(), 'clipora-bin-'));
  await mkdir(destino, { recursive: true });
  await writeFile(join(destino, 'package.json'), '{ "type": "commonjs" }\n');
  const itens = [
    ['clipora-yt-dlp', 'ytdlp-falso.mjs', 'm.principal(process.argv.slice(2))', opcoes.semYtdlp, opcoes.ytdlpNaoExecutavel],
    ['clipora-ffmpeg', 'ffmpeg-falso.mjs', "m.principal('ffmpeg', process.argv.slice(2))", opcoes.semFfmpeg, false],
    ['clipora-ffprobe', 'ffmpeg-falso.mjs', "m.principal('ffprobe', process.argv.slice(2))", opcoes.semFfprobe, false],
  ];
  for (const [nome, modulo, chamada, omitir, naoExecutavel] of itens) {
    if (omitir) continue;
    const arquivo = join(destino, nome);
    await writeFile(arquivo, wrapper(modulo, chamada));
    await chmod(arquivo, naoExecutavel ? 0o644 : 0o755);
  }
  // Configuração por pasta: { CLIPORA_FALSO_CENARIO: 'login', CLIPORA_FALSO_REGISTRO: '/tmp/x.jsonl', ... }
  if (opcoes.ambiente && Object.keys(opcoes.ambiente).length > 0) {
    await writeFile(join(destino, ARQUIVO_CONFIG_PASTA), `${JSON.stringify(opcoes.ambiente, null, 2)}\n`);
  }
  return destino;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const valor = (nome) => {
    const i = args.indexOf(`--${nome}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const comValor = new Set(['--cenario', '--registro', '--ffmpeg', '--atraso-ms']);
  const destino = args.find((a, i) => !a.startsWith('--') && !comValor.has(args[i - 1]));
  const ambiente = Object.fromEntries(
    [
      ['CLIPORA_FALSO_CENARIO', valor('cenario')],
      ['CLIPORA_FALSO_REGISTRO', valor('registro') && resolve(valor('registro'))],
      ['CLIPORA_FFMPEG_FALSO', valor('ffmpeg')],
      ['CLIPORA_FALSO_ATRASO_MS', valor('atraso-ms')],
    ].filter(([, v]) => v !== undefined),
  );
  if (!destino) {
    process.stderr.write('uso: node tests/fixtures/preparar-bin.mjs <destino> [--sem-ytdlp] [--sem-ffmpeg] [--sem-ffprobe] [--ytdlp-nao-executavel] [--cenario <nome>] [--registro <arq>] [--ffmpeg <modo>] [--atraso-ms <n>]\n');
    process.exit(2);
  }
  const dir = await prepararBin({
    destino,
    semYtdlp: args.includes('--sem-ytdlp'),
    semFfmpeg: args.includes('--sem-ffmpeg'),
    semFfprobe: args.includes('--sem-ffprobe'),
    ytdlpNaoExecutavel: args.includes('--ytdlp-nao-executavel'),
    ambiente,
  });
  process.stdout.write(`${dir}\n`);
}
