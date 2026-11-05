import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import { ServicoCliporaSimulado } from "./servicos/simulado";
import type { EstadoPersistido, VerificacaoYtdlp } from "./tipos/contrato";

type OpcoesSimulado = ConstructorParameters<typeof ServicoCliporaSimulado>[0];

function criarSimulado(opcoes: OpcoesSimulado = {}) {
  return new ServicoCliporaSimulado({ atrasoPreviaMs: 5, atrasoPassoDownloadMs: 10, ...opcoes });
}

const COM_ATUALIZACAO: VerificacaoYtdlp = {
  versaoAtual: "2024.08.06",
  versaoDisponivel: "2025.10.22",
  atualizacaoDisponivel: true,
  origem: "empacotada",
  erroVerificacao: null,
};

const campoLink = () => screen.getByLabelText(/link do instagram reels ou do tiktok/i);
const botaoBaixar = () => screen.getByRole("button", { name: /^baixar$/i });
const avisoAtualizacao = () => screen.getByRole("region", { name: /atualização do yt-dlp/i });

async function colarLinkEAguardarPrevia(usuario: ReturnType<typeof userEvent.setup>, url: string) {
  await usuario.type(campoLink(), url);
  await waitFor(() => expect(botaoBaixar()).toBeEnabled(), { timeout: 3000 });
}

describe("App (fluxo completo com o serviço simulado)", () => {
  it(
    "permite colar um link, ver a prévia, baixar e abrir a pasta ao final",
    async () => {
      const usuario = userEvent.setup();
      render(<App servico={criarSimulado({ atrasoPreviaMs: 100 })} />);

      const campo = campoLink();
      await usuario.type(campo, "https://www.instagram.com/reel/abc123/");

      await waitFor(() => expect(screen.getByText(/carregando prévia/i)).toBeInTheDocument());
      await waitFor(() => expect(botaoBaixar()).toBeInTheDocument(), { timeout: 3000 });
      expect(screen.getByText(/vídeo simulado de instagram/i)).toBeInTheDocument();

      await usuario.click(botaoBaixar());

      // Durante o download o campo de link fica desabilitado (bloqueio de ação incompatível).
      expect(campo).toBeDisabled();

      await waitFor(
        () => expect(screen.getByRole("button", { name: /abrir pasta/i })).toBeInTheDocument(),
        { timeout: 5000 },
      );
      expect(screen.getByText(/download concluído/i)).toBeInTheDocument();
      expect(campo).not.toBeDisabled();
      // A pasta escolhida no fluxo de download aparece nas configurações (fonte única).
      expect(screen.getByText("/simulado/Downloads")).toBeInTheDocument();
    },
    10_000,
  );

  it("mostra erro compreensível em português para um link inválido e permite corrigir", async () => {
    const usuario = userEvent.setup();
    render(<App servico={criarSimulado()} />);

    const campo = campoLink();
    await usuario.type(campo, "https://exemplo.com/algo");

    await waitFor(() =>
      expect(screen.getByText(/esse link não é do instagram reels ou do tiktok/i)).toBeInTheDocument(),
    );
    // Link errado não adianta repetir: só "Entendi".
    expect(screen.queryByRole("button", { name: /tentar novamente/i })).not.toBeInTheDocument();

    await usuario.click(screen.getByRole("button", { name: /entendi/i }));
    expect(
      screen.queryByText(/esse link não é do instagram reels ou do tiktok/i),
    ).not.toBeInTheDocument();
    // O texto digitado permanece no campo, e o foco volta para ele.
    expect(campo).toHaveValue("https://exemplo.com/algo");
    expect(campo).toHaveFocus();
  });

  it("'Tentar novamente' após erro de prévia repete a solicitação", async () => {
    const usuario = userEvent.setup();
    const servico = criarSimulado();
    const espiao = vi.spyOn(servico, "obter_previa");
    render(<App servico={servico} />);

    await usuario.type(campoLink(), "https://www.instagram.com/reel/erro-rede/");
    const alerta = await screen.findByRole("alert", {}, { timeout: 3000 });
    expect(alerta).toHaveTextContent(/sem conexão com a internet/i);
    expect(espiao).toHaveBeenCalledTimes(1);

    await usuario.click(within(alerta).getByRole("button", { name: /tentar novamente/i }));
    await waitFor(() => expect(espiao).toHaveBeenCalledTimes(2));
    expect(espiao.mock.calls[1][0].url).toBe("https://www.instagram.com/reel/erro-rede/");
    expect(await screen.findByRole("alert")).toHaveTextContent(/sem conexão/i);
  });
});

describe("App: teclado e foco (M5)", () => {
  it(
    "fluxo só com teclado: o foco segue para o progresso e depois para 'Abrir pasta'",
    async () => {
      const usuario = userEvent.setup();
      render(<App servico={criarSimulado()} />);

      // Ao abrir, o foco já está no campo de link.
      expect(campoLink()).toHaveFocus();
      await usuario.keyboard("https://www.tiktok.com/@alguem/video/123");
      await waitFor(() => expect(botaoBaixar()).toBeEnabled(), { timeout: 3000 });
      expect(campoLink()).toHaveFocus(); // a prévia não rouba o foco de quem digita

      await usuario.tab();
      expect(botaoBaixar()).toHaveFocus();
      await usuario.keyboard("{Enter}");

      // O botão Baixar some; o foco vai para a área de progresso.
      const progresso = screen.getByLabelText(/download em andamento/i);
      expect(progresso).toHaveFocus();

      const abrir = await screen.findByRole("button", { name: /abrir pasta/i }, { timeout: 5000 });
      expect(abrir).toHaveFocus();
    },
    10_000,
  );

  it(
    "erro durante o download leva o foco para 'Tentar novamente', que repete o download",
    async () => {
      const usuario = userEvent.setup();
      const servico = criarSimulado();
      servico.definirPastaParaTeste({ caminho: "/d", estado: "valida" });
      const espiao = vi.spyOn(servico, "iniciar_download");
      render(<App servico={servico} />);

      await colarLinkEAguardarPrevia(usuario, "https://www.instagram.com/reel/falha-download/");
      await usuario.click(botaoBaixar());

      const tentar = await screen.findByRole("button", { name: /tentar novamente/i }, { timeout: 3000 });
      expect(tentar).toHaveFocus();
      expect(screen.getByRole("alert")).toHaveTextContent(/o download falhou/i);

      await usuario.click(tentar);
      expect(espiao).toHaveBeenCalledTimes(2);
      await screen.findByRole("button", { name: /tentar novamente/i }, { timeout: 3000 });
    },
    10_000,
  );
});

describe("App: aviso de nova versão do yt-dlp", () => {
  it(
    "mostra o aviso, só atualiza por ação do usuário e bloqueia Baixar durante a atualização",
    async () => {
      const usuario = userEvent.setup();
      const servico = criarSimulado({ verificacaoYtdlpInicial: COM_ATUALIZACAO, atrasoPassoDownloadMs: 40 });
      const verificar = vi.spyOn(servico, "verificar_ytdlp");
      const atualizar = vi.spyOn(servico, "atualizar_ytdlp");
      render(<App servico={servico} />);

      expect(await screen.findByText("Nova versão do yt-dlp disponível (2025.10.22).")).toBeInTheDocument();
      expect(atualizar).not.toHaveBeenCalled(); // nunca automático

      await colarLinkEAguardarPrevia(usuario, "https://www.instagram.com/reel/abc/");

      await usuario.click(within(avisoAtualizacao()).getByRole("button", { name: /^atualizar$/i }));
      expect(atualizar).toHaveBeenCalledWith(expect.objectContaining({ versaoEsperada: "2025.10.22" }));
      expect(within(avisoAtualizacao()).getByRole("status")).toHaveTextContent(/atualizando o yt-dlp/i);
      expect(within(avisoAtualizacao()).getByRole("progressbar")).toBeInTheDocument();
      expect(botaoBaixar()).toBeDisabled();
      expect(botaoBaixar()).toHaveAccessibleDescription(/aguarde a atualização/i);

      await waitFor(
        () => expect(avisoAtualizacao()).toHaveTextContent("yt-dlp atualizado para a versão 2025.10.22."),
        { timeout: 3000 },
      );
      expect(within(avisoAtualizacao()).queryByRole("button")).not.toBeInTheDocument();
      expect(botaoBaixar()).toBeEnabled();
      expect(screen.getByText(/^versão do yt-dlp/i)).toHaveTextContent("2025.10.22 (atualizada pelo Clipora)");
      expect(verificar).toHaveBeenCalledTimes(1);
    },
    10_000,
  );

  it(
    "desabilita Atualizar durante um download",
    async () => {
      const usuario = userEvent.setup();
      const servico = criarSimulado({ verificacaoYtdlpInicial: COM_ATUALIZACAO, atrasoPassoDownloadMs: 40 });
      servico.definirPastaParaTeste({ caminho: "/d", estado: "valida" });
      render(<App servico={servico} />);

      await colarLinkEAguardarPrevia(usuario, "https://www.instagram.com/reel/abc/");
      const atualizarBotao = within(avisoAtualizacao()).getByRole("button", { name: /^atualizar$/i });
      expect(atualizarBotao).toBeEnabled();

      await usuario.click(botaoBaixar());
      expect(atualizarBotao).toBeDisabled();
      expect(atualizarBotao).toHaveAccessibleDescription(/quando o download terminar/i);

      await screen.findByRole("button", { name: /abrir pasta/i }, { timeout: 5000 });
      expect(atualizarBotao).toBeEnabled();
    },
    10_000,
  );

  it("falha na atualização aparece no aviso e permite tentar de novo", async () => {
    const usuario = userEvent.setup();
    const servico = criarSimulado({
      verificacaoYtdlpInicial: COM_ATUALIZACAO,
      falhaAtualizacao: "ATUALIZACAO_INTEGRIDADE",
    });
    render(<App servico={servico} />);

    await usuario.click(await screen.findByRole("button", { name: /^atualizar$/i }));
    const alerta = await within(avisoAtualizacao()).findByRole("alert", {}, { timeout: 3000 });
    expect(alerta).toHaveTextContent(/não pôde ser verificada com segurança/i);
    expect(
      within(avisoAtualizacao()).getByRole("button", { name: /tentar atualizar novamente/i }),
    ).toBeEnabled();
  });

  it("falha da verificação não vira erro grande: sem aviso nem alerta, só uma nota discreta", async () => {
    const servico = criarSimulado({
      verificacaoYtdlpInicial: {
        ...COM_ATUALIZACAO,
        versaoDisponivel: null,
        atualizacaoDisponivel: false,
        erroVerificacao: { codigo: "SEM_CONEXAO", mensagem: "offline" },
      },
    });
    render(<App servico={servico} />);

    expect(await screen.findByText(/não foi possível verificar agora/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /atualização do yt-dlp/i })).not.toBeInTheDocument();
  });

  it("verificar_ytdlp rejeitado (ex.: YTDLP_INDISPONIVEL) também é só uma nota", async () => {
    const servico = criarSimulado();
    vi.spyOn(servico, "verificar_ytdlp").mockRejectedValue({ codigo: "YTDLP_INDISPONIVEL", mensagem: "x" });
    render(<App servico={servico} />);
    expect(await screen.findByText(/não foi possível verificar agora/i)).toBeInTheDocument();
    expect(screen.getByText(/^versão do yt-dlp/i)).toHaveTextContent("não identificada");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("App: recuperação ao abrir (obter_estado)", () => {
  it("retoma uma atualização em andamento e só verifica o yt-dlp quando ela termina", async () => {
    const servico = criarSimulado({ verificacaoYtdlpInicial: COM_ATUALIZACAO });
    let atualizando = true;
    vi.spyOn(servico, "obter_estado").mockImplementation(
      async (): Promise<EstadoPersistido> => ({ download: null, atualizacaoEmAndamento: atualizando }),
    );
    const verificar = vi.spyOn(servico, "verificar_ytdlp");
    render(<App servico={servico} intervaloRecuperacaoMs={20} />);

    expect(await screen.findByText(/atualizando o yt-dlp: em andamento/i)).toBeInTheDocument();
    expect(verificar).not.toHaveBeenCalled();

    atualizando = false;
    await waitFor(() => expect(verificar).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/nova versão do yt-dlp disponível/i)).toBeInTheDocument();
  });

  it("retoma um download em andamento sem prévia e avisa quando ele termina", async () => {
    const servico = criarSimulado();
    let ativo = true;
    vi.spyOn(servico, "obter_estado").mockImplementation(
      async (): Promise<EstadoPersistido> => ({
        download: ativo ? { downloadId: "d1", etapa: "baixando_audio", percentual: 60 } : null,
        atualizacaoEmAndamento: false,
      }),
    );
    render(<App servico={servico} intervaloRecuperacaoMs={20} />);

    expect(await screen.findByText(/continua em andamento/i)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "60");
    expect(campoLink()).toBeDisabled();

    ativo = false;
    expect(await screen.findByText(/foi encerrado/i)).toBeInTheDocument();
    expect(campoLink()).toBeEnabled();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});

describe("App: revisão de experiência (etapa 8)", () => {
  it("Enter no campo carrega a prévia na hora, sem esperar o debounce", async () => {
    const usuario = userEvent.setup();
    const servico = criarSimulado();
    const espiao = vi.spyOn(servico, "obter_previa");
    render(<App servico={servico} />);

    await usuario.click(campoLink());
    await usuario.paste("https://www.instagram.com/reel/abc/");
    await usuario.keyboard("{Enter}");
    expect(espiao).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(botaoBaixar()).toBeEnabled());

    // Enter de novo com a mesma prévia pronta não refaz a requisição.
    await usuario.keyboard("{Enter}");
    expect(espiao).toHaveBeenCalledTimes(1);
  });

  it("Esc com o foco no aviso de erro fecha o aviso", async () => {
    const usuario = userEvent.setup();
    render(<App servico={criarSimulado()} />);
    await usuario.click(campoLink());
    await usuario.paste("https://exemplo.com/x");
    await usuario.keyboard("{Enter}");
    const entendi = await screen.findByRole("button", { name: /entendi/i });
    entendi.focus();
    await usuario.keyboard("{Escape}");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(campoLink()).toHaveFocus();
  });

  it("componente ausente (YTDLP_INDISPONIVEL): só 'Entendi', a ação é reinstalar", async () => {
    const usuario = userEvent.setup();
    const servico = criarSimulado();
    vi.spyOn(servico, "obter_previa").mockRejectedValue({ codigo: "YTDLP_INDISPONIVEL", mensagem: "x" });
    render(<App servico={servico} />);
    await usuario.click(campoLink());
    await usuario.paste("https://www.instagram.com/reel/abc/");
    await usuario.keyboard("{Enter}");
    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent(/reinstale o clipora/i);
    expect(within(alerta).queryByRole("button", { name: /tentar novamente/i })).not.toBeInTheDocument();
  });

  it("atualização não suportada: sem botão de tentar de novo", async () => {
    const usuario = userEvent.setup();
    render(
      <App
        servico={criarSimulado({
          verificacaoYtdlpInicial: COM_ATUALIZACAO,
          falhaAtualizacao: "ATUALIZACAO_NAO_SUPORTADA",
        })}
      />,
    );
    await usuario.click(await screen.findByRole("button", { name: /^atualizar$/i }));
    await within(avisoAtualizacao()).findByRole("alert", {}, { timeout: 3000 });
    expect(within(avisoAtualizacao()).queryByRole("button")).not.toBeInTheDocument();
  });
});
