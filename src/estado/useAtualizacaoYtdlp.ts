import { useCallback, useEffect, useRef, useState } from "react";
import { normalizarErro } from "../erros/normalizar";
import { servico as servicoPadrao } from "../servicos";
import type { ServicoClipora } from "../servicos/tipos";
import type { ErroClipora, EventoAtualizacao, VerificacaoYtdlp } from "../tipos/contrato";

const INTERVALO_RECUPERACAO_MS = 1000;

export type FaseAtualizacao =
  | { tipo: "inativo" }
  | {
      tipo: "atualizando";
      progresso: EventoAtualizacao | null;
      /** Atualização iniciada antes de recarregar a janela: sem canal de
       * eventos, acompanhada por consulta a `obter_estado()`. */
      recuperada: boolean;
    }
  | { tipo: "sucesso"; versaoInstalada: string }
  | { tipo: "erro"; erro: ErroClipora };

export type OpcoesAtualizacaoYtdlp = {
  /** Enquanto houver download, "Atualizar" fica bloqueado (o backend
   * rejeitaria com DOWNLOAD_EM_ANDAMENTO). */
  downloadEmAndamento: boolean;
  intervaloRecuperacaoMs?: number;
};

/**
 * Verificação (uma vez por abertura) e atualização manual do yt-dlp.
 *
 * Na abertura, consulta `obter_estado()` primeiro: se uma atualização já
 * estiver em andamento (janela recarregada), acompanha até ela terminar e
 * só então chama `verificar_ytdlp()`. A atualização só começa por ação do
 * usuário (`atualizar`). Falha da verificação nunca vira erro grande: fica
 * em `falhaVerificacao` para uma nota discreta.
 */
export function useAtualizacaoYtdlp(
  servicoClipora: ServicoClipora = servicoPadrao,
  opcoes: OpcoesAtualizacaoYtdlp,
) {
  const [verificacao, setVerificacao] = useState<VerificacaoYtdlp | null>(null);
  const [falhaVerificacao, setFalhaVerificacao] = useState<ErroClipora | null>(null);
  const [fase, setFase] = useState<FaseAtualizacao>({ tipo: "inativo" });
  const intervaloMs = opcoes.intervaloRecuperacaoMs ?? INTERVALO_RECUPERACAO_MS;
  const downloadEmAndamentoRef = useRef(opcoes.downloadEmAndamento);
  downloadEmAndamentoRef.current = opcoes.downloadEmAndamento;

  const montado = useRef(false);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const verificar = useCallback(() => {
    servicoClipora.verificar_ytdlp().then(
      (v) => {
        if (!montado.current) return;
        setVerificacao(v);
        setFalhaVerificacao(v.erroVerificacao);
      },
      (e: unknown) => {
        if (montado.current) setFalhaVerificacao(normalizarErro(e));
      },
    );
  }, [servicoClipora]);

  // Abertura: obter_estado() e, em seguida, verificar_ytdlp() uma única vez
  // (a guarda por ref também evita a chamada dupla do StrictMode).
  const iniciado = useRef(false);
  useEffect(() => {
    if (iniciado.current) return;
    iniciado.current = true;
    servicoClipora.obter_estado().then(
      (estado) => {
        if (estado.atualizacaoEmAndamento) {
          setFase({ tipo: "atualizando", progresso: null, recuperada: true });
        } else {
          verificar();
        }
      },
      () => verificar(),
    );
  }, [servicoClipora, verificar]);

  // Acompanha uma atualização recuperada até ela sumir de obter_estado().
  const acompanhandoRecuperada = fase.tipo === "atualizando" && fase.recuperada;
  useEffect(() => {
    if (!acompanhandoRecuperada) return;
    let ativo = true;
    const id = setInterval(() => {
      servicoClipora.obter_estado().then(
        (estado) => {
          if (!ativo || estado.atualizacaoEmAndamento) return;
          ativo = false;
          clearInterval(id);
          setFase({ tipo: "inativo" });
          verificar();
        },
        () => {},
      );
    }, intervaloMs);
    return () => {
      ativo = false;
      clearInterval(id);
    };
  }, [acompanhandoRecuperada, servicoClipora, intervaloMs, verificar]);

  const emAndamento = fase.tipo === "atualizando";
  const versaoDisponivel =
    verificacao?.atualizacaoDisponivel && verificacao.versaoDisponivel
      ? verificacao.versaoDisponivel
      : null;
  const podeAtualizar =
    versaoDisponivel !== null &&
    !emAndamento &&
    fase.tipo !== "sucesso" &&
    !opcoes.downloadEmAndamento;

  const emAndamentoRef = useRef(emAndamento);
  emAndamentoRef.current = emAndamento;

  const atualizar = useCallback(async () => {
    if (!versaoDisponivel || emAndamentoRef.current || downloadEmAndamentoRef.current) return;
    emAndamentoRef.current = true;
    setFase({ tipo: "atualizando", progresso: null, recuperada: false });
    try {
      const { versaoInstalada } = await servicoClipora.atualizar_ytdlp({
        versaoEsperada: versaoDisponivel,
        onEvento: (evento) => {
          if (!montado.current) return;
          setFase((atual) =>
            atual.tipo === "atualizando" ? { ...atual, progresso: evento } : atual,
          );
        },
      });
      if (!montado.current) return;
      setFase({ tipo: "sucesso", versaoInstalada });
      setVerificacao((v) =>
        v
          ? { ...v, versaoAtual: versaoInstalada, atualizacaoDisponivel: false, origem: "atualizada" }
          : v,
      );
    } catch (e) {
      if (montado.current) setFase({ tipo: "erro", erro: normalizarErro(e) });
    }
  }, [servicoClipora, versaoDisponivel]);

  return {
    verificacao,
    falhaVerificacao,
    fase,
    versaoDisponivel,
    emAndamento,
    podeAtualizar,
    atualizar,
  };
}

export type UseAtualizacaoYtdlpRetorno = ReturnType<typeof useAtualizacaoYtdlp>;
