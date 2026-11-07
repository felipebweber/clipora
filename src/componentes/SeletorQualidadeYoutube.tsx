import { rotuloQualidadeYoutube } from "../qualidadesYoutube";

type Props = {
  alturas: number[];
  /** Alturas com H.264; sem a lista (backend antigo), nenhuma é marcada. */
  compativeis?: number[] | null;
  altura: number | null;
  desabilitado: boolean;
  aoAlterar: (altura: number | null) => void;
};

export function SeletorQualidadeYoutube({ alturas, compativeis, altura, desabilitado, aoAlterar }: Props) {
  const incompativel = (opcao: number) => Array.isArray(compativeis) && !compativeis.includes(opcao);
  return (
    <div className="seletor-qualidade-youtube">
      <label htmlFor="qualidade-youtube">Qualidade</label>
      <select
        id="qualidade-youtube"
        value={altura ?? ""}
        disabled={desabilitado}
        onChange={(evento) => aoAlterar(evento.target.value === "" ? null : Number(evento.target.value))}
      >
        <option value="">Melhor compatível</option>
        {alturas.map((opcao) => (
          <option value={opcao} key={opcao}>
            {rotuloQualidadeYoutube(opcao)}
            {incompativel(opcao) ? " · pode exigir VLC" : ""}
          </option>
        ))}
      </select>
      {altura !== null && incompativel(altura) && (
        <p className="aviso-compatibilidade">
          O YouTube só oferece essa qualidade em VP9/AV1: o arquivo pode não abrir no QuickTime ou no player padrão do
          sistema. Use o VLC ou o IINA, ou escolha uma qualidade sem esse aviso.
        </p>
      )}
    </div>
  );
}
