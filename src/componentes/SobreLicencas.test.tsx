import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "../App";
import { ehLicencasValidas } from "../estado/useLicencas";
import { ServicoCliporaSimulado } from "../servicos/simulado";
import type { VerificacaoYtdlp } from "../tipos/contrato";
import { SobreLicencas } from "./SobreLicencas";

const VERIFICACAO_EMPACOTADA: VerificacaoYtdlp = {
  versaoAtual: "2024.08.06",
  versaoDisponivel: null,
  atualizacaoDisponivel: false,
  origem: "empacotada",
  erroVerificacao: null,
};

function renderizar(
  opcoes: ConstructorParameters<typeof ServicoCliporaSimulado>[0] = {},
  verificacao: VerificacaoYtdlp | null = VERIFICACAO_EMPACOTADA,
) {
  const servico = new ServicoCliporaSimulado(opcoes);
  const aoFechar = vi.fn();
  render(<SobreLicencas servico={servico} aoFechar={aoFechar} verificacaoYtdlp={verificacao} />);
  return { servico, aoFechar };
}

describe("SobreLicencas: conteúdo", () => {
  it("mostra a versão do Clipora, yt-dlp e FFmpeg e o aviso de programas separados", async () => {
    renderizar();
    const dialogo = screen.getByRole("dialog", { name: "Sobre o Clipora" });
    expect(dialogo).toHaveAttribute("aria-modal", "true");
    expect(await screen.findByRole("region", { name: "yt-dlp 2024.08.06" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "FFmpeg 8.1.3" })).toBeInTheDocument();
    expect(screen.getByText(/Clipora 0\.1\.0/)).toBeInTheDocument();
    expect(dialogo).toHaveTextContent(/programas separados/);
    expect(dialogo).toHaveTextContent(/GPL versão 3/);
    expect(dialogo).toHaveTextContent(/LGPL versão 2\.1/);
    expect(dialogo).toHaveTextContent(
      "Este programa usa código do FFmpeg, licenciado sob a LGPLv2.1.",
    );
    expect(dialogo).toHaveTextContent("https://ffmpeg.org/releases/ffmpeg-8.1.3.tar.xz");
    expect(dialogo).toHaveTextContent(/não é afiliado/);
  });

  it("os links abrem via abrir_link_licenca(componenteId, tipo), nunca passando URL", async () => {
    const usuario = userEvent.setup();
    const { servico } = renderizar();
    const ffmpeg = await screen.findByRole("region", { name: "FFmpeg 8.1.3" });
    await usuario.click(within(ffmpeg).getByRole("button", { name: /código-fonte desta versão/i }));
    const ytdlp = screen.getByRole("region", { name: /yt-dlp/ });
    await usuario.click(within(ytdlp).getByRole("button", { name: /página do projeto/i }));
    expect(servico.linksAbertos).toEqual([
      { componenteId: "ffmpeg", tipo: "codigoFonte" },
      { componenteId: "yt-dlp", tipo: "projeto" },
    ]);
  });

  it("falha ao abrir o navegador mostra o endereço para copiar, sem bloquear", async () => {
    const usuario = userEvent.setup();
    const { servico } = renderizar();
    vi.spyOn(servico, "abrir_link_licenca").mockRejectedValue({ codigo: "ERRO_INTERNO", mensagem: "x" });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ffmpeg = await screen.findByRole("region", { name: "FFmpeg 8.1.3" });
    await usuario.click(within(ffmpeg).getByRole("button", { name: /código-fonte/i }));
    expect(
      await screen.findByText(
        "Não foi possível abrir o navegador. Copie o endereço: https://ffmpeg.org/releases/ffmpeg-8.1.3.tar.xz",
      ),
    ).toBeInTheDocument();
  });

  it("yt-dlp atualizado pelo app: mostra a versão em uso e o código-fonte daquela tag", async () => {
    renderizar(
      {},
      { ...VERIFICACAO_EMPACOTADA, versaoAtual: "2025.10.22", origem: "atualizada" },
    );
    const cartao = await screen.findByRole("region", { name: "yt-dlp 2025.10.22" });
    expect(cartao).toHaveTextContent("(atualizado pelo Clipora)");
    expect(cartao).toHaveTextContent(
      "https://github.com/yt-dlp/yt-dlp/releases/download/2025.10.22/yt-dlp.tar.gz",
    );
    // A URL da tag atualizada não está no resumo empacotado: só texto, sem botão.
    expect(within(cartao).getAllByRole("button").map((b) => b.textContent)).not.toContain(
      "Código-fonte desta versão",
    );
  });

  it("conta e filtra as bibliotecas e cita as que usam LGPL", async () => {
    const usuario = userEvent.setup();
    renderizar();
    expect(await screen.findByText(/3 bibliotecas Rust e 2 pacotes JavaScript/)).toBeInTheDocument();
    expect(screen.getByText(/sequoia-openpgp usa a licença LGPL/)).toBeInTheDocument();
    const lista = screen.getByRole("list", { name: "Bibliotecas e licenças" });
    expect(within(lista).getAllByRole("listitem")).toHaveLength(5);

    await usuario.type(screen.getByLabelText(/filtrar bibliotecas/i), "react");
    expect(within(lista).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("2 de 5 itens")).toBeInTheDocument();
  });

  it("texto completo: em <pre> focável, renderizado como texto (sem HTML)", async () => {
    const usuario = userEvent.setup();
    renderizar();
    const botao = await screen.findByRole("button", { name: /mostrar texto completo/i });
    expect(botao).toHaveAttribute("aria-expanded", "false");
    await usuario.click(botao);
    expect(botao).toHaveAttribute("aria-expanded", "true");

    const pre = screen.getByLabelText("Texto completo das licenças de terceiros");
    expect(pre.tagName).toBe("PRE");
    expect(pre).toHaveAttribute("tabindex", "0");
    expect(pre.textContent).toContain("<script>alert(");
    expect(pre.querySelector("script")).toBeNull();
    expect(pre).toHaveTextContent("GNU GENERAL PUBLIC LICENSE");
  });
});

describe("SobreLicencas: erros", () => {
  it("LICENCAS_INDISPONIVEIS: mensagem clara, versão do app ainda visível e 'Tentar novamente'", async () => {
    const usuario = userEvent.setup();
    const { servico } = renderizar({ licencasIndisponiveis: true });
    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Não foi possível carregar as informações de licença.");
    expect(alerta).toHaveTextContent(/reinstale o clipora/i);
    expect(screen.getByText(/Clipora 0\.1\.0/)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent(/programas separados/);

    const espiao = vi.spyOn(servico, "obter_licencas");
    await usuario.click(within(alerta).getByRole("button", { name: /tentar novamente/i }));
    expect(espiao).toHaveBeenCalledTimes(1);
  });

  it("resposta em formato inesperado vira erro, sem quebrar a tela", async () => {
    const servico = new ServicoCliporaSimulado();
    vi.spyOn(servico, "obter_licencas").mockResolvedValue({ foo: 1 } as never);
    render(<SobreLicencas servico={servico} aoFechar={() => {}} verificacaoYtdlp={null} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/não foi possível carregar/i);
  });

  it("ehLicencasValidas aceita o formato 1 e rejeita o resto", async () => {
    const licencas = await new ServicoCliporaSimulado().obter_licencas();
    expect(ehLicencasValidas(licencas)).toBe(true);
    expect(ehLicencasValidas(null)).toBe(false);
    expect(ehLicencasValidas({ resumo: licencas.resumo })).toBe(false);
    expect(ehLicencasValidas({ ...licencas, resumo: { ...licencas.resumo, crates: null } })).toBe(false);
  });
});

describe("SobreLicencas: teclado", () => {
  it("Esc fecha; Tab fica preso dentro do diálogo", async () => {
    const usuario = userEvent.setup();
    const { aoFechar } = renderizar();
    const dialogo = screen.getByRole("dialog");
    expect(dialogo).toHaveFocus();
    await screen.findByRole("region", { name: /FFmpeg/ });

    const fechar = screen.getByRole("button", { name: "Fechar" });
    await usuario.tab();
    expect(fechar).toHaveFocus();
    await usuario.tab({ shift: true });
    // Do primeiro elemento, Shift+Tab vai para o último focável do diálogo.
    expect(screen.getByRole("button", { name: /mostrar texto completo/i })).toHaveFocus();
    await usuario.tab();
    expect(fechar).toHaveFocus();

    await usuario.keyboard("{Escape}");
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("no App: abre por Configurações, deixa o resto inerte e devolve o foco ao fechar com Esc", async () => {
    const usuario = userEvent.setup();
    render(<App servico={new ServicoCliporaSimulado({ atrasoPreviaMs: 5 })} />);
    await usuario.click(screen.getByText("Configurações"));
    const abrir = screen.getByRole("button", { name: "Sobre e licenças" });
    expect(abrir).toHaveAttribute("aria-haspopup", "dialog");
    await usuario.click(abrir);

    expect(screen.getByRole("dialog", { name: "Sobre o Clipora" })).toBeInTheDocument();
    expect(document.querySelector("main")).toHaveAttribute("inert");

    await usuario.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.querySelector("main")).not.toHaveAttribute("inert");
    await waitFor(() => expect(abrir).toHaveFocus());
  });
});
