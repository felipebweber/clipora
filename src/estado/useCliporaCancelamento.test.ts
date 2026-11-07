import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ServicoClipora } from "../servicos/tipos";
import type { EventoDownload, Previa } from "../tipos/contrato";
import { useClipora } from "./useClipora";

const URL_REEL = "https://www.instagram.com/reel/abc/";

function previaFalsa(overrides: Partial<Previa> = {}): Previa {
  return {
    requisicaoId: 1,
    urlOriginal: URL_REEL,
    urlNormalizada: URL_REEL,
    titulo: "Um vídeo",
    plataforma: "instagram",
    duracaoSegundos: 10,
    capaDataUrl: null,
    qualidadesYoutube: null,
    ...overrides,
  };
}

type Inicio = {
  downloadId: string;
  onEvento: (evento: EventoDownload) => void;
  resolver: () => void;
  rejeitar: (erro: unknown) => void;
};

/** Serviço em que cada chamada de iniciar_download fica pendente até o teste
 * decidir, e cada evento é emitido manualmente. */
function criarServico() {
  const inicios: Inicio[] = [];
  const servico: ServicoClipora = {
    obter_historico: vi.fn().mockResolvedValue([]),
    consultar_historico: vi.fn().mockResolvedValue(null),
    limpar_historico: vi.fn().mockResolvedValue(undefined),
    abrir_arquivo_download: vi.fn().mockResolvedValue(undefined),
    obter_previa: vi.fn().mockResolvedValue(previaFalsa()),
    iniciar_download: vi.fn(
      ({ downloadId, onEvento }: { downloadId: string; url: string; onEvento: (e: EventoDownload) => void }) =>
        new Promise<void>((resolver, rejeitar) => {
          inicios.push({ downloadId, onEvento, resolver, rejeitar });
        }),
    ),
    cancelar_download: vi.fn().mockResolvedValue(undefined),
    obter_estado: vi
      .fn()
      .mockResolvedValue({ download: null, atualizacaoEmAndamento: false, ultimoResultado: null }),
    abrir_pasta_download: vi.fn().mockResolvedValue(undefined),
    obter_pasta_destino: vi.fn(),
    selecionar_pasta_destino: vi.fn(),
    verificar_ytdlp: vi.fn(),
    atualizar_ytdlp: vi.fn(),
    obter_licencas: vi.fn(),
    abrir_link_licenca: vi.fn(),
  };
  return { servico, inicios };
}

async function liberar() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

async function prontoParaBaixar(servico: ServicoClipora, opcoes = {}) {
  const hook = renderHook(() => useClipora(servico, opcoes));
  await act(async () => {
    hook.result.current.aoAlterarLink(URL_REEL);
    hook.result.current.confirmarLink();
    await liberar();
  });
  await waitFor(() => expect(hook.result.current.estado.tipo).toBe("pronto"));
  return hook;
}

describe("useClipora: cancelamento do download", () => {
  it("mantém Cancelando… até o terminal e volta para a prévia sem erro", async () => {
    const { servico, inicios } = criarServico();
    const { result } = await prontoParaBaixar(servico);

    await act(async () => {
      result.current.baixar();
      await liberar();
    });
    await act(async () => {
      inicios[0].resolver();
      inicios[0].onEvento({ tipo: "progresso", etapa: "baixando_video", percentual: 20 });
      await liberar();
    });

    await act(async () => {
      result.current.cancelarDownload();
      await liberar();
    });
    expect(servico.cancelar_download).toHaveBeenCalledWith({ downloadId: inicios[0].downloadId });
    expect(result.current.estado).toMatchObject({ tipo: "baixando", cancelando: true });

    // Progresso atrasado não desfaz o Cancelando…
    await act(async () => {
      inicios[0].onEvento({ tipo: "progresso", etapa: "baixando_video", percentual: 30 });
      await liberar();
    });
    expect(result.current.estado).toMatchObject({ tipo: "baixando", cancelando: true });

    await act(async () => {
      inicios[0].onEvento({ tipo: "cancelado" });
      await liberar();
    });
    expect(result.current.estado).toEqual({
      tipo: "pronto",
      previa: previaFalsa(),
      alturaYoutube: null,
      cancelado: true,
    });
    expect(result.current.podeSolicitarDownload).toBe(true);
  });

  it("preserva a qualidade do YouTube escolhida para a nova tentativa", async () => {
    const { servico, inicios } = criarServico();
    const previa = previaFalsa({
      urlOriginal: "https://www.youtube.com/watch?v=abc",
      urlNormalizada: "https://www.youtube.com/watch?v=abc",
      plataforma: "youtube",
      qualidadesYoutube: [720, 360],
    });
    vi.mocked(servico.obter_previa).mockResolvedValue(previa);
    const { result } = renderHook(() => useClipora(servico));
    await act(async () => {
      result.current.aoAlterarLink(previa.urlOriginal);
      result.current.confirmarLink();
      await liberar();
    });
    await waitFor(() => expect(result.current.estado.tipo).toBe("pronto"));
    act(() => result.current.alterarQualidadeYoutube(360));

    await act(async () => {
      result.current.baixar();
      await liberar();
    });
    await act(async () => {
      inicios[0].resolver();
      result.current.cancelarDownload();
      await liberar();
    });
    await act(async () => {
      inicios[0].onEvento({ tipo: "cancelado" });
      await liberar();
    });
    expect(result.current.estado).toEqual({ tipo: "pronto", previa, alturaYoutube: 360, cancelado: true });

    await act(async () => {
      result.current.baixar();
      await liberar();
    });
    expect(servico.iniciar_download).toHaveBeenCalledTimes(2);
    expect(vi.mocked(servico.iniciar_download).mock.calls[1][0]).toMatchObject({ alturaYoutube: 360 });
    expect(inicios[1].downloadId).not.toBe(inicios[0].downloadId);
  });

  it("aguarda iniciar_download responder antes de pedir o cancelamento", async () => {
    const { servico, inicios } = criarServico();
    const { result } = await prontoParaBaixar(servico);
    await act(async () => {
      result.current.baixar();
      await liberar();
    });

    await act(async () => {
      result.current.cancelarDownload();
      await liberar();
    });
    expect(result.current.estado).toMatchObject({ tipo: "baixando", cancelando: true });
    expect(servico.cancelar_download).not.toHaveBeenCalled();

    await act(async () => {
      inicios[0].resolver();
      await liberar();
    });
    expect(servico.cancelar_download).toHaveBeenCalledTimes(1);
    expect(servico.cancelar_download).toHaveBeenCalledWith({ downloadId: inicios[0].downloadId });
  });

  it("cliques repetidos enviam um único pedido", async () => {
    const { servico, inicios } = criarServico();
    const { result } = await prontoParaBaixar(servico);
    await act(async () => {
      result.current.baixar();
      await liberar();
      inicios[0].resolver();
      await liberar();
    });
    await act(async () => {
      result.current.cancelarDownload();
      result.current.cancelarDownload();
      await liberar();
      result.current.cancelarDownload();
      await liberar();
    });
    expect(servico.cancelar_download).toHaveBeenCalledTimes(1);
  });

  it("falha no pedido mantém o acompanhamento e permite tentar cancelar de novo", async () => {
    const { servico, inicios } = criarServico();
    vi.mocked(servico.cancelar_download)
      .mockRejectedValueOnce({ codigo: "ERRO_INTERNO", mensagem: "x" })
      .mockResolvedValue(undefined);
    const { result } = await prontoParaBaixar(servico);
    await act(async () => {
      result.current.baixar();
      await liberar();
      inicios[0].resolver();
      await liberar();
    });

    await act(async () => {
      result.current.cancelarDownload();
      await liberar();
    });
    expect(result.current.estado.tipo).toBe("baixando");
    expect(result.current.estado).not.toHaveProperty("cancelando");
    expect(result.current.aviso).toMatch(/Não foi possível cancelar o download/);

    await act(async () => {
      result.current.cancelarDownload();
      await liberar();
    });
    expect(servico.cancelar_download).toHaveBeenCalledTimes(2);
    expect(result.current.estado).toMatchObject({ tipo: "baixando", cancelando: true });
  });

  it("conclusão concorrente vence o cancelamento", async () => {
    const { servico, inicios } = criarServico();
    const { result } = await prontoParaBaixar(servico);
    await act(async () => {
      result.current.baixar();
      await liberar();
      inicios[0].resolver();
      await liberar();
    });
    await act(async () => {
      result.current.cancelarDownload();
      await liberar();
    });
    await act(async () => {
      inicios[0].onEvento({ tipo: "concluido", caminho: "/d/v.mp4", nomeArquivo: "v.mp4", renomeado: false });
      await liberar();
    });
    expect(result.current.estado).toMatchObject({ tipo: "concluido", resultado: { nomeArquivo: "v.mp4" } });
  });

  it("cancelar com o seletor de pasta aberto impede a retentativa quando ele fecha", async () => {
    const { servico, inicios } = criarServico();
    let escolherPasta: (pasta: string | null) => void = () => {};
    vi.mocked(servico.selecionar_pasta_destino).mockImplementation(
      () => new Promise((resolve) => { escolherPasta = resolve; }),
    );
    const aoAlterarPasta = vi.fn();
    const { result } = await prontoParaBaixar(servico, { aoAlterarPasta });
    await act(async () => {
      result.current.baixar();
      await liberar();
      inicios[0].rejeitar({ codigo: "PASTA_NAO_DEFINIDA", mensagem: "x" });
      await liberar();
    });
    expect(servico.selecionar_pasta_destino).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.cancelarDownload();
      await liberar();
    });
    expect(result.current.estado).toMatchObject({ tipo: "baixando", cancelando: true });

    await act(async () => {
      escolherPasta("/escolhida");
      await liberar();
    });
    expect(servico.iniciar_download).toHaveBeenCalledTimes(1);
    expect(servico.cancelar_download).not.toHaveBeenCalled();
    expect(aoAlterarPasta).toHaveBeenCalledTimes(1);
    expect(result.current.estado).toEqual({ tipo: "pronto", previa: previaFalsa(), alturaYoutube: null, cancelado: true });
  });

  it("evento cancelado atrasado de um ID anterior não afeta o novo download", async () => {
    const { servico, inicios } = criarServico();
    const { result } = await prontoParaBaixar(servico);
    await act(async () => {
      result.current.baixar();
      await liberar();
      inicios[0].resolver();
      result.current.cancelarDownload();
      await liberar();
      inicios[0].onEvento({ tipo: "cancelado" });
      await liberar();
    });
    await act(async () => {
      result.current.baixar();
      await liberar();
      inicios[1].resolver();
      await liberar();
    });
    await act(async () => {
      inicios[0].onEvento({ tipo: "cancelado" });
      await liberar();
    });
    expect(result.current.estado).toMatchObject({ tipo: "baixando", downloadId: inicios[1].downloadId });
    expect(result.current.estado).not.toHaveProperty("cancelando");
  });

  it("recupera Cancelando… após recarga e mostra o cancelamento sem prévia", async () => {
    vi.useFakeTimers();
    try {
      const { servico } = criarServico();
      vi.mocked(servico.obter_estado)
        .mockResolvedValueOnce({
          download: { downloadId: "d7", alturaYoutube: null, etapa: "baixando_video", percentual: 40, cancelando: true },
          atualizacaoEmAndamento: false,
          ultimoResultado: null,
        })
        .mockResolvedValue({
          download: null,
          atualizacaoEmAndamento: false,
          ultimoResultado: { tipo: "cancelado", downloadId: "d7", alturaYoutube: null },
        });
      const { result } = renderHook(() => useClipora(servico, { intervaloRecuperacaoMs: 100 }));
      await act(async () => {});
      expect(result.current.estado).toMatchObject({ tipo: "baixando", recuperado: true, cancelando: true });

      await act(async () => vi.advanceTimersByTime(100));
      expect(result.current.estado).toEqual({ tipo: "aguardando_link", cancelado: true });
      expect(result.current.aviso).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ao abrir, mostra o último resultado cancelado", async () => {
    const { servico } = criarServico();
    vi.mocked(servico.obter_estado).mockResolvedValue({
      download: null,
      atualizacaoEmAndamento: false,
      ultimoResultado: { tipo: "cancelado", downloadId: "d8", alturaYoutube: null },
    });
    const { result } = renderHook(() => useClipora(servico));
    await waitFor(() => expect(result.current.estado).toEqual({ tipo: "aguardando_link", cancelado: true }));
  });

  it("download recuperado pode ser cancelado diretamente", async () => {
    const { servico } = criarServico();
    vi.mocked(servico.obter_estado).mockResolvedValue({
      download: { downloadId: "d9", alturaYoutube: null, etapa: "baixando_video", percentual: 10 },
      atualizacaoEmAndamento: false,
      ultimoResultado: null,
    });
    const { result } = renderHook(() => useClipora(servico, { intervaloRecuperacaoMs: 60_000 }));
    await waitFor(() => expect(result.current.estado.tipo).toBe("baixando"));
    await act(async () => {
      result.current.cancelarDownload();
      await liberar();
    });
    expect(servico.cancelar_download).toHaveBeenCalledWith({ downloadId: "d9" });
    expect(result.current.estado).toMatchObject({ tipo: "baixando", cancelando: true });
  });
});
