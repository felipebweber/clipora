import { describe, expect, it } from "vitest";
import type { EventoDownload } from "../tipos/contrato";
import { ServicoCliporaSimulado } from "./simulado";

function criarServico(overrides: ConstructorParameters<typeof ServicoCliporaSimulado>[0] = {}) {
  return new ServicoCliporaSimulado({
    atrasoPreviaMs: 1,
    atrasoPassoDownloadMs: 1,
    ...overrides,
  });
}

describe("ServicoCliporaSimulado.obter_previa", () => {
  it("resolve com os dados ecoados (requisicaoId, urls) após o atraso simulado", async () => {
    const servico = criarServico();
    const previa = await servico.obter_previa({
      url: "https://www.instagram.com/reel/abc/",
      requisicaoId: 7,
    });
    expect(previa.requisicaoId).toBe(7);
    expect(previa.urlOriginal).toBe("https://www.instagram.com/reel/abc/");
    expect(previa.plataforma).toBe("instagram");
    expect(previa.capaDataUrl).toMatch(/^data:image\//);
  });

  it("detecta plataforma tiktok pela URL", async () => {
    const servico = criarServico();
    const previa = await servico.obter_previa({
      url: "https://www.tiktok.com/@alguem/video/123",
      requisicaoId: 1,
    });
    expect(previa.plataforma).toBe("tiktok");
  });

  it("normaliza http para https na urlNormalizada, preservando urlOriginal", async () => {
    const servico = criarServico();
    const previa = await servico.obter_previa({
      url: "http://www.instagram.com/reel/abc/",
      requisicaoId: 1,
    });
    expect(previa.urlOriginal).toBe("http://www.instagram.com/reel/abc/");
    expect(previa.urlNormalizada).toBe("https://www.instagram.com/reel/abc/");
  });

  it("simula prévia sem capa com o marcador sem-capa", async () => {
    const servico = criarServico();
    const previa = await servico.obter_previa({
      url: "https://www.instagram.com/reel/sem-capa/",
      requisicaoId: 1,
    });
    expect(previa.capaDataUrl).toBeNull();
    expect(previa.titulo).not.toBeNull();
  });

  it("rejeita com o código de erro indicado pelo marcador na URL", async () => {
    const servico = criarServico();
    await expect(
      servico.obter_previa({ url: "https://instagram.com/reel/erro-login/", requisicaoId: 1 }),
    ).rejects.toMatchObject({ codigo: "LOGIN_NECESSARIO" });
  });

  it("cancela a prévia anterior com PREVIA_CANCELADA quando uma nova é solicitada", async () => {
    const servico = criarServico({ atrasoPreviaMs: 20 });
    const primeira = servico.obter_previa({ url: "https://instagram.com/reel/a/", requisicaoId: 1 });
    const segunda = servico.obter_previa({ url: "https://instagram.com/reel/b/", requisicaoId: 2 });

    await expect(primeira).rejects.toMatchObject({ codigo: "PREVIA_CANCELADA" });
    await expect(segunda).resolves.toMatchObject({ requisicaoId: 2 });
  });

  it("rejeita com TEMPO_ESGOTADO após o limite configurado", async () => {
    const servico = criarServico({ atrasoPreviaMs: 1000, tempoLimitePreviaMs: 5 });
    await expect(
      servico.obter_previa({ url: "https://instagram.com/reel/a/", requisicaoId: 1 }),
    ).rejects.toMatchObject({ codigo: "TEMPO_ESGOTADO" });
  });
});

describe("ServicoCliporaSimulado.iniciar_download", () => {
  it("rejeita com PASTA_NAO_DEFINIDA quando não há pasta configurada", async () => {
    const servico = criarServico();
    const eventos: EventoDownload[] = [];
    await expect(
      servico.iniciar_download({
        downloadId: "d1",
        url: "https://instagram.com/reel/a/",
        onEvento: (e) => eventos.push(e),
      }),
    ).rejects.toMatchObject({ codigo: "PASTA_NAO_DEFINIDA" });
    expect(eventos).toHaveLength(0);
  });

  it("emite eventos de progresso ordenados e termina em concluído", async () => {
    const servico = criarServico();
    servico.definirPastaParaTeste({ caminho: "/tmp/destino", estado: "valida" });
    const eventos: EventoDownload[] = [];

    await servico.iniciar_download({
      downloadId: "d1",
      url: "https://instagram.com/reel/a/",
      onEvento: (e) => eventos.push(e),
    });

    expect(eventos.length).toBeGreaterThan(1);
    expect(eventos[0]).toMatchObject({ tipo: "progresso", etapa: "preparando" });
    const ultimo = eventos[eventos.length - 1];
    expect(ultimo).toMatchObject({ tipo: "concluido", renomeado: false });
    if (ultimo.tipo === "concluido") {
      expect(ultimo.caminho).toContain("/tmp/destino/");
    }
    expect(await servico.obter_estado()).toMatchObject({
      ultimoResultado: {
        downloadId: "d1",
        tipo: "concluido",
        caminho: "/tmp/destino/Vídeo simulado de instagram.mp4",
        nomeArquivo: "Vídeo simulado de instagram.mp4",
        renomeado: false,
      },
    });

    // percentuais devem ser monotonicamente não-decrescentes
    const percentuais = eventos
      .filter((e): e is Extract<EventoDownload, { tipo: "progresso" }> => e.tipo === "progresso")
      .map((e) => e.percentual)
      .filter((p): p is number => p !== null);
    for (let i = 1; i < percentuais.length; i++) {
      expect(percentuais[i]).toBeGreaterThanOrEqual(percentuais[i - 1]);
    }
  });

  it("emite progresso com percentual null (indeterminado) com o marcador indeterminado", async () => {
    const servico = criarServico();
    servico.definirPastaParaTeste({ caminho: "/tmp/destino", estado: "valida" });
    const eventos: EventoDownload[] = [];

    await servico.iniciar_download({
      downloadId: "d1",
      url: "https://instagram.com/reel/indeterminado/",
      onEvento: (e) => eventos.push(e),
    });

    const algumIndeterminado = eventos.some((e) => e.tipo === "progresso" && e.percentual === null);
    expect(algumIndeterminado).toBe(true);
  });

  it("termina com evento de erro quando a URL simula falha de download", async () => {
    const servico = criarServico();
    servico.definirPastaParaTeste({ caminho: "/tmp/destino", estado: "valida" });
    const eventos: EventoDownload[] = [];

    await expect(
      servico.iniciar_download({
        downloadId: "d1",
        url: "https://instagram.com/reel/falha-download/",
        onEvento: (e) => eventos.push(e),
      }),
    ).rejects.toMatchObject({ codigo: "DOWNLOAD_FALHOU" });

    expect(eventos[eventos.length - 1]).toMatchObject({ tipo: "erro" });
    expect(await servico.obter_estado()).toMatchObject({
      ultimoResultado: {
        downloadId: "d1",
        tipo: "erro",
        erro: { codigo: "DOWNLOAD_FALHOU" },
      },
    });
  });
});

describe("fluxo de pasta de destino", () => {
  it("selecionar_pasta_destino retorna null quando cancelado e mantém a pasta anterior", async () => {
    const servico = criarServico();
    servico.proximaSelecaoDePasta = null;
    const resultado = await servico.selecionar_pasta_destino();
    expect(resultado).toBeNull();
    await expect(servico.obter_pasta_destino()).resolves.toMatchObject({ estado: "nao_definida" });
  });

  it("selecionar_pasta_destino persiste a pasta escolhida", async () => {
    const servico = criarServico();
    servico.proximaSelecaoDePasta = "/escolhida";
    const resultado = await servico.selecionar_pasta_destino();
    expect(resultado).toBe("/escolhida");
    await expect(servico.obter_pasta_destino()).resolves.toEqual({
      caminho: "/escolhida",
      estado: "valida",
    });
  });
});

describe("abrir_pasta_download", () => {
  it("rejeita downloadId desconhecido", async () => {
    const servico = criarServico();
    await expect(servico.abrir_pasta_download({ downloadId: "desconhecido" })).rejects.toMatchObject(
      { codigo: "ERRO_INTERNO" },
    );
  });

  it("resolve para um downloadId concluído com sucesso", async () => {
    const servico = criarServico();
    servico.definirPastaParaTeste({ caminho: "/tmp/destino", estado: "valida" });
    await servico.iniciar_download({
      downloadId: "d1",
      url: "https://instagram.com/reel/a/",
      onEvento: () => {},
    });
    await expect(servico.abrir_pasta_download({ downloadId: "d1" })).resolves.toBeUndefined();
  });
});
