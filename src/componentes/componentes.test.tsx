import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { UsePastaDestinoRetorno } from "../estado/usePastaDestino";
import type { Previa } from "../tipos/contrato";
import { CampoLink } from "./CampoLink";
import { ConfiguracoesPainel } from "./ConfiguracoesPainel";
import { PreviaCard } from "./PreviaCard";
import { ProgressoDownloadView } from "./ProgressoDownload";

describe("ProgressoDownloadView (M2)", () => {
  it("determinado: barra com valor e percentual arredondado em pt-BR", () => {
    render(<ProgressoDownloadView progresso={{ etapa: "baixando_video", percentual: 42.567 }} />);
    const barra = screen.getByRole("progressbar", { name: /progresso do download/i });
    expect(barra).toHaveAttribute("value", "42.567");
    expect(barra).toHaveAttribute("aria-valuetext", "Baixando vídeo: 43%");
    expect(screen.getByText(/43%/)).toBeInTheDocument();
    expect(screen.queryByText(/42[.,]5/)).not.toBeInTheDocument();
  });

  it("indeterminado: barra sem valor", () => {
    render(<ProgressoDownloadView progresso={{ etapa: "preparando", percentual: null }} />);
    const barra = screen.getByRole("progressbar");
    expect(barra).not.toHaveAttribute("value");
    expect(barra).toHaveAttribute("aria-valuetext", "Preparando: em andamento");
  });

  it("anuncia em região live só a etapa; percentual e barra ficam fora dela", () => {
    render(<ProgressoDownloadView progresso={{ etapa: "unindo", percentual: 80 }} />);
    const regiao = screen.getByRole("status");
    expect(regiao).toHaveTextContent(/^Unindo vídeo e áudio$/);
    expect(within(regiao).queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("etapa desconhecida vinda do backend não quebra a tela", () => {
    render(
      <ProgressoDownloadView
        progresso={{ etapa: "outra" as unknown as "preparando", percentual: 10 }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Baixando");
  });
});

describe("PreviaCard (L1)", () => {
  const base: Previa = {
    requisicaoId: 1,
    urlOriginal: "u",
    urlNormalizada: "u",
    titulo: "T",
    plataforma: "tiktok",
    duracaoSegundos: 65,
    capaDataUrl: null,
  };

  it.each([
    "data:image/png;base64,AAAA",
    "data:image/jpeg;base64,AAAA",
    "data:image/webp;base64,AAAA",
  ])("aceita capa raster %s", (capa) => {
    const { container } = render(<PreviaCard previa={{ ...base, capaDataUrl: capa }} />);
    expect(container.querySelector("img")).toHaveAttribute("src", capa);
  });

  it.each([
    "data:image/svg+xml;base64,AAAA",
    "https://exemplo.com/capa.jpg",
    "javascript:alert(1)",
    "data:text/html;base64,AAAA",
  ])("rejeita capa %s e mostra o substituto", (capa) => {
    const { container } = render(<PreviaCard previa={{ ...base, capaDataUrl: capa }} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/capa não disponível/i)).toBeInTheDocument();
  });
});

describe("CampoLink (L2)", () => {
  it("liga a dica de bloqueio ao campo por aria-describedby", () => {
    render(<CampoLink valor="x" aoAlterar={() => {}} desabilitado temErro={false} />);
    const campo = screen.getByLabelText(/link do instagram/i);
    expect(campo).toHaveAttribute("aria-describedby", "campo-link-dica");
    expect(campo).toHaveAccessibleDescription("O link não pode ser alterado durante o download.");
  });

  it("sem bloqueio e sem erro não tem aria-describedby", () => {
    render(<CampoLink valor="" aoAlterar={() => {}} desabilitado={false} temErro={false} />);
    expect(screen.getByLabelText(/link do instagram/i)).not.toHaveAttribute("aria-describedby");
  });
});

describe("ConfiguracoesPainel (M3/L3)", () => {
  function pastaFalsa(over: Partial<UsePastaDestinoRetorno> = {}): UsePastaDestinoRetorno {
    return {
      pasta: { caminho: "/videos", estado: "valida" },
      erro: null,
      selecionando: false,
      alterar: vi.fn(),
      recarregar: vi.fn(),
      ...over,
    };
  }
  const props = { verificacaoYtdlp: null, falhaVerificacaoYtdlp: null };

  it("mostra os estados ausente e sem_permissao", () => {
    const { rerender } = render(
      <ConfiguracoesPainel
        pasta={pastaFalsa({ pasta: { caminho: "/sumiu", estado: "ausente" } })}
        bloqueado={false}
        {...props}
      />,
    );
    expect(screen.getByText("/sumiu")).toBeInTheDocument();
    expect(screen.getByText(/não existe mais/i)).toBeInTheDocument();

    rerender(
      <ConfiguracoesPainel
        pasta={pastaFalsa({ pasta: { caminho: "/trancada", estado: "sem_permissao" } })}
        bloqueado={false}
        {...props}
      />,
    );
    expect(screen.getByText(/não tem permissão/i)).toBeInTheDocument();
  });

  it("erro da pasta usa role=alert", () => {
    render(
      <ConfiguracoesPainel
        pasta={pastaFalsa({ erro: { codigo: "PASTA_SEM_PERMISSAO", mensagem: "x" } })}
        bloqueado={false}
        {...props}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/sem permissão/i);
  });

  it("desabilita 'Alterar pasta' durante o download, com a explicação", () => {
    render(<ConfiguracoesPainel pasta={pastaFalsa()} bloqueado {...props} />);
    const botao = screen.getByRole("button", { name: /alterar pasta/i, hidden: true });
    expect(botao).toBeDisabled();
    expect(botao).toHaveAccessibleDescription(/durante o download/i);
  });

  it("falha da verificação do yt-dlp é só uma nota discreta (sem alert)", () => {
    render(
      <ConfiguracoesPainel
        pasta={pastaFalsa()}
        bloqueado={false}
        verificacaoYtdlp={null}
        falhaVerificacaoYtdlp={{ codigo: "SEM_CONEXAO", mensagem: "x" }}
      />,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(/não foi possível verificar agora/i)).toBeInTheDocument();
  });
});
