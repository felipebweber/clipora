import type { Previa } from "../tipos/contrato";

function formatarDuracao(segundos: number): string {
  const total = Math.round(segundos);
  const minutos = Math.floor(total / 60);
  const resto = total % 60;
  return `${minutos}:${resto.toString().padStart(2, "0")}`;
}

const NOME_PLATAFORMA: Record<Previa["plataforma"], string> = {
  instagram: "Instagram Reels",
  tiktok: "TikTok",
  youtube: "YouTube",
};

/** Só aceita data URLs de imagem raster: o backend nunca deve mandar outra
 * coisa, e um SVG ou URL externa não deve chegar a um `<img>`. */
const CAPA_PERMITIDA = /^data:image\/(jpeg|png|webp|gif|avif);base64,/;

export function capaSegura(capaDataUrl: string | null): string | null {
  return capaDataUrl && CAPA_PERMITIDA.test(capaDataUrl) ? capaDataUrl : null;
}

export function PreviaCard({ previa }: { previa: Previa }) {
  const capa = capaSegura(previa.capaDataUrl);
  return (
    <section className="previa" aria-label="Prévia do vídeo">
      <div className="previa-capa">
        {capa ? (
          <img src={capa} alt="" />
        ) : (
          <div className="previa-capa-indisponivel">Capa não disponível</div>
        )}
      </div>
      <div className="previa-info">
        <p className="previa-titulo">{previa.titulo ?? "Título não disponível"}</p>
        <p className="previa-meta">
          {NOME_PLATAFORMA[previa.plataforma]}
          {previa.duracaoSegundos != null ? ` • ${formatarDuracao(previa.duracaoSegundos)}` : ""}
        </p>
      </div>
    </section>
  );
}
