import { describe, expect, it } from "vitest";
import { validarLink, type ResultadoValidacao } from "./validarLink";

function erroDe(resultado: ResultadoValidacao) {
  if (resultado.ok) throw new Error("esperava ok: false, recebeu ok: true");
  return resultado.erro;
}

describe("validarLink (pré-filtro leniente, não autoritativo)", () => {
  it("aceita reel do Instagram em www.", () => {
    expect(validarLink("https://www.instagram.com/reel/abc123/")).toEqual({
      ok: true,
      plataforma: "instagram",
    });
  });

  it("aceita Instagram em m. e em instagram.com/<usuario>/reel/<id>/ (caminho não é validado aqui)", () => {
    expect(validarLink("https://m.instagram.com/reels/abc123/").ok).toBe(true);
    expect(validarLink("https://instagram.com/alguem/reel/abc123/").ok).toBe(true);
  });

  it("aceita vídeo do TikTok com @usuario/video/id em www. e m.", () => {
    expect(validarLink("https://www.tiktok.com/@alguem/video/1234567890")).toEqual({
      ok: true,
      plataforma: "tiktok",
    });
    expect(validarLink("https://m.tiktok.com/@alguem/video/1234567890").ok).toBe(true);
    expect(validarLink("https://m.tiktok.com/t/abcdef/").ok).toBe(true);
  });

  it("aceita links curtos do TikTok (vm./vt.)", () => {
    expect(validarLink("https://vm.tiktok.com/ZMabcdef/").ok).toBe(true);
    expect(validarLink("https://vt.tiktok.com/ZMabcdef/").ok).toBe(true);
  });

  it("aceita hosts do YouTube como plataforma sem validar o tipo do caminho", () => {
    for (const url of [
      "https://youtube.com/watch?v=YE7VzlLtp-4",
      "https://www.youtube.com/watch?v=YE7VzlLtp-4",
      "https://m.youtube.com/watch?v=YE7VzlLtp-4",
      "https://youtu.be/YE7VzlLtp-4",
    ]) {
      expect(validarLink(url)).toEqual({ ok: true, plataforma: "youtube" });
    }
    expect(validarLink("https://youtube.com.evil.example/watch?v=YE7VzlLtp-4").ok).toBe(false);
  });

  it("aceita http (será normalizado para https pelo backend)", () => {
    expect(validarLink("http://www.instagram.com/reel/abc/").ok).toBe(true);
  });

  it("rejeita texto vazio ou malformado como LINK_INVALIDO", () => {
    expect(validarLink("").ok).toBe(false);
    expect(validarLink("   ").ok).toBe(false);
    expect(erroDe(validarLink("não é url"))).toMatchObject({ codigo: "LINK_INVALIDO" });
  });

  it("rejeita protocolo diferente de http/https", () => {
    const resultado = validarLink("ftp://instagram.com/reel/abc/");
    expect(resultado).toEqual({
      ok: false,
      erro: { codigo: "LINK_INVALIDO", mensagem: "unsupported protocol" },
    });
  });

  it("rejeita credenciais e porta explícita na URL", () => {
    expect(validarLink("https://user:pass@instagram.com/reel/abc/").ok).toBe(false);
    expect(validarLink("https://instagram.com:8443/reel/abc/").ok).toBe(false);
  });

  it("rejeita domínio não suportado como PLATAFORMA_NAO_SUPORTADA", () => {
    expect(validarLink("https://youtube.com.evil.example/watch?v=abc")).toEqual({
      ok: false,
      erro: { codigo: "PLATAFORMA_NAO_SUPORTADA", mensagem: "unsupported host" },
    });
  });
});
