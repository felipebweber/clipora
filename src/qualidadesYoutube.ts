const U32_MAX = 4_294_967_295;

/** A UI catalog must be non-empty, strictly descending, and contain only exact u32 heights. */
export function catalogoYoutubeValido(valor: unknown): valor is number[] {
  if (!Array.isArray(valor) || valor.length === 0) return false;
  let anterior = Number.POSITIVE_INFINITY;
  for (const altura of valor) {
    if (!Number.isInteger(altura) || altura <= 0 || altura > U32_MAX || altura >= anterior) return false;
    anterior = altura;
  }
  return true;
}

export function rotuloQualidadeYoutube(altura: number): string {
  return altura === 2160 ? "2160p (4K)" : `${altura}p`;
}
