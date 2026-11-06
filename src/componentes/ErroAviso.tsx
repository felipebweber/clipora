import type { Ref } from "react";
import { mensagemDoErro, sugestaoDoErro } from "../erros/mensagens";
import type { ErroClipora } from "../tipos/contrato";

type Props = {
  erro: ErroClipora;
  /** Quando presente, exibe "Tentar novamente", que repete a ação que falhou. */
  aoTentarNovamente?: () => void;
  aoAtualizarPrevia?: () => void;
  aoFechar: () => void;
  /** Recebe o primeiro botão, para onde o foco vai quando o aviso aparece
   * no lugar do elemento focado. */
  refBotao?: Ref<HTMLButtonElement>;
};

export function ErroAviso({ erro, aoTentarNovamente, aoAtualizarPrevia, aoFechar, refBotao }: Props) {
  const mensagem = mensagemDoErro(erro);
  const sugestao = sugestaoDoErro(erro);

  return (
    // Esc com o foco no aviso equivale a "Entendi".
    <div
      id="erro-aviso"
      className="erro"
      role="alert"
      onKeyDown={(evento) => {
        if (evento.key === "Escape") aoFechar();
      }}
    >
      <p className="erro-mensagem">{mensagem}</p>
      {sugestao && <p className="erro-sugestao">{sugestao}</p>}
      <div className="erro-acoes">
        {aoTentarNovamente && (
          <button type="button" onClick={aoTentarNovamente} ref={refBotao}>
            Tentar novamente
          </button>
        )}
        {aoAtualizarPrevia && (
          <button type="button" onClick={aoAtualizarPrevia} ref={!aoTentarNovamente ? refBotao : undefined}>
            Atualizar prévia
          </button>
        )}
        <button type="button" onClick={aoFechar} ref={aoTentarNovamente || aoAtualizarPrevia ? undefined : refBotao}>
          Entendi
        </button>
      </div>
    </div>
  );
}
