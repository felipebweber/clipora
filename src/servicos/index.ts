import { isTauri } from "@tauri-apps/api/core";
import { ServicoCliporaSimulado } from "./simulado";
import { ServicoCliporaTauri } from "./tauri";
import type { ServicoClipora } from "./tipos";

export type { ServicoClipora } from "./tipos";
export { ServicoCliporaSimulado } from "./simulado";
export { ServicoCliporaTauri } from "./tauri";

/**
 * PONTO DE TROCA único entre a implementação real (dentro da janela do
 * Tauri) e a simulada (navegador comum via `pnpm dev` e testes em jsdom).
 * Reducer, hooks e componentes dependem apenas do tipo `ServicoClipora`.
 */
export function criarServico(): ServicoClipora {
  return isTauri() ? new ServicoCliporaTauri() : new ServicoCliporaSimulado(opcoesDoCenario());
}

type OpcoesSimulado = NonNullable<ConstructorParameters<typeof ServicoCliporaSimulado>[0]>;

const COM_ATUALIZACAO = {
  versaoAtual: "2024.08.06",
  versaoDisponivel: "2025.10.22",
  atualizacaoDisponivel: true,
  origem: "empacotada",
  erroVerificacao: null,
} as const;

/**
 * Cenários para revisão manual no navegador (`pnpm dev`), via
 * `?cenario=<nome>` (vários separados por vírgula). Os demais estados
 * (erros de prévia/download) saem de marcadores no link — ver simulado.ts.
 */
export const CENARIOS_SIMULADO: Record<string, OpcoesSimulado> = {
  atualizacao: { verificacaoYtdlpInicial: COM_ATUALIZACAO },
  "falha-atualizacao": {
    verificacaoYtdlpInicial: COM_ATUALIZACAO,
    falhaAtualizacao: "ATUALIZACAO_INTEGRIDADE",
  },
  "verificacao-falhou": {
    verificacaoYtdlpInicial: {
      ...COM_ATUALIZACAO,
      versaoDisponivel: null,
      atualizacaoDisponivel: false,
      erroVerificacao: { codigo: "SEM_CONEXAO", mensagem: "offline" },
    },
  },
  "sem-licencas": { licencasIndisponiveis: true },
  "pasta-ausente": { pastaInicial: { caminho: "/Volumes/PenDrive/Videos", estado: "ausente" } },
};

export function opcoesDoCenario(busca: string = globalThis.location?.search ?? ""): OpcoesSimulado {
  const nomes = new URLSearchParams(busca).get("cenario")?.split(",") ?? [];
  return Object.assign({}, ...nomes.map((n) => CENARIOS_SIMULADO[n.trim()] ?? {}));
}

export const servico: ServicoClipora = criarServico();
