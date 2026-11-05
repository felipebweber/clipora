import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { validarLink } from "../links/validarLink";
import { servico as servicoPadrao } from "../servicos";
import type { ServicoClipora } from "../servicos/tipos";
import type { ErroClipora, EventoDownload } from "../tipos/contrato";
import { ehErroDePasta } from "../tipos/contrato";
import {
  type EstadoApp,
  estadoInicial,
  podeAbrirPasta,
  podeEditarLink,
  podeSolicitarDownload,
  reduzir,
} from "./maquina";

const ATRASO_DEBOUNCE_MS = 400;

function gerarIdDownload(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `download-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Hook de orquestração da tela principal: liga o reducer (src/estado/maquina.ts)
 * à camada de serviço (src/servicos). Não contém regra de UI — apenas o fluxo
 * assíncrono (debounce da prévia, retentativa de pasta de destino, mapeamento
 * dos eventos de download para ações do reducer).
 */
export function useClipora(servicoClipora: ServicoClipora = servicoPadrao) {
  const [estado, dispatch] = useReducer(reduzir, estadoInicial);
  const [textoLink, setTextoLink] = useState("");
  const proximoRequisicaoId = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

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
        (previa) => dispatch({ tipo: "previa_recebida", requisicaoId, previa }),
        (erro: ErroClipora) => dispatch({ tipo: "previa_falhou", requisicaoId, erro }),
      );
    },
    [servicoClipora],
  );

  const aoAlterarLink = useCallback(
    (valor: string) => {
      if (!podeEditarLink(estado)) return; // bloqueia troca de link durante download
      setTextoLink(valor);

      if (debounceRef.current) clearTimeout(debounceRef.current);

      const texto = valor.trim();
      if (!texto) {
        dispatch({ tipo: "link_limpo" });
        return;
      }

      debounceRef.current = setTimeout(() => solicitarPrevia(texto), ATRASO_DEBOUNCE_MS);
    },
    [estado, solicitarPrevia],
  );

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
        dispatch({ tipo: "download_erro", downloadId, erro: evento.erro });
      }
    },
    [],
  );

  const tentarIniciarDownload = useCallback(
    async (downloadId: string, url: string): Promise<void> => {
      try {
        await servicoClipora.iniciar_download({
          downloadId,
          url,
          onEvento: criarOuvinteDeEventos(downloadId),
        });
      } catch (erroDesconhecido) {
        const erro = erroDesconhecido as ErroClipora;
        if (ehErroDePasta(erro)) {
          const pastaEscolhida = await servicoClipora.selecionar_pasta_destino();
          if (pastaEscolhida === null) {
            dispatch({ tipo: "download_cancelado", downloadId });
            return;
          }
          await tentarIniciarDownload(downloadId, url);
          return;
        }
        dispatch({ tipo: "download_erro", downloadId, erro });
      }
    },
    [servicoClipora, criarOuvinteDeEventos],
  );

  const baixar = useCallback(() => {
    if (estado.tipo !== "pronto") return; // bloqueia download sem prévia pronta
    const previaAtual = estado.previa;
    const downloadId = gerarIdDownload();
    dispatch({ tipo: "download_iniciado", downloadId });
    void tentarIniciarDownload(downloadId, previaAtual.urlNormalizada);
  }, [estado, tentarIniciarDownload]);

  const reconhecerErro = useCallback(() => {
    dispatch({ tipo: "erro_reconhecido" });
  }, []);

  const abrirPasta = useCallback(() => {
    if (estado.tipo !== "concluido") return;
    void servicoClipora.abrir_pasta_download({ downloadId: estado.downloadId });
  }, [estado, servicoClipora]);

  return {
    estado,
    textoLink,
    aoAlterarLink,
    baixar,
    reconhecerErro,
    abrirPasta,
    podeEditarLink: podeEditarLink(estado),
    podeSolicitarDownload: podeSolicitarDownload(estado),
    podeAbrirPasta: podeAbrirPasta(estado),
  };
}

export type UseCliporaRetorno = ReturnType<typeof useClipora>;
export type { EstadoApp };
