import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { version as versaoPacote } from "../../package.json";
import { mensagemDoErro } from "../erros/mensagens";
import { normalizarErro } from "../erros/normalizar";
import { useLicencas } from "../estado/useLicencas";
import type { ServicoClipora } from "../servicos/tipos";
import type {
  ComponenteLicenca,
  PacoteLicenca,
  TipoLinkLicenca,
  VerificacaoYtdlp,
} from "../tipos/contrato";

const SELETOR_FOCAVEIS =
  'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** Tags oficiais do yt-dlp são datas (ex.: 2026.10.26 ou 2026.10.26.1). */
const TAG_YTDLP = /^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/;

type Props = {
  servico: ServicoClipora;
  aoFechar: () => void;
  /** Versão do yt-dlp em uso (pode ser uma atualização feita pelo app). */
  verificacaoYtdlp: VerificacaoYtdlp | null;
};

/**
 * Tela "Sobre e licenças" (docs/licencas.md §5.3), em diálogo modal: Esc
 * fecha, o foco fica preso dentro dele e volta para quem o abriu (a cargo de
 * quem renderiza). Todo texto vindo do backend é renderizado como texto —
 * nada de innerHTML.
 */
export function SobreLicencas({ servico, aoFechar, verificacaoYtdlp }: Props) {
  const { estado, tentarNovamente } = useLicencas(servico, true);
  const refDialogo = useRef<HTMLDivElement>(null);
  const idTitulo = useId();
  const [mostrarTexto, setMostrarTexto] = useState(false);
  const [avisoLink, setAvisoLink] = useState<string | null>(null);

  useEffect(() => {
    refDialogo.current?.focus();
  }, []);

  function aoTeclar(evento: KeyboardEvent<HTMLDivElement>) {
    if (evento.key === "Escape") {
      evento.stopPropagation();
      aoFechar();
      return;
    }
    if (evento.key !== "Tab" || !refDialogo.current) return;
    const focaveis = Array.from(
      refDialogo.current.querySelectorAll<HTMLElement>(SELETOR_FOCAVEIS),
    );
    if (focaveis.length === 0) return;
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];
    const ativo = document.activeElement;
    if (evento.shiftKey && (ativo === primeiro || ativo === refDialogo.current)) {
      evento.preventDefault();
      ultimo.focus();
    } else if (!evento.shiftKey && ativo === ultimo) {
      evento.preventDefault();
      primeiro.focus();
    }
  }

  function abrirLink(componenteId: string, tipo: TipoLinkLicenca, url: string) {
    setAvisoLink(null);
    servico.abrir_link_licenca({ componenteId, tipo }).catch((erro: unknown) => {
      // O código fica no console para diagnóstico; ao usuário, a ação.
      console.warn("abrir_link_licenca falhou", normalizarErro(erro));
      setAvisoLink(`Não foi possível abrir o navegador. Copie o endereço: ${url}`);
    });
  }

  const licencas = estado.tipo === "pronto" ? estado.licencas : null;
  const versaoClipora = licencas?.resumo.app.versao ?? versaoPacote;
  const ytdlp = licencas?.resumo.componentes.find((c) => c.id === "yt-dlp") ?? null;
  const ffmpeg = licencas?.resumo.componentes.find((c) => c.id === "ffmpeg") ?? null;

  return (
    <div className="dialogo-fundo">
      <div
        ref={refDialogo}
        className="dialogo"
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        tabIndex={-1}
        onKeyDown={aoTeclar}
      >
        <div className="dialogo-cabecalho">
          <h2 id={idTitulo}>Sobre o Clipora</h2>
          <button type="button" onClick={aoFechar}>
            Fechar
          </button>
        </div>

        <p>
          <strong>Clipora {versaoClipora}</strong> — baixa um vídeo público por vez do Instagram
          Reels ou do TikTok, direto no seu computador.
        </p>

        <p className="sobre-programas-separados">
          O Clipora usa dois programas separados, que ele executa no seu computador:{" "}
          <strong>yt-dlp</strong>, distribuído sob a licença GPL versão 3, e{" "}
          <strong>FFmpeg</strong>, distribuído sob a licença LGPL versão 2.1. Cada um mantém a
          própria licença, e o código-fonte de ambos está disponível nos endereços abaixo.
        </p>

        {estado.tipo === "carregando" || estado.tipo === "inativo" ? (
          <p role="status">Carregando informações de licença…</p>
        ) : null}

        {estado.tipo === "erro" && (
          <div className="erro" role="alert">
            <p className="erro-mensagem">Não foi possível carregar as informações de licença.</p>
            <p className="erro-sugestao">{mensagemDoErro(estado.erro)}</p>
            <div className="erro-acoes">
              <button type="button" onClick={tentarNovamente}>
                Tentar novamente
              </button>
            </div>
          </div>
        )}

        {licencas && (
          <>
            <h3>Componentes principais</h3>
            {ytdlp && (
              <CartaoYtdlp componente={ytdlp} verificacao={verificacaoYtdlp} aoAbrirLink={abrirLink} />
            )}
            {ffmpeg && <CartaoFfmpeg componente={ffmpeg} aoAbrirLink={abrirLink} />}
            {avisoLink && (
              <p className="aviso" role="status">
                {avisoLink}
              </p>
            )}

            <ListaBibliotecas crates={licencas.resumo.crates} npm={licencas.resumo.npm} />

            <h3>Texto completo das licenças</h3>
            <button
              type="button"
              aria-expanded={mostrarTexto}
              aria-controls="licencas-texto-completo"
              onClick={() => setMostrarTexto((v) => !v)}
            >
              {mostrarTexto ? "Ocultar texto completo" : "Mostrar texto completo das licenças"}
            </button>
            {mostrarTexto && (
              <pre
                id="licencas-texto-completo"
                className="licencas-texto"
                tabIndex={0}
                aria-label="Texto completo das licenças de terceiros"
              >
                {licencas.textoCompleto}
              </pre>
            )}
          </>
        )}

        <p className="sobre-nota">
          O Clipora não é afiliado ao Instagram, ao TikTok, ao yt-dlp nem ao FFmpeg.
        </p>
      </div>
    </div>
  );
}

type AoAbrirLink = (componenteId: string, tipo: TipoLinkLicenca, url: string) => void;

function Endereco({
  rotulo,
  url,
  aoAbrir,
}: {
  rotulo: string;
  url: string;
  /** Ausente quando o endereço não está no resumo empacotado (o backend só
   * abre URLs de lá): então ele é exibido só para copiar. */
  aoAbrir?: () => void;
}) {
  return (
    <div className="endereco">
      {aoAbrir ? (
        <button type="button" className="botao-link" onClick={aoAbrir}>
          {rotulo}
        </button>
      ) : (
        <span>{rotulo}:</span>
      )}{" "}
      <code>{url}</code>
    </div>
  );
}

function CartaoYtdlp({
  componente,
  verificacao,
  aoAbrirLink,
}: {
  componente: ComponenteLicenca;
  verificacao: VerificacaoYtdlp | null;
  aoAbrirLink: AoAbrirLink;
}) {
  const emUso = verificacao?.versaoAtual ?? componente.versao;
  const atualizado = verificacao?.origem === "atualizada" && emUso !== componente.versao;
  const fonteAtualizada =
    atualizado && TAG_YTDLP.test(emUso)
      ? `https://github.com/yt-dlp/yt-dlp/releases/download/${emUso}/yt-dlp.tar.gz`
      : null;

  return (
    <section className="cartao-licenca" aria-label={`yt-dlp ${emUso}`}>
      <h4>
        yt-dlp {emUso}
        {atualizado ? " (atualizado pelo Clipora)" : ""}
      </h4>
      <p>Obtém o vídeo público a partir do link.</p>
      <p>
        Licença: GPL versão 3 ou posterior (programa executável); o código do próprio yt-dlp é de
        domínio público (Unlicense).
      </p>
      {fonteAtualizada ? (
        <>
          <Endereco rotulo="Código-fonte desta versão" url={fonteAtualizada} />
          <Endereco
            rotulo={`Código-fonte da versão incluída no Clipora (${componente.versao})`}
            url={componente.codigoFonte}
            aoAbrir={() => aoAbrirLink(componente.id, "codigoFonte", componente.codigoFonte)}
          />
        </>
      ) : (
        <Endereco
          rotulo="Abrir código-fonte desta versão"
          url={componente.codigoFonte}
          aoAbrir={() => aoAbrirLink(componente.id, "codigoFonte", componente.codigoFonte)}
        />
      )}
      <Endereco
        rotulo="Abrir página do projeto"
        url={componente.projeto}
        aoAbrir={() => aoAbrirLink(componente.id, "projeto", componente.projeto)}
      />
    </section>
  );
}

function CartaoFfmpeg({
  componente,
  aoAbrirLink,
}: {
  componente: ComponenteLicenca;
  aoAbrirLink: AoAbrirLink;
}) {
  return (
    <section className="cartao-licenca" aria-label={`FFmpeg ${componente.versao}`}>
      <h4>FFmpeg {componente.versao}</h4>
      <p>Junta o vídeo e o áudio sem perder qualidade.</p>
      <p>
        Este programa usa código do FFmpeg, licenciado sob a LGPLv2.1. O código-fonte exato está
        disponível no endereço abaixo. Os arquivos clipora-ffmpeg e clipora-ffprobe são o FFmpeg
        sem modificações.
      </p>
      <Endereco
        rotulo="Abrir código-fonte desta versão"
        url={componente.codigoFonte}
        aoAbrir={() => aoAbrirLink(componente.id, "codigoFonte", componente.codigoFonte)}
      />
      {componente.sha256Fonte && (
        <p className="sobre-nota">
          SHA-256 do código-fonte: <code>{componente.sha256Fonte}</code>
        </p>
      )}
      <Endereco
        rotulo="Abrir página do projeto"
        url={componente.projeto}
        aoAbrir={() => aoAbrirLink(componente.id, "projeto", componente.projeto)}
      />
    </section>
  );
}

function ListaBibliotecas({ crates, npm }: { crates: PacoteLicenca[]; npm: PacoteLicenca[] }) {
  const [filtro, setFiltro] = useState("");
  const idFiltro = useId();
  const todas = useMemo(
    () => [
      ...crates.map((p) => ({ ...p, origem: "Rust" })),
      ...npm.map((p) => ({ ...p, origem: "JavaScript" })),
    ],
    [crates, npm],
  );
  const termo = filtro.trim().toLowerCase();
  const visiveis = termo
    ? todas.filter((p) => `${p.nome} ${p.licenca}`.toLowerCase().includes(termo))
    : todas;
  const lgpl = crates.filter((p) => /\bLGPL/i.test(p.licenca));

  return (
    <>
      <h3>Bibliotecas de código aberto</h3>
      <p>
        O Clipora inclui {crates.length} {crates.length === 1 ? "biblioteca Rust" : "bibliotecas Rust"}{" "}
        e {npm.length} {npm.length === 1 ? "pacote JavaScript" : "pacotes JavaScript"}.
      </p>
      {lgpl.length > 0 && (
        <p className="sobre-nota">
          {lgpl.map((p) => p.nome).join(", ")}{" "}
          {lgpl.length === 1 ? "usa" : "usam"} a licença LGPL; o texto dela está no texto completo
          abaixo.
        </p>
      )}
      <label htmlFor={idFiltro}>Filtrar bibliotecas por nome ou licença</label>
      <input
        id={idFiltro}
        className="licencas-filtro"
        type="search"
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
      />
      <p className="sobre-nota" role="status">
        {visiveis.length === todas.length
          ? `${todas.length} itens`
          : `${visiveis.length} de ${todas.length} itens`}
      </p>
      <ul className="licencas-lista" tabIndex={0} aria-label="Bibliotecas e licenças">
        {visiveis.map((p) => (
          <li key={`${p.origem}:${p.nome}@${p.versao}`}>
            {p.nome} {p.versao} — {p.licenca}{" "}
            <span className="sobre-nota">({p.origem})</span>
          </li>
        ))}
      </ul>
    </>
  );
}
