import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ServicoCliporaSimulado } from "../servicos/simulado";
import type { ServicoClipora } from "../servicos/tipos";
import type { EventoDownload, Previa } from "../tipos/contrato";
import { useClipora } from "./useClipora";

function previaFalsa(requisicaoId: number, overrides: Partial<Previa> = {}): Previa {
  return {
    requisicaoId,
    urlOriginal: "https://www.instagram.com/reel/abc/",
    urlNormalizada: "https://www.instagram.com/reel/abc/",
    titulo: "Um vídeo",
    plataforma: "instagram",
    duracaoSegundos: 10,
    capaDataUrl: null,
    ...overrides,
  };
}

/** Serviço totalmente controlável para testar ordenação e descarte sem
 * depender dos atrasos reais do ServicoCliporaSimulado. */
function criarServicoControlavel() {
  const resolucoesPrevia = new Map<number, { resolve: (p: Previa) => void; reject: (e: unknown) => void }>();
  const servico: ServicoClipora = {
    obter_previa: vi.fn(({ requisicaoId }: { url: string; requisicaoId: number }) => {
      return new Promise<Previa>((resolve, reject) => {
        resolucoesPrevia.set(requisicaoId, { resolve, reject });
      });
    }),
    iniciar_download: vi.fn(),
    obter_estado: vi.fn(),
    abrir_pasta_download: vi.fn().mockResolvedValue(undefined),
    obter_pasta_destino: vi.fn(),
    selecionar_pasta_destino: vi.fn(),
    verificar_ytdlp: vi.fn(),
    atualizar_ytdlp: vi.fn(),
  };
  return { servico, resolucoesPrevia };
}

describe("useClipora: edição de link e carregamento de prévia", () => {
  it("dispara a prévia após o debounce e aplica o resultado", async () => {
    vi.useFakeTimers();
    const { servico, resolucoesPrevia } = criarServicoControlavel();
    const { result } = renderHook(() => useClipora(servico));

    act(() => result.current.aoAlterarLink("https://www.instagram.com/reel/abc/"));
    expect(result.current.estado.tipo).toBe("aguardando_link"); // ainda no debounce

    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current.estado.tipo).toBe("carregando_previa");
    expect(servico.obter_previa).toHaveBeenCalledTimes(1);

    const previa = previaFalsa(1);
    await act(async () => {
      resolucoesPrevia.get(1)!.resolve(previa);
      await Promise.resolve();
    });
    expect(result.current.estado).toEqual({ tipo: "pronto", previa });

    vi.useRealTimers();
  });

  it("limpar o campo cancela o debounce e volta para aguardando_link imediatamente", () => {
    vi.useFakeTimers();
    const { servico } = criarServicoControlavel();
    const { result } = renderHook(() => useClipora(servico));

    act(() => result.current.aoAlterarLink("https://www.instagram.com/reel/abc/"));
    act(() => result.current.aoAlterarLink(""));
    expect(result.current.estado).toEqual({ tipo: "aguardando_link" });

    vi.advanceTimersByTime(1000);
    expect(servico.obter_previa).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("descarta a resposta atrasada de um link anterior mesmo quando ela chega depois da mais nova", async () => {
    vi.useFakeTimers();
    const { servico, resolucoesPrevia } = criarServicoControlavel();
    const { result } = renderHook(() => useClipora(servico));

    act(() => result.current.aoAlterarLink("https://www.instagram.com/reel/primeiro/"));
    await act(async () => vi.advanceTimersByTime(400));

    act(() => result.current.aoAlterarLink("https://www.instagram.com/reel/segundo/"));
    await act(async () => vi.advanceTimersByTime(400));

    expect(result.current.estado).toEqual({
      tipo: "carregando_previa",
      requisicaoId: 2,
      url: "https://www.instagram.com/reel/segundo/",
    });

    // A prévia da segunda (mais recente) chega primeiro.
    const previaSegunda = previaFalsa(2, { urlOriginal: "https://www.instagram.com/reel/segundo/" });
    await act(async () => {
      resolucoesPrevia.get(2)!.resolve(previaSegunda);
      await Promise.resolve();
    });
    expect(result.current.estado).toEqual({ tipo: "pronto", previa: previaSegunda });

    // A da primeira (antiga) chega atrasada: deve ser ignorada.
    const previaPrimeira = previaFalsa(1, { urlOriginal: "https://www.instagram.com/reel/primeiro/" });
    await act(async () => {
      resolucoesPrevia.get(1)!.resolve(previaPrimeira);
      await Promise.resolve();
    });
    expect(result.current.estado).toEqual({ tipo: "pronto", previa: previaSegunda });

    vi.useRealTimers();
  });

  it("bloqueia a edição do link durante um download", async () => {
    const servico = new ServicoCliporaSimulado({ atrasoPreviaMs: 1, atrasoPassoDownloadMs: 5 });
    servico.definirPastaParaTeste({ caminho: "/tmp/destino", estado: "valida" });
    const { result } = renderHook(() => useClipora(servico));

    await act(async () => {
      result.current.aoAlterarLink("https://www.instagram.com/reel/abc/");
      await new Promise((r) => setTimeout(r, 450));
    });
    expect(result.current.estado.tipo).toBe("pronto");

    act(() => result.current.baixar());
    expect(result.current.estado.tipo).toBe("baixando");
    expect(result.current.podeEditarLink).toBe(false);

    act(() => result.current.aoAlterarLink("https://www.instagram.com/reel/outro/"));
    expect(result.current.textoLink).toBe("https://www.instagram.com/reel/abc/"); // não foi alterado

    await waitFor(() => expect(result.current.estado.tipo).toBe("concluido"));
  });
});

describe("useClipora: fluxo de pasta de destino ao baixar", () => {
  it("quando a pasta não está definida, abre o seletor e tenta de novo se uma pasta for escolhida", async () => {
    const { servico } = criarServicoControlavel();
    const previa = previaFalsa(1);
    vi.mocked(servico.obter_previa).mockResolvedValue(previa);

    let primeiraTentativa = true;
    vi.mocked(servico.iniciar_download).mockImplementation(
      async ({ onEvento }: { downloadId: string; url: string; onEvento: (e: EventoDownload) => void }) => {
        if (primeiraTentativa) {
          primeiraTentativa = false;
          throw { codigo: "PASTA_NAO_DEFINIDA", mensagem: "x" };
        }
        onEvento({ tipo: "concluido", caminho: "/escolhida/v.mp4", nomeArquivo: "v.mp4", renomeado: false });
      },
    );
    vi.mocked(servico.selecionar_pasta_destino).mockResolvedValue("/escolhida");

    const { result } = renderHook(() => useClipora(servico));
    await act(async () => {
      result.current.aoAlterarLink("https://www.instagram.com/reel/abc/");
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.estado.tipo).toBe("pronto"));

    await act(async () => {
      result.current.baixar();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(servico.selecionar_pasta_destino).toHaveBeenCalledTimes(1);
    expect(servico.iniciar_download).toHaveBeenCalledTimes(2);
    expect(result.current.estado).toMatchObject({ tipo: "concluido" });
  });

  it("quando o usuário cancela o seletor de pasta, volta para pronto sem exibir erro", async () => {
    const { servico } = criarServicoControlavel();
    const previa = previaFalsa(1);
    vi.mocked(servico.obter_previa).mockResolvedValue(previa);
    vi.mocked(servico.iniciar_download).mockRejectedValue({
      codigo: "PASTA_AUSENTE",
      mensagem: "x",
    });
    vi.mocked(servico.selecionar_pasta_destino).mockResolvedValue(null);

    const { result } = renderHook(() => useClipora(servico));
    await act(async () => {
      result.current.aoAlterarLink("https://www.instagram.com/reel/abc/");
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.estado.tipo).toBe("pronto"));

    await act(async () => {
      result.current.baixar();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(servico.iniciar_download).toHaveBeenCalledTimes(1);
    expect(result.current.estado).toEqual({ tipo: "pronto", previa });
  });
});

describe("useClipora: abrir pasta", () => {
  it("chama abrir_pasta_download com o downloadId do download concluído", async () => {
    const servico = new ServicoCliporaSimulado({ atrasoPreviaMs: 1, atrasoPassoDownloadMs: 1 });
    servico.definirPastaParaTeste({ caminho: "/tmp/destino", estado: "valida" });
    const espiao = vi.spyOn(servico, "abrir_pasta_download");
    const { result } = renderHook(() => useClipora(servico));

    await act(async () => {
      result.current.aoAlterarLink("https://www.instagram.com/reel/abc/");
      await new Promise((r) => setTimeout(r, 50));
    });
    await waitFor(() => expect(result.current.estado.tipo).toBe("pronto"));

    act(() => result.current.baixar());
    await waitFor(() => expect(result.current.estado.tipo).toBe("concluido"));

    act(() => result.current.abrirPasta());
    expect(espiao).toHaveBeenCalledTimes(1);
    const estadoConcluido = result.current.estado;
    if (estadoConcluido.tipo === "concluido") {
      expect(espiao).toHaveBeenCalledWith({ downloadId: estadoConcluido.downloadId });
    }
  });

  it("não chama abrir_pasta_download fora do estado concluído", () => {
    const { servico } = criarServicoControlavel();
    const { result } = renderHook(() => useClipora(servico));
    act(() => result.current.abrirPasta());
    expect(servico.abrir_pasta_download).not.toHaveBeenCalled();
  });
});
