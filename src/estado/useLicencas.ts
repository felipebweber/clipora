import { useCallback, useEffect, useRef, useState } from "react";
import { normalizarErro } from "../erros/normalizar";
import type { ServicoClipora } from "../servicos/tipos";
import type { ErroClipora, Licencas } from "../tipos/contrato";

export type EstadoLicencas =
  | { tipo: "inativo" }
  | { tipo: "carregando" }
  | { tipo: "pronto"; licencas: Licencas }
  | { tipo: "erro"; erro: ErroClipora };

function ehLista(valor: unknown): boolean {
  return Array.isArray(valor);
}

/** O formato ainda é provisório: valida o mínimo que a tela usa para não
 * quebrar se o backend mandar algo diferente. */
export function ehLicencasValidas(valor: unknown): valor is Licencas {
  if (typeof valor !== "object" || valor === null) return false;
  const { resumo, textoCompleto } = valor as Record<string, unknown>;
  if (typeof textoCompleto !== "string") return false;
  if (typeof resumo !== "object" || resumo === null) return false;
  const r = resumo as Record<string, unknown>;
  const app = r.app as Record<string, unknown> | undefined;
  return (
    typeof app?.versao === "string" && ehLista(r.componentes) && ehLista(r.crates) && ehLista(r.npm)
  );
}

/**
 * Carrega as licenças sob demanda (só quando a tela Sobre é aberta) e as
 * mantém em memória para as próximas aberturas.
 */
export function useLicencas(servico: ServicoClipora, ativo: boolean) {
  const [estado, setEstado] = useState<EstadoLicencas>({ tipo: "inativo" });
  const montado = useRef(false);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const carregar = useCallback(() => {
    setEstado({ tipo: "carregando" });
    servico.obter_licencas().then(
      (licencas) => {
        if (!montado.current) return;
        if (ehLicencasValidas(licencas)) setEstado({ tipo: "pronto", licencas });
        else
          setEstado({
            tipo: "erro",
            erro: { codigo: "ERRO_INTERNO", mensagem: "formato inesperado de obter_licencas" },
          });
      },
      (e: unknown) => {
        if (montado.current) setEstado({ tipo: "erro", erro: normalizarErro(e) });
      },
    );
  }, [servico]);

  useEffect(() => {
    if (ativo && estado.tipo === "inativo") carregar();
  }, [ativo, estado.tipo, carregar]);

  return { estado, tentarNovamente: carregar };
}
