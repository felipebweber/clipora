// @vitest-environment node
// Prova que cada cenário dos executáveis falsos (tests/fixtures) se comporta
// como documentado em tests/fixtures/README.md. Escrito em .mjs para não
// depender de @types/node no typecheck.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lerRegistro } from '../fixtures/lib/comum.mjs';
import { CENARIOS } from '../fixtures/lib/cenarios.mjs';
import { prepararBin } from '../fixtures/preparar-bin.mjs';

const BIN = fileURLToPath(new URL('../fixtures/bin/', import.meta.url));
const YTDLP = join(BIN, 'clipora-yt-dlp');
const FFMPEG = join(BIN, 'clipora-ffmpeg');
const FFPROBE = join(BIN, 'clipora-ffprobe');
const REEL = 'https://www.instagram.com/reel/ABC123/';
const TIKTOK = 'https://www.tiktok.com/@clipora/video/7300000000000000000';
const UNIX = process.platform !== 'win32';
// No Windows os wrappers com shebang não executam (ver tests/fixtures/README.md, seção Windows).
const descrever = UNIX ? describe : describe.skip;

let dir;
let registro;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clipora-fixtures-'));
  registro = join(dir, 'registro.jsonl');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Executa sem shell, como o backend fará. */
function rodar(programa, args, { env = {}, matarApos, grupo = false } = {}) {
  return new Promise((resolver, rejeitar) => {
    const inicio = Date.now();
    const filho = spawn(programa, args, {
      env: { ...process.env, CLIPORA_FALSO_REGISTRO: registro, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: grupo,
    });
    let stdout = '';
    let stderr = '';
    filho.stdout.on('data', (d) => (stdout += d));
    filho.stderr.on('data', (d) => (stderr += d));
    filho.on('error', rejeitar);
    let temporizador;
    if (matarApos) temporizador = setTimeout(() => (grupo ? process.kill(-filho.pid, 'SIGKILL') : filho.kill('SIGKILL')), matarApos);
    filho.on('close', (codigo, sinal) => {
      clearTimeout(temporizador);
      resolver({ codigo, sinal, stdout, stderr, ms: Date.now() - inicio, pid: filho.pid });
    });
  });
}

const previa = (url, env = {}) =>
  rodar(YTDLP, ['--ignore-config', '--no-update', '--no-playlist', '--ffmpeg-location', FFMPEG, '--dump-single-json', '--skip-download', '--', url], { env });

const pastaDestino = () => join(dir, 'destino');
const baixar = (url, env = {}, extra = []) =>
  rodar(YTDLP, [
    '--ignore-config', '--no-update', '--no-playlist', '--ffmpeg-location', FFMPEG, '--newline', '--progress',
    '--print', 'after_move:filepath', '-P', pastaDestino(), '-o', '%(title)s [%(id)s].%(ext)s', ...extra, '--', url,
  ], { env });

const arquivos = (pasta = pastaDestino()) => (existsSync(pasta) ? readdirSync(pasta).sort() : []);
const vivo = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const percentuais = (texto) => [...texto.matchAll(/\[download\]\s+([\d.]+)%/g)].map((m) => Number(m[1]));
const FINAL_REEL = 'Video by clipora.teste [ABC123].mp4';

descrever('yt-dlp falso: prévia e metadados', () => {
  it('sucesso: imprime JSON, sai com 0 e registra os argumentos', async () => {
    const r = await previa(TIKTOK);
    expect(r.codigo).toBe(0);
    const info = JSON.parse(r.stdout);
    expect(info).toMatchObject({ id: '7300000000000000000', extractor: 'TikTok', duration: 12.5 });
    expect(info.title).toBeTruthy();
    expect(info.thumbnail).toMatch(/^https:\/\//);
    const [inicio] = await lerRegistro(registro);
    expect(inicio).toMatchObject({ programa: 'yt-dlp', evento: 'inicio', separador: true, urls: [TIKTOK], urlsAntesDoSeparador: [] });
    expect(inicio.argv).toContain('--ignore-config');
  });

  it('sem-titulo-sem-capa: título vazio e sem miniatura', async () => {
    const info = JSON.parse((await previa(TIKTOK, { CLIPORA_FALSO_CENARIO: 'sem-titulo-sem-capa' })).stdout);
    expect(info.title).toBe('');
    expect(info).not.toHaveProperty('thumbnail');
  });

  it('post-video-unico e carrossel', async () => {
    const unico = JSON.parse((await previa('https://www.instagram.com/p/POST1/', { CLIPORA_FALSO_CENARIO: 'post-video-unico' })).stdout);
    expect(unico._type).toBe('video');
    const carrossel = JSON.parse((await previa('https://www.instagram.com/p/POST2/', { CLIPORA_FALSO_CENARIO: 'carrossel' })).stdout);
    expect(carrossel._type).toBe('playlist');
    expect(carrossel.entries).toHaveLength(2);
  });

  it('lento: respeita o atraso (CLIPORA_FALSO_ATRASO_MS sobrescreve)', async () => {
    const r = await previa(TIKTOK, { CLIPORA_FALSO_CENARIO: 'lento', CLIPORA_FALSO_ATRASO_MS: '300' });
    expect(r.codigo).toBe(0);
    expect(r.ms).toBeGreaterThanOrEqual(300);
  });

  it('travado: não termina sozinho; só morre por sinal e não registra "fim"', async () => {
    const r = await rodar(YTDLP, ['-J', '--', TIKTOK], { env: { CLIPORA_FALSO_CENARIO: 'travado' }, matarApos: 400 });
    expect(r.sinal).toBe('SIGKILL');
    const eventos = (await lerRegistro(registro)).map((e) => e.evento);
    expect(eventos).toEqual(['inicio']);
  });

  it.runIf(UNIX)('com-filho: matar só o pai deixa o filho órfão; matar o grupo encerra os dois', async () => {
    const soPai = await rodar(YTDLP, ['-J', '--', TIKTOK], { env: { CLIPORA_FALSO_CENARIO: 'com-filho' }, matarApos: 400 });
    const orfao = (await lerRegistro(registro)).find((e) => e.evento === 'filho').filhoPid;
    expect(soPai.sinal).toBe('SIGKILL');
    expect(vivo(orfao)).toBe(true);
    process.kill(orfao, 'SIGKILL');

    rmSync(registro);
    const grupo = await rodar(YTDLP, ['-J', '--', TIKTOK], { env: { CLIPORA_FALSO_CENARIO: 'com-filho' }, matarApos: 400, grupo: true });
    const filho = (await lerRegistro(registro)).find((e) => e.evento === 'filho').filhoPid;
    expect(grupo.sinal).toBe('SIGKILL');
    await new Promise((r) => setTimeout(r, 100));
    expect(vivo(filho)).toBe(false);
  });

  const erros = [
    ['foto', REEL, 'There is no video in this post'],
    ['login', REEL, 'login required'],
    ['login-tiktok', TIKTOK, 'Log in for access'],
    ['privado', TIKTOK, 'This video is private'],
    ['removido', TIKTOK, 'Video not available, status code 10204'],
    ['limite', REEL, 'HTTP Error 429: Too Many Requests'],
    ['sem-conexao', TIKTOK, "Failed to resolve 'www.tiktok.com' ([Errno 8]"],
    ['sem-conexao-linux', TIKTOK, 'Temporary failure in name resolution'],
    ['sem-conexao-windows', TIKTOK, 'getaddrinfo failed'],
    ['extrator-quebrado', TIKTOK, 'Confirm you are on the latest version using  yt-dlp -U'],
  ];
  it.each(erros)('%s: exit 1, stdout vazio e stderr realista', async (cenario, url, trecho) => {
    const r = await previa(url, { CLIPORA_FALSO_CENARIO: cenario });
    expect(r.codigo).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/^ERROR: \[(Instagram|TikTok)\] /);
    expect(r.stderr).toContain(trecho);
  });

  it('json-invalido: exit 0 com stdout que não é JSON', async () => {
    const r = await previa(TIKTOK, { CLIPORA_FALSO_CENARIO: 'json-invalido' });
    expect(r.codigo).toBe(0);
    expect(() => JSON.parse(r.stdout)).toThrow();
  });

  it('falha-muda: exit 1 sem nenhuma saída', async () => {
    const r = await previa(TIKTOK, { CLIPORA_FALSO_CENARIO: 'falha-muda' });
    expect(r).toMatchObject({ codigo: 1, stdout: '', stderr: '' });
  });

  it('URL de outro site: "Unsupported URL"', async () => {
    const r = await previa('https://www.youtube.com/watch?v=x');
    expect(r.codigo).toBe(1);
    expect(r.stderr).toContain('ERROR: Unsupported URL: https://www.youtube.com/watch?v=x');
  });

  it('cenário por arquivo JSON sobrescreve campos', async () => {
    const arq = join(dir, 'cenario.json');
    writeFileSync(arq, JSON.stringify({ base: 'sucesso', metadados: { title: 'Título do arquivo', duration: 3 } }));
    const info = JSON.parse((await previa(TIKTOK, { CLIPORA_FALSO_CENARIO_ARQUIVO: arq })).stdout);
    expect(info).toMatchObject({ title: 'Título do arquivo', duration: 3 });
  });

  it('todos os cenários documentados existem', () => {
    expect(Object.keys(CENARIOS).length).toBeGreaterThanOrEqual(28);
    for (const c of Object.values(CENARIOS)) expect(c.descricao).toBeTruthy();
  });
});

descrever('yt-dlp falso: opções', () => {
  it.each(['--exec', '--cookies-from-browser', '-U', '--no-check-certificates'])('opção proibida %s: exit 2', async (opcao) => {
    const args = opcao === '-U' ? [opcao, '--', TIKTOK] : [opcao, 'x', '--', TIKTOK];
    const r = await rodar(YTDLP, args);
    expect(r.codigo).toBe(2);
    expect(r.stderr).toContain('opção proibida pelo contrato do Clipora');
  });

  it('opção desconhecida: exit 2 (ou ignorada com CLIPORA_FALSO_PERMISSIVO=1)', async () => {
    expect((await rodar(YTDLP, ['--opcao-inventada', '-J', '--', TIKTOK])).codigo).toBe(2);
    const r = await rodar(YTDLP, ['--opcao-inventada', '-J', '--', TIKTOK], { env: { CLIPORA_FALSO_PERMISSIVO: '1' } });
    expect(r.codigo).toBe(0);
    expect((await lerRegistro(registro)).at(-2).ignoradas).toEqual(['--opcao-inventada']);
  });

  it('URL antes do "--" fica registrada (para VT-07/VT-08)', async () => {
    await rodar(YTDLP, ['-J', TIKTOK]);
    expect((await lerRegistro(registro))[0]).toMatchObject({ separador: false, urlsAntesDoSeparador: [TIKTOK] });
  });

  it('--version: padrão, sobrescrita e versao-quebrada', async () => {
    expect((await rodar(YTDLP, ['--version'])).stdout).toBe('2026.10.26\n');
    expect((await rodar(YTDLP, ['--version'], { env: { CLIPORA_FALSO_VERSAO: '2026.11.01' } })).stdout).toBe('2026.11.01\n');
    const r = await rodar(YTDLP, ['--version'], { env: { CLIPORA_FALSO_CENARIO: 'versao-quebrada' } });
    expect(r.codigo).toBe(1);
    expect(r.stdout).toBe('');
  });
});

descrever('yt-dlp falso: download', () => {
  it('sucesso: progresso em duas partes no stderr, união pelo FFmpeg e caminho final no stdout', async () => {
    const r = await baixar(REEL);
    expect(r.codigo).toBe(0);
    const final = join(pastaDestino(), FINAL_REEL);
    expect(r.stdout).toBe(`${final}\n`);
    expect(arquivos()).toEqual([FINAL_REEL]);
    expect(statSync(final).size).toBe(262144 + 65536);
    // --print implica modo silencioso: o progresso (pedido com --progress) vai para o stderr.
    expect(percentuais(r.stderr)).toEqual([0, 25, 50, 75, 100, 0, 25, 50, 75, 100]);
    expect(r.stderr).not.toContain('Destination');
    const ffmpeg = (await lerRegistro(registro)).filter((e) => e.programa === 'ffmpeg' && e.evento === 'inicio');
    expect(ffmpeg.map((e) => e.argv[0])).toEqual(['-version', '-y']);
  });

  it('sem --print: mensagens e progresso vão para o stdout', async () => {
    const r = await rodar(YTDLP, ['--ffmpeg-location', FFMPEG, '--newline', '-P', pastaDestino(), '--', REEL]);
    expect(r.codigo).toBe(0);
    expect(r.stdout).toContain('[download] Destination:');
    expect(r.stdout).toContain(`[Merger] Merging formats into "${join(pastaDestino(), FINAL_REEL)}"`);
    expect(percentuais(r.stdout).length).toBe(10);
  });

  it('sem --newline: progresso separado por \\r', async () => {
    const r = await rodar(YTDLP, ['--ffmpeg-location', FFMPEG, '-P', pastaDestino(), '--', REEL]);
    expect(r.stdout).toMatch(/\r\[download\]\s+25\.0%/);
  });

  it('--progress-template com %(progress...)s e %(info...)s', async () => {
    const r = await baixar(REEL, {}, ['--progress-template', 'download:[clipora] %(info.format_id)s %(progress.downloaded_bytes)s/%(progress.total_bytes)s %(progress._percent_str)s']);
    const linhas = r.stderr.split('\n').filter((l) => l.startsWith('[clipora]'));
    expect(linhas[0]).toBe('[clipora] v1080 0/262144   0.0%');
    expect(linhas.at(-1)).toBe('[clipora] a128 65536/65536 100.0%');
  });

  it('progresso-indeterminado: sem percentual nem total', async () => {
    const r = await baixar(REEL, { CLIPORA_FALSO_CENARIO: 'progresso-indeterminado' }, ['--progress-template', 'download:%(progress)j']);
    const eventos = r.stderr.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
    expect(eventos.length).toBe(10);
    for (const e of eventos) expect(e).not.toHaveProperty('total_bytes');
    expect(r.codigo).toBe(0);
  });

  it('arquivo-unico: sem união e sem chamar o FFmpeg para converter', async () => {
    const r = await baixar(TIKTOK, { CLIPORA_FALSO_CENARIO: 'arquivo-unico' });
    expect(r.codigo).toBe(0);
    expect(arquivos()).toHaveLength(1);
    const conversoes = (await lerRegistro(registro)).filter((e) => e.programa === 'ffmpeg' && e.argv?.[0] === '-y');
    expect(conversoes).toEqual([]);
  });

  it('arquivo já existente: exit 0, imprime o caminho antigo e não altera nada (falso sucesso natural)', async () => {
    await baixar(REEL);
    const final = join(pastaDestino(), FINAL_REEL);
    writeFileSync(final, 'conteúdo original');
    const r = await baixar(REEL);
    expect(r.codigo).toBe(0);
    expect(r.stdout).toBe(`${final}\n`);
    expect(readFileSync(final, 'utf8')).toBe('conteúdo original');
    expect((await lerRegistro(registro)).some((e) => e.evento === 'ja-baixado')).toBe(true);
  });

  it('ja-baixado: mensagem "has already been downloaded", exit 0, nada criado', async () => {
    const r = await rodar(YTDLP, ['--ffmpeg-location', FFMPEG, '-P', pastaDestino(), '--', REEL], { env: { CLIPORA_FALSO_CENARIO: 'ja-baixado' } });
    expect(r.codigo).toBe(0);
    expect(r.stdout).toContain(`[download] ${join(pastaDestino(), FINAL_REEL)} has already been downloaded`);
    expect(arquivos()).toEqual([]);
  });

  it('sem-arquivo: exit 0, nenhum arquivo e nenhum after_move', async () => {
    const r = await baixar(REEL, { CLIPORA_FALSO_CENARIO: 'sem-arquivo' });
    expect(r.codigo).toBe(0);
    expect(r.stdout).toBe('');
    expect(arquivos()).toEqual([]);
  });

  it('arquivo-vazio: exit 0 com o final de 0 bytes', async () => {
    const r = await baixar(REEL, { CLIPORA_FALSO_CENARIO: 'arquivo-vazio' });
    expect(r.codigo).toBe(0);
    expect(statSync(r.stdout.trim()).size).toBe(0);
  });

  it('so-part: exit 0 deixando só o .part', async () => {
    const r = await baixar(REEL, { CLIPORA_FALSO_CENARIO: 'so-part' });
    expect(r.codigo).toBe(0);
    expect(r.stdout).toBe('');
    expect(arquivos()).toEqual(['Video by clipora.teste [ABC123].fv1080.mp4.part']);
  });

  it('caminho-fora: exit 0 e after_move fora da pasta de destino', async () => {
    const fora = join(dir, 'fora');
    const r = await baixar(REEL, { CLIPORA_FALSO_CENARIO: 'caminho-fora', CLIPORA_FALSO_PASTA_FORA: fora });
    const impresso = r.stdout.trim();
    expect(r.codigo).toBe(0);
    expect(impresso).toBe(join(fora, 'fora.mp4'));
    expect(impresso.startsWith(pastaDestino())).toBe(false);
    expect(existsSync(impresso)).toBe(true);
    expect(arquivos()).toEqual([]);
  });

  it.each([
    ['rede-cai', 'unable to download video data'],
    ['sem-espaco', 'No space left on device'],
  ])('%s: exit 1 a 50%% deixando .part', async (cenario, trecho) => {
    const r = await baixar(REEL, { CLIPORA_FALSO_CENARIO: cenario });
    expect(r.codigo).toBe(1);
    expect(r.stderr).toContain(trecho);
    expect(Math.max(...percentuais(r.stderr))).toBe(25);
    expect(arquivos()).toEqual(['Video by clipora.teste [ABC123].fv1080.mp4.part']);
    expect(r.stdout).toBe('');
  });

  it('carrossel no download: baixa vários arquivos (o backend deve barrar antes)', async () => {
    const r = await baixar('https://www.instagram.com/p/POST2/', { CLIPORA_FALSO_CENARIO: 'carrossel' });
    expect(r.codigo).toBe(0);
    expect(arquivos()).toHaveLength(2);
  });
});

descrever('FFmpeg falso e ausente', () => {
  it('CLIPORA_FFMPEG_FALSO=falha: yt-dlp sai com 1 e as partes ficam para trás', async () => {
    const r = await baixar(REEL, { CLIPORA_FFMPEG_FALSO: 'falha' });
    expect(r.codigo).toBe(1);
    expect(r.stderr).toContain('ERROR: Postprocessing: Conversion failed!');
    expect(r.stdout).toBe('');
    expect(arquivos()).toEqual([
      'Video by clipora.teste [ABC123].fa128.m4a',
      'Video by clipora.teste [ABC123].fv1080.mp4',
      'Video by clipora.teste [ABC123].temp.mp4',
    ]);
  });

  it('FFmpeg ausente sem -f: aviso, formato único e exit 0 (degradação silenciosa)', async () => {
    const r = await baixar(REEL, {}, ['--ffmpeg-location', join(dir, 'nao-existe', 'clipora-ffmpeg')]);
    expect(r.codigo).toBe(0);
    expect(r.stderr).toContain('WARNING: ffmpeg not found.');
    expect(arquivos()).toEqual([FINAL_REEL]);
    expect(statSync(join(pastaDestino(), FINAL_REEL)).size).toBe(131072);
  });

  it('FFmpeg ausente com -f bv*+ba: aviso, partes separadas, exit 0, after_move "NA"', async () => {
    const r = await baixar(REEL, {}, ['--ffmpeg-location', join(dir, 'nao-existe'), '-f', 'bv*+ba']);
    expect(r.codigo).toBe(0);
    expect(r.stderr).toContain("ffmpeg is not installed. The formats won't be merged");
    expect(r.stdout).toBe('NA\n');
    expect(arquivos()).toHaveLength(2);
  });

  it('CLIPORA_FFMPEG_FALSO=quebrado: -version falha e o yt-dlp trata como ausente', async () => {
    const r = await baixar(REEL, { CLIPORA_FFMPEG_FALSO: 'quebrado' });
    expect(r.codigo).toBe(0);
    expect(r.stderr).toContain('WARNING: ffmpeg not found.');
  });

  it('--ffmpeg-location apontando para PASTA procura "ffmpeg", não "clipora-ffmpeg"', async () => {
    const r = await baixar(REEL, {}, ['--ffmpeg-location', BIN]);
    expect(r.stderr).toContain('WARNING: ffmpeg not found.');
    const ev = (await lerRegistro(registro)).find((e) => e.evento === 'ffmpeg');
    expect(ev.caminho).toBe(join(BIN, 'ffmpeg'));
  });

  it('ffmpeg/ffprobe falsos diretamente', async () => {
    expect((await rodar(FFMPEG, ['-version'])).stdout).toMatch(/^ffmpeg version 7\.1-clipora-falso/);
    const probe = await rodar(FFPROBE, ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', 'x.mp4']);
    expect(JSON.parse(probe.stdout).streams.map((s) => s.codec_type)).toEqual(['video', 'audio']);
    const falha = await rodar(FFPROBE, ['x.mp4'], { env: { CLIPORA_FFPROBE_FALSO: 'falha' } });
    expect(falha.codigo).toBe(1);
  });
});

descrever('preparar-bin (CLIPORA_BIN_DIR)', () => {
  it('monta pasta sem FFmpeg e com yt-dlp funcional fora do repositório', async () => {
    const pasta = await prepararBin({ destino: join(dir, 'bin'), semFfmpeg: true });
    expect(readdirSync(pasta).sort()).toEqual(['clipora-ffprobe', 'clipora-yt-dlp', 'package.json']);
    const r = await rodar(join(pasta, 'clipora-yt-dlp'), ['--version']);
    expect(r.stdout).toBe('2026.10.26\n');
  });

  it.runIf(UNIX)('yt-dlp não executável: spawn falha com EACCES', async () => {
    const pasta = await prepararBin({ destino: join(dir, 'bin'), ytdlpNaoExecutavel: true });
    await expect(rodar(join(pasta, 'clipora-yt-dlp'), ['--version'])).rejects.toMatchObject({ code: 'EACCES' });
  });

  it('clipora-falso.json por pasta: cenários diferentes em paralelo, sem variáveis de ambiente', async () => {
    const regA = join(dir, 'a.jsonl');
    const pastaLogin = await prepararBin({ destino: join(dir, 'login'), ambiente: { CLIPORA_FALSO_CENARIO: 'login', CLIPORA_FALSO_REGISTRO: regA } });
    const pastaOk = await prepararBin({ destino: join(dir, 'ok'), ambiente: { CLIPORA_FFMPEG_FALSO: 'falha' } });
    const semAmbiente = (programa, args) =>
      new Promise((resolver) => {
        const env = { ...process.env };
        for (const k of Object.keys(env)) if (k.startsWith('CLIPORA_')) delete env[k];
        const p = spawn(programa, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        p.stdout.on('data', (d) => (stdout += d));
        p.stderr.on('data', (d) => (stderr += d));
        p.on('close', (codigo) => resolver({ codigo, stdout, stderr }));
      });
    const [login, ok, uniao] = await Promise.all([
      semAmbiente(join(pastaLogin, 'clipora-yt-dlp'), ['-J', '--', REEL]),
      semAmbiente(join(pastaOk, 'clipora-yt-dlp'), ['-J', '--', REEL]),
      semAmbiente(join(pastaOk, 'clipora-yt-dlp'), ['--ffmpeg-location', join(pastaOk, 'clipora-ffmpeg'), '-P', join(dir, 'd2'), '--', REEL]),
    ]);
    expect(login.codigo).toBe(1);
    expect(login.stderr).toContain('login required');
    expect(ok.codigo).toBe(0);
    // O modo do ffmpeg vem do clipora-falso.json da mesma pasta.
    expect(uniao.codigo).toBe(1);
    expect(uniao.stderr).toContain('Conversion failed!');
    expect((await lerRegistro(regA)).map((e) => e.evento)).toEqual(['inicio', 'fim']);
  });

  it('CLI: node preparar-bin.mjs <destino> --sem-ffmpeg --cenario limite', async () => {
    const destino = join(dir, 'cli');
    const r = await rodar(process.execPath, [fileURLToPath(new URL('../fixtures/preparar-bin.mjs', import.meta.url)), destino, '--sem-ffmpeg', '--cenario', 'limite']);
    expect(r.codigo).toBe(0);
    expect(r.stdout.trim()).toBe(destino);
    expect(readdirSync(destino).sort()).toEqual(['clipora-falso.json', 'clipora-ffprobe', 'clipora-yt-dlp', 'package.json']);
    expect(JSON.parse(readFileSync(join(destino, 'clipora-falso.json'), 'utf8'))).toEqual({ CLIPORA_FALSO_CENARIO: 'limite' });
  });

  it('yt-dlp ausente: spawn falha com ENOENT', async () => {
    const pasta = await prepararBin({ destino: join(dir, 'bin'), semYtdlp: true });
    await expect(rodar(join(pasta, 'clipora-yt-dlp'), ['--version'])).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
