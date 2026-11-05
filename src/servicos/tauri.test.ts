import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventoAtualizacao, EventoDownload } from "../tipos/contrato";

// Channel falso: guarda as instâncias criadas para o teste poder "enviar"
// mensagens pelo backend, chamando `onmessage` na ordem desejada.
const { invokeMock, canaisCriados, CanalFalso } = vi.hoisted(() => {
  const canaisCriados: Array<{
    onmessage: (m: unknown) => void;
    emit: (m: unknown) => void;
    close: () => void;
    fechado: boolean;
  }> = [];
  class CanalFalso<T> {
    onmessage: (mensagem: T) => void = () => {};
    fechado = false;

    emit(mensagem: T) {
      if (!this.fechado) this.onmessage(mensagem);
    }

    close() {
      this.fechado = true;
      // Simula o { end: true } do Tauri, que remove o callback registrado.
      this.onmessage = () => {};
    }

    constructor() {
      canaisCriados.push(this as unknown as (typeof canaisCriados)[number]);
    }
  }
  return { invokeMock: vi.fn(), canaisCriados, CanalFalso };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  Channel: CanalFalso,
  isTauri: () => false,
}));

import { ServicoCliporaTauri } from "./tauri";

beforeEach(() => {
  invokeMock.mockReset();
  canaisCriados.length = 0;
});

describe("ServicoCliporaTauri: nomes de comando e payloads exatos do contrato", () => {
  it("obter_previa envia { url, requisicaoId }", async () => {
    const previa = { requisicaoId: 3 };
    invokeMock.mockResolvedValue(previa);
    const servico = new ServicoCliporaTauri();
    await expect(servico.obter_previa({ url: "https://x", requisicaoId: 3 })).resolves.toBe(previa);
    expect(invokeMock).toHaveBeenCalledWith("obter_previa", { url: "https://x", requisicaoId: 3 });
  });

  it("comandos sem argumentos chamam invoke só com o nome", async () => {
    invokeMock.mockResolvedValue("ok");
    const servico = new ServicoCliporaTauri();
    await servico.obter_estado();
    await servico.obter_pasta_destino();
    await servico.selecionar_pasta_destino();
    await servico.verificar_ytdlp();
    expect(invokeMock.mock.calls).toEqual([
      ["obter_estado", undefined],
      ["obter_pasta_destino", undefined],
      ["selecionar_pasta_destino", undefined],
      ["verificar_ytdlp", undefined],
    ]);
  });

  it("abrir_pasta_download envia apenas { downloadId }", async () => {
    invokeMock.mockResolvedValue(null);
    await new ServicoCliporaTauri().abrir_pasta_download({ downloadId: "d1" });
    expect(invokeMock).toHaveBeenCalledWith("abrir_pasta_download", { downloadId: "d1" });
  });

  it("abrir_link_licenca envia o discriminante restrito da fonte atualizada", async () => {
    invokeMock.mockResolvedValue(null);
    await new ServicoCliporaTauri().abrir_link_licenca({
      componenteId: "yt-dlp",
      tipo: "codigoFonteAtualizada",
    });
    expect(invokeMock).toHaveBeenCalledWith("abrir_link_licenca", {
      componenteId: "yt-dlp",
      tipo: "codigoFonteAtualizada",
    });
  });

  it("iniciar_download envia { downloadId, url, onEvento: Channel }", async () => {
    invokeMock.mockResolvedValue(null);
    await new ServicoCliporaTauri().iniciar_download({
      downloadId: "d1",
      url: "https://www.tiktok.com/@a/video/1",
      onEvento: () => {},
    });
    expect(canaisCriados).toHaveLength(1);
    expect(invokeMock).toHaveBeenCalledWith("iniciar_download", {
      downloadId: "d1",
      url: "https://www.tiktok.com/@a/video/1",
      onEvento: canaisCriados[0],
    });
    expect(Object.keys(invokeMock.mock.calls[0][1]).sort()).toEqual(["downloadId", "onEvento", "url"]);
  });

  it("atualizar_ytdlp envia { versaoEsperada, onEvento: Channel } e devolve o resultado", async () => {
    invokeMock.mockResolvedValue({ versaoInstalada: "2025.01.01" });
    const resultado = await new ServicoCliporaTauri().atualizar_ytdlp({
      versaoEsperada: "2025.01.01",
      onEvento: () => {},
    });
    expect(resultado).toEqual({ versaoInstalada: "2025.01.01" });
    expect(invokeMock).toHaveBeenCalledWith("atualizar_ytdlp", {
      versaoEsperada: "2025.01.01",
      onEvento: canaisCriados[0],
    });
  });
});

describe("ServicoCliporaTauri: eventos pelo Channel", () => {
  it("repassa os eventos de download ao onEvento na ordem em que chegam", async () => {
    invokeMock.mockResolvedValue(null);
    const recebidos: EventoDownload[] = [];
    await new ServicoCliporaTauri().iniciar_download({
      downloadId: "d1",
      url: "https://x",
      onEvento: (e) => recebidos.push(e),
    });
    const enviados: EventoDownload[] = [
      { tipo: "progresso", etapa: "preparando", percentual: null },
      { tipo: "progresso", etapa: "baixando_video", percentual: 42.5, bytesBaixados: 10, bytesTotais: 20 },
      { tipo: "progresso", etapa: "unindo", percentual: 90 },
      { tipo: "concluido", caminho: "/d/v.mp4", nomeArquivo: "v.mp4", renomeado: true },
    ];
    for (const evento of enviados) canaisCriados[0].onmessage(evento);
    expect(recebidos).toEqual(enviados);
  });

  it("cria Channel novo após PASTA_* fechar o anterior e recebe progresso/conclusão na retentativa", async () => {
    invokeMock
      .mockImplementationOnce((_comando, args) => {
        args.onEvento.close();
        return Promise.reject({ codigo: "PASTA_NAO_DEFINIDA", mensagem: "x" });
      })
      .mockImplementationOnce((_comando, args) => {
        args.onEvento.emit({ tipo: "progresso", etapa: "baixando_video", percentual: 50 });
        args.onEvento.emit({
          tipo: "concluido",
          caminho: "/Downloads/clip.mp4",
          nomeArquivo: "clip.mp4",
          renomeado: false,
        });
        return Promise.resolve(null);
      });
    const servico = new ServicoCliporaTauri();
    const recebidos: EventoDownload[] = [];
    const onEvento = (evento: EventoDownload) => recebidos.push(evento);
    await expect(
      servico.iniciar_download({ downloadId: "d1", url: "u", onEvento }),
    ).rejects.toMatchObject({ codigo: "PASTA_NAO_DEFINIDA" });
    canaisCriados[0].emit({ tipo: "progresso", etapa: "baixando_video", percentual: 1 });
    expect(recebidos).toEqual([]); // canal fechado não pode entregar eventos tardios
    await servico.iniciar_download({ downloadId: "d1", url: "u", onEvento });

    expect(canaisCriados).toHaveLength(2);
    expect(canaisCriados[0].fechado).toBe(true);
    expect(invokeMock.mock.calls[0][1].onEvento).not.toBe(invokeMock.mock.calls[1][1].onEvento);
    expect(invokeMock.mock.calls.map(([, args]) => args.downloadId)).toEqual(["d1", "d1"]);
    expect(invokeMock.mock.calls[1][1].onEvento.onmessage).toBe(onEvento);
    expect(recebidos).toEqual([
      { tipo: "progresso", etapa: "baixando_video", percentual: 50 },
      {
        tipo: "concluido",
        caminho: "/Downloads/clip.mp4",
        nomeArquivo: "clip.mp4",
        renomeado: false,
      },
    ]);

    await servico.iniciar_download({ downloadId: "d2", url: "u", onEvento });
    expect(canaisCriados).toHaveLength(3); // canal novo para cada chamada IPC
  });

  it("repassa os eventos de atualização ao onEvento", async () => {
    let resolver: (v: unknown) => void = () => {};
    invokeMock.mockReturnValue(new Promise((r) => (resolver = r)));
    const recebidos: EventoAtualizacao[] = [];
    const promessa = new ServicoCliporaTauri().atualizar_ytdlp({
      versaoEsperada: "v",
      onEvento: (e) => recebidos.push(e),
    });
    canaisCriados[0].onmessage({ tipo: "progresso", etapa: "verificando", percentual: null });
    canaisCriados[0].onmessage({ tipo: "progresso", etapa: "instalando", percentual: null });
    resolver({ versaoInstalada: "v" });
    await promessa;
    expect(recebidos.map((e) => e.etapa)).toEqual(["verificando", "instalando"]);
  });
});

describe("ServicoCliporaTauri: conversão de erros rejeitados pelo invoke", () => {
  it("ErroClipora válido chega intacto (com detalhe)", async () => {
    const erro = { codigo: "YTDLP_INDISPONIVEL", mensagem: "missing", detalhe: "not found" };
    invokeMock.mockRejectedValue(erro);
    await expect(
      new ServicoCliporaTauri().obter_previa({ url: "u", requisicaoId: 1 }),
    ).rejects.toEqual(erro);
  });

  it("string (ex.: comando inexistente no runtime) vira ERRO_INTERNO com a mensagem original", async () => {
    invokeMock.mockRejectedValue("command obter_previa not found");
    await expect(new ServicoCliporaTauri().obter_estado()).rejects.toEqual({
      codigo: "ERRO_INTERNO",
      mensagem: "command obter_previa not found",
    });
  });

  it("objeto com código desconhecido vira ERRO_INTERNO", async () => {
    invokeMock.mockRejectedValue({ codigo: "QUALQUER", mensagem: "x" });
    await expect(new ServicoCliporaTauri().verificar_ytdlp()).rejects.toMatchObject({
      codigo: "ERRO_INTERNO",
    });
  });

  it("código válido sem mensagem é aceito com mensagem vazia; detalhe não-string é descartado", async () => {
    invokeMock.mockRejectedValue({ codigo: "SEM_CONEXAO", detalhe: 42 });
    await expect(new ServicoCliporaTauri().obter_pasta_destino()).rejects.toEqual({
      codigo: "SEM_CONEXAO",
      mensagem: "",
    });
  });

  it("null/undefined/Error viram ERRO_INTERNO com mensagem não vazia", async () => {
    for (const valor of [null, undefined, new Error("boom")]) {
      invokeMock.mockRejectedValueOnce(valor);
      const erro = await new ServicoCliporaTauri().selecionar_pasta_destino().catch((e) => e);
      expect(erro.codigo).toBe("ERRO_INTERNO");
      expect(erro.mensagem).not.toBe("");
    }
  });

  it("falha de iniciar_download e atualizar_ytdlp também é normalizada", async () => {
    invokeMock.mockRejectedValue({ foo: 1 });
    await expect(
      new ServicoCliporaTauri().iniciar_download({ downloadId: "d", url: "u", onEvento: () => {} }),
    ).rejects.toMatchObject({ codigo: "ERRO_INTERNO" });
    await expect(
      new ServicoCliporaTauri().atualizar_ytdlp({ versaoEsperada: "v", onEvento: () => {} }),
    ).rejects.toMatchObject({ codigo: "ERRO_INTERNO" });
  });
});

describe("ServicoCliporaTauri: licenças", () => {
  it("obter_licencas sem argumentos; LICENCAS_INDISPONIVEIS chega intacto", async () => {
    invokeMock.mockResolvedValueOnce({ resumo: {}, textoCompleto: "" });
    await new ServicoCliporaTauri().obter_licencas();
    expect(invokeMock).toHaveBeenCalledWith("obter_licencas", undefined);

    invokeMock.mockRejectedValueOnce({ codigo: "LICENCAS_INDISPONIVEIS", mensagem: "missing" });
    await expect(new ServicoCliporaTauri().obter_licencas()).rejects.toEqual({
      codigo: "LICENCAS_INDISPONIVEIS",
      mensagem: "missing",
    });
  });

  it("abrir_link_licenca envia só { componenteId, tipo } (nunca uma URL)", async () => {
    invokeMock.mockResolvedValue(null);
    await new ServicoCliporaTauri().abrir_link_licenca({ componenteId: "ffmpeg", tipo: "codigoFonte" });
    expect(invokeMock).toHaveBeenCalledWith("abrir_link_licenca", {
      componenteId: "ffmpeg",
      tipo: "codigoFonte",
    });
  });
});
