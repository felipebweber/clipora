import type { EtapaDownload } from "../tipos/contrato";
import type { ProgressoDownload } from "../estado/maquina";

const ROTULO_ETAPA: Record<EtapaDownload, string> = {
  preparando: "Preparando",
  baixando_video: "Baixando vídeo",
  baixando_audio: "Baixando áudio",
  unindo: "Unindo vídeo e áudio",
  finalizando: "Finalizando",
};

export function ProgressoDownloadView({ progresso }: { progresso: ProgressoDownload }) {
  const determinado = progresso.percentual !== null;
  const rotulo = ROTULO_ETAPA[progresso.etapa];

  return (
    <div className="progresso" aria-live="polite" role="status">
      <p className="progresso-rotulo">
        {rotulo}
        {determinado ? ` — ${progresso.percentual}%` : "…"}
      </p>
      <progress
        className="progresso-barra"
        max={100}
        value={determinado ? (progresso.percentual as number) : undefined}
        aria-label={`Progresso do download: ${rotulo}`}
      />
    </div>
  );
}
