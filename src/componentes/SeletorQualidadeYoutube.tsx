import { rotuloQualidadeYoutube } from "../qualidadesYoutube";

type Props = {
  alturas: number[];
  altura: number | null;
  desabilitado: boolean;
  aoAlterar: (altura: number | null) => void;
};

export function SeletorQualidadeYoutube({ alturas, altura, desabilitado, aoAlterar }: Props) {
  return (
    <div className="seletor-qualidade-youtube">
      <label htmlFor="qualidade-youtube">Qualidade</label>
      <select
        id="qualidade-youtube"
        value={altura ?? ""}
        disabled={desabilitado}
        onChange={(evento) => aoAlterar(evento.target.value === "" ? null : Number(evento.target.value))}
      >
        <option value="">Melhor disponível</option>
        {alturas.map((opcao) => <option value={opcao} key={opcao}>{rotuloQualidadeYoutube(opcao)}</option>)}
      </select>
    </div>
  );
}
