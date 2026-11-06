import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ServicoCliporaSimulado } from "../servicos/simulado";
import type { ServicoClipora } from "../servicos/tipos";
import type { EventoDownload, Previa } from "../tipos/contrato";
import { AVISO_DOWNLOAD_RECUPERADO_ENCERRADO, useClipora } from "./useClipora";

function previaFalsa(requisicaoId: number, overrides: Partial<Previa> = {}): Previa {
  return {
    requisicaoId,
    urlOriginal: "https://www.instagram.com/reel/abc/",
    urlNormalizada: "https://www.instagram.com/reel/abc/",
    titulo: "Um vídeo",
    plataforma: "instagram",
    duracaoSegundos: 10,
    capaDataUrl: null,
    qualidadesYoutube: null,
    ...overrides,
  };
}

/** Serviço totalmente controlável para testar ordenação e descarte sem
 * depender dos atrasos reais do ServicoCliporaSimulado. */
function criarServicoControlavel() {
  const resolucoesPrevia = new Map<number, { resolve: (p: Previa) => void; reject: (e: unknown) => void }>();
  const servico: ServicoClipora = {
    obter_historico: vi.fn().mockResolvedValue([]),
    consultar_historico: vi.fn().mockResolvedValue(null),
    limpar_historico: vi.fn().mockResolvedValue(undefined),
    abrir_arquivo_download: vi.fn().mockResolvedValue(undefined),
    obter_previa: vi.fn(({ requisicaoId }: { url: string; requisicaoId: number }) => {
      return new Promise<Previa>((resolve, reject) => {
        resolucoesPrevia.set(requisicaoId, { resolve, reject });
      });
    }),
    iniciar_download: vi.fn(),
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
    expect(result.current.estado).toEqual({ tipo: "pronto", previa, alturaYoutube: null });

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
    expect(result.current.estado).toEqual({ tipo: "pronto", previa: previaSegunda, alturaYoutube: null });

    // A da primeira (antiga) chega atrasada: deve ser ignorada.
    const previaPrimeira = previaFalsa(1, { urlOriginal: "https://www.instagram.com/reel/primeiro/" });
    await act(async () => {
      resolucoesPrevia.get(1)!.resolve(previaPrimeira);
      await Promise.resolve();
    });
    expect(result.current.estado).toEqual({ tipo: "pronto", previa: previaSegunda, alturaYoutube: null });

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
    expect(result.current.estado).toEqual({ tipo: "pronto", previa, alturaYoutube: null });
  });
});

describe("useClipora: URL original no download", () => {
  it("envia a URL original, mantendo ao backend a escolha da forma normalizada", async () => {
    const { servico } = criarServicoControlavel();
    const original = "http://www.instagram.com/reel/AbC/?utm_source=share";
    const normalizada = "https://www.instagram.com/reel/AbC/?utm_source=share";
    vi.mocked(servico.obter_previa).mockResolvedValue(previaFalsa(1, { urlOriginal: original, urlNormalizada: normalizada }));
    const { result } = renderHook(() => useClipora(servico));
    await act(async () => { result.current.aoAlterarLink(original); await Promise.resolve(); });
    await waitFor(() => expect(result.current.estado.tipo).toBe("pronto"));
    act(() => result.current.baixar());
    expect(servico.iniciar_download).toHaveBeenCalledWith(expect.objectContaining({ url: original }));
  });
});

describe("useClipora: qualidade exata do YouTube", () => {
  const url = "https://youtu.be/YE7VzlLtp-4";
  const previaYoutube = (requisicaoId: number, qualidades: number[] | null = [1080, 720]): Previa => previaFalsa(requisicaoId, {
    urlOriginal: url,
    urlNormalizada: "https://www.youtube.com/watch?v=YE7VzlLtp-4",
    plataforma: "youtube",
    qualidadesYoutube: qualidades,
  });

  it("captura a altura escolhida no payload do download sem misturá-la com links de outras plataformas", async () => {
    const { servico } = criarServicoControlavel();
    Object.defineProperty(servico, "youtubeDownloadIntegrado", { value: true });
    vi.mocked(servico.obter_previa).mockResolvedValue(previaYoutube(1));
    const { result } = renderHook(() => useClipora(servico));
    await act(async () => { result.current.aoAlterarLink(url); await Promise.resolve(); });
    await waitFor(() => expect(result.current.estado.tipo).toBe("pronto"));
    act(() => result.current.alterarQualidadeYoutube(720));
    act(() => result.current.baixar());
    expect(servico.iniciar_download).toHaveBeenCalledWith(expect.objectContaining({ url, alturaYoutube: 720 }));

    const servicoInstagram = criarServicoControlavel().servico;
    vi.mocked(servicoInstagram.obter_previa).mockResolvedValue(previaFalsa(1));
    const instagram = renderHook(() => useClipora(servicoInstagram));
    await act(async () => { instagram.result.current.aoAlterarLink("https://www.instagram.com/reel/abc/"); await Promise.resolve(); });
    await waitFor(() => expect(instagram.result.current.estado.tipo).toBe("pronto"));
    act(() => instagram.result.current.baixar());
    expect(servicoInstagram.iniciar_download).toHaveBeenCalledTimes(1);
    expect(servicoInstagram.iniciar_download).toHaveBeenCalledWith(expect.not.objectContaining({ alturaYoutube: expect.anything() }));
  });

  it("preserva 720p na retentativa após escolher uma pasta", async () => {
    const { servico } = criarServicoControlavel();
    Object.defineProperty(servico, "youtubeDownloadIntegrado", { value: true });
    vi.mocked(servico.obter_previa)
      .mockResolvedValueOnce(previaYoutube(1))
      .mockResolvedValueOnce(previaYoutube(2, [1080]));
    let primeira = true;
    vi.mocked(servico.iniciar_download).mockImplementation(async ({ onEvento }) => {
      if (primeira) { primeira = false; throw { codigo: "PASTA_NAO_DEFINIDA", mensagem: "folder" }; }
      onEvento({ tipo: "concluido", caminho: "/d/v.mp4", nomeArquivo: "v.mp4", renomeado: false });
    });
    vi.mocked(servico.selecionar_pasta_destino).mockResolvedValue("/d");
    const { result } = renderHook(() => useClipora(servico));
    await act(async () => { result.current.aoAlterarLink(url); await Promise.resolve(); });
    await waitFor(() => expect(result.current.estado.tipo).toBe("pronto"));
    act(() => result.current.alterarQualidadeYoutube(720));
    await act(async () => { result.current.baixar(); await Promise.resolve(); await Promise.resolve(); });
    expect(vi.mocked(servico.iniciar_download).mock.calls.map(([args]) => args.alturaYoutube)).toEqual([720, 720]);
    expect(result.current.estado).toMatchObject({ tipo: "concluido", alturaYoutube: 720 });
  });

  it("atualiza o catálogo após QUALIDADE_INDISPONIVEL e volta a Melhor disponível", async () => {
    const { servico } = criarServicoControlavel();
    Object.defineProperty(servico, "youtubeDownloadIntegrado", { value: true });
    vi.mocked(servico.obter_previa)
      .mockResolvedValueOnce(previaYoutube(1))
      .mockResolvedValueOnce(previaYoutube(2, [1080]));
    vi.mocked(servico.iniciar_download).mockRejectedValue({ codigo: "QUALIDADE_INDISPONIVEL", mensagem: "changed" });
    const { result } = renderHook(() => useClipora(servico));
    await act(async () => { result.current.aoAlterarLink(url); await Promise.resolve(); });
    await waitFor(() => expect(result.current.estado.tipo).toBe("pronto"));
    act(() => result.current.alterarQualidadeYoutube(720));
    await act(async () => { result.current.baixar(); await Promise.resolve(); });
    await waitFor(() => expect(result.current.estado).toMatchObject({ tipo: "erro", erro: { codigo: "QUALIDADE_INDISPONIVEL" } }));

    act(() => result.current.atualizarPrevia());
    await waitFor(() => expect(result.current.estado).toMatchObject({ tipo: "pronto", alturaYoutube: null }));
    expect(result.current.estado).toMatchObject({ previa: { qualidadesYoutube: [1080] } });
  });

  it("mantém a qualidade selecionada no resultado concluído", async () => {
    const { servico } = criarServicoControlavel();
    Object.defineProperty(servico, "youtubeDownloadIntegrado", { value: true });
    vi.mocked(servico.obter_previa).mockResolvedValue(previaYoutube(1));
    vi.mocked(servico.iniciar_download).mockImplementation(async ({ onEvento }) => {
      onEvento({ tipo: "concluido", caminho: "/d/v.mp4", nomeArquivo: "v.mp4", renomeado: false });
    });
    const { result } = renderHook(() => useClipora(servico));
    await act(async () => { result.current.aoAlterarLink(url); await Promise.resolve(); });
    await waitFor(() => expect(result.current.estado.tipo).toBe("pronto"));
    act(() => result.current.alterarQualidadeYoutube(720));
    await act(async () => result.current.baixar());
    expect(result.current.estado).toMatchObject({ tipo: "concluido", alturaYoutube: 720 });
  });

  it("não permite baixar YouTube quando o backend ainda não integrou a tentativa ou não há catálogo", async () => {
    const { servico } = criarServicoControlavel();
    vi.mocked(servico.obter_previa).mockResolvedValue(previaYoutube(1, null));
    const { result } = renderHook(() => useClipora(servico));
    await act(async () => { result.current.aoAlterarLink(url); await Promise.resolve(); });
    await waitFor(() => expect(result.current.estado.tipo).toBe("pronto"));
    expect(result.current.podeSolicitarDownload).toBe(false);
    act(() => result.current.baixar());
    expect(servico.iniciar_download).not.toHaveBeenCalled();
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

/** Leva o hook até "pronto" com a prévia dada (serviço controlável). */
async function chegarEmPronto(
  servico: ServicoClipora,
  url = "https://www.instagram.com/reel/abc/",
) {
  vi.mocked(servico.obter_previa).mockResolvedValue(previaFalsa(1, { urlOriginal: url, urlNormalizada: url }));
  const aoAlterarPasta = vi.fn();
  const hook = renderHook(() => useClipora(servico, { aoAlterarPasta }));
  await act(async () => {
    hook.result.current.aoAlterarLink(url);
  });
  await waitFor(() => expect(hook.result.current.estado.tipo).toBe("pronto"), { timeout: 2000 });
  return { ...hook, aoAlterarPasta };
}

describe("useClipora: falhas no fluxo de pasta (H2)", () => {
  it("selecionar_pasta_destino rejeitando vira erro de download (sem ficar preso em 'baixando')", async () => {
    const { servico } = criarServicoControlavel();
    vi.mocked(servico.iniciar_download).mockRejectedValue({ codigo: "PASTA_NAO_DEFINIDA", mensagem: "x" });
    vi.mocked(servico.selecionar_pasta_destino).mockRejectedValue("dialog plugin crashed");
    const { result } = await chegarEmPronto(servico);

    await act(async () => {
      result.current.baixar();
    });

    await waitFor(() => expect(result.current.estado.tipo).toBe("erro"));
    expect(result.current.estado).toMatchObject({
      tipo: "erro",
      origem: "download",
      erro: { codigo: "ERRO_INTERNO", mensagem: "dialog plugin crashed" },
    });
  });

  it("repete o download no máximo uma vez após escolher a pasta e avisa a fonte da pasta", async () => {
    const { servico } = criarServicoControlavel();
    vi.mocked(servico.iniciar_download).mockRejectedValue({ codigo: "PASTA_SEM_PERMISSAO", mensagem: "x" });
    vi.mocked(servico.selecionar_pasta_destino).mockResolvedValue("/outra");
    const { result, aoAlterarPasta } = await chegarEmPronto(servico);

    await act(async () => {
      result.current.baixar();
    });

    await waitFor(() => expect(result.current.estado.tipo).toBe("erro"));
    expect(servico.iniciar_download).toHaveBeenCalledTimes(2);
    expect(servico.selecionar_pasta_destino).toHaveBeenCalledTimes(1);
    expect(aoAlterarPasta).toHaveBeenCalledTimes(1);
    // Mesmo ID nas duas tentativas, como pede o contrato.
    const [primeira, segunda] = vi.mocked(servico.iniciar_download).mock.calls;
    expect(segunda[0].downloadId).toBe(primeira[0].downloadId);
    expect(segunda[0].onEvento).toBe(primeira[0].onEvento);
    expect(result.current.estado).toMatchObject({ erro: { codigo: "PASTA_SEM_PERMISSAO" } });
  });
});

describe("useClipora: normalização de erros (M1)", () => {
  it("prévia rejeitada com algo que não é ErroClipora vira ERRO_INTERNO com mensagem não vazia", async () => {
    const { servico } = criarServicoControlavel();
    vi.mocked(servico.obter_previa).mockRejectedValue(new Error("falhou feio"));
    const { result } = renderHook(() => useClipora(servico));

    await act(async () => {
      result.current.aoAlterarLink("https://www.instagram.com/reel/abc/");
    });
    await waitFor(() => expect(result.current.estado.tipo).toBe("erro"), { timeout: 2000 });
    expect(result.current.estado).toMatchObject({
      erro: { codigo: "ERRO_INTERNO", mensagem: "falhou feio" },
    });
  });

  it("evento de erro malformado no canal vira ERRO_INTERNO", async () => {
    const { servico } = criarServicoControlavel();
    vi.mocked(servico.iniciar_download).mockImplementation(async ({ onEvento }) => {
      onEvento({ tipo: "erro", erro: { codigo: "NAO_EXISTE" } } as unknown as EventoDownload);
    });
    const { result } = await chegarEmPronto(servico);

    await act(async () => {
      result.current.baixar();
    });
    expect(result.current.estado).toMatchObject({ tipo: "erro", erro: { codigo: "ERRO_INTERNO" } });
  });
});

describe("useClipora: corrida entre debounce e Baixar (H3)", () => {
  it("editar o link invalida a prévia na hora: Baixar não baixa o vídeo anterior", async () => {
    const { servico } = criarServicoControlavel();
    const { result } = await chegarEmPronto(servico, "https://www.instagram.com/reel/aaa/");
    expect(result.current.podeSolicitarDownload).toBe(true);

    act(() => result.current.aoAlterarLink("https://www.instagram.com/reel/bbb/"));
    // Ainda dentro do debounce de 400 ms:
    expect(result.current.estado).toEqual({ tipo: "aguardando_link" });
    expect(result.current.podeSolicitarDownload).toBe(false);

    act(() => result.current.baixar());
    expect(servico.iniciar_download).not.toHaveBeenCalled();
  });

  it("A → B → A: a resposta atrasada do primeiro A não é aplicada enquanto o último A carrega", async () => {
    vi.useFakeTimers();
    const { servico, resolucoesPrevia } = criarServicoControlavel();
    const { result } = renderHook(() => useClipora(servico));
    const A = "https://www.instagram.com/reel/aaa/";
    const B = "https://www.instagram.com/reel/bbb/";

    for (const url of [A, B, A]) {
      act(() => result.current.aoAlterarLink(url));
      await act(async () => vi.advanceTimersByTime(400));
    }
    expect(result.current.estado).toEqual({ tipo: "carregando_previa", requisicaoId: 3, url: A });

    // Resposta atrasada do PRIMEIRO A (requisicaoId 1) — mesma URL, mas antiga.
    await act(async () => {
      resolucoesPrevia.get(1)!.resolve(previaFalsa(1, { urlOriginal: A, titulo: "antiga" }));
    });
    expect(result.current.estado).toEqual({ tipo: "carregando_previa", requisicaoId: 3, url: A });

    // B chega atrasado também e é ignorado.
    await act(async () => {
      resolucoesPrevia.get(2)!.resolve(previaFalsa(2, { urlOriginal: B }));
    });
    expect(result.current.estado.tipo).toBe("carregando_previa");

    const atual = previaFalsa(3, { urlOriginal: A, titulo: "atual" });
    await act(async () => {
      resolucoesPrevia.get(3)!.resolve(atual);
    });
    expect(result.current.estado).toEqual({ tipo: "pronto", previa: atual, alturaYoutube: null });
    vi.useRealTimers();
  });
});

describe("useClipora: tentar novamente (M6)", () => {
  it("erro de prévia: repete obter_previa com o link atual", async () => {
    const { servico } = criarServicoControlavel();
    const url = "https://www.instagram.com/reel/abc/";
    vi.mocked(servico.obter_previa)
      .mockRejectedValueOnce({ codigo: "SEM_CONEXAO", mensagem: "x" })
      .mockResolvedValueOnce(previaFalsa(2, { urlOriginal: url }));
    const { result } = renderHook(() => useClipora(servico));

    await act(async () => result.current.aoAlterarLink(url));
    await waitFor(() => expect(result.current.estado.tipo).toBe("erro"), { timeout: 2000 });

    await act(async () => result.current.tentarNovamente());
    expect(servico.obter_previa).toHaveBeenCalledTimes(2);
    expect(vi.mocked(servico.obter_previa).mock.calls[1][0]).toEqual({ url, requisicaoId: 2 });
    await waitFor(() => expect(result.current.estado.tipo).toBe("pronto"));
  });

  it("erro de download: inicia um novo download da mesma prévia", async () => {
    const { servico } = criarServicoControlavel();
    vi.mocked(servico.iniciar_download)
      .mockRejectedValueOnce({ codigo: "DOWNLOAD_FALHOU", mensagem: "x" })
      .mockImplementationOnce(async ({ onEvento }) => {
        onEvento({ tipo: "concluido", caminho: "/d/v.mp4", nomeArquivo: "v.mp4", renomeado: false });
      });
    const { result } = await chegarEmPronto(servico);

    await act(async () => result.current.baixar());
    expect(result.current.estado).toMatchObject({ tipo: "erro", origem: "download" });

    await act(async () => result.current.tentarNovamente());
    expect(servico.iniciar_download).toHaveBeenCalledTimes(2);
    const [primeira, segunda] = vi.mocked(servico.iniciar_download).mock.calls;
    expect(segunda[0].url).toBe(primeira[0].url);
    expect(segunda[0].downloadId).not.toBe(primeira[0].downloadId);
    expect(result.current.estado.tipo).toBe("concluido");
  });
});

describe("useClipora: abrir pasta com falha (M7)", () => {
  it("mostra um aviso não bloqueante em vez de engolir o erro", async () => {
    const { servico } = criarServicoControlavel();
    vi.mocked(servico.iniciar_download).mockImplementation(async ({ onEvento }) => {
      onEvento({ tipo: "concluido", caminho: "/d/v.mp4", nomeArquivo: "v.mp4", renomeado: false });
    });
    vi.mocked(servico.abrir_pasta_download).mockRejectedValue({ codigo: "PASTA_AUSENTE", mensagem: "x" });
    const { result } = await chegarEmPronto(servico);
    await act(async () => result.current.baixar());

    await act(async () => result.current.abrirPasta());
    expect(result.current.aviso).toBe(
      "Não foi possível abrir a pasta. A pasta de destino não existe mais. Escolha outra em Configurações.",
    );
    expect(result.current.estado.tipo).toBe("concluido"); // não bloqueia
  });
});

describe("useClipora: recuperação ao abrir (M4)", () => {
  it("ignora o resultado terminal da consulta inicial se o usuário já alterou o campo", async () => {
    const { servico } = criarServicoControlavel();
    let resolverEstado: (valor: Awaited<ReturnType<ServicoClipora["obter_estado"]>>) => void = () => {};
    vi.mocked(servico.obter_estado).mockReturnValue(
      new Promise((resolve) => {
        resolverEstado = resolve;
      }),
    );
    const { result } = renderHook(() => useClipora(servico));

    act(() => {
      result.current.aoAlterarLink("https://www.instagram.com/reel/a/");
      result.current.aoAlterarLink("");
    });
    await act(async () => {
      resolverEstado({
        download: null,
        atualizacaoEmAndamento: false,
        ultimoResultado: {
          downloadId: "antigo",
          alturaYoutube: null,
          tipo: "concluido",
          caminho: "/Downloads/antigo.mp4",
          nomeArquivo: "antigo.mp4",
          renomeado: false,
        },
      });
    });

    expect(result.current.estado).toEqual({ tipo: "aguardando_link" });
  });

  it("recupera o download ativo, acompanha por obter_estado() e encerra quando ele some", async () => {
    vi.useFakeTimers();
    const { servico } = criarServicoControlavel();
    vi.mocked(servico.obter_estado)
      .mockResolvedValueOnce({
        download: { downloadId: "d9", alturaYoutube: null, etapa: "baixando_video", percentual: 30 },
        atualizacaoEmAndamento: false,
        ultimoResultado: null,
      })
      .mockResolvedValueOnce({
        download: { downloadId: "d9", alturaYoutube: null, etapa: "unindo", percentual: 90 },
        atualizacaoEmAndamento: false,
        ultimoResultado: null,
      })
      .mockResolvedValue({ download: null, atualizacaoEmAndamento: false, ultimoResultado: null });

    const { result } = renderHook(() => useClipora(servico, { intervaloRecuperacaoMs: 100 }));
    await act(async () => {});
    expect(result.current.estado).toEqual({
      tipo: "baixando",
      previa: null,
      downloadId: "d9",
      alturaYoutube: null,
      progresso: { etapa: "baixando_video", percentual: 30 },
      recuperado: true,
    });
    expect(result.current.podeEditarLink).toBe(false);

    await act(async () => vi.advanceTimersByTime(100));
    expect(result.current.estado).toMatchObject({ progresso: { etapa: "unindo", percentual: 90 } });

    await act(async () => vi.advanceTimersByTime(100));
    expect(result.current.estado).toEqual({ tipo: "aguardando_link" });
    expect(result.current.aviso).toBe(AVISO_DOWNLOAD_RECUPERADO_ENCERRADO);
    vi.useRealTimers();
  });

  it("usa a prévia de obter_estado() quando o backend já a envia", async () => {
    const { servico } = criarServicoControlavel();
    const previa = previaFalsa(5);
    vi.mocked(servico.obter_estado).mockResolvedValue({
      download: { downloadId: "d1", alturaYoutube: null, etapa: "preparando", percentual: null, previa },
      atualizacaoEmAndamento: false,
      ultimoResultado: null,
    });
    const { result } = renderHook(() => useClipora(servico, { intervaloRecuperacaoMs: 60_000 }));
    await waitFor(() => expect(result.current.estado).toMatchObject({ tipo: "baixando", previa }));
  });

  it("falha de obter_estado() na abertura é silenciosa", async () => {
    const { servico } = criarServicoControlavel();
    vi.mocked(servico.obter_estado).mockRejectedValue("indisponível");
    const { result } = renderHook(() => useClipora(servico));
    await act(async () => {});
    expect(result.current.estado).toEqual({ tipo: "aguardando_link" });
  });
});
