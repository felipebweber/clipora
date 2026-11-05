import type {
  EtapaDownload,
  ErroClipora,
  Previa,
  ResultadoTerminal,
} from "../tipos/contrato";

/**
 * Máquina de estados da tela principal do Clipora.
 *
 * Estados impossíveis são evitados pelo tipo sempre que possível (a única
 * exceção é um download recuperado após recarregar a janela, que pode não
 * ter prévia — ver `estado_recuperado`). Toda transição passa pela
 * função pura `reduzir`, que ignora ações incompatíveis com o estado atual
 * em vez de lançar erro — isso é o que garante, por exemplo, que uma
 * resposta atrasada de prévia (`requisicaoId` antigo) nunca sobrescreva o
 * estado atual, e que o link não possa ser trocado durante um download.
 */

export type ProgressoDownload = {
  etapa: EtapaDownload;
  percentual: number | null;
  bytesBaixados?: number;
  bytesTotais?: number;
};

export type ResultadoDownload = {
  caminho: string;
  nomeArquivo: string;
  renomeado: boolean;
};

export type OrigemErro = "previa" | "download";

export type EstadoApp =
  | { tipo: "aguardando_link" }
  | { tipo: "carregando_previa"; requisicaoId: number; url: string }
  | { tipo: "pronto"; previa: Previa }
  | {
      tipo: "baixando";
      // `null` apenas no caso de download recuperado via `obter_estado()`
      // após recarregar o webview, antes do contrato passar a ecoar a
      // prévia nesse retorno (ver ação `estado_recuperado`).
      previa: Previa | null;
      downloadId: string;
      progresso: ProgressoDownload;
      /** Download iniciado antes de recarregar a janela: o canal de eventos
       * original se perdeu, então o progresso vem de consultas periódicas a
       * `obter_estado()` (ver useClipora). */
      recuperado?: true;
    }
  | {
      tipo: "concluido";
      previa: Previa | null;
      downloadId: string;
      resultado: ResultadoDownload;
    }
  | { tipo: "erro"; erro: ErroClipora; origem: OrigemErro; previa: Previa | null };

export type AcaoApp =
  | { tipo: "link_limpo" }
  | { tipo: "link_editado" }
  | { tipo: "previa_solicitada"; requisicaoId: number; url: string }
  | { tipo: "previa_recebida"; requisicaoId: number; previa: Previa }
  | { tipo: "previa_falhou"; requisicaoId: number; erro: ErroClipora }
  | { tipo: "download_iniciado"; downloadId: string }
  | {
      tipo: "download_progresso";
      downloadId: string;
      etapa: EtapaDownload;
      percentual: number | null;
      bytesBaixados?: number;
      bytesTotais?: number;
    }
  | {
      tipo: "download_concluido";
      downloadId: string;
      caminho: string;
      nomeArquivo: string;
      renomeado: boolean;
    }
  | { tipo: "download_erro"; downloadId: string; erro: ErroClipora }
  | { tipo: "download_cancelado"; downloadId: string }
  | { tipo: "erro_reconhecido" }
  | {
      tipo: "estado_recuperado";
      downloadId: string;
      etapa: EtapaDownload;
      percentual: number | null;
      previa: Previa | null;
    }
  | { tipo: "download_resultado_recuperado"; resultado: ResultadoTerminal }
  | { tipo: "download_recuperado_encerrado"; downloadId: string };

export const estadoInicial: EstadoApp = { tipo: "aguardando_link" };

export function reduzir(estado: EstadoApp, acao: AcaoApp): EstadoApp {
  switch (acao.tipo) {
    case "link_limpo":
    case "link_editado": {
      // Não se pode trocar/limpar o link durante um download em curso.
      if (estado.tipo === "baixando") return estado;
      // Qualquer edição invalida imediatamente a prévia exibida (e descarta
      // uma prévia em carregamento): durante o debounce o botão Baixar não
      // pode continuar apontando para o vídeo do link anterior.
      return { tipo: "aguardando_link" };
    }

    case "previa_solicitada": {
      // Mesma regra: nenhuma nova prévia pode ser solicitada durante um
      // download. Em qualquer outro estado, a nova solicitação assume o
      // controle (inclusive substituindo uma `carregando_previa` anterior;
      // a resposta antiga será descartada por não bater o requisicaoId).
      if (estado.tipo === "baixando") return estado;
      return {
        tipo: "carregando_previa",
        requisicaoId: acao.requisicaoId,
        url: acao.url,
      };
    }

    case "previa_recebida": {
      if (estado.tipo !== "carregando_previa") return estado;
      if (estado.requisicaoId !== acao.requisicaoId) return estado; // atrasada
      return { tipo: "pronto", previa: acao.previa };
    }

    case "previa_falhou": {
      // PREVIA_CANCELADA é sempre ignorada: é o efeito esperado de uma
      // prévia mais nova ter substituído esta, não um erro para o usuário.
      if (acao.erro.codigo === "PREVIA_CANCELADA") return estado;
      if (estado.tipo !== "carregando_previa") return estado;
      if (estado.requisicaoId !== acao.requisicaoId) return estado; // atrasada
      return { tipo: "erro", erro: acao.erro, origem: "previa", previa: null };
    }

    case "download_iniciado": {
      // Só é possível iniciar download a partir de uma prévia pronta — ou
      // do erro de um download anterior dessa mesma prévia ("Tentar
      // novamente").
      let previa: Previa;
      if (estado.tipo === "pronto") previa = estado.previa;
      else if (estado.tipo === "erro" && estado.origem === "download" && estado.previa)
        previa = estado.previa;
      else return estado;
      return {
        tipo: "baixando",
        previa,
        downloadId: acao.downloadId,
        progresso: { etapa: "preparando", percentual: null },
      };
    }

    case "download_progresso": {
      if (estado.tipo !== "baixando") return estado;
      if (estado.downloadId !== acao.downloadId) return estado;
      return {
        ...estado,
        progresso: {
          etapa: acao.etapa,
          percentual: acao.percentual,
          bytesBaixados: acao.bytesBaixados,
          bytesTotais: acao.bytesTotais,
        },
      };
    }

    case "download_concluido": {
      if (estado.tipo !== "baixando") return estado;
      if (estado.downloadId !== acao.downloadId) return estado;
      return {
        tipo: "concluido",
        previa: estado.previa,
        downloadId: estado.downloadId,
        resultado: {
          caminho: acao.caminho,
          nomeArquivo: acao.nomeArquivo,
          renomeado: acao.renomeado,
        },
      };
    }

    case "download_erro": {
      if (estado.tipo !== "baixando") return estado;
      if (estado.downloadId !== acao.downloadId) return estado;
      return { tipo: "erro", erro: acao.erro, origem: "download", previa: estado.previa };
    }

    case "download_cancelado": {
      // Usuário cancelou o diálogo de pasta de destino (PASTA_NAO_DEFINIDA/
      // PASTA_AUSENTE/PASTA_SEM_PERMISSAO tratados pela camada de
      // orquestração, nunca exibidos como erro): volta para "pronto" sem
      // iniciar o download, mantendo a prévia.
      if (estado.tipo !== "baixando") return estado;
      if (estado.downloadId !== acao.downloadId) return estado;
      // Defensivo: na prática só se chega aqui a partir de um download
      // iniciado pelo usuário (sempre com prévia); se algum dia um download
      // recuperado sem prévia (ver `estado_recuperado`) passar pelo fluxo de
      // pasta, não há prévia para voltar a "pronto" — melhor reiniciar.
      if (!estado.previa) return { tipo: "aguardando_link" };
      return { tipo: "pronto", previa: estado.previa };
    }

    case "estado_recuperado": {
      // Só faz sentido logo na abertura do app, antes de qualquer interação
      // do usuário com o campo de link.
      if (estado.tipo !== "aguardando_link") return estado;
      return {
        tipo: "baixando",
        previa: acao.previa,
        downloadId: acao.downloadId,
        progresso: { etapa: acao.etapa, percentual: acao.percentual },
        recuperado: true,
      };
    }

    case "download_resultado_recuperado": {
      const recuperacaoInicial = estado.tipo === "aguardando_link";
      const recuperacaoDoDownloadAtivo =
        estado.tipo === "baixando" &&
        estado.recuperado === true &&
        estado.downloadId === acao.resultado.downloadId;
      if (!recuperacaoInicial && !recuperacaoDoDownloadAtivo) return estado;

      if (acao.resultado.tipo === "concluido") {
        return {
          tipo: "concluido",
          previa: estado.tipo === "baixando" ? estado.previa : null,
          downloadId: acao.resultado.downloadId,
          resultado: {
            caminho: acao.resultado.caminho,
            nomeArquivo: acao.resultado.nomeArquivo,
            renomeado: acao.resultado.renomeado,
          },
        };
      }
      return {
        tipo: "erro",
        erro: acao.resultado.erro,
        origem: "download",
        previa: estado.tipo === "baixando" ? estado.previa : null,
      };
    }

    case "download_recuperado_encerrado": {
      // O download recuperado sumiu de `obter_estado()`: terminou (com
      // sucesso ou erro) sem que pudéssemos receber o evento terminal.
      if (estado.tipo !== "baixando" || !estado.recuperado) return estado;
      if (estado.downloadId !== acao.downloadId) return estado;
      return { tipo: "aguardando_link" };
    }

    case "erro_reconhecido": {
      if (estado.tipo !== "erro") return estado;
      // Erro de download com prévia conhecida: volta para "pronto" para
      // permitir tentar o download novamente sem recarregar a prévia.
      if (estado.origem === "download" && estado.previa) {
        return { tipo: "pronto", previa: estado.previa };
      }
      return { tipo: "aguardando_link" };
    }

    default: {
      const _exaustivo: never = acao;
      return _exaustivo;
    }
  }
}

// --- Seletores auxiliares (usados pela UI para bloquear ações) ---

export function podeEditarLink(estado: EstadoApp): boolean {
  return estado.tipo !== "baixando";
}

export function podeSolicitarDownload(estado: EstadoApp): boolean {
  return estado.tipo === "pronto";
}

export function podeAbrirPasta(estado: EstadoApp): boolean {
  return estado.tipo === "concluido";
}
