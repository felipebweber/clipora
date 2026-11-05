import type { CodigoErro, ErroClipora } from "../tipos/contrato";

/**
 * Mapa código -> mensagem em português. O backend envia `mensagem` apenas
 * como fallback técnico; o frontend é dono do texto exibido ao usuário.
 */
export const MENSAGENS_ERRO: Record<CodigoErro, string> = {
  LINK_INVALIDO: "Esse link não é válido. Verifique e tente novamente.",
  PLATAFORMA_NAO_SUPORTADA:
    "Esse link não é do Instagram Reels ou do TikTok, as plataformas aceitas.",
  PREVIA_CANCELADA: "Prévia cancelada.",
  TEMPO_ESGOTADO: "O carregamento demorou demais. Tente novamente.",
  SEM_CONEXAO: "Sem conexão com a internet. Verifique sua rede e tente novamente.",
  LOGIN_NECESSARIO: "Esse conteúdo exige login e não pode ser baixado.",
  CONTEUDO_PRIVADO_OU_REMOVIDO: "Esse conteúdo é privado ou foi removido.",
  LIMITE_DE_ACESSO: "Limite de acessos da plataforma atingido. Tente novamente mais tarde.",
  CONTEUDO_NAO_SUPORTADO:
    "Esse tipo de conteúdo não é suportado (apenas um vídeo por link, sem álbuns ou fotos).",
  PREVIA_INDISPONIVEL:
    "Não foi possível carregar a prévia agora. Isso pode mudar; tente novamente.",
  PASTA_NAO_DEFINIDA: "Nenhuma pasta de destino definida.",
  PASTA_AUSENTE: "A pasta de destino não existe mais. Escolha outra.",
  PASTA_SEM_PERMISSAO: "Sem permissão para salvar na pasta escolhida. Escolha outra.",
  ESPACO_INSUFICIENTE: "Não há espaço suficiente na pasta de destino.",
  FFMPEG_INDISPONIVEL: "O componente necessário para unir vídeo e áudio está indisponível.",
  ARQUIVO_INCOMPLETO: "O arquivo não foi concluído corretamente. Tente novamente.",
  DOWNLOAD_EM_ANDAMENTO: "Já existe um download em andamento.",
  DOWNLOAD_FALHOU: "O download falhou. Tente novamente.",
  ATUALIZACAO_EM_ANDAMENTO: "Uma atualização do yt-dlp está em andamento. Aguarde para continuar.",
  ATUALIZACAO_INTEGRIDADE: "A atualização não pôde ser verificada com segurança e foi cancelada.",
  ATUALIZACAO_NAO_SUPORTADA: "A atualização não é suportada neste sistema.",
  ATUALIZACAO_FALHOU: "A atualização falhou. A versão anterior continua em uso.",
  ERRO_INTERNO: "Ocorreu um erro interno inesperado.",
};

/** Sugestões complementares exibidas junto de alguns erros (ex.: extrator
 * falhou -> sugerir atualizar o yt-dlp, conforme o contrato). */
const SUGESTAO_ADICIONAL: Partial<Record<CodigoErro, string>> = {
  PREVIA_INDISPONIVEL: "Se o problema continuar, verifique se há uma atualização do yt-dlp disponível nas configurações.",
  DOWNLOAD_FALHOU: "Se o problema continuar, verifique se há uma atualização do yt-dlp disponível nas configurações.",
};

export function mensagemDoErro(erro: ErroClipora): string {
  return MENSAGENS_ERRO[erro.codigo] ?? erro.mensagem;
}

export function sugestaoDoErro(erro: ErroClipora): string | null {
  return SUGESTAO_ADICIONAL[erro.codigo] ?? null;
}
