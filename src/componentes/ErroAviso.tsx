import { mensagemDoErro, sugestaoDoErro } from "../erros/mensagens";
import type { ErroClipora } from "../tipos/contrato";

type Props = {
  erro: ErroClipora;
  podeTentarNovamente: boolean;
  aoFechar: () => void;
};

export function ErroAviso({ erro, podeTentarNovamente, aoFechar }: Props) {
  const mensagem = mensagemDoErro(erro);
  const sugestao = sugestaoDoErro(erro);

  return (
    <div id="erro-aviso" className="erro" role="alert" aria-live="assertive">
      <p className="erro-mensagem">{mensagem}</p>
      {sugestao && <p className="erro-sugestao">{sugestao}</p>}
      <button type="button" onClick={aoFechar}>
        {podeTentarNovamente ? "Tentar novamente" : "Entendi"}
      </button>
    </div>
  );
}
