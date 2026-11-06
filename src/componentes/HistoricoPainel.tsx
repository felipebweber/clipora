import { useState } from "react";
import type { ItemHistorico } from "../tipos/contrato";

type Props = {
  itens: ItemHistorico[];
  carregando: boolean;
  erro: string | null;
  baixarDesabilitado?: boolean;
  duplicado: ItemHistorico | null;
  aoLimpar: () => Promise<boolean>;
  aoAbrirArquivo: (downloadId: string) => void;
  aoAbrirPasta: (downloadId: string) => void;
  aoBaixarNovamente: () => void;
};

function dataLegivel(timestamp: number): string {
  const data = new Date(timestamp);
  if (!Number.isFinite(data.getTime())) return "Data indisponível";
  try {
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(data);
  } catch {
    return "Data indisponível";
  }
}

export function HistoricoPainel(props: Props) {
  const [confirmando, setConfirmando] = useState(false);
  const { itens, carregando, erro, duplicado } = props;
  return (
    <>
      {duplicado && (
        <section className="historico-duplicado" aria-label="Aviso de vídeo já baixado" role="status">
          <p>Este vídeo já está no histórico: <strong>{duplicado.nomeArquivo}</strong>.</p>
          {duplicado.disponivel ? (
            <button type="button" onClick={() => props.aoAbrirArquivo(duplicado.downloadId)}>Abrir cópia</button>
          ) : <p>O arquivo não está disponível no local salvo. Você pode baixá-lo novamente.</p>}
          <button type="button" disabled={props.baixarDesabilitado} onClick={props.aoBaixarNovamente}>Baixar novamente</button>
        </section>
      )}
      <details className="historico-painel">
        <summary>Histórico de downloads ({itens.length})</summary>
        <div className="historico-conteudo">
          {carregando && <p className="status" role="status">Carregando histórico…</p>}
          {!carregando && !erro && itens.length === 0 && <p className="status">Nenhum vídeo baixado ainda.</p>}
          {itens.map((item) => (
            <article className="historico-item" key={item.downloadId}>
              <div className="historico-dados">
                <strong>{item.nomeArquivo}</strong>
                <span>{item.plataforma === "instagram" ? "Instagram" : item.plataforma === "tiktok" ? "TikTok" : "YouTube"} · {dataLegivel(item.concluidoEm)}</span>
                {!item.disponivel && <span className="historico-indisponivel">Arquivo indisponível neste local.</span>}
              </div>
              {item.disponivel && <button type="button" aria-label={`Abrir arquivo ${item.nomeArquivo}`} onClick={() => props.aoAbrirArquivo(item.downloadId)}>Abrir vídeo</button>}
              <button type="button" aria-label={`Abrir pasta de ${item.nomeArquivo}`} onClick={() => props.aoAbrirPasta(item.downloadId)}>Abrir pasta</button>
            </article>
          ))}
          {itens.length > 0 && !confirmando && <button type="button" onClick={() => setConfirmando(true)}>Limpar histórico</button>}
          {confirmando && (
            <div className="historico-confirmacao" role="group" aria-label="Confirmar limpeza do histórico">
              <p>Os vídeos salvos não serão apagados; somente os registros do histórico serão removidos.</p>
              <button type="button" disabled={carregando} onClick={async () => {
                const sucesso = await props.aoLimpar();
                if (sucesso) setConfirmando(false);
              }}>Confirmar limpeza</button>
              <button type="button" onClick={() => setConfirmando(false)}>Cancelar</button>
            </div>
          )}
        </div>
      </details>
    </>
  );
}
