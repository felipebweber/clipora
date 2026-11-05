import { ServicoCliporaSimulado } from "./simulado";
import type { ServicoClipora } from "./tipos";

export type { ServicoClipora } from "./tipos";
export { ServicoCliporaSimulado } from "./simulado";

/**
 * PONTO DE TROCA único entre a implementação simulada (etapa 2) e a real
 * via @tauri-apps/api (etapas 3–5). Quando a implementação real existir
 * (ex. `./tauri.ts`, chamando `invoke()` e criando um `Channel` real por
 * trás do callback `onEvento`), troque a linha abaixo — nenhum outro
 * arquivo (reducer, hooks, componentes) precisa mudar, pois todos
 * dependem apenas do tipo `ServicoClipora`.
 */
export const servico: ServicoClipora = new ServicoCliporaSimulado();
