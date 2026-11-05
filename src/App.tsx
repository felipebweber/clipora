import { CampoLink } from "./componentes/CampoLink";
import { ConfiguracoesPainel } from "./componentes/ConfiguracoesPainel";
import { ErroAviso } from "./componentes/ErroAviso";
import { PreviaCard } from "./componentes/PreviaCard";
import { ProgressoDownloadView } from "./componentes/ProgressoDownload";
import { useClipora } from "./estado/useClipora";
import type { Previa } from "./tipos/contrato";
import "./App.css";

function previaDoEstado(
  estado: ReturnType<typeof useClipora>["estado"],
): Previa | null {
  switch (estado.tipo) {
    case "pronto":
    case "baixando":
    case "concluido":
      return estado.previa;
    case "erro":
      return estado.previa;
    default:
      return null;
  }
}

function App() {
  const {
    estado,
    textoLink,
    aoAlterarLink,
    baixar,
    reconhecerErro,
    abrirPasta,
    podeEditarLink,
    podeSolicitarDownload,
  } = useClipora();

  const erroAtual = estado.tipo === "erro" ? estado.erro : null;
  const previaAtual = previaDoEstado(estado);

  return (
    <main className="app">
      <h1>Clipora</h1>
      <p className="subtitulo">
        Cole o link de um vídeo público do Instagram Reels ou do TikTok para baixá-lo.
      </p>

      <CampoLink
        valor={textoLink}
        aoAlterar={aoAlterarLink}
        desabilitado={!podeEditarLink}
        temErro={erroAtual !== null}
      />

      {estado.tipo === "carregando_previa" && (
        <p className="status" role="status" aria-live="polite">
          Carregando prévia…
        </p>
      )}

      {erroAtual && (
        <ErroAviso
          erro={erroAtual}
          podeTentarNovamente={estado.tipo === "erro" && estado.origem === "download"}
          aoFechar={reconhecerErro}
        />
      )}

      {previaAtual && <PreviaCard previa={previaAtual} />}

      {estado.tipo === "pronto" && (
        <button type="button" className="botao-baixar" onClick={baixar} disabled={!podeSolicitarDownload}>
          Baixar
        </button>
      )}

      {estado.tipo === "baixando" && <ProgressoDownloadView progresso={estado.progresso} />}

      {estado.tipo === "concluido" && (
        <div className="conclusao" role="status" aria-live="polite">
          <p>Download concluído: {estado.resultado.nomeArquivo}</p>
          {estado.resultado.renomeado && (
            <p className="conclusao-nota">
              Já existia um arquivo com esse nome; este foi salvo com um nome diferente.
            </p>
          )}
          <button type="button" onClick={abrirPasta}>
            Abrir pasta
          </button>
        </div>
      )}

      <ConfiguracoesPainel />
    </main>
  );
}

export default App;
