import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HistoricoPainel } from "./HistoricoPainel";
import type { ItemHistorico } from "../tipos/contrato";

const item: ItemHistorico = {
  downloadId: "d1", urlOriginal: "https://www.instagram.com/reel/abc/", urlNormalizada: "https://www.instagram.com/reel/abc/",
  titulo: "Reel salvo", plataforma: "instagram", caminho: "/Downloads/reel.mp4", nomeArquivo: "reel.mp4", concluidoEm: 1_793_900_000_000, disponivel: true,
};
const padrao = {
  itens: [item], carregando: false, erro: null, duplicado: null,
  aoTentarNovamente: vi.fn(), aoLimpar: vi.fn(), aoAbrirArquivo: vi.fn(), aoAbrirPasta: vi.fn(), aoBaixarNovamente: vi.fn(),
};

describe("HistoricoPainel", () => {
  it("mantém a lista recolhida até expandir e oferece ações por ID", async () => {
    const usuario = userEvent.setup();
    render(<HistoricoPainel {...padrao} />);
    expect(screen.getByRole("button", { name: /abrir arquivo reel\.mp4/i })).not.toBeVisible();
    await usuario.click(screen.getByText(/histórico de downloads/i));
    await usuario.click(screen.getByRole("button", { name: /abrir arquivo reel\.mp4/i }));
    expect(padrao.aoAbrirArquivo).toHaveBeenCalledWith("d1");
  });

  it("pede confirmação antes de limpar e informa que os vídeos ficam no disco", async () => {
    const usuario = userEvent.setup();
    const aoLimpar = vi.fn(async () => true);
    render(<HistoricoPainel {...padrao} aoLimpar={aoLimpar} />);
    await usuario.click(screen.getByRole("button", { name: /limpar histórico/i }));
    expect(padrao.aoLimpar).not.toHaveBeenCalled();
    expect(screen.getByText(/os vídeos salvos não serão apagados/i)).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: /confirmar limpeza/i }));
    expect(aoLimpar).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /confirmar limpeza/i })).not.toBeInTheDocument();
  });

  it("mantém confirmação aberta se a limpeza falhar", async () => {
    const usuario = userEvent.setup();
    render(<HistoricoPainel {...padrao} aoLimpar={async () => false} />);
    await usuario.click(screen.getByRole("button", { name: /limpar histórico/i }));
    await usuario.click(screen.getByRole("button", { name: /confirmar limpeza/i }));
    expect(screen.getByRole("button", { name: /confirmar limpeza/i })).toBeInTheDocument();
  });

  it("mostra duplicidade sem bloquear novo download e oferece a cópia disponível", async () => {
    const usuario = userEvent.setup();
    render(<HistoricoPainel {...padrao} duplicado={item} />);
    expect(screen.getByText(/este vídeo já está no histórico/i)).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: /baixar novamente/i }));
    expect(padrao.aoBaixarNovamente).toHaveBeenCalledTimes(1);
    await usuario.click(screen.getByRole("button", { name: /abrir cópia/i }));
    expect(padrao.aoAbrirArquivo).toHaveBeenCalledWith("d1");
  });

  it("desabilita Baixar novamente quando o download não pode ser iniciado", async () => {
    render(<HistoricoPainel {...padrao} duplicado={item} baixarDesabilitado />);
    expect(screen.getByRole("button", { name: /baixar novamente/i })).toBeDisabled();
  });

  it("mostra fallback quando o timestamp do histórico está fora do intervalo de Date", async () => {
    const usuario = userEvent.setup();
    render(<HistoricoPainel {...padrao} itens={[{ ...item, concluidoEm: Number.MAX_VALUE }]} />);
    await usuario.click(screen.getByText(/histórico de downloads/i));
    expect(screen.getByText(/data indisponível/i)).toBeInTheDocument();
  });
});
