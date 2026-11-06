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
    qualidadesYoutube: null,
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
    expect(estado).toEqual({ tipo: "pronto", previa, alturaYoutube: null });
    expect(podeSolicitarDownload(estado)).toBe(true);

    estado = reduzir(estado, { tipo: "download_iniciado", downloadId: "d1" });
    expect(estado).toEqual({
      tipo: "baixando",
      previa,
      downloadId: "d1",
      alturaYoutube: null,
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
      alturaYoutube: null,
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
    expect(estado).toEqual({ tipo: "pronto", previa: previaNova, alturaYoutube: null });
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
      alturaYoutube: null,
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

describe("recuperação de estado via obter_estado() ao abrir o app", () => {
  it("estado_recuperado com prévia leva direto a 'baixando' e aceita eventos normalmente", () => {
    const previa = previaFalsa(1);
    let estado: EstadoApp = reduzir(estadoInicial, {
      tipo: "estado_recuperado",
      downloadId: "d1",
      etapa: "baixando_video",
      percentual: 40,
      previa,
    });
    expect(estado).toEqual({
      tipo: "baixando",
      previa,
      downloadId: "d1",
      alturaYoutube: null,
      progresso: { etapa: "baixando_video", percentual: 40 },
      recuperado: true,
    });

    estado = reduzir(estado, {
      tipo: "download_concluido",
      downloadId: "d1",
      caminho: "/tmp/v.mp4",
      nomeArquivo: "v.mp4",
      renomeado: false,
    });
    expect(estado).toMatchObject({ tipo: "concluido", previa });
  });

  it("estado_recuperado sem prévia (contrato ainda não a envia) não quebra: fica em 'baixando' com previa null", () => {
    const estado = reduzir(estadoInicial, {
      tipo: "estado_recuperado",
      downloadId: "d1",
      etapa: "unindo",
      percentual: 80,
      previa: null,
    });
    expect(estado).toEqual({
      tipo: "baixando",
      previa: null,
      downloadId: "d1",
      alturaYoutube: null,
      progresso: { etapa: "unindo", percentual: 80 },
      recuperado: true,
    });

    // Eventos de progresso/conclusão continuam funcionando normalmente.
    const concluido = reduzir(estado, {
      tipo: "download_concluido",
      downloadId: "d1",
      caminho: "/tmp/v.mp4",
      nomeArquivo: "v.mp4",
      renomeado: false,
    });
    expect(concluido).toEqual({
      tipo: "concluido",
      previa: null,
      downloadId: "d1",
      alturaYoutube: null,
      resultado: { caminho: "/tmp/v.mp4", nomeArquivo: "v.mp4", renomeado: false },
    });
  });

  it("estado_recuperado é ignorado se o usuário já começou a interagir", () => {
    const carregando = reduzir(estadoInicial, {
      tipo: "previa_solicitada",
      requisicaoId: 1,
      url: "https://x",
    });
    const depois = reduzir(carregando, {
      tipo: "estado_recuperado",
      downloadId: "d1",
      etapa: "preparando",
      percentual: null,
      previa: null,
    });
    expect(depois).toEqual(carregando);
  });

  it("download_cancelado a partir de um download recuperado sem prévia volta para aguardando_link (defensivo)", () => {
    const recuperado: EstadoApp = {
      tipo: "baixando",
      previa: null,
      downloadId: "d1",
      progresso: { etapa: "preparando", percentual: null },
    };
    expect(reduzir(recuperado, { tipo: "download_cancelado", downloadId: "d1" })).toEqual({
      tipo: "aguardando_link",
    });
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
      alturaYoutube: null,
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

describe("edição do link invalida a prévia imediatamente (corrida debounce + Baixar)", () => {
  it("link_editado a partir de 'pronto' descarta a prévia e bloqueia o download", () => {
    const pronto: EstadoApp = { tipo: "pronto", previa: previaFalsa(1) };
    const depois = reduzir(pronto, { tipo: "link_editado" });
    expect(depois).toEqual({ tipo: "aguardando_link" });
    expect(podeSolicitarDownload(depois)).toBe(false);
  });

  it("link_editado durante carregando_previa faz a resposta antiga ser descartada", () => {
    let estado = reduzir(estadoInicial, { tipo: "previa_solicitada", requisicaoId: 1, url: "https://a" });
    estado = reduzir(estado, { tipo: "link_editado" });
    estado = reduzir(estado, { tipo: "previa_recebida", requisicaoId: 1, previa: previaFalsa(1) });
    expect(estado).toEqual({ tipo: "aguardando_link" });
  });

  it("link_editado é ignorado durante um download", () => {
    const baixando: EstadoApp = {
      tipo: "baixando",
      previa: previaFalsa(1),
      downloadId: "d1",
      progresso: { etapa: "preparando", percentual: null },
    };
    expect(reduzir(baixando, { tipo: "link_editado" })).toBe(baixando);
  });
});

describe("tentar novamente após erro de download", () => {
  it("download_iniciado a partir do erro de download com prévia volta a baixar a mesma prévia", () => {
    const previa = previaFalsa(1);
    const erro: EstadoApp = {
      tipo: "erro",
      erro: { codigo: "DOWNLOAD_FALHOU", mensagem: "x" },
      origem: "download",
      previa,
    };
    expect(reduzir(erro, { tipo: "download_iniciado", downloadId: "d2" })).toEqual({
      tipo: "baixando",
      previa,
      downloadId: "d2",
      alturaYoutube: null,
      progresso: { etapa: "preparando", percentual: null },
    });
  });

  it("download_iniciado a partir de um erro de prévia é ignorado", () => {
    const erro: EstadoApp = {
      tipo: "erro",
      erro: { codigo: "SEM_CONEXAO", mensagem: "x" },
      origem: "previa",
      previa: null,
    };
    expect(reduzir(erro, { tipo: "download_iniciado", downloadId: "d2" })).toBe(erro);
  });
});

describe("seleção de qualidade YouTube", () => {
  it("mantém altura exata na tentativa, erro e retentativa; edição de link a limpa", () => {
    const previa = previaFalsa(1, {
      plataforma: "youtube",
      qualidadesYoutube: [1080, 720],
      urlOriginal: "https://youtu.be/YE7VzlLtp-4",
    });
    let estado = reduzir(estadoInicial, { tipo: "previa_solicitada", requisicaoId: 1, url: previa.urlOriginal });
    estado = reduzir(estado, { tipo: "previa_recebida", requisicaoId: 1, previa });
    expect(estado).toMatchObject({ tipo: "pronto", alturaYoutube: null });
    estado = reduzir(estado, { tipo: "qualidade_youtube_alterada", altura: 720 });
    expect(estado).toMatchObject({ tipo: "pronto", alturaYoutube: 720 });
    estado = reduzir(estado, { tipo: "download_iniciado", downloadId: "d1" });
    expect(estado).toMatchObject({ tipo: "baixando", alturaYoutube: 720 });
    estado = reduzir(estado, {
      tipo: "download_erro", downloadId: "d1", erro: { codigo: "DOWNLOAD_FALHOU", mensagem: "x" },
    });
    expect(estado).toMatchObject({ tipo: "erro", alturaYoutube: 720 });
    estado = reduzir(estado, { tipo: "download_iniciado", downloadId: "d2" });
    expect(estado).toMatchObject({ tipo: "baixando", alturaYoutube: 720 });
    estado = reduzir(estado, { tipo: "download_erro", downloadId: "d2", erro: { codigo: "DOWNLOAD_FALHOU", mensagem: "x" } });
    estado = reduzir(estado, { tipo: "erro_reconhecido" });
    expect(estado).toMatchObject({ tipo: "pronto", alturaYoutube: 720 });
    expect(reduzir(estado, { tipo: "link_editado" })).toEqual({ tipo: "aguardando_link" });
  });

  it("não permite baixar prévia YouTube sem catálogo válido nem escolher altura ausente", () => {
    const previa = previaFalsa(1, { plataforma: "youtube", qualidadesYoutube: null });
    const pronto = reduzir(
      reduzir(estadoInicial, { tipo: "previa_solicitada", requisicaoId: 1, url: previa.urlOriginal }),
      { tipo: "previa_recebida", requisicaoId: 1, previa },
    );
    expect(podeSolicitarDownload(pronto)).toBe(false);
    expect(reduzir(pronto, { tipo: "download_iniciado", downloadId: "d1" })).toBe(pronto);
  });
});

describe("encerramento de download recuperado", () => {
  const recuperado: EstadoApp = {
    tipo: "baixando",
    previa: null,
    downloadId: "d1",
    progresso: { etapa: "unindo", percentual: 80 },
    recuperado: true,
  };

  it("volta para aguardando_link quando o download recuperado some de obter_estado()", () => {
    expect(reduzir(recuperado, { tipo: "download_recuperado_encerrado", downloadId: "d1" })).toEqual({
      tipo: "aguardando_link",
    });
  });

  it("é ignorado para outro downloadId ou para um download normal (não recuperado)", () => {
    expect(reduzir(recuperado, { tipo: "download_recuperado_encerrado", downloadId: "d2" })).toBe(
      recuperado,
    );
    const normal: EstadoApp = { ...recuperado, recuperado: undefined, previa: previaFalsa(1) };
    expect(reduzir(normal, { tipo: "download_recuperado_encerrado", downloadId: "d1" })).toBe(normal);
  });

  it("restaura conclusão persistida e permite identificar o download para abrir a pasta", () => {
    expect(
      reduzir(estadoInicial, {
        tipo: "download_resultado_recuperado",
        resultado: {
          downloadId: "d2",
          alturaYoutube: null,
          tipo: "concluido",
          caminho: "/Downloads/clip.mp4",
          nomeArquivo: "clip.mp4",
          renomeado: false,
        },
      }),
    ).toEqual({
      tipo: "concluido",
      previa: null,
      downloadId: "d2",
      alturaYoutube: null,
      resultado: { caminho: "/Downloads/clip.mp4", nomeArquivo: "clip.mp4", renomeado: false },
    });
  });

  it("restaura erro persistido como erro de download, sem estado de conclusão", () => {
    expect(
      reduzir(estadoInicial, {
        tipo: "download_resultado_recuperado",
        resultado: {
          downloadId: "d2",
          alturaYoutube: null,
          tipo: "erro",
          erro: { codigo: "DOWNLOAD_FALHOU", mensagem: "failed" },
        },
      }),
    ).toEqual({
      tipo: "erro",
      origem: "download",
      previa: null,
      erro: { codigo: "DOWNLOAD_FALHOU", mensagem: "failed" },
      alturaYoutube: null,
    });
  });

  it("ignora resultado terminal de outra execução em vez de declarar sucesso", () => {
    expect(
      reduzir(recuperado, {
        tipo: "download_resultado_recuperado",
        resultado: {
          downloadId: "antigo",
          alturaYoutube: null,
          tipo: "concluido",
          caminho: "/Downloads/antigo.mp4",
          nomeArquivo: "antigo.mp4",
          renomeado: false,
        },
      }),
    ).toBe(recuperado);
  });
});
