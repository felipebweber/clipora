import { describe, expect, it } from "vitest";
import { CODIGOS_ERRO, ehCodigoErro, type CodigoErro } from "../tipos/contrato";
import { MENSAGENS_ERRO, mensagemDoErro, sugestaoDoErro } from "./mensagens";

// Usa a lista em runtime do contrato (em vez de duplicá-la aqui) para que a
// adição de um novo código (ex. YTDLP_INDISPONIVEL) force este teste a
// cobri-lo automaticamente.
const TODOS_OS_CODIGOS: readonly CodigoErro[] = CODIGOS_ERRO;

describe("mensagens de erro", () => {
  it("tem uma mensagem em português não vazia para cada código do contrato", () => {
    for (const codigo of TODOS_OS_CODIGOS) {
      expect(MENSAGENS_ERRO[codigo]).toBeTruthy();
      expect(MENSAGENS_ERRO[codigo].length).toBeGreaterThan(5);
    }
  });

  it("mensagemDoErro usa o mapa em português, ignorando o fallback técnico", () => {
    const mensagem = mensagemDoErro({
      codigo: "PASTA_AUSENTE",
      mensagem: "folder not found (technical)",
    });
    expect(mensagem).toBe(MENSAGENS_ERRO.PASTA_AUSENTE);
    expect(mensagem).not.toContain("technical");
  });

  it("mensagemDoErro cai para o fallback técnico em código desconhecido", () => {
    const mensagem = mensagemDoErro({
      // simula um código futuro ainda não mapeado no frontend
      codigo: "CODIGO_INEXISTENTE" as CodigoErro,
      mensagem: "fallback do backend",
    });
    expect(mensagem).toBe("fallback do backend");
  });

  it("sugestaoDoErro retorna null quando não há sugestão complementar", () => {
    expect(sugestaoDoErro({ codigo: "LINK_INVALIDO", mensagem: "x" })).toBeNull();
  });

  it("sugestaoDoErro sugere atualizar o yt-dlp quando o extrator falha", () => {
    expect(sugestaoDoErro({ codigo: "DOWNLOAD_FALHOU", mensagem: "x" })).toMatch(/yt-dlp/);
    expect(sugestaoDoErro({ codigo: "PREVIA_INDISPONIVEL", mensagem: "x" })).toMatch(/yt-dlp/);
  });
});

describe("ehCodigoErro", () => {
  it("reconhece todos os códigos válidos, incluindo YTDLP_INDISPONIVEL", () => {
    for (const codigo of TODOS_OS_CODIGOS) {
      expect(ehCodigoErro(codigo)).toBe(true);
    }
  });

  it("rejeita valores que não são códigos de erro conhecidos", () => {
    expect(ehCodigoErro("ALGO_DESCONHECIDO")).toBe(false);
    expect(ehCodigoErro(123)).toBe(false);
    expect(ehCodigoErro(null)).toBe(false);
    expect(ehCodigoErro(undefined)).toBe(false);
  });
});
