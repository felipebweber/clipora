// ffmpeg/ffprobe falsos mínimos para testes do Clipora.
// Modo por variável de ambiente:
//   CLIPORA_FFMPEG_FALSO  = sucesso (padrão) | falha | quebrado
//   CLIPORA_FFPROBE_FALSO = sucesso (padrão) | falha | quebrado
// "falha": -version funciona, mas a conversão/análise falha.
// "quebrado": até -version falha (o yt-dlp considera o programa indisponível).
// "ausente" não é um modo: basta o executável não existir (ver preparar-bin.mjs).

import { readFileSync, writeFileSync } from 'node:fs';
import { aplicarConfigDaPasta, dormir, inteiroDoAmbiente, registrar } from './comum.mjs';

const semPrefixo = (a) => (a.startsWith('file:') ? a.slice(5) : a);

export async function principal(programa, argv) {
  aplicarConfigDaPasta();
  const variavel = programa === 'ffprobe' ? 'CLIPORA_FFPROBE_FALSO' : 'CLIPORA_FFMPEG_FALSO';
  const modo = process.env[variavel] || 'sucesso';
  registrar({ programa, evento: 'inicio', argv, modo });
  const codigo = await executar(programa, modo, argv);
  registrar({ programa, evento: 'fim', codigo });
  process.exitCode = codigo;
}

async function executar(programa, modo, argv) {
  if (argv.includes('-version')) {
    if (modo === 'quebrado') {
      process.stderr.write(`${programa}: error while loading shared libraries: libavdevice.so.61: cannot open shared object file\n`);
      return 127;
    }
    process.stdout.write(`${programa} version 7.1-clipora-falso Copyright (c) 2000-2026 the FFmpeg developers\nconfiguration: --disable-gpl --disable-nonfree\n`);
    return 0;
  }
  if (modo === 'quebrado') return 127;
  await dormir(inteiroDoAmbiente('CLIPORA_FFMPEG_ATRASO_MS', 0));

  if (programa === 'ffprobe') {
    if (modo === 'falha') {
      process.stderr.write(`${semPrefixo(argv.at(-1) ?? '')}: Invalid data found when processing input\n`);
      return 1;
    }
    process.stdout.write(`${JSON.stringify({
      streams: [
        { index: 0, codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920 },
        { index: 1, codec_type: 'audio', codec_name: 'aac', sample_rate: '44100' },
      ],
      format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '12.500000' },
    })}\n`);
    return 0;
  }

  // ffmpeg: entradas em -i, saída no último argumento.
  const entradas = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === '-i') entradas.push(semPrefixo(argv[++i]));
  const saida = semPrefixo(argv.at(-1) ?? '');
  if (entradas.length === 0 || !saida || saida.startsWith('-')) {
    process.stderr.write('At least one output file must be specified\n');
    return 1;
  }
  if (modo === 'falha') {
    // Deixa uma saída parcial para testar a limpeza de temporários.
    writeFileSync(saida, Buffer.alloc(16, 0x58));
    process.stderr.write(`[aac @ 0x7f8] Error submitting packet to decoder: Invalid data found when processing input\nConversion failed!\n`);
    return 1;
  }
  let dados;
  try {
    dados = Buffer.concat(entradas.map((e) => readFileSync(e)));
  } catch (e) {
    process.stderr.write(`${e.path}: No such file or directory\n`);
    return 1;
  }
  writeFileSync(saida, dados);
  return 0;
}
