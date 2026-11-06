import { describe, expect, it } from "vitest";
import { catalogoYoutubeValido, rotuloQualidadeYoutube } from "./qualidadesYoutube";

describe("catálogo de qualidades do YouTube", () => {
  it("aceita apenas alturas positivas únicas em ordem estritamente decrescente dentro de u32", () => {
    expect(catalogoYoutubeValido([2160, 1080, 720])).toBe(true);
    for (const catalogo of [null, [], [1080, 1080], [720, 1080], [720, 0], [720, 1.5], [4_294_967_296]]) {
      expect(catalogoYoutubeValido(catalogo)).toBe(false);
    }
  });

  it("rotula a altura exata sem arredondar resoluções incomuns", () => {
    expect(rotuloQualidadeYoutube(2160)).toBe("2160p (4K)");
    expect(rotuloQualidadeYoutube(1080)).toBe("1080p");
    expect(rotuloQualidadeYoutube(1079)).toBe("1079p");
  });
});
