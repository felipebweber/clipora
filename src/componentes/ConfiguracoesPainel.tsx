import { usePastaDestino } from "../estado/usePastaDestino";
import { mensagemDoErro } from "../erros/mensagens";
import type { ServicoClipora } from "../servicos/tipos";

export function ConfiguracoesPainel({ servico }: { servico?: ServicoClipora }) {
  const { pasta, erro, alterar } = usePastaDestino(servico);

  return (
    <details className="configuracoes">
      <summary>Configurações</summary>
      <div className="configuracoes-conteudo">
        <p>
          Pasta de destino:{" "}
          <strong>{pasta?.caminho ?? "nenhuma pasta definida ainda"}</strong>
        </p>
        {erro && <p className="erro-mensagem">{mensagemDoErro(erro)}</p>}
        <button type="button" onClick={() => void alterar()}>
          Alterar pasta de destino
        </button>
      </div>
    </details>
  );
}
