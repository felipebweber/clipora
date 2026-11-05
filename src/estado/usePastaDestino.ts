import { useCallback, useEffect, useRef, useState } from "react";
import { servico as servicoPadrao } from "../servicos";
import type { ServicoClipora } from "../servicos/tipos";
import type { ErroClipora, PastaDestino } from "../tipos/contrato";

/**
 * Hook independente para o painel de configurações: carrega a pasta de
 * destino atual e permite alterá-la. É deliberadamente separado da máquina
 * de estados principal (src/estado/maquina.ts) — a troca de pasta pelas
 * configurações não interfere no fluxo de link/prévia/download, e o fluxo
 * de download trata PASTA_NAO_DEFINIDA/PASTA_AUSENTE/PASTA_SEM_PERMISSAO
 * chamando `selecionar_pasta_destino` por conta própria (ver useClipora).
 */
export function usePastaDestino(servicoClipora: ServicoClipora = servicoPadrao) {
  const [pasta, setPasta] = useState<PastaDestino | null>(null);
  const [erro, setErro] = useState<ErroClipora | null>(null);
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;
    servicoClipora.obter_pasta_destino().then(
      (p) => {
        if (montado.current) setPasta(p);
      },
      (e: ErroClipora) => {
        if (montado.current) setErro(e);
      },
    );
    return () => {
      montado.current = false;
    };
  }, [servicoClipora]);

  const alterar = useCallback(async () => {
    try {
      const caminho = await servicoClipora.selecionar_pasta_destino();
      if (caminho !== null && montado.current) {
        setPasta({ caminho, estado: "valida" });
        setErro(null);
      }
    } catch (e) {
      if (montado.current) setErro(e as ErroClipora);
    }
  }, [servicoClipora]);

  return { pasta, erro, alterar };
}
