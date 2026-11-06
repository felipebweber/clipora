import type { CodigoErro, ErroClipora } from "../tipos/contrato";

/**
 * Mapa código -> mensagem em português. O backend envia `mensagem` apenas
 * como fallback técnico; o frontend é dono do texto exibido ao usuário.
 */
export const MENSAGENS_ERRO: Record<CodigoErro, string> = {
  LINK_INVALIDO: "Esse link não é válido. Confira o endereço e cole de novo.",
  PLATAFORMA_NAO_SUPORTADA:
    "Esse link não é do Instagram Reels, do TikTok ou do YouTube. Cole um link de uma dessas plataformas.",
  PREVIA_CANCELADA: "A prévia foi cancelada. Cole o link de novo para continuar.",
  TEMPO_ESGOTADO: "O carregamento demorou demais. Verifique sua conexão e tente novamente.",
  SEM_CONEXAO: "Sem conexão com a internet. Verifique sua rede e tente novamente.",
  LOGIN_NECESSARIO:
    "Esse vídeo só pode ser visto com login. O Clipora baixa apenas vídeos públicos; tente outro link.",
  CONTEUDO_PRIVADO_OU_REMOVIDO:
    "Esse vídeo é privado ou foi removido. Confira o link ou tente outro vídeo.",
  LIMITE_DE_ACESSO:
    "A plataforma limitou os acessos por enquanto. Aguarde alguns minutos e tente novamente.",
  CONTEUDO_NAO_SUPORTADO:
    "Esse link não aponta para um único vídeo (fotos e álbuns não são aceitos). Tente o link de um vídeo.",
  PREVIA_INDISPONIVEL:
    "Não foi possível carregar a prévia agora. Tente novamente em instantes.",
  PASTA_NAO_DEFINIDA:
    "Nenhuma pasta de destino foi escolhida. Escolha uma em Configurações ou tente baixar de novo.",
  PASTA_AUSENTE: "A pasta de destino não existe mais. Escolha outra em Configurações.",
  PASTA_SEM_PERMISSAO:
    "O Clipora não tem permissão para salvar na pasta escolhida. Escolha outra em Configurações.",
  ESPACO_INSUFICIENTE:
    "Não há espaço livre suficiente no disco. Libere espaço ou escolha outra pasta e tente novamente.",
  FFMPEG_INDISPONIVEL:
    "O componente que junta vídeo e áudio está indisponível. Reinstale o Clipora para corrigir.",
  ARQUIVO_INCOMPLETO: "O arquivo não foi salvo por completo. Tente baixar novamente.",
  DOWNLOAD_EM_ANDAMENTO: "Já existe um download em andamento. Aguarde ele terminar.",
  DOWNLOAD_FALHOU: "O download falhou. Tente novamente.",
  ATUALIZACAO_EM_ANDAMENTO:
    "Uma atualização do yt-dlp está em andamento. Aguarde ela terminar para continuar.",
  ATUALIZACAO_INTEGRIDADE:
    "A atualização não pôde ser verificada com segurança e foi cancelada. A versão atual continua em uso; tente novamente mais tarde.",
  ATUALIZACAO_NAO_SUPORTADA:
    "Não foi possível confirmar a compatibilidade desta atualização com o Clipora. A versão atual do yt-dlp continua em uso. Atualize ou reinstale o Clipora para tentar novamente.",
  ATUALIZACAO_FALHOU:
    "A atualização falhou e a versão anterior continua em uso. Verifique sua conexão e tente novamente.",
  LICENCAS_INDISPONIVEIS:
    "As informações de licença não foram encontradas neste aplicativo. Reinstale o Clipora para restaurá-las.",
  HISTORICO_INDISPONIVEL: "Não foi possível atualizar o histórico. Tente novamente.",
  ARQUIVO_AUSENTE: "Este vídeo não está mais disponível no local salvo. Tente baixá-lo novamente.",
  QUALIDADE_INDISPONIVEL: "Essa qualidade não está mais disponível. Atualize a prévia e escolha outra.",
  MOTOR_YOUTUBE_INDISPONIVEL:
    "O componente necessário para baixar do YouTube está indisponível ou é incompatível. Reinstale ou atualize o Clipora.",
  YTDLP_INDISPONIVEL:
    "O componente necessário para obter o vídeo está indisponível. Reinstale o Clipora ou atualize o yt-dlp quando o aviso de nova versão aparecer.",
  ERRO_INTERNO:
    "Algo deu errado de forma inesperada. Tente novamente; se continuar, feche e abra o Clipora.",
};

/** Sugestões complementares exibidas junto de alguns erros (ex.: extrator
 * falhou -> sugerir atualizar o yt-dlp, conforme o contrato). */
const SUGESTAO_ADICIONAL: Partial<Record<CodigoErro, string>> = {
  PREVIA_INDISPONIVEL: "Se o problema continuar, atualize o yt-dlp quando o aviso de nova versão aparecer.",
  DOWNLOAD_FALHOU: "Se o problema continuar, atualize o yt-dlp quando o aviso de nova versão aparecer.",
};

/** Erros de prévia em que repetir a mesma requisição não adianta (o link, o
 * conteúdo ou a instalação é o problema). Os demais oferecem "Tentar
 * novamente". */
const PREVIA_SEM_NOVA_TENTATIVA: ReadonlySet<CodigoErro> = new Set<CodigoErro>([
  "LINK_INVALIDO",
  "PLATAFORMA_NAO_SUPORTADA",
  "LOGIN_NECESSARIO",
  "CONTEUDO_PRIVADO_OU_REMOVIDO",
  "CONTEUDO_NAO_SUPORTADO",
  "YTDLP_INDISPONIVEL",
  "FFMPEG_INDISPONIVEL",
  "MOTOR_YOUTUBE_INDISPONIVEL",
  "QUALIDADE_INDISPONIVEL",
]);

/** Erros de download em que repetir não adianta (a ação é reinstalar). */
const DOWNLOAD_SEM_NOVA_TENTATIVA: ReadonlySet<CodigoErro> = new Set<CodigoErro>([
  "YTDLP_INDISPONIVEL",
  "FFMPEG_INDISPONIVEL",
  "MOTOR_YOUTUBE_INDISPONIVEL",
  "QUALIDADE_INDISPONIVEL",
]);

export function permiteNovaTentativa(erro: ErroClipora, origem: "previa" | "download"): boolean {
  const semNovaTentativa =
    origem === "download" ? DOWNLOAD_SEM_NOVA_TENTATIVA : PREVIA_SEM_NOVA_TENTATIVA;
  return !semNovaTentativa.has(erro.codigo);
}

export function mensagemDoErro(erro: ErroClipora): string {
  return MENSAGENS_ERRO[erro.codigo] ?? (erro.mensagem || MENSAGENS_ERRO.ERRO_INTERNO);
}

export function sugestaoDoErro(erro: ErroClipora): string | null {
  return SUGESTAO_ADICIONAL[erro.codigo] ?? null;
}
