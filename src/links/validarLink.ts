import type { ErroClipora, Plataforma } from "../tipos/contrato";

/**
 * Pré-filtro de link no frontend (feedback imediato, sem round-trip).
 *
 * A validação AUTORITATIVA é feita no Rust (ver docs/contrato-ipc.md,
 * seção "Prévia e política de URL"); esta função só evita chamadas óbvias
 * ao backend e dá retorno rápido ao usuário. Por isso é DELIBERADAMENTE
 * leniente: verifica apenas esquema/credenciais/porta e se o host é
 * plausivelmente Instagram ou TikTok, sem validar o caminho (o Rust aceita
 * formas de caminho mais amplas que seria frágil replicar aqui, ex.
 * `instagram.com/<usuario>/reel/<id>/`). Nunca deve ser a palavra final
 * sobre se um link é aceito.
 */
export type ResultadoValidacao =
  | { ok: true; plataforma: Plataforma }
  | { ok: false; erro: ErroClipora };

const HOSTS_INSTAGRAM = new Set(["instagram.com", "www.instagram.com", "m.instagram.com"]);
const HOSTS_TIKTOK = new Set([
  "tiktok.com",
  "www.tiktok.com",
  "m.tiktok.com",
  "vm.tiktok.com",
  "vt.tiktok.com",
]);

export function validarLink(urlTexto: string): ResultadoValidacao {
  const texto = urlTexto.trim();
  if (!texto) {
    return { ok: false, erro: { codigo: "LINK_INVALIDO", mensagem: "empty url" } };
  }

  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    return { ok: false, erro: { codigo: "LINK_INVALIDO", mensagem: "malformed url" } };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, erro: { codigo: "LINK_INVALIDO", mensagem: "unsupported protocol" } };
  }
  if (url.username || url.password) {
    return { ok: false, erro: { codigo: "LINK_INVALIDO", mensagem: "credentials not allowed" } };
  }
  if (url.port) {
    return { ok: false, erro: { codigo: "LINK_INVALIDO", mensagem: "explicit port not allowed" } };
  }

  const host = url.hostname.toLowerCase();

  if (HOSTS_INSTAGRAM.has(host)) {
    return { ok: true, plataforma: "instagram" };
  }
  if (HOSTS_TIKTOK.has(host)) {
    return { ok: true, plataforma: "tiktok" };
  }

  return {
    ok: false,
    erro: { codigo: "PLATAFORMA_NAO_SUPORTADA", mensagem: "unsupported host" },
  };
}
