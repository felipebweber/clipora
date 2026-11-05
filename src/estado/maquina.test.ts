import { describe, expect, it } from "vitest";
import type { Previa } from "../tipos/contrato";
import {
  type EstadoApp,
  estadoInicial,
  podeAbrirPasta,
  podeEditarLink,
  podeSolicitarDownload,
  reduzir,
} from "./maquina";

function previaFalsa(requisicaoId: number, overrides: Partial<Previa> = {}): Previa {
  return {
    requisicaoId,
    urlOriginal: "https://www.instagram.com/reel/abc/",
    urlNormalizada: "https://www.instagram.com/reel/abc/",
    titulo: "Um título",
    plataforma: "instagram",
    duracaoSegundos: 12,
    capaDataUrl: "data:image/jpeg;base64,xyz",
    ...overrides,
  };
}

describe("estado inicial", () => {
  it("começa aguardando link", () => {
    expect(estadoInicial).toEqual({ tipo: "aguardando_link" });
  });
});

describe("fluxo feliz: link -> prévia -> download -> concluído", () => {
  it("percorre todos os estados na ordem esperada", () => {
    let estado: EstadoApp = estadoInicial;

    estado = reduzir(estado, { tipo: "previa_solicitada", requisicaoId: 1, url: "https://x" });
    expect(estado).toEqual({ tipo: "carregando_previa", requisicaoId: 1, url: "https://x" });

    const previa = previaFalsa(1);
    estado = reduzir(estado, { tipo: "previa_recebida", requisicaoId: 1, previa });
    expect(estado).toEqual({ tipo: "pronto", previa });
    expect(podeSolicitarDownload(estado)).toBe(true);

    estado = reduzir(estado, { tipo: "download_iniciado", downloadId: "d1" });
    expect(estado).toEqual({
      tipo: "baixando",
      previa,
      downloadId: "d1",
      progresso: { etapa: "preparando", percentual: null },
    });

    estado = reduzir(estado, {
      tipo: "download_progresso",
      downloadId: "d1",
      etapa: "baixando_video",
      percentual: 42,
      bytesBaixados: 420,
      bytesTotais: 1000,
    });
    expect(estado).toMatchObject({
      tipo: "baixando",
      progresso: { etapa: "baixando_video", percentual: 42 },
    });

    estado = reduzir(estado, {
      tipo: "download_concluido",
      downloadId: "d1",
      caminho: "/tmp/video.mp4",
      nomeArquivo: "video.mp4",
      renomeado: false,
    });
    expect(estado).toEqual({
      tipo: "concluido",
      previa,
      downloadId: "d1",
      resultado: { caminho: "/tmp/video.mp4", nomeArquivo: "video.mp4", renomeado: false },
    });
    expect(podeAbrirPasta(estado)).toBe(true);
  });
});

describe("bloqueio de ações incompatíveis", () => {
  it("não permite iniciar download sem prévia pronta", () => {
    const estado = reduzir(estadoInicial, { tipo: "download_iniciado", downloadId: "d1" });
    expect(estado).toEqual(estadoInicial);
  });

  it("não permite trocar o link durante um download", () => {
    const previa = previaFalsa(1);
    const baixando: EstadoApp = {
      tipo: "baixando",
      previa,
      downloadId: "d1",
      progresso: { etapa: "preparando", percentual: null },
    };

    expect(podeEditarLink(baixando)).toBe(false);

    const aposLimpar = reduzir(baixando, { tipo: "link_limpo" });
    expect(aposLimpar).toEqual(baixando);

    const aposNovaPrevia = reduzir(baixando, {
      tipo: "previa_solicitada",
      requisicaoId: 99,
      url: "https://outro",
    });
    expect(aposNovaPrevia).toEqual(baixando);
  });

  it("não permite abrir pasta fora do estado concluído", () => {
    expect(podeAbrirPasta(estadoInicial)).toBe(false);
    expect(podeAbrirPasta({ tipo: "pronto", previa: previaFalsa(1) })).toBe(false);
  });

  it("progresso/conclusão/erro de um downloadId diferente do atual é ignorado", () => {
    const previa = previaFalsa(1);
    const baixando: EstadoApp = {
      tipo: "baixando",
      previa,
      downloadId: "d1",
      progresso: { etapa: "preparando", percentual: null },
    };

    expect(
      reduzir(baixando, {
        tipo: "download_progresso",
        downloadId: "outro-id",
        etapa: "unindo",
        percentual: 90,
      }),
    ).toEqual(baixando);

    expect(
      reduzir(baixando, {
        tipo: "download_concluido",
        downloadId: "outro-id",
        caminho: "x",
        nomeArquivo: "x",
        renomeado: false,
      }),
    ).toEqual(baixando);

    expect(
      reduzir(baixando, {
        tipo: "download_erro",
        downloadId: "outro-id",
        erro: { codigo: "DOWNLOAD_FALHOU", mensagem: "x" },
      }),
    ).toEqual(baixando);
  });
});

describe("respostas atrasadas de prévia", () => {
  it("ignora prévia recebida com requisicaoId antigo, mantendo o estado da requisição atual", () => {
    let estado: EstadoApp = reduzir(estadoInicial, {
      tipo: "previa_solicitada",
      requisicaoId: 1,
      url: "https://primeiro",
    });
    // Usuário mudou de ideia rápido e já disparou uma segunda prévia.
    estado = reduzir(estado, {
      tipo: "previa_solicitada",
      requisicaoId: 2,
      url: "https://segundo",
    });
    expect(estado).toEqual({ tipo: "carregando_previa", requisicaoId: 2, url: "https://segundo" });

    // A resposta atrasada da primeira (id 1) chega depois: deve ser ignorada.
    const previaAntiga = previaFalsa(1, { urlOriginal: "https://primeiro" });
    estado = reduzir(estado, { tipo: "previa_recebida", requisicaoId: 1, previa: previaAntiga });
    expect(estado).toEqual({ tipo: "carregando_previa", requisicaoId: 2, url: "https://segundo" });

    // A resposta da segunda chega e é aplicada normalmente.
    const previaNova = previaFalsa(2, { urlOriginal: "https://segundo" });
    estado = reduzir(estado, { tipo: "previa_recebida", requisicaoId: 2, previa: previaNova });
    expect(estado).toEqual({ tipo: "pronto", previa: previaNova });
  });

  it("ignora PREVIA_CANCELADA sempre, mesmo sem exibir erro", () => {
    const estado = reduzir(estadoInicial, {
      tipo: "previa_solicitada",
      requisicaoId: 1,
      url: "https://x",
    });
    const depois = reduzir(estado, {
      tipo: "previa_falhou",
      requisicaoId: 1,
      erro: { codigo: "PREVIA_CANCELADA", mensagem: "cancelado" },
    });
    expect(depois).toEqual(estado);
  });

  it("ignora falha de prévia com requisicaoId antigo", () => {
    let estado: EstadoApp = reduzir(estadoInicial, {
      tipo: "previa_solicitada",
      requisicaoId: 1,
      url: "https://primeiro",
    });
    estado = reduzir(estado, {
      tipo: "previa_solicitada",
      requisicaoId: 2,
      url: "https://segundo",
    });

    const depois = reduzir(estado, {
      tipo: "previa_falhou",
      requisicaoId: 1,
      erro: { codigo: "SEM_CONEXAO", mensagem: "x" },
    });
    expect(depois).toEqual(estado);
  });
});

describe("cancelamento do diálogo de pasta", () => {
  it("download_cancelado volta para pronto mantendo a prévia, sem passar por erro", () => {
    const previa = previaFalsa(1);
    const baixando: EstadoApp = {
      tipo: "baixando",
      previa,
      downloadId: "d1",
      progresso: { etapa: "preparando", percentual: null },
    };
    expect(reduzir(baixando, { tipo: "download_cancelado", downloadId: "d1" })).toEqual({
      tipo: "pronto",
      previa,
    });
  });

  it("download_cancelado com downloadId diferente é ignorado", () => {
    const previa = previaFalsa(1);
    const baixando: EstadoApp = {
      tipo: "baixando",
      previa,
      downloadId: "d1",
      progresso: { etapa: "preparando", percentual: null },
    };
    expect(reduzir(baixando, { tipo: "download_cancelado", downloadId: "outro" })).toEqual(baixando);
  });
});

describe("erros e recuperação", () => {
  it("falha de prévia com requisicaoId atual vai para erro sem prévia associada", () => {
    const carregando = reduzir(estadoInicial, {
      tipo: "previa_solicitada",
      requisicaoId: 1,
      url: "https://x",
    });
    const erro = reduzir(carregando, {
      tipo: "previa_falhou",
      requisicaoId: 1,
      erro: { codigo: "LOGIN_NECESSARIO", mensagem: "x" },
    });
    expect(erro).toEqual({
      tipo: "erro",
      erro: { codigo: "LOGIN_NECESSARIO", mensagem: "x" },
      origem: "previa",
      previa: null,
    });

    // Reconhecer o erro de prévia volta para aguardando_link.
    expect(reduzir(erro, { tipo: "erro_reconhecido" })).toEqual({ tipo: "aguardando_link" });
  });

  it("erro de download preserva a prévia e permite tentar novamente", () => {
    const previa = previaFalsa(1);
    const baixando: EstadoApp = {
      tipo: "baixando",
      previa,
      downloadId: "d1",
      progresso: { etapa: "baixando_video", percentual: 10 },
    };
    const erro = reduzir(baixando, {
      tipo: "download_erro",
      downloadId: "d1",
      erro: { codigo: "ESPACO_INSUFICIENTE", mensagem: "x" },
    });
    expect(erro).toEqual({
      tipo: "erro",
      erro: { codigo: "ESPACO_INSUFICIENTE", mensagem: "x" },
      origem: "download",
      previa,
    });

    const depois = reduzir(erro, { tipo: "erro_reconhecido" });
    expect(depois).toEqual({ tipo: "pronto", previa });
  });

  it("limpar o link a partir de um erro volta para aguardando_link", () => {
    const erro: EstadoApp = {
      tipo: "erro",
      erro: { codigo: "LINK_INVALIDO", mensagem: "x" },
      origem: "previa",
      previa: null,
    };
    expect(reduzir(erro, { tipo: "link_limpo" })).toEqual({ tipo: "aguardando_link" });
  });
});
