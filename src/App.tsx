import { useCallback, useEffect, useRef, useState } from "react";
import { AvisoAtualizacao } from "./componentes/AvisoAtualizacao";
import { CampoLink } from "./componentes/CampoLink";
import { ConfiguracoesPainel } from "./componentes/ConfiguracoesPainel";
import { ErroAviso } from "./componentes/ErroAviso";
import { PreviaCard } from "./componentes/PreviaCard";
import { ProgressoDownloadView } from "./componentes/ProgressoDownload";
import { SobreLicencas } from "./componentes/SobreLicencas";
import { permiteNovaTentativa } from "./erros/mensagens";
import type { EstadoApp } from "./estado/maquina";
import { useAtualizacaoYtdlp } from "./estado/useAtualizacaoYtdlp";
import { useClipora } from "./estado/useClipora";
import { usePastaDestino } from "./estado/usePastaDestino";
import { servico as servicoPadrao } from "./servicos";
import type { ServicoClipora } from "./servicos/tipos";
import type { Previa } from "./tipos/contrato";
import "./App.css";

function previaDoEstado(estado: EstadoApp): Previa | null {
  switch (estado.tipo) {
    case "pronto":
    case "baixando":
    case "concluido":
    case "erro":
      return estado.previa;
    default:
      return null;
  }
}

function focoPerdido(): boolean {
  const ativo = document.activeElement;
  return !ativo || ativo === document.body;
}

type Props = {
  servico?: ServicoClipora;
  /** Intervalo das consultas a obter_estado() ao acompanhar um download ou
   * atualização recuperados (ajustável nos testes). */
  intervaloRecuperacaoMs?: number;
};

function App({ servico = servicoPadrao, intervaloRecuperacaoMs }: Props) {
  const pasta = usePastaDestino(servico);
  const {
    estado,
    textoLink,
    aviso,
    aoAlterarLink,
    confirmarLink,
    baixar,
    tentarNovamente,
    reconhecerErro,
    abrirPasta,
    podeEditarLink,
    podeSolicitarDownload,
  } = useClipora(servico, { aoAlterarPasta: pasta.recarregar, intervaloRecuperacaoMs });

  const downloadEmAndamento = estado.tipo === "baixando";
  const atualizacao = useAtualizacaoYtdlp(servico, { downloadEmAndamento, intervaloRecuperacaoMs });

  const erroAtual = estado.tipo === "erro" ? estado.erro : null;
  const previaAtual = previaDoEstado(estado);
  const baixarHabilitado = podeSolicitarDownload && !atualizacao.emAndamento;

  // Gestão de foco: quando o elemento focado some (Baixar ao iniciar o
  // download, a área de progresso ao concluir, "Entendi" ao fechar o erro),
  // o foco vai para o elemento lógico seguinte do novo estado. Se o foco
  // ainda está em algum lugar (ex.: o usuário digitando no campo), nada muda.
  const refCampo = useRef<HTMLInputElement>(null);
  const refBaixar = useRef<HTMLButtonElement>(null);
  const refProgresso = useRef<HTMLDivElement>(null);
  const refErro = useRef<HTMLButtonElement>(null);
  const refAbrirPasta = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!focoPerdido()) return;
    const alvo = {
      aguardando_link: refCampo,
      carregando_previa: refCampo,
      pronto: refBaixar.current && !refBaixar.current.disabled ? refBaixar : refCampo,
      baixando: refProgresso,
      concluido: refAbrirPasta,
      erro: refErro,
    }[estado.tipo];
    alvo.current?.focus();
  }, [estado.tipo]);

  // Tela "Sobre e licenças": modal; o resto da janela fica inerte enquanto
  // ela está aberta e o foco volta ao botão que a abriu.
  const [sobreAberto, setSobreAberto] = useState(false);
  const refBotaoSobre = useRef<HTMLButtonElement>(null);
  const fecharSobre = useCallback(() => {
    setSobreAberto(false);
    // Depois que o diálogo sai e o <main> deixa de ser inerte.
    requestAnimationFrame(() => refBotaoSobre.current?.focus());
  }, []);

  return (
    <>
    <main className="app" inert={sobreAberto}>
      <h1>Clipora</h1>
      <p className="subtitulo">
        Cole o link de um vídeo público do Instagram Reels ou do TikTok para baixá-lo.
      </p>

      <AvisoAtualizacao atualizacao={atualizacao} downloadEmAndamento={downloadEmAndamento} />

      <CampoLink
        valor={textoLink}
        aoAlterar={aoAlterarLink}
        aoConfirmar={confirmarLink}
        desabilitado={!podeEditarLink}
        temErro={erroAtual !== null}
        refInput={refCampo}
      />

      {estado.tipo === "carregando_previa" && (
        <p className="status" role="status">
          Carregando prévia…
        </p>
      )}

      {estado.tipo === "erro" && (
        <ErroAviso
          erro={estado.erro}
          aoTentarNovamente={
            permiteNovaTentativa(estado.erro, estado.origem) ? tentarNovamente : undefined
          }
          aoFechar={reconhecerErro}
          refBotao={refErro}
        />
      )}

      {previaAtual && <PreviaCard previa={previaAtual} />}

      {estado.tipo === "pronto" && (
        <>
          <button
            type="button"
            ref={refBaixar}
            className="botao-baixar"
            onClick={baixar}
            disabled={!baixarHabilitado}
            aria-describedby={atualizacao.emAndamento ? "dica-baixar" : undefined}
          >
            Baixar
          </button>
          {atualizacao.emAndamento && (
            <p id="dica-baixar" className="campo-link-dica">
              Aguarde a atualização do yt-dlp terminar para baixar.
            </p>
          )}
        </>
      )}

      {estado.tipo === "baixando" && (
        <>
          {estado.recuperado && !estado.previa && (
            <p className="status">
              Um download iniciado antes de a janela ser recarregada continua em andamento.
            </p>
          )}
          <ProgressoDownloadView progresso={estado.progresso} refContainer={refProgresso} />
        </>
      )}

      {estado.tipo === "concluido" && (
        <div className="conclusao">
          <p role="status">Download concluído: {estado.resultado.nomeArquivo}</p>
          {estado.resultado.renomeado && (
            <p className="conclusao-nota">
              Já existia um arquivo com esse nome; este foi salvo com um nome diferente.
            </p>
          )}
          <button type="button" ref={refAbrirPasta} onClick={abrirPasta}>
            Abrir pasta
          </button>
        </div>
      )}

      {aviso && (
        <p className="aviso" role="status">
          {aviso}
        </p>
      )}

      <ConfiguracoesPainel
        pasta={pasta}
        bloqueado={downloadEmAndamento}
        verificacaoYtdlp={atualizacao.verificacao}
        falhaVerificacaoYtdlp={atualizacao.falhaVerificacao}
        aoAbrirSobre={() => setSobreAberto(true)}
        refBotaoSobre={refBotaoSobre}
      />
    </main>
    {sobreAberto && (
      <SobreLicencas
        servico={servico}
        aoFechar={fecharSobre}
        verificacaoYtdlp={atualizacao.verificacao}
      />
    )}
    </>
  );
}

export default App;
