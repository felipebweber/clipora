type Props = {
  valor: string;
  aoAlterar: (valor: string) => void;
  desabilitado: boolean;
  temErro: boolean;
};

export function CampoLink({ valor, aoAlterar, desabilitado, temErro }: Props) {
  return (
    <div className="campo-link">
      <label htmlFor="campo-link-input">Link do Instagram Reels ou do TikTok</label>
      <input
        id="campo-link-input"
        type="url"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        placeholder="Cole o link aqui"
        value={valor}
        disabled={desabilitado}
        onChange={(evento) => aoAlterar(evento.target.value)}
        aria-invalid={temErro || undefined}
        aria-describedby={temErro ? "erro-aviso" : undefined}
      />
      {desabilitado && (
        <p className="campo-link-dica">O link não pode ser alterado durante o download.</p>
      )}
    </div>
  );
}
