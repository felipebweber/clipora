import { useCallback, useEffect, useRef, useState } from "react";
import { normalizarErro } from "../erros/normalizar";
import { servico as servicoPadrao } from "../servicos";
import type { ServicoClipora } from "../servicos/tipos";
import type { ErroClipora, PastaDestino } from "../tipos/contrato";

/**
 * Fonte única da pasta de destino exibida na interface. É usada pelo
 * painel de configurações e recarregada pelo fluxo de download (via
 * `recarregar`) sempre que ele faz o usuário escolher uma nova pasta — o
 * valor exibido sempre vem de `obter_pasta_destino()`, nunca é presumido.
 */
export function usePastaDestino(servicoClipora: ServicoClipora = servicoPadrao) {
  const [pasta, setPasta] = useState<PastaDestino | null>(null);
  const [erro, setErro] = useState<ErroClipora | null>(null);
  const [selecionando, setSelecionando] = useState(false);
  const montado = useRef(false);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const recarregar = useCallback(async () => {
    try {
      const p = await servicoClipora.obter_pasta_destino();
      if (montado.current) setPasta(p);
    } catch (e) {
      if (montado.current) setErro(normalizarErro(e));
    }
  }, [servicoClipora]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  const alterar = useCallback(async () => {
    setSelecionando(true);
    try {
      const caminho = await servicoClipora.selecionar_pasta_destino();
      if (caminho !== null && montado.current) {
        setErro(null);
        await recarregar();
      }
    } catch (e) {
      if (montado.current) setErro(normalizarErro(e));
    } finally {
      if (montado.current) setSelecionando(false);
    }
  }, [servicoClipora, recarregar]);

  return { pasta, erro, selecionando, alterar, recarregar };
}

export type UsePastaDestinoRetorno = ReturnType<typeof usePastaDestino>;
