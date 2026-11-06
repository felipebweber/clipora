import type { Ref } from "react";
import type { EtapaDownload } from "../tipos/contrato";
import type { ProgressoDownload } from "../estado/maquina";

const ROTULO_ETAPA: Record<EtapaDownload, string> = {
  preparando: "Preparando",
  baixando_video: "Baixando vídeo",
  baixando_audio: "Baixando áudio",
  unindo: "Unindo vídeo e áudio",
  finalizando: "Finalizando",
};

const formatarPercentual = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

type Props = {
  progresso: ProgressoDownload;
  /** Recebe o contêiner (focável via tabIndex=-1) para gestão de foco. */
  refContainer?: Ref<HTMLDivElement>;
};

/**
 * Progresso do download. Só a etapa fica em região `aria-live` — o
 * percentual muda até ~10×/s e anunciá-lo inundaria o leitor de tela; quem
 * quiser o valor exato o encontra no `<progress>` (fora da região live).
 */
export function ProgressoDownloadView({ progresso, refContainer }: Props) {
  // `etapa` vem do backend; uma etapa desconhecida não pode quebrar a tela.
  const rotulo = ROTULO_ETAPA[progresso.etapa] ?? "Baixando";
  const etapaTransferindo = progresso.etapa === "baixando_video" || progresso.etapa === "baixando_audio";
  // Percentual mede bytes da transferência completa. Valores de preparação,
  // união e finalização de versões antigas não representam bytes transferidos.
  const determinado = etapaTransferindo && progresso.percentual !== null;
  const valorPercentual = progresso.percentual as number;
  const percentualTexto = determinado
    ? `${formatarPercentual.format(
        valorPercentual < 100 ? Math.min(valorPercentual, 99) : valorPercentual,
      )}%`
    : null;
  const percentualAcessivel = percentualTexto
    ? `${percentualTexto} transferido da transferência total; etapa: ${rotulo}`
    : `${rotulo}: percentual da transferência total indisponível nesta etapa`;

  return (
    <div className="progresso" ref={refContainer} tabIndex={-1} aria-label="Download em andamento">
      <p className="progresso-rotulo">
        <span role="status">{rotulo}</span>
        <span aria-hidden="true">{percentualTexto ? ` — ${percentualTexto} transferido` : "…"}</span>
      </p>
      <progress
        className="progresso-barra"
        max={100}
        value={determinado ? (progresso.percentual as number) : undefined}
        aria-label="Progresso do download"
        aria-valuetext={percentualAcessivel}
      />
    </div>
  );
}
