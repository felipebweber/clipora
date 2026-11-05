import type { Ref } from "react";

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
  return (
    <div className="campo-link">
      <label htmlFor="campo-link-input">Link do Instagram Reels ou do TikTok</label>
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
