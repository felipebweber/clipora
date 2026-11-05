import { ehCodigoErro, type ErroClipora } from "../tipos/contrato";

/**
 * Converte qualquer valor rejeitado (por `invoke()`, pelo serviço simulado
 * ou por uma exceção inesperada no próprio frontend) em um `ErroClipora`
 * válido. Um erro do contrato passa intacto; qualquer outra coisa vira
 * `ERRO_INTERNO`, com o texto original preservado em `mensagem` — assim a
 * interface nunca exibe um alerta vazio.
 */
export function normalizarErro(valor: unknown): ErroClipora {
  if (typeof valor === "object" && valor !== null && "codigo" in valor) {
    const { codigo, mensagem, detalhe } = valor as Record<string, unknown>;
    if (ehCodigoErro(codigo)) {
      const erro: ErroClipora = {
        codigo,
        mensagem: typeof mensagem === "string" ? mensagem : "",
      };
      if (typeof detalhe === "string") erro.detalhe = detalhe;
      return erro;
    }
  }
  return { codigo: "ERRO_INTERNO", mensagem: descrever(valor) };
}

function descrever(valor: unknown): string {
  if (valor instanceof Error) return valor.message || valor.name;
  if (typeof valor === "string") return valor;
  if (valor === undefined) return "erro desconhecido";
  try {
    return JSON.stringify(valor) ?? String(valor);
  } catch {
    return String(valor);
  }
}
