import type { Ref } from "react";

type Props = {
  valor: string;
  aoAlterar: (valor: string) => void;
  desabilitado: boolean;
  temErro: boolean;
  refInput?: Ref<HTMLInputElement>;
};

export function CampoLink({ valor, aoAlterar, desabilitado, temErro, refInput }: Props) {
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
