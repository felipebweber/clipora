/**
 * Tipos espelhados de docs/contrato-ipc.md (v2, commit 119b563).
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
  | "ERRO_INTERNO";

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

export type EstadoDownloadAtivo = {
  downloadId: string;
  percentual: number | null;
  etapa: EtapaDownload;
};

/** Retorno de `obter_estado()` — renomeado de `Estado` (ver nota acima). */
export type EstadoPersistido = {
  download: EstadoDownloadAtivo | null;
  atualizacaoEmAndamento: boolean;
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
