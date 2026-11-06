// yt-dlp falso para testes do Clipora. Não acessa a rede.
// Modela o comportamento observável do yt-dlp que o backend precisa tratar:
// argumentos, JSON de metadados, --print, progresso (--newline,
// --progress-template), modo silencioso, stderr de erros, "already downloaded",
// arquivos .part, união via FFmpeg e processos filhos.
// Ver tests/fixtures/README.md.

import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, renameSync, rmSync, statSync, truncateSync, unlinkSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { carregarCenario } from './cenarios.mjs';
import { aplicarConfigDaPasta, dormir, formatarBytes, formatarTempo, inteiroDoAmbiente, registrar, travar } from './comum.mjs';

const EXE = process.platform === 'win32' ? '.exe' : '';
const VERSAO_PADRAO = '2026.10.26';

// ---------------------------------------------------------------- opções

const COM_VALOR = new Set([
  '--ffmpeg-location', '-o', '--output', '-P', '--paths', '-f', '--format', '--merge-output-format',
  '--remux-video', '--progress-template', '--print', '-O', '--trim-filenames', '--socket-timeout',
  '--retries', '--fragment-retries', '--encoding', '--plugin-dirs', '--color', '--compat-options',
  '--limit-rate', '-r', '--extractor-args', '--js-runtimes', '-S', '--format-sort', '--sleep-requests',
  '--output-na-placeholder', '--parse-metadata', '--replace-in-metadata',
]);
const SEM_VALOR = new Set([
  '--ignore-config', '--no-config-locations', '--no-update', '--no-playlist', '--yes-playlist',
  '-J', '--dump-single-json', '-j', '--dump-json', '--skip-download', '-s', '--simulate', '--no-simulate',
  '--newline', '--progress', '--no-progress', '-q', '--quiet', '--no-quiet', '--no-warnings',
  '-v', '--verbose', '--no-color', '--restrict-filenames', '--no-restrict-filenames', '--windows-filenames',
  '--no-windows-filenames', '-w', '--no-overwrites', '--force-overwrites', '--no-force-overwrites',
  '-c', '--continue', '--no-continue', '--part', '--no-part', '--mtime', '--no-mtime', '--no-cache-dir',
  '--no-plugin-dirs', '--abort-on-error', '--no-abort-on-error', '--version', '--no-exec', '-k',
  '--keep-video', '--no-keep-video', '--no-embed-thumbnail', '--no-write-thumbnail', '--no-mark-watched',
  '--console-title', '--no-progress-delta', '--no-cookies', '--no-cookies-from-browser', '--no-remote-components', '--no-js-runtimes',
]);
// Proibidas pelo contrato/roteiro (VT-07, VT-08, contrato v2 "sem yt-dlp -U").
const PROIBIDAS = new Set([
  '--exec', '--exec-before-download', '--cookies', '--cookies-from-browser', '-u', '--username',
  '-p', '--password', '-2', '--twofactor', '--netrc', '--netrc-location', '--netrc-cmd', '-U', '--update',
  '--update-to', '--no-check-certificates', '--load-info-json', '-a', '--batch-file', '--config-locations',
]);

const ALIAS = {
  '-o': '--output', '-P': '--paths', '-f': '--format', '-O': '--print', '-J': '--dump-single-json',
  '-j': '--dump-json', '-s': '--simulate', '-q': '--quiet', '-v': '--verbose', '-w': '--no-overwrites',
  '-c': '--continue', '-k': '--keep-video', '-r': '--limit-rate', '-S': '--format-sort',
};

class ErroOpcao extends Error {}

export function analisarArgumentos(argv) {
  const permissivo = process.env.CLIPORA_FALSO_PERMISSIVO === '1';
  const op = { flags: new Set(), valores: {}, prints: [], paths: {}, progressTemplates: {}, urls: [], urlsAntesDoSeparador: [], separador: false, ignoradas: [] };
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    if (op.separador) {
      op.urls.push(arg);
      continue;
    }
    if (arg === '--') {
      op.separador = true;
      continue;
    }
    if (!arg.startsWith('-') || arg === '-') {
      op.urls.push(arg);
      op.urlsAntesDoSeparador.push(arg);
      continue;
    }
    let valorEmbutido;
    if (arg.startsWith('--') && arg.includes('=')) {
      valorEmbutido = arg.slice(arg.indexOf('=') + 1);
      arg = arg.slice(0, arg.indexOf('='));
    }
    if (PROIBIDAS.has(arg)) throw new ErroOpcao(`opção proibida pelo contrato do Clipora: ${arg}`);
    const nome = ALIAS[arg] ?? arg;
    if (COM_VALOR.has(arg) || COM_VALOR.has(nome)) {
      const valor = valorEmbutido ?? argv[++i];
      if (valor === undefined) throw new ErroOpcao(`${arg} option requires an argument`);
      if (nome === '--print') op.prints.push(analisarPrint(valor));
      else if (nome === '--paths') {
        const m = /^(home|temp):(.*)$/s.exec(valor);
        if (m) op.paths[m[1]] = m[2];
        else op.paths.home = valor;
      } else if (nome === '--progress-template') {
        const m = /^(download|postprocess|download-title|postprocess-title):(.*)$/s.exec(valor);
        if (m) op.progressTemplates[m[1]] = m[2];
        else op.progressTemplates.download = valor;
      } else op.valores[nome] = valor;
      continue;
    }
    if (SEM_VALOR.has(arg) || SEM_VALOR.has(nome)) {
      op.flags.add(nome);
      continue;
    }
    if (permissivo) {
      op.ignoradas.push(arg);
      continue;
    }
    throw new ErroOpcao(`no such option: ${arg} (opção não modelada pelo yt-dlp falso; use CLIPORA_FALSO_PERMISSIVO=1 ou acrescente-a em tests/fixtures/lib/ytdlp-falso.mjs)`);
  }
  return op;
}

function analisarPrint(valor) {
  const m = /^(pre_process|after_filter|video|before_dl|post_process|after_move|after_video|playlist):(.*)$/s.exec(valor);
  const quando = m ? m[1] : 'video';
  let modelo = m ? m[2] : valor;
  if (/^[\w.]+$/.test(modelo)) modelo = `%(${modelo})s`;
  return { quando, modelo };
}

// ---------------------------------------------------------------- modelos de saída

function buscar(ctx, caminho) {
  const projecao = /^(?:(formats)\.:\.)?\{([a-z_,]+)\}$/.exec(caminho.replace(/^\./, ''));
  if (projecao) {
    const selecionar = (item) => Object.fromEntries(projecao[2].split(',')
      .filter((chave) => item?.[chave] !== undefined && item[chave] !== null)
      .map((chave) => [chave, item[chave]]));
    return projecao[1] ? ctx.formats?.map(selecionar) : selecionar(ctx);
  }
  let atual = ctx;
  for (const parte of caminho.split('.')) {
    if (atual == null || typeof atual !== 'object' || !(parte in atual)) return undefined;
    atual = atual[parte];
  }
  return atual;
}

/** Subconjunto do OUTTMPL do yt-dlp: %(campo)s, %(campo)d, %(campo).Nf, %(campo).NB, %(campo)j, %%. */
export function renderizar(modelo, ctx, { nomeDeArquivo = false } = {}) {
  return modelo.replace(/%%|%\(([^)]+)\)([-#0+ ]*)(\d*)(?:\.(\d+))?([diouxXeEfFgGcrsaBjqlhUDS])/g, (tudo, campo, _flags, _larg, precisao, tipo) => {
    if (tudo === '%%') return '%';
    let valor = buscar(ctx, campo);
    if (valor === undefined || valor === null) return 'NA';
    if (tipo === 'j') return JSON.stringify(valor);
    if (tipo === 'd' || tipo === 'i') return String(Math.trunc(Number(valor)));
    if (tipo === 'f') return Number(valor).toFixed(precisao ? Number(precisao) : 6);
    let texto = String(valor);
    if (nomeDeArquivo) texto = texto.replace(/\//g, '⧸');
    if (precisao && (tipo === 's' || tipo === 'B')) texto = texto.slice(0, Number(precisao));
    return texto;
  });
}

// ---------------------------------------------------------------- metadados

function identificar(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname;
  const partes = u.pathname.split('/').filter(Boolean);
  if (['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(host)) { return {extrator:'Youtube',site:'youtube',host,id:host==='youtu.be'?partes[0]:u.searchParams.get('v'),tipoLink:'watch'}; }
  if (/(^|\.)instagram\.com$/.test(host)) {
    return { extrator: 'Instagram', site: 'instagram', host, id: partes[1] ?? 'C0000000000', tipoLink: partes[0] };
  }
  if (/(^|\.)tiktok\.com$/.test(host)) {
    const i = partes.indexOf('video');
    return { extrator: 'TikTok', site: 'tiktok', host, id: i >= 0 ? partes[i + 1] : '7300000000000000001', tipoLink: partes[0] };
  }
  return null;
}

function metadadosPadrao(alvo, url, extra = {}) {
  const instagram = alvo.site === 'instagram';
  const base = {
    id: alvo.id,
    title: instagram ? 'Video by clipora.teste' : 'Vídeo de teste do Clipora #fixture',
    description: 'Descrição de teste',
    uploader: 'clipora.teste',
    duration: 12.5,
    thumbnail: `https://${instagram ? 'scontent.cdninstagram.com' : 'p16-sign.tiktokcdn.com'}/capa-${alvo.id}.jpg`,
    webpage_url: url,
    webpage_url_basename: alvo.id,
    extractor: alvo.extrator,
    extractor_key: alvo.extrator,
    ext: 'mp4',
    format_id: 'v1080+a128',
    // Como no -J real: codecs do formato escolhido no topo e a lista de formatos.
    vcodec: 'h264',
    acodec: 'aac',
    formats: [
      { format_id: 'a128', ext: 'm4a', vcodec: 'none', acodec: 'aac', filesize: 65536 },
      { format_id: 'v1080', ext: 'mp4', vcodec: 'h264', acodec: 'none', filesize: 262144 },
    ],
    requested_formats: [
      { format_id: 'v1080', ext: 'mp4', vcodec: 'h264', acodec: 'none', filesize: 262144 },
      { format_id: 'a128', ext: 'm4a', vcodec: 'none', acodec: 'aac', filesize: 65536 },
    ],
    _type: 'video',
  };
  const resultado = { ...base, ...extra };
  for (const [k, v] of Object.entries(resultado)) if (v === undefined) delete resultado[k];
  return resultado;
}

// ---------------------------------------------------------------- saída

class Saida {
  constructor(op) {
    this.quieto = (op.flags.has('--quiet') || op.prints.length > 0 || op.flags.has('--dump-single-json') || op.flags.has('--dump-json')) && !op.flags.has('--no-quiet');
    // No yt-dlp, mensagens de tela vão para o stderr quando em modo silencioso.
    this.tela = this.quieto ? process.stderr : process.stdout;
    this.progresso = this.quieto ? op.flags.has('--progress') : !op.flags.has('--no-progress');
    this.newline = op.flags.has('--newline');
    this.semAvisos = op.flags.has('--no-warnings');
  }
  info(texto) {
    if (!this.quieto) this.tela.write(`${texto}\n`);
  }
  aviso(texto) {
    if (!this.semAvisos) process.stderr.write(`WARNING: ${texto}\n`);
  }
  erro(texto) {
    process.stderr.write(`${texto}\n`);
  }
  linhaProgresso(texto, final = false) {
    if (!this.progresso) return;
    if (this.newline) this.tela.write(`${texto}\n`);
    else this.tela.write(`\r${texto}${final ? '\n' : ''}`);
  }
}

// ---------------------------------------------------------------- FFmpeg

function executavel(caminho) {
  try {
    if (!statSync(caminho).isFile()) return false;
    if (process.platform !== 'win32') accessSync(caminho, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Resolve o FFmpeg como o yt-dlp: --ffmpeg-location (arquivo ou pasta) ou PATH. */
function localizarFfmpeg(op) {
  const local = op.valores['--ffmpeg-location'];
  let candidato;
  let origem;
  if (local !== undefined) {
    origem = 'ffmpeg-location';
    let ehPasta = false;
    try {
      ehPasta = statSync(local).isDirectory();
    } catch {}
    // Numa pasta, o yt-dlp procura "ffmpeg" (não "clipora-ffmpeg").
    candidato = ehPasta ? join(local, `ffmpeg${EXE}`) : local;
  } else {
    origem = 'PATH';
    for (const dir of (process.env.PATH ?? '').split(delimiter)) {
      const c = join(dir, `ffmpeg${EXE}`);
      if (dir && executavel(c)) {
        candidato = c;
        break;
      }
    }
  }
  if (!candidato || !executavel(candidato)) return { disponivel: false, origem, caminho: candidato ?? null };
  // O yt-dlp executa "ffmpeg -version" para confirmar a disponibilidade.
  const r = spawnSync(candidato, ['-version'], { encoding: 'utf8' });
  return { disponivel: r.status === 0, origem, caminho: candidato };
}

function executarFfmpeg(caminho, args) {
  return new Promise((resolver) => {
    const filho = spawn(caminho, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    filho.stderr.on('data', (d) => (stderr += d));
    filho.on('error', (e) => resolver({ codigo: -1, stderr: String(e) }));
    filho.on('close', (codigo) => resolver({ codigo, stderr }));
  });
}

// ---------------------------------------------------------------- download

async function baixarParte({ saida, cenario, parte, destino, info, op, intervaloMs, ehPrimeira }) {
  const passos = 4;
  const total = parte.filesize ?? (parte.vcodec === 'none' ? 65536 : 262144);
  const totalConhecido = cenario.download.totalConhecido !== false;
  const partArq = `${destino}.part`;
  mkdirSync(dirname(partArq), { recursive: true });
  writeFileSync(partArq, '');
  saida.info(`[download] Destination: ${destino}`);
  const bloco = Buffer.alloc(total / passos, parte.vcodec !== 'none' ? 0x56 : 0x41);
  if (parte.vcodec !== 'none') Buffer.from([0,0,0,24,102,116,121,112,105,115,111,109]).copy(bloco);
  const inicio = Date.now();
  const falhaEm = cenario.erro?.fase === 'download' && ehPrimeira ? cenario.erro.em ?? 0.5 : null;
  for (let passo = 0; passo <= passos; passo++) {
    const baixados = (total / passos) * passo;
    const fracao = baixados / total;
    if (falhaEm !== null && fracao >= falhaEm) {
      saida.erro(renderizarMensagem(cenario.erro.stderr, info));
      return { falhou: true, codigo: cenario.erro.codigo ?? 1 };
    }
    const decorrido = Math.max((Date.now() - inicio) / 1000, 0.001);
    const velocidade = baixados / decorrido || null;
    const progresso = {
      status: passo === passos ? 'finished' : 'downloading',
      downloaded_bytes: baixados,
      ...(totalConhecido ? { total_bytes: total } : {}),
      speed: velocidade,
      eta: totalConhecido && velocidade ? (total - baixados) / velocidade : null,
      elapsed: decorrido,
      filename: destino,
      tmpfilename: partArq,
      _percent_str: totalConhecido ? `${(fracao * 100).toFixed(1).padStart(5)}%` : 'NA',
      _total_bytes_str: totalConhecido ? formatarBytes(total) : 'NA',
      _downloaded_bytes_str: formatarBytes(baixados),
      _speed_str: velocidade ? `${formatarBytes(velocidade)}/s` : 'Unknown B/s',
      _eta_str: totalConhecido && velocidade ? formatarTempo((total - baixados) / velocidade) : 'Unknown',
      _elapsed_str: formatarTempo(decorrido),
    };
    const modelo = op.progressTemplates.download;
    const ctxParte = { ...info, format_id: parte.format_id, ext: parte.ext, vcodec: parte.vcodec, acodec: parte.acodec };
    if (modelo) {
      saida.linhaProgresso(renderizar(modelo, { progress: progresso, info: ctxParte }), passo === passos);
    } else if (passo === passos) {
      const em = totalConhecido ? `${formatarBytes(total)} in ${formatarTempo(decorrido)}` : `${formatarBytes(baixados)} in ${formatarTempo(decorrido)}`;
      saida.linhaProgresso(`[download] 100% of ${em.padStart(10)} at ${progresso._speed_str}`, true);
    } else if (totalConhecido) {
      saida.linhaProgresso(`[download] ${progresso._percent_str} of ${progresso._total_bytes_str.padStart(10)} at ${progresso._speed_str.padStart(12)} ETA ${progresso._eta_str}`);
    } else {
      saida.linhaProgresso(`[download] ${progresso._downloaded_bytes_str.padStart(10)} at ${progresso._speed_str.padStart(12)} (${progresso._elapsed_str})`);
    }
    if (passo < passos) {
      appendFileSync(partArq, bloco);
      await dormir(intervaloMs);
    }
  }
  if (cenario.download.resultado === 'so-part') return { falhou: false, soPart: true };
  renameSync(partArq, destino);
  return { falhou: false };
}

async function baixarVideo({ saida, cenario, op, info, intervaloMs }) {
  const home = resolve(op.paths.home ?? process.cwd());
  const ext = op.valores['--merge-output-format'] ?? 'mp4';
  const modeloSaida = op.valores['--output'] ?? '%(title)s [%(id)s].%(ext)s';
  const nome = renderizar(modeloSaida, { ...info, ext }, { nomeDeArquivo: true });
  const final = isAbsolute(nome) ? nome : join(home, nome);
  const pastaTemp = op.paths.temp ? resolve(op.paths.temp) : dirname(final);
  const imprimirApos = (quando, filepath) => {
    for (const p of op.prints) if (p.quando === quando) process.stdout.write(`${renderizar(p.modelo, { ...info, ext, filepath, filename: filepath })}\n`);
  };

  // Arquivo final já existe (ou cenário forçado): mensagem, exit 0 e nada é alterado.
  if (cenario.download.resultado === 'ja-baixado' || (existsSync(final) && !op.flags.has('--force-overwrites'))) {
    saida.info(`[download] ${final} has already been downloaded`);
    registrar({ programa: 'yt-dlp', evento: 'ja-baixado', final });
    imprimirApos('after_move', final);
    return 0;
  }

  const ffmpeg = localizarFfmpeg(op);
  registrar({ programa: 'yt-dlp', evento: 'ffmpeg', ...ffmpeg });
  const pedidoFormato = op.valores['--format'];
  let partes = cenario.download.uniao === false ? [{ format_id: 'b', ext: 'mp4', vcodec: 'h264', acodec: 'aac', filesize: 327680 }] : info.requested_formats;
  if (info.extractor === 'Youtube') {
    // Replica o parser do yt-dlp: IDs de formato são strings e exigem aspas.
    // Não aceite o antigo formato_id=numérico sem aspas, que compara tipos e falha no yt-dlp real.
    const ids=[...(pedidoFormato ?? '').matchAll(/\[format_id="([A-Za-z0-9_-]+)"\]/g)].map((m)=>m[1]);
    partes=ids.map((id)=>info.formats.find((f)=>f.format_id===id));
    if (!ids.length || partes.some((f)=>!f)) { saida.erro('ERROR: Requested format is not available'); return 1; }
    const altura=Number(/\[height=(\d+)\]/.exec(pedidoFormato)?.[1]);
    if (partes[0].height!==altura) { saida.erro('ERROR: Requested format is not available'); return 1; }
  }
  let unir = partes.length > 1;
  let separadoSemUniao = false;
  if (unir && !ffmpeg.disponivel) {
    if (pedidoFormato && pedidoFormato.includes('+')) {
      saida.aviso("You have requested merging of multiple formats but ffmpeg is not installed. The formats won't be merged");
      unir = false;
      separadoSemUniao = true;
    } else {
      // Sem -f explícito, o yt-dlp troca para o melhor formato único e segue com exit 0.
      saida.aviso('ffmpeg not found. The downloaded format may not be the best available. Installing ffmpeg is strongly recommended: https://github.com/yt-dlp/yt-dlp#dependencies');
      partes = [{ format_id: 'b', ext: 'mp4', vcodec: 'h264', acodec: 'aac', filesize: 131072 }];
      unir = false;
    }
  }
  saida.info(`[info] ${info.id}: Downloading 1 format(s): ${partes.map((p) => p.format_id).join('+')}`);

  const semExt = final.replace(/\.[^./\\]+$/, '');
  const arquivosPartes = [];
  for (let i = 0; i < partes.length; i++) {
    const parte = partes[i];
    const destino = unir || separadoSemUniao ? join(unir ? pastaTemp : dirname(final), `${basename(semExt)}.f${parte.format_id}.${parte.ext}`) : final;
    const r = await baixarParte({ saida, cenario, parte, destino, info, op, intervaloMs, ehPrimeira: i === 0 });
    if (r.falhou) return r.codigo;
    if (r.soPart) return 0;
    arquivosPartes.push(destino);
  }

  if (separadoSemUniao) {
    imprimirApos('after_move', undefined);
    return 0;
  }

  if (unir) {
    saida.info(`[Merger] Merging formats into "${final}"`);
    const temporario = `${semExt}.temp.${ext}`;
    const args = ['-y', '-loglevel', 'repeat+info'];
    for (const a of arquivosPartes) args.push('-i', `file:${a}`);
    args.push('-c', 'copy', '-map', '0:v:0', '-map', '1:a:0', '-movflags', '+faststart', `file:${temporario}`);
    const r = await executarFfmpeg(ffmpeg.caminho, args);
    if (r.codigo !== 0) {
      saida.erro(`ERROR: Postprocessing: ${r.stderr.trim().split('\n').pop() || 'Conversion failed!'}`);
      return 1;
    }
    renameSync(temporario, final);
    for (const a of arquivosPartes) {
      saida.info(`Deleting original file ${a} (pass -k to keep)`);
      if (!op.flags.has('--keep-video')) unlinkSync(a);
    }
  }

  switch (cenario.download.resultado) {
    case 'sem-arquivo':
      rmSync(final, { force: true });
      return 0;
    case 'arquivo-vazio':
      truncateSync(final, 0);
      break;
    case 'caminho-fora': {
      // Caminho fixo e sobrescrito a cada execução, para não acumular arquivos
      // no tmp do sistema quando o chamador (corretamente) rejeita o resultado.
      // CLIPORA_FALSO_PASTA_FORA permite colocá-lo numa pasta do próprio teste.
      const pastaFora = resolve(process.env.CLIPORA_FALSO_PASTA_FORA || join(tmpdir(), 'clipora-fixtures-fora'));
      mkdirSync(pastaFora, { recursive: true });
      const fora = join(pastaFora, `fora.${ext}`);
      renameSync(final, fora);
      registrar({ programa: 'yt-dlp', evento: 'caminho-fora', fora });
      imprimirApos('after_move', fora);
      return 0;
    }
    default:
      break;
  }
  imprimirApos('after_move', final);
  return 0;
}

function renderizarMensagem(texto, info) {
  return texto
    .replaceAll('{id}', info.id ?? 'NA')
    .replaceAll('{url}', info.webpage_url ?? 'NA')
    .replaceAll('{extrator}', info.extractor ?? 'generic')
    .replaceAll('{host}', info._host ?? 'NA');
}

// ---------------------------------------------------------------- principal

export async function principal(argv) {
  aplicarConfigDaPasta();
  let op;
  try {
    op = analisarArgumentos(argv);
  } catch (e) {
    if (!(e instanceof ErroOpcao)) throw e;
    registrar({ programa: 'yt-dlp', evento: 'inicio', argv, erroOpcao: e.message });
    process.stderr.write(`Usage: yt-dlp [OPTIONS] URL [URL...]\n\nyt-dlp: error: ${e.message}\n`);
    registrar({ programa: 'yt-dlp', evento: 'fim', codigo: 2 });
    process.exitCode = 2;
    return;
  }
  const cenario = carregarCenario();
  registrar({
    programa: 'yt-dlp', evento: 'inicio', argv, cwd: process.cwd(), cenario: cenario.nome,
    separador: op.separador, urls: op.urls, urlsAntesDoSeparador: op.urlsAntesDoSeparador, ignoradas: op.ignoradas,
  });
  const codigo = await executar(op, cenario);
  registrar({ programa: 'yt-dlp', evento: 'fim', codigo });
  process.exitCode = codigo;
}

async function executar(op, cenario) {
  const saida = new Saida(op);
  if (op.flags.has('--version')) {
    if (cenario.versaoFalha) {
      saida.erro('[PYI-12345:ERROR] Failed to load Python shared library');
      return 1;
    }
    process.stdout.write(`${process.env.CLIPORA_FALSO_VERSAO || cenario.versao || VERSAO_PADRAO}\n`);
    return 0;
  }
  if (op.urls.length === 0) {
    saida.erro('ERROR: You must provide at least one URL.\nType yt-dlp --help to see a list of all options.');
    return 2;
  }
  const url = op.urls[0];
  const intervaloMs = inteiroDoAmbiente('CLIPORA_FALSO_INTERVALO_MS', 10);
  const atrasoMs = inteiroDoAmbiente('CLIPORA_FALSO_ATRASO_MS', cenario.atrasoMs ?? 0);

  if (cenario.filho) {
    const filho = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1 << 30)'], { stdio: 'ignore' });
    registrar({ programa: 'yt-dlp', evento: 'filho', filhoPid: filho.pid });
  }
  if (cenario.travar) return travar();
  if (atrasoMs > 0) await dormir(atrasoMs);

  const alvo = identificar(url);
  if (!alvo) {
    saida.erro(`ERROR: Unsupported URL: ${url}`);
    return 1;
  }
  saida.info(`[${alvo.extrator}] Extracting URL: ${url}`);
  saida.info(`[${alvo.extrator}] ${alvo.id}: Downloading webpage`);

  const info = metadadosPadrao(alvo, url, cenario.metadados);
  Object.defineProperty(info, '_host', { value: alvo.host, enumerable: false });

  if (cenario.erro?.fase === 'extracao') {
    saida.erro(renderizarMensagem(cenario.erro.stderr, info));
    return cenario.erro.codigo ?? 1;
  }
  if (cenario.stdoutBruto !== undefined) {
    process.stdout.write(cenario.stdoutBruto);
    return cenario.codigoSaida ?? 0;
  }

  let videos = [info];
  let documento = info;
  if (cenario.tipo === 'playlist') {
    videos = [1, 2].map((n) => metadadosPadrao({ ...alvo, id: `${alvo.id}_${n}` }, url, { title: `Item ${n} do carrossel`, playlist_index: n }));
    documento = { _type: 'playlist', id: alvo.id, title: 'Post com vários itens', extractor: alvo.extrator, extractor_key: alvo.extrator, webpage_url: url, entries: videos, playlist_count: videos.length };
  }

  if (op.flags.has('--dump-single-json')) process.stdout.write(`${JSON.stringify(documento)}\n`);
  if (op.flags.has('--dump-json')) for (const v of videos) process.stdout.write(`${JSON.stringify(v)}\n`);
  for (const v of videos) for (const p of op.prints) if (p.quando === 'video' || p.quando === 'pre_process') process.stdout.write(`${renderizar(p.modelo, v)}\n`);

  const estagiosPosteriores = op.prints.some((p) => !['video', 'pre_process', 'after_filter'].includes(p.quando));
  const dump = op.flags.has('--dump-single-json') || op.flags.has('--dump-json');
  const simular =
    op.flags.has('--simulate') || op.flags.has('--skip-download') ||
    (!op.flags.has('--no-simulate') && (dump || (op.prints.length > 0 && !estagiosPosteriores)));
  if (simular) return 0;

  // download.videos > 1: a prévia (-J) mostra um vídeo único, mas o download
  // produz vários itens, cada um com o próprio after_move. Testa a rejeição de
  // carrossel no download, independente da checagem feita na prévia.
  const quantidade = cenario.download.videos ?? 1;
  const paraBaixar =
    quantidade > 1 && cenario.tipo !== 'playlist'
      ? Array.from({ length: quantidade }, (_, i) => metadadosPadrao({ ...alvo, id: `${alvo.id}_${i + 1}` }, url, { ...cenario.metadados, title: `Item ${i + 1} do carrossel`, playlist_index: i + 1 }))
      : videos;
  if (paraBaixar !== videos) registrar({ programa: 'yt-dlp', evento: 'varios-itens', quantidade });
  for (const v of paraBaixar) {
    const codigo = await baixarVideo({ saida, cenario, op, info: v, intervaloMs });
    if (codigo !== 0) return codigo;
  }
  return 0;
}
