import { mensagemDoErro } from "../erros/mensagens";
import type { UseAtualizacaoYtdlpRetorno } from "../estado/useAtualizacaoYtdlp";

/** Etapas enviadas pelo backend em `EventoAtualizacao.etapa`
 * (src-tauri/src/instalacao.rs); etapas desconhecidas caem no genérico. */
const ROTULO_ETAPA_ATUALIZACAO: Record<string, string> = {
  verificando: "consultando a versão publicada",
  baixando: "baixando",
  verificando_integridade: "verificando a integridade",
  instalando: "instalando",
  concluido: "concluindo",
};

const formatarPercentual = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

type Props = {
  atualizacao: UseAtualizacaoYtdlpRetorno;
  downloadEmAndamento: boolean;
};

/**
 * Aviso discreto de nova versão do yt-dlp. A atualização só começa quando o
 * usuário clica em "Atualizar"; o aviso então mostra andamento, sucesso ou
 * erro.
 */
export function AvisoAtualizacao({ atualizacao, downloadEmAndamento }: Props) {
  const { fase, versaoDisponivel, podeAtualizar, atualizar } = atualizacao;
  if (fase.tipo === "inativo" && !versaoDisponivel) return null;

  const podeRepetir = fase.tipo === "erro" && fase.erro.codigo !== "ATUALIZACAO_NAO_SUPORTADA";
  const botaoAtualizar = versaoDisponivel && (fase.tipo === "inativo" || podeRepetir) && (
    <button
      type="button"
      className="aviso-atualizacao-botao"
      onClick={() => void atualizar()}
      disabled={!podeAtualizar}
      aria-describedby={downloadEmAndamento ? "aviso-atualizacao-dica" : undefined}
    >
      {fase.tipo === "erro" ? "Tentar atualizar novamente" : "Atualizar"}
    </button>
  );

  let texto: string;
  switch (fase.tipo) {
    case "inativo":
      texto = `Nova versão do yt-dlp disponível (${versaoDisponivel}).`;
      break;
    case "atualizando": {
      const etapa = fase.progresso
        ? (ROTULO_ETAPA_ATUALIZACAO[fase.progresso.etapa] ?? "em andamento")
        : "em andamento";
      texto = `Atualizando o yt-dlp: ${etapa}…`;
      break;
    }
    case "sucesso":
      texto = `yt-dlp atualizado para a versão ${fase.versaoInstalada}.`;
      break;
    case "erro":
      texto = mensagemDoErro(fase.erro);
      break;
  }

  const percentual = fase.tipo === "atualizando" ? (fase.progresso?.percentual ?? null) : null;

  return (
    <section
      className={`aviso-atualizacao${fase.tipo === "erro" ? " aviso-atualizacao-erro" : ""}`}
      aria-label="Atualização do yt-dlp"
    >
      <p className="aviso-atualizacao-texto" role={fase.tipo === "erro" ? "alert" : "status"}>
        {texto}
      </p>
      {fase.tipo === "atualizando" && (
        <progress
          className="aviso-atualizacao-barra"
          max={100}
          value={percentual ?? undefined}
          aria-label="Progresso da atualização do yt-dlp"
          aria-valuetext={
            percentual !== null ? `${formatarPercentual.format(percentual)}%` : "Em andamento"
          }
        />
      )}
      {botaoAtualizar}
      {downloadEmAndamento && botaoAtualizar && (
        <p id="aviso-atualizacao-dica" className="aviso-atualizacao-dica">
          Disponível quando o download terminar.
        </p>
      )}
    </section>
  );
}
