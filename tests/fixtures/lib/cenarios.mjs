// Cenários do yt-dlp falso. Selecionados por CLIPORA_FALSO_CENARIO (padrão:
// "sucesso") e ajustáveis por um arquivo JSON em CLIPORA_FALSO_CENARIO_ARQUIVO.
//
// As mensagens de stderr foram modeladas na saída do yt-dlp (extratores
// Instagram/TikTok e núcleo). São aproximações: revalidar com o binário real
// fixado em scripts/binarios.lock antes de fechar as etapas 3 e 5.
//
// Placeholders nas mensagens: {id}, {url}, {extrator}, {host}.

import { readFileSync } from 'node:fs';

const COOKIES = (site) =>
  `Use --cookies, --cookies-from-browser, --username and --password, --netrc-cmd, or --netrc (${site}) to provide account credentials. See  https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp  for how to manually pass cookies`;

const erroExtracao = (stderr, codigo = 1) => ({ erro: { fase: 'extracao', stderr, codigo } });

/** Campos de cada cenário (todos opcionais):
 *  descricao     texto
 *  atrasoMs      espera antes de responder (sobrescrito por CLIPORA_FALSO_ATRASO_MS)
 *  travar        nunca termina
 *  filho         cria um processo filho de longa duração (mesmo grupo de processos)
 *  metadados     campos que sobrescrevem o JSON de metadados padrão
 *  tipo          "video" | "playlist"
 *  stdoutBruto   texto escrito no stdout no lugar do JSON (com codigoSaida)
 *  erro          { fase: "extracao" | "download", stderr, codigo, em (fração 0–1) }
 *  download      { uniao, totalConhecido, resultado, videos }
 *                videos: número de itens baixados quando a prévia mostra vídeo único (padrão 1)
 *                resultado: "normal" | "ja-baixado" | "sem-arquivo" | "arquivo-vazio" | "so-part" | "caminho-fora"
 *  versao        texto de --version; versaoFalha: true faz --version falhar
 */
export const CENARIOS = {
  // ---- Prévia / metadados ----
  sucesso: { descricao: 'Metadados normais; download com vídeo e áudio separados unidos pelo FFmpeg.' },
  lento: { descricao: 'Responde corretamente após 1500 ms (resposta atrasada).', atrasoMs: 1500 },
  travado: { descricao: 'Nunca responde nem termina (tempo esgotado).', travar: true },
  'com-filho': {
    descricao: 'Cria um processo filho de longa duração e trava (morte da árvore de processos).',
    filho: true,
    travar: true,
  },
  'sem-titulo-sem-capa': {
    descricao: 'Título vazio e sem miniatura (comum em TikTok sem legenda).',
    metadados: { title: '', description: '', thumbnail: undefined, thumbnails: [] },
  },
  'post-video-unico': {
    descricao: 'Post /p/ do Instagram com um único vídeo (aceito na v1).',
    metadados: { webpage_url_basename: 'p' },
  },
  carrossel: {
    descricao: 'Post com vários itens: JSON com _type "playlist" e 2 entradas (CONTEUDO_NAO_SUPORTADO na v1).',
    tipo: 'playlist',
  },
  foto: {
    descricao: 'Post só com foto.',
    ...erroExtracao('ERROR: [{extrator}] {id}: There is no video in this post'),
  },
  login: {
    descricao: 'Instagram exige login (a mensagem também contém "not available" e "rate-limit").',
    ...erroExtracao(`ERROR: [{extrator}] {id}: Requested content is not available, rate-limit reached or login required. ${COOKIES('instagram')}`),
  },
  'login-tiktok': {
    descricao: 'TikTok exige login (conteúdo restrito).',
    ...erroExtracao(`ERROR: [{extrator}] {id}: This post may not be comfortable for some audiences. Log in for access. ${COOKIES('tiktok')}`),
  },
  privado: {
    descricao: 'Vídeo privado.',
    ...erroExtracao('ERROR: [{extrator}] {id}: This video is private'),
  },
  removido: {
    descricao: 'Vídeo removido/indisponível (TikTok usa "not available", não "unavailable").',
    ...erroExtracao('ERROR: [{extrator}] {id}: Video not available, status code 10204'),
  },
  limite: {
    descricao: 'HTTP 429.',
    ...erroExtracao('ERROR: [{extrator}] {id}: Unable to download webpage: HTTP Error 429: Too Many Requests (caused by <HTTPError 429: Too Many Requests>)'),
  },
  'sem-conexao': {
    descricao: 'DNS falhou (texto do macOS).',
    ...erroExtracao(`ERROR: [{extrator}] {id}: Unable to download webpage: Failed to resolve '{host}' ([Errno 8] nodename nor servname provided, or not known) (caused by TransportError("Failed to resolve '{host}' ([Errno 8] nodename nor servname provided, or not known)"))`),
  },
  'sem-conexao-linux': {
    descricao: 'DNS falhou (texto do Linux).',
    ...erroExtracao(`ERROR: [{extrator}] {id}: Unable to download webpage: Failed to resolve '{host}' ([Errno -3] Temporary failure in name resolution) (caused by TransportError("Failed to resolve '{host}' ([Errno -3] Temporary failure in name resolution)"))`),
  },
  'sem-conexao-windows': {
    descricao: 'DNS falhou (texto do Windows).',
    ...erroExtracao(`ERROR: [{extrator}] {id}: Unable to download webpage: Failed to resolve '{host}' ([Errno 11001] getaddrinfo failed) (caused by TransportError("Failed to resolve '{host}' ([Errno 11001] getaddrinfo failed)"))`),
  },
  'extrator-quebrado': {
    descricao: 'Extrator quebrado por mudança na plataforma (sugerir atualizar o yt-dlp).',
    ...erroExtracao('ERROR: [{extrator}] {id}: Unable to extract universal data for rehydration; please report this issue on  https://github.com/yt-dlp/yt-dlp/issues?q= , filling out the appropriate issue template. Confirm you are on the latest version using  yt-dlp -U'),
  },
  'json-invalido': {
    descricao: 'Sai com 0, mas o stdout não é JSON.',
    stdoutBruto: '<html>não é json</html>\n',
    codigoSaida: 0,
  },
  'falha-muda': { descricao: 'Sai com 1 sem nenhuma mensagem.', stdoutBruto: '', codigoSaida: 1 },

  // ---- Download ----
  'arquivo-unico': { descricao: 'Formato único (sem união; FFmpeg não é chamado).', download: { uniao: false } },
  'progresso-indeterminado': {
    descricao: 'Tamanho total desconhecido: linhas de progresso sem percentual.',
    download: { totalConhecido: false },
  },
  'ja-baixado': {
    descricao: 'Imprime "has already been downloaded", sai com 0 e não cria nada (falso sucesso).',
    download: { resultado: 'ja-baixado' },
  },
  'sem-arquivo': {
    descricao: 'Mostra progresso, sai com 0, mas não deixa arquivo final nem imprime after_move.',
    download: { resultado: 'sem-arquivo' },
  },
  'arquivo-vazio': { descricao: 'Sai com 0 deixando o arquivo final com 0 bytes.', download: { resultado: 'arquivo-vazio' } },
  'so-part': { descricao: 'Sai com 0 deixando apenas o .part do vídeo.', download: { resultado: 'so-part' } },
  'caminho-fora': {
    descricao: 'Sai com 0 e imprime em after_move um caminho fora da pasta de destino.',
    download: { resultado: 'caminho-fora' },
  },
  'download-varios-itens': {
    descricao: 'Prévia (-J) de vídeo único, mas o download baixa 2 itens e imprime 2 linhas after_move, exit 0 (rejeição de carrossel no download).',
    download: { videos: 2 },
  },
  'rede-cai': {
    descricao: 'A conexão cai a 50% do vídeo: exit 1, .part fica para trás.',
    erro: {
      fase: 'download',
      em: 0.5,
      codigo: 1,
      stderr: "ERROR: unable to download video data: ('Connection broken: IncompleteRead(131072 bytes read, 131072 more expected)', IncompleteRead(131072 bytes read, 131072 more expected))",
    },
  },
  'sem-espaco': {
    descricao: 'Disco cheio a 50% do vídeo.',
    erro: { fase: 'download', em: 0.5, codigo: 1, stderr: 'ERROR: unable to write data: [Errno 28] No space left on device' },
  },

  // ---- Versão ----
  'versao-quebrada': { descricao: '--version falha (binário corrompido).', versaoFalha: true },
};

export function carregarCenario() {
  const nome = process.env.CLIPORA_FALSO_CENARIO || 'sucesso';
  let base = CENARIOS[nome];
  if (!base) {
    throw new Error(`cenário desconhecido: ${nome}. Disponíveis: ${Object.keys(CENARIOS).join(', ')}`);
  }
  let cenario = { nome, ...base, download: { ...(base.download ?? {}) } };
  const arquivo = process.env.CLIPORA_FALSO_CENARIO_ARQUIVO;
  if (arquivo) {
    const extra = JSON.parse(readFileSync(arquivo, 'utf8'));
    if (extra.base) {
      const outro = CENARIOS[extra.base];
      if (!outro) throw new Error(`cenário base desconhecido: ${extra.base}`);
      cenario = { nome: extra.base, ...outro, download: { ...(outro.download ?? {}) } };
    }
    cenario = {
      ...cenario,
      ...extra,
      nome: extra.nome ?? `${cenario.nome}+arquivo`,
      download: { ...cenario.download, ...(extra.download ?? {}) },
      metadados: { ...(cenario.metadados ?? {}), ...(extra.metadados ?? {}) },
    };
  }
  return cenario;
}
