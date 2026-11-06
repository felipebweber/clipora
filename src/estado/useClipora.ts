import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { mensagemDoErro } from "../erros/mensagens";
import { normalizarErro } from "../erros/normalizar";
import { validarLink } from "../links/validarLink";
import { servico as servicoPadrao } from "../servicos";
import type { ServicoClipora } from "../servicos/tipos";
import type { EventoDownload } from "../tipos/contrato";
import { ehErroDePasta } from "../tipos/contrato";
import { catalogoYoutubeValido } from "../qualidadesYoutube";
import {
  type EstadoApp,
  estadoInicial,
  podeAbrirPasta,
  podeEditarLink,
  reduzir,
} from "./maquina";

const ATRASO_DEBOUNCE_MS = 400;
const INTERVALO_RECUPERACAO_MS = 1000;

export const AVISO_DOWNLOAD_RECUPERADO_ENCERRADO =
  "O download que estava em andamento foi encerrado. Confira o arquivo na pasta de destino.";

function gerarIdDownload(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `download-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export type OpcoesUseClipora = {
  /** Chamado depois que o fluxo de download fez o usuário escolher uma nova
   * pasta, para que a fonte única da pasta (usePastaDestino) se recarregue. */
  aoAlterarPasta?: () => void;
  /** Intervalo das consultas a `obter_estado()` enquanto acompanha um
   * download recuperado (ajustável nos testes). */
  intervaloRecuperacaoMs?: number;
};

/**
 * Hook de orquestração da tela principal: liga o reducer (src/estado/maquina.ts)
 * à camada de serviço (src/servicos). Não contém regra de UI — apenas o fluxo
 * assíncrono (debounce da prévia, retentativa de pasta de destino, mapeamento
 * dos eventos de download para ações do reducer e recuperação de um download
 * em andamento ao abrir a janela).
 */
export function useClipora(
  servicoClipora: ServicoClipora = servicoPadrao,
  opcoes: OpcoesUseClipora = {},
) {
  const [estado, dispatch] = useReducer(reduzir, estadoInicial);
  const [textoLink, setTextoLink] = useState("");
  /** Mensagem não bloqueante (ex.: falha ao abrir a pasta). */
  const [aviso, setAviso] = useState<string | null>(null);
  const proximoRequisicaoId = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aoAlterarPastaRef = useRef(opcoes.aoAlterarPasta);
  aoAlterarPastaRef.current = opcoes.aoAlterarPasta;
  const intervaloRecuperacaoMs = opcoes.intervaloRecuperacaoMs ?? INTERVALO_RECUPERACAO_MS;

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Ao abrir a janela: recupera um download que já estava em andamento no
  // backend (ex.: a janela foi recarregada). O reducer só aceita isso antes
  // de qualquer interação do usuário. Falhas aqui não são exibidas: no pior
  // caso, a tela começa vazia como de costume.
  const recuperacaoIniciada = useRef(false);
  const interacaoDoUsuario = useRef(false);
  useEffect(() => {
    if (recuperacaoIniciada.current) return;
    recuperacaoIniciada.current = true;
    servicoClipora.obter_estado().then(
      ({ download, ultimoResultado }) => {
        if (interacaoDoUsuario.current) return;
        if (download) {
          dispatch({
            tipo: "estado_recuperado",
            downloadId: download.downloadId,
            etapa: download.etapa,
            percentual: download.percentual,
            alturaYoutube: download.alturaYoutube ?? null,
            previa: download.previa ? { ...download.previa, qualidadesYoutube: download.previa.qualidadesYoutube ?? null } : null,
          });
        } else if (ultimoResultado) {
          dispatch({ tipo: "download_resultado_recuperado", resultado: { ...ultimoResultado, alturaYoutube: ultimoResultado.alturaYoutube ?? null } });
        }
      },
      () => {},
    );
  }, [servicoClipora]);

  // Um download recuperado não tem mais o canal de eventos original (ele
  // pertencia à janela anterior), então acompanhamos por consulta periódica.
  const downloadRecuperado =
    estado.tipo === "baixando" && estado.recuperado ? estado.downloadId : null;
  useEffect(() => {
    if (!downloadRecuperado) return;
    let ativo = true;
    const id = setInterval(() => {
      servicoClipora.obter_estado().then(
        ({ download, ultimoResultado }) => {
          if (!ativo) return;
          if (download && download.downloadId === downloadRecuperado) {
            dispatch({
              tipo: "download_progresso",
              downloadId: downloadRecuperado,
              etapa: download.etapa,
              percentual: download.percentual,
            });
          } else if (ultimoResultado?.downloadId === downloadRecuperado) {
            dispatch({ tipo: "download_resultado_recuperado", resultado: ultimoResultado });
          } else {
            dispatch({ tipo: "download_recuperado_encerrado", downloadId: downloadRecuperado });
            setAviso(AVISO_DOWNLOAD_RECUPERADO_ENCERRADO);
          }
        },
        () => {}, // falha pontual: tenta de novo no próximo intervalo
      );
    }, intervaloRecuperacaoMs);
    return () => {
      ativo = false;
      clearInterval(id);
    };
  }, [downloadRecuperado, servicoClipora, intervaloRecuperacaoMs]);

  const solicitarPrevia = useCallback(
    (url: string) => {
      const requisicaoId = ++proximoRequisicaoId.current;
      dispatch({ tipo: "previa_solicitada", requisicaoId, url });

      const preFiltro = validarLink(url);
      if (!preFiltro.ok) {
        dispatch({ tipo: "previa_falhou", requisicaoId, erro: preFiltro.erro });
        return;
      }

      servicoClipora.obter_previa({ url, requisicaoId }).then(
        (previa) => dispatch({ tipo: "previa_recebida", requisicaoId, previa: { ...previa, qualidadesYoutube: previa.qualidadesYoutube ?? null } }),
        (erro: unknown) =>
          dispatch({ tipo: "previa_falhou", requisicaoId, erro: normalizarErro(erro) }),
      );
    },
    [servicoClipora],
  );

  const aoAlterarLink = useCallback(
    (valor: string) => {
      if (!podeEditarLink(estado)) return; // bloqueia troca de link durante download
      interacaoDoUsuario.current = true;
      setTextoLink(valor);
      setAviso(null);

      if (debounceRef.current) clearTimeout(debounceRef.current);

      const texto = valor.trim();
      if (!texto) {
        dispatch({ tipo: "link_limpo" });
        return;
      }

      // Invalida a prévia já exibida imediatamente: durante o debounce o
      // botão Baixar não pode baixar o vídeo do link anterior.
      dispatch({ tipo: "link_editado" });
      debounceRef.current = setTimeout(() => solicitarPrevia(texto), ATRASO_DEBOUNCE_MS);
    },
    [estado, solicitarPrevia],
  );

  /** Enter no campo: carrega a prévia na hora, sem esperar o debounce. */
  const confirmarLink = useCallback(() => {
    const texto = textoLink.trim();
    if (!texto || !podeEditarLink(estado)) return;
    interacaoDoUsuario.current = true;
    if (estado.tipo === "pronto" && estado.previa.urlOriginal === texto) return;
    if (estado.tipo === "carregando_previa" && estado.url === texto) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = null;
    solicitarPrevia(texto);
  }, [estado, textoLink, solicitarPrevia]);

  const criarOuvinteDeEventos = useCallback(
    (downloadId: string) => (evento: EventoDownload) => {
      if (evento.tipo === "progresso") {
        dispatch({
          tipo: "download_progresso",
          downloadId,
          etapa: evento.etapa,
          percentual: evento.percentual,
          bytesBaixados: evento.bytesBaixados,
          bytesTotais: evento.bytesTotais,
        });
      } else if (evento.tipo === "concluido") {
        dispatch({
          tipo: "download_concluido",
          downloadId,
          caminho: evento.caminho,
          nomeArquivo: evento.nomeArquivo,
          renomeado: evento.renomeado,
        });
      } else {
        dispatch({ tipo: "download_erro", downloadId, erro: normalizarErro(evento.erro) });
      }
    },
    [],
  );

  /**
   * Inicia o download; se o backend pedir uma pasta (PASTA_NAO_DEFINIDA/
   * AUSENTE/SEM_PERMISSAO), abre o seletor e repete no máximo uma vez com o
   * mesmo ID e o mesmo ouvinte. Nunca rejeita: toda falha vira
   * `download_erro` (ou `download_cancelado` se o seletor for cancelado).
   */
  const executarDownload = useCallback(
    async (downloadId: string, url: string, alturaYoutube?: number | null): Promise<void> => {
      const onEvento = criarOuvinteDeEventos(downloadId);
      for (let tentativa = 0; ; tentativa++) {
        try {
          await servicoClipora.iniciar_download({
            downloadId,
            url,
            ...(alturaYoutube !== undefined ? { alturaYoutube } : {}),
            onEvento,
          });
          return;
        } catch (erroDesconhecido) {
          const erro = normalizarErro(erroDesconhecido);
          if (!ehErroDePasta(erro) || tentativa > 0) {
            dispatch({ tipo: "download_erro", downloadId, erro });
            return;
          }
          let pastaEscolhida: string | null;
          try {
            pastaEscolhida = await servicoClipora.selecionar_pasta_destino();
          } catch (erroSelecao) {
            dispatch({ tipo: "download_erro", downloadId, erro: normalizarErro(erroSelecao) });
            return;
          }
          if (pastaEscolhida === null) {
            dispatch({ tipo: "download_cancelado", downloadId });
            return;
          }
          aoAlterarPastaRef.current?.();
        }
      }
    },
    [servicoClipora, criarOuvinteDeEventos],
  );

  const previaPronta =
    estado.tipo === "pronto" && textoLink.trim() === estado.previa.urlOriginal
      ? estado.previa
      : null;

  const baixarHabilitado = previaPronta !== null &&
    (previaPronta.plataforma !== "youtube" ||
      (catalogoYoutubeValido(previaPronta.qualidadesYoutube) && servicoClipora.youtubeDownloadIntegrado === true));

  const baixar = useCallback(() => {
    // Só baixa a prévia pronta que corresponde ao texto atual do campo.
    if (!previaPronta || !baixarHabilitado) return;
    interacaoDoUsuario.current = true;
    const downloadId = gerarIdDownload();
    setAviso(null);
    dispatch({ tipo: "download_iniciado", downloadId });
    // O Rust valida este endereço e deriva urlNormalizada da prévia associada;
    // preservar o original permite registrar as duas formas no histórico.
    const altura = previaPronta.plataforma === "youtube" && estado.tipo === "pronto" ? estado.alturaYoutube : undefined;
    void executarDownload(downloadId, previaPronta.urlOriginal, altura);
  }, [estado, previaPronta, baixarHabilitado, executarDownload]);

  const podeBaixarNovamente = estado.tipo === "concluido" &&
    estado.previa !== null &&
    textoLink.trim() === estado.previa.urlOriginal &&
    (estado.previa.plataforma !== "youtube" ||
      (catalogoYoutubeValido(estado.previa.qualidadesYoutube) && servicoClipora.youtubeDownloadIntegrado === true));

  const baixarNovamente = useCallback(() => {
    if (estado.tipo !== "concluido" || !estado.previa || !podeBaixarNovamente) return;
    interacaoDoUsuario.current = true;
    const downloadId = gerarIdDownload();
    setAviso(null);
    dispatch({ tipo: "download_iniciado", downloadId });
    const altura = estado.previa.plataforma === "youtube" ? estado.alturaYoutube ?? null : undefined;
    void executarDownload(downloadId, estado.previa.urlOriginal, altura);
  }, [estado, podeBaixarNovamente, executarDownload]);

  /** "Tentar novamente": repete a ação que falhou. */
  const tentarNovamente = useCallback(() => {
    if (estado.tipo !== "erro") return;
    interacaoDoUsuario.current = true;
    if (estado.origem === "download" && estado.previa) {
      const downloadId = gerarIdDownload();
      dispatch({ tipo: "download_iniciado", downloadId });
      const altura = estado.previa.plataforma === "youtube" ? estado.alturaYoutube : undefined;
      void executarDownload(downloadId, estado.previa.urlOriginal, altura);
      return;
    }
    const texto = textoLink.trim();
    if (texto) solicitarPrevia(texto);
    else dispatch({ tipo: "erro_reconhecido" });
  }, [estado, textoLink, executarDownload, solicitarPrevia]);

  const reconhecerErro = useCallback(() => {
    interacaoDoUsuario.current = true;
    dispatch({ tipo: "erro_reconhecido" });
  }, []);

  const alterarQualidadeYoutube = useCallback((altura: number | null) => {
    dispatch({ tipo: "qualidade_youtube_alterada", altura });
  }, []);

  const atualizarPrevia = useCallback(() => {
    if (estado.tipo !== "erro" || estado.erro.codigo !== "QUALIDADE_INDISPONIVEL") return;
    const url = estado.previa?.urlOriginal ?? textoLink.trim();
    if (!url) return;
    interacaoDoUsuario.current = true;
    setAviso(null);
    solicitarPrevia(url);
  }, [estado, textoLink, solicitarPrevia]);

  const abrirPasta = useCallback(() => {
    if (estado.tipo !== "concluido") return;
    setAviso(null);
    servicoClipora.abrir_pasta_download({ downloadId: estado.downloadId }).catch((erro: unknown) => {
      setAviso(`Não foi possível abrir a pasta. ${mensagemDoErro(normalizarErro(erro))}`);
    });
  }, [estado, servicoClipora]);

  return {
    estado,
    textoLink,
    aviso,
    aoAlterarLink,
    confirmarLink,
    baixar,
    baixarNovamente,
    tentarNovamente,
    reconhecerErro,
    abrirPasta,
    alterarQualidadeYoutube,
    atualizarPrevia,
    podeEditarLink: podeEditarLink(estado),
    podeSolicitarDownload: baixarHabilitado,
    podeBaixarNovamente,
    podeAbrirPasta: podeAbrirPasta(estado),
  };
}

export type UseCliporaRetorno = ReturnType<typeof useClipora>;
export type { EstadoApp };
