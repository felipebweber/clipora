import { describe, expect, it } from "vitest";
import type { CodigoErro } from "../tipos/contrato";
import { MENSAGENS_ERRO, mensagemDoErro, sugestaoDoErro } from "./mensagens";

const TODOS_OS_CODIGOS: CodigoErro[] = [
  "LINK_INVALIDO",
  "PLATAFORMA_NAO_SUPORTADA",
  "PREVIA_CANCELADA",
  "TEMPO_ESGOTADO",
  "SEM_CONEXAO",
  "LOGIN_NECESSARIO",
  "CONTEUDO_PRIVADO_OU_REMOVIDO",
  "LIMITE_DE_ACESSO",
  "CONTEUDO_NAO_SUPORTADO",
  "PREVIA_INDISPONIVEL",
  "PASTA_NAO_DEFINIDA",
  "PASTA_AUSENTE",
  "PASTA_SEM_PERMISSAO",
  "ESPACO_INSUFICIENTE",
  "FFMPEG_INDISPONIVEL",
  "ARQUIVO_INCOMPLETO",
  "DOWNLOAD_EM_ANDAMENTO",
  "DOWNLOAD_FALHOU",
  "ATUALIZACAO_EM_ANDAMENTO",
  "ATUALIZACAO_INTEGRIDADE",
  "ATUALIZACAO_NAO_SUPORTADA",
  "ATUALIZACAO_FALHOU",
  "ERRO_INTERNO",
];

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
