import { describe, expect, it } from "vitest";
import { CODIGOS_ERRO, ehCodigoErro, type CodigoErro } from "../tipos/contrato";
import { MENSAGENS_ERRO, mensagemDoErro, permiteNovaTentativa, sugestaoDoErro } from "./mensagens";

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

describe("revisão de experiência: cada erro diz o que aconteceu e o que fazer", () => {
  // Verbos de ação aceitos na orientação ao usuário.
  const ACAO =
    /\b(tente|confira|cole|verifique|aguarde|escolha|libere|reinstale|instale|atualize|feche)\b/i;

  it.each(CODIGOS_ERRO.map((c) => [c]))("%s tem problema + ação clara", (codigo) => {
    const texto = MENSAGENS_ERRO[codigo];
    // Pelo menos duas frases (ou frase + orientação após ';'): o problema e a ação.
    expect(texto.split(/[.;](?:\s|$)/).filter((f) => f.trim()).length).toBeGreaterThanOrEqual(2);
    expect(texto).toMatch(ACAO);
  });

  it.each(CODIGOS_ERRO.map((c) => [c]))("%s não usa jargão técnico nem inglês", (codigo) => {
    expect(MENSAGENS_ERRO[codigo]).not.toMatch(
      /\b(interno|extrator|remux|stderr|exit|null|pyinstaller|error|failed|timeout|path)\b/i,
    );
  });

  it("mensagem de fallback vazia cai no texto genérico em português", () => {
    expect(mensagemDoErro({ codigo: "CODIGO_NOVO" as CodigoErro, mensagem: "" })).toBe(
      MENSAGENS_ERRO.ERRO_INTERNO,
    );
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

describe("permiteNovaTentativa", () => {
  const erro = (codigo: CodigoErro) => ({ codigo, mensagem: "x" });
  it("não oferece repetir quando o problema é o link, o conteúdo ou a instalação", () => {
    for (const c of ["LINK_INVALIDO", "LOGIN_NECESSARIO", "YTDLP_INDISPONIVEL"] as const) {
      expect(permiteNovaTentativa(erro(c), "previa")).toBe(false);
    }
    expect(permiteNovaTentativa(erro("FFMPEG_INDISPONIVEL"), "download")).toBe(false);
  });
  it("oferece repetir em falhas transitórias", () => {
    expect(permiteNovaTentativa(erro("SEM_CONEXAO"), "previa")).toBe(true);
    expect(permiteNovaTentativa(erro("DOWNLOAD_FALHOU"), "download")).toBe(true);
    expect(permiteNovaTentativa(erro("PASTA_AUSENTE"), "download")).toBe(true);
  });
});
