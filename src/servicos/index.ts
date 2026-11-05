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
  return isTauri() ? new ServicoCliporaTauri() : new ServicoCliporaSimulado();
}

export const servico: ServicoClipora = criarServico();
