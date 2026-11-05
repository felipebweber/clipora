/**
 * Tipos espelhados de docs/contrato-ipc.md (v2, revisão pós-commit 6be9e6b:
 * +YTDLP_INDISPONIVEL, regra "a última chamada vence" para requisicaoId).
 *
 * Fonte de verdade: o contrato pertence ao Ferrugem (backend). Este arquivo
 * NUNCA deve ser editado para "corrigir" o contrato — qualquer divergência
 * percebida deve ser reportada ao coordenador, não resolvida aqui.
 *
 * Observação de nomenclatura: o contrato usa `Estado` para o retorno de
 * `obter_estado` (download ativo + atualização em andamento). Para não
 * colidir com o `EstadoApp` da máquina de estados da tela (src/estado),
 * esse tipo foi renomeado aqui para `EstadoPersistido`.
 */

export type CodigoErro =
  | "LINK_INVALIDO"
  | "PLATAFORMA_NAO_SUPORTADA"
  | "PREVIA_CANCELADA"
  | "TEMPO_ESGOTADO"
  | "SEM_CONEXAO"
  | "LOGIN_NECESSARIO"
  | "CONTEUDO_PRIVADO_OU_REMOVIDO"
  | "LIMITE_DE_ACESSO"
  | "CONTEUDO_NAO_SUPORTADO"
  | "PREVIA_INDISPONIVEL"
  | "PASTA_NAO_DEFINIDA"
  | "PASTA_AUSENTE"
  | "PASTA_SEM_PERMISSAO"
  | "ESPACO_INSUFICIENTE"
  | "FFMPEG_INDISPONIVEL"
  | "ARQUIVO_INCOMPLETO"
  | "DOWNLOAD_EM_ANDAMENTO"
  | "DOWNLOAD_FALHOU"
  | "ATUALIZACAO_EM_ANDAMENTO"
  | "ATUALIZACAO_INTEGRIDADE"
  | "ATUALIZACAO_NAO_SUPORTADA"
  | "ATUALIZACAO_FALHOU"
  | "YTDLP_INDISPONIVEL"
  | "LICENCAS_INDISPONIVEIS"
  | "ERRO_INTERNO";

/** Lista em runtime dos códigos válidos, usada para validar erros vindos do
 * Rust via `invoke()` (podem chegar malformados em casos extremos).
 * `satisfies` garante que só há códigos válidos; a checagem
 * `_CodigosFaltando` abaixo garante que nenhum código da união ficou de fora. */
export const CODIGOS_ERRO = [
  "LINK_INVALIDO",
  "PLATAFORMA_NAO_SUPORTADA",
  "PREVIA_CANCELADA",
  "TEMPO_ESGOTADO",
  "SEM_CONEXAO",
  "LOGIN_NECESSARIO",
  "CONTEUDO_PRIVADO_OU_REMOVIDO",
  "LIMITE_DE_ACESSO",
  "CONTEUDO_NAO_SUPORTADO",
  "PREVIA_INDISPONIVEL",
  "PASTA_NAO_DEFINIDA",
  "PASTA_AUSENTE",
  "PASTA_SEM_PERMISSAO",
  "ESPACO_INSUFICIENTE",
  "FFMPEG_INDISPONIVEL",
  "ARQUIVO_INCOMPLETO",
  "DOWNLOAD_EM_ANDAMENTO",
  "DOWNLOAD_FALHOU",
  "ATUALIZACAO_EM_ANDAMENTO",
  "ATUALIZACAO_INTEGRIDADE",
  "ATUALIZACAO_NAO_SUPORTADA",
  "ATUALIZACAO_FALHOU",
  "YTDLP_INDISPONIVEL",
  "LICENCAS_INDISPONIVEIS",
  "ERRO_INTERNO",
] as const satisfies readonly CodigoErro[];

/** Falha a compilação se algum membro de `CodigoErro` não estiver em
 * `CODIGOS_ERRO` (ex.: o contrato ganhou um código novo). */
type _CodigosFaltando = Exclude<CodigoErro, (typeof CODIGOS_ERRO)[number]>;
const _completude: [_CodigosFaltando] extends [never] ? true : _CodigosFaltando = true;
void _completude;

export function ehCodigoErro(valor: unknown): valor is CodigoErro {
  return typeof valor === "string" && (CODIGOS_ERRO as readonly string[]).includes(valor);
}

/**
 * `mensagem` é o fallback em inglês/técnico enviado pelo Rust; o frontend é
 * dono do texto em português exibido ao usuário (ver src/erros/mensagens.ts).
 * `detalhe` é técnico e não deve ser exibido por padrão.
 */
export type ErroClipora = {
  codigo: CodigoErro;
  mensagem: string;
  detalhe?: string;
};

export type Plataforma = "instagram" | "tiktok";

export type Previa = {
  requisicaoId: number;
  urlOriginal: string;
  urlNormalizada: string;
  titulo: string | null;
  plataforma: Plataforma;
  duracaoSegundos: number | null;
  capaDataUrl: string | null;
};

export type EtapaDownload =
  | "preparando"
  | "baixando_video"
  | "baixando_audio"
  | "unindo"
  | "finalizando";

export type EventoDownload =
  | {
      tipo: "progresso";
      etapa: EtapaDownload;
      percentual: number | null;
      bytesBaixados?: number;
      bytesTotais?: number;
    }
  | { tipo: "concluido"; caminho: string; nomeArquivo: string; renomeado: boolean }
  | { tipo: "erro"; erro: ErroClipora };

/**
 * `previa` é `null` quando a prévia não foi carregada ou pertence a outra
 * URL. Continua opcional no tipo para tolerar um backend anterior a essa
 * extensão do contrato; nos dois casos o frontend cai num estado de
 * recuperação sem prévia (ver src/estado/maquina.ts, `estado_recuperado`).
 */
export type EstadoDownloadAtivo = {
  downloadId: string;
  percentual: number | null;
  etapa: EtapaDownload;
  previa?: Previa | null;
};

export type ResultadoTerminal =
  | {
      downloadId: string;
      tipo: "concluido";
      caminho: string;
      nomeArquivo: string;
      renomeado: boolean;
    }
  | { downloadId: string; tipo: "erro"; erro: ErroClipora };

/** Retorno de `obter_estado()` — renomeado de `Estado` (ver nota acima). */
export type EstadoPersistido = {
  download: EstadoDownloadAtivo | null;
  atualizacaoEmAndamento: boolean;
  ultimoResultado: ResultadoTerminal | null;
};

export type EstadoPasta = "nao_definida" | "valida" | "ausente" | "sem_permissao";

export type PastaDestino = {
  caminho: string | null;
  estado: EstadoPasta;
};

export type OrigemYtdlp = "empacotada" | "atualizada";

export type VerificacaoYtdlp = {
  versaoAtual: string;
  versaoDisponivel: string | null;
  atualizacaoDisponivel: boolean;
  origem: OrigemYtdlp;
  erroVerificacao: ErroClipora | null;
};

export type EventoAtualizacao = {
  tipo: "progresso";
  etapa: string;
  percentual: number | null;
};

export type ResultadoAtualizacao = {
  versaoInstalada: string;
};

/** Códigos de erro que, ao surgirem como resposta de `iniciar_download`, não
 * devem ser exibidos como erro terminal: o fluxo é interceptar e chamar
 * `selecionar_pasta_destino`. */
export const CODIGOS_ERRO_PASTA: readonly CodigoErro[] = [
  "PASTA_NAO_DEFINIDA",
  "PASTA_AUSENTE",
  "PASTA_SEM_PERMISSAO",
];

export function ehErroDePasta(erro: ErroClipora): boolean {
  return CODIGOS_ERRO_PASTA.includes(erro.codigo);
}

// ── Licenças ─────────────────────────────────────────────────────────────────
// `obter_licencas()` lê `licencas/licencas.json` (formato 1, gerado por
// scripts/gerar-licencas.mjs) e `THIRD_PARTY_LICENSES.txt` dos recursos do
// app. Arquivo ausente/inválido rejeita com LICENCAS_INDISPONIVEIS.

export type ComponenteLicenca = {
  id: string;
  nome: string;
  versao: string;
  licenca: string;
  papel: string;
  codigoFonte: string;
  projeto: string;
  binario?: string;
  sha256Fonte?: string;
};

export type PacoteLicenca = {
  nome: string;
  versao: string;
  licenca: string;
  projeto?: string;
};

export type ResumoLicencas = {
  formato: number;
  app: { nome: string; versao: string };
  alvo: string;
  componentes: ComponenteLicenca[];
  crates: PacoteLicenca[];
  npm: PacoteLicenca[];
  arquivoCompleto: string;
};

export type Licencas = {
  resumo: ResumoLicencas;
  textoCompleto: string;
};

/** `abrir_link_licenca` aceita apenas os destinos HTTPS do contrato, sem URL
 * arbitrária do frontend; `codigoFonteAtualizada` é restrito ao yt-dlp e tem
 * seu endereço derivado pelo backend a partir da versão instalada. */
export type TipoLinkLicenca = "codigoFonte" | "projeto" | "codigoFonteAtualizada";
