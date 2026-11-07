import { useRef, type Ref } from "react";

type Props = {
  valor: string;
  aoAlterar: (valor: string) => void;
  /** Enter: carregar a prévia imediatamente. */
  aoConfirmar?: () => void;
  desabilitado: boolean;
  temErro: boolean;
  refInput?: Ref<HTMLInputElement>;
};

export function CampoLink({
  valor,
  aoAlterar,
  aoConfirmar,
  desabilitado,
  temErro,
  refInput,
}: Props) {
  const descricoes = [desabilitado ? "campo-link-dica" : null, temErro ? "erro-aviso" : null]
    .filter(Boolean)
    .join(" ");
  // Primeiro clique (campo ainda sem foco) seleciona o link inteiro, para a
  // próxima colagem substituí-lo; cliques seguintes posicionam o cursor.
  const selecionarAoSoltar = useRef(false);
  return (
    <div className="campo-link">
      <label htmlFor="campo-link-input">Link do Instagram Reels, TikTok ou YouTube</label>
      <input
        id="campo-link-input"
        ref={refInput}
        type="url"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        placeholder="Cole o link aqui"
        value={valor}
        disabled={desabilitado}
        onChange={(evento) => aoAlterar(evento.target.value)}
        onFocus={(evento) => evento.currentTarget.select()}
        onMouseDown={(evento) => {
          selecionarAoSoltar.current = document.activeElement !== evento.currentTarget;
        }}
        onMouseUp={(evento) => {
          if (selecionarAoSoltar.current) {
            selecionarAoSoltar.current = false;
            evento.preventDefault();
            evento.currentTarget.select();
          }
        }}
        onKeyDown={(evento) => {
          if (evento.key === "Enter") {
            evento.preventDefault();
            aoConfirmar?.();
          }
        }}
        aria-invalid={temErro || undefined}
        aria-describedby={descricoes || undefined}
      />
      {desabilitado && (
        <p id="campo-link-dica" className="campo-link-dica">
          O link não pode ser alterado durante o download.
        </p>
      )}
    </div>
  );
}
