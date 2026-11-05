import { mensagemDoErro } from "../erros/mensagens";
import type { UsePastaDestinoRetorno } from "../estado/usePastaDestino";
import type { ErroClipora, PastaDestino, VerificacaoYtdlp } from "../tipos/contrato";

type Props = {
  pasta: UsePastaDestinoRetorno;
  /** Bloqueia "Alterar pasta" (ex.: durante um download). */
  bloqueado: boolean;
  verificacaoYtdlp: VerificacaoYtdlp | null;
  falhaVerificacaoYtdlp: ErroClipora | null;
};

function descricaoPasta(pasta: PastaDestino | null): { caminho: string; nota: string | null } {
  if (!pasta || pasta.estado === "nao_definida" || !pasta.caminho) {
    return {
      caminho: "nenhuma pasta definida ainda",
      nota: "Ela será pedida no primeiro download.",
    };
  }
  switch (pasta.estado) {
    case "ausente":
      return { caminho: pasta.caminho, nota: "Essa pasta não existe mais. Escolha outra." };
    case "sem_permissao":
      return {
        caminho: pasta.caminho,
        nota: "O Clipora não tem permissão para salvar nessa pasta. Escolha outra.",
      };
    default:
      return { caminho: pasta.caminho, nota: null };
  }
}

export function ConfiguracoesPainel({
  pasta: { pasta, erro, selecionando, alterar },
  bloqueado,
  verificacaoYtdlp,
  falhaVerificacaoYtdlp,
}: Props) {
  const { caminho, nota } = descricaoPasta(pasta);
  const problema = pasta?.estado === "ausente" || pasta?.estado === "sem_permissao";

  return (
    <details className="configuracoes">
      <summary>Configurações</summary>
      <div className="configuracoes-conteudo">
        <p>
          Pasta de destino: <strong>{caminho}</strong>
        </p>
        {nota && (
          <p className={problema ? "configuracoes-nota configuracoes-nota-problema" : "configuracoes-nota"}>
            {nota}
          </p>
        )}
        {erro && (
          <p className="erro-mensagem" role="alert">
            {mensagemDoErro(erro)}
          </p>
        )}
        <button
          type="button"
          onClick={() => void alterar()}
          disabled={bloqueado || selecionando}
          aria-describedby={bloqueado ? "configuracoes-dica-bloqueio" : undefined}
        >
          Alterar pasta de destino
        </button>
        {bloqueado && (
          <p id="configuracoes-dica-bloqueio" className="configuracoes-nota">
            Não é possível alterar a pasta durante o download.
          </p>
        )}

        <p className="configuracoes-ytdlp">
          Versão do yt-dlp:{" "}
          <strong>
            {verificacaoYtdlp
              ? verificacaoYtdlp.versaoAtual
              : falhaVerificacaoYtdlp
                ? "não identificada"
                : "verificando…"}
          </strong>
          {verificacaoYtdlp?.origem === "atualizada" ? " (atualizada pelo Clipora)" : ""}
        </p>
        {falhaVerificacaoYtdlp && (
          <p className="configuracoes-nota">
            Não foi possível verificar agora se há uma nova versão do yt-dlp.
          </p>
        )}
      </div>
    </details>
  );
}
