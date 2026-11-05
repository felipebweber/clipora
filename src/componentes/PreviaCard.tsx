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
};

export function PreviaCard({ previa }: { previa: Previa }) {
  return (
    <section className="previa" aria-label="Prévia do vídeo">
      <div className="previa-capa">
        {previa.capaDataUrl ? (
          <img src={previa.capaDataUrl} alt="" />
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
