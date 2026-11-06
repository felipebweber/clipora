import { describe, expect, it } from "vitest";
import { ServicoCliporaSimulado } from "./simulado";
import type { ItemHistorico } from "../tipos/contrato";

describe("histórico simulado", () => {
  it("registra só conclusões, lista mais recentes primeiro e limpa só os registros", async () => {
    const servico = new ServicoCliporaSimulado({ atrasoPassoDownloadMs: 0 });
    servico.definirPastaParaTeste({ caminho: "/simulado/Downloads", estado: "valida" });
    const concluir = async (downloadId: string, url: string) => {
      await servico.iniciar_download({ downloadId, url, onEvento: () => {} });
    };

    await concluir("d1", "https://www.instagram.com/reel/abc/");
    expect(await servico.obter_historico()).toMatchObject([
      { downloadId: "d1", urlOriginal: "https://www.instagram.com/reel/abc/", plataforma: "instagram", disponivel: true },
    ] satisfies Partial<ItemHistorico>[]);

    await expect(concluir("d2", "https://www.instagram.com/reel/falha-download/")).rejects.toMatchObject({ codigo: "DOWNLOAD_FALHOU" });
    await concluir("d3", "https://www.tiktok.com/@p/video/123");
    expect((await servico.obter_historico()).map(({ downloadId }) => downloadId)).toEqual(["d3", "d1"]);

    await servico.limpar_historico();
    expect(await servico.obter_historico()).toEqual([]);
    await expect(servico.abrir_arquivo_download({ downloadId: "d1" })).resolves.toBeUndefined();
  });

  it("acha duplicidade por ID canônico e não confunde IDs diferentes", async () => {
    const servico = new ServicoCliporaSimulado({ atrasoPassoDownloadMs: 0 });
    servico.definirPastaParaTeste({ caminho: "/d", estado: "valida" });
    await servico.iniciar_download({ downloadId: "d1", url: "https://www.instagram.com/reel/abc/?igsh=old", onEvento: () => {} });

    expect(await servico.consultar_historico({ url: "https://instagram.com/reels/abc/#tracking" })).toMatchObject({ downloadId: "d1" });
    expect(await servico.consultar_historico({ url: "https://www.instagram.com/reel/different/" })).toBeNull();
  });

  it("preserva maiúsculas do shortcode, rejeita /tv e compara original e normalizada", async () => {
    const servico = new ServicoCliporaSimulado({ atrasoPassoDownloadMs: 0 });
    servico.definirPastaParaTeste({ caminho: "/d", estado: "valida" });
    const original = "http://instagram.com/reel/AbC/?utm_source=share";
    const previa = await servico.obter_previa({ url: original, requisicaoId: 1 });
    await servico.iniciar_download({ downloadId: "d1", url: original, onEvento: () => {} });
    expect(await servico.consultar_historico({ url: "https://instagram.com/reel/AbC?utm_source=x" })).toMatchObject({ downloadId: "d1" });
    expect(await servico.consultar_historico({ url: "https://instagram.com/reel/abc/" })).toBeNull();
    await expect(servico.consultar_historico({ url: "https://instagram.com/tv/AbC/" })).rejects.toMatchObject({ codigo: "LINK_INVALIDO" });

    const salvo = (await servico.obter_historico())[0];
    expect(salvo.urlOriginal).toBe(original);
    expect(salvo.urlNormalizada).toBe(previa.urlNormalizada);
  });

  it("mantém conclusão e abertura após falha simulada de gravação e recupera na retentativa de leitura", async () => {
    const servico = new ServicoCliporaSimulado({ atrasoPassoDownloadMs: 0, falhasPersistenciaHistoricoRestantes: 2 });
    servico.definirPastaParaTeste({ caminho: "/d", estado: "valida" });
    const eventos: unknown[] = [];
    await servico.iniciar_download({ downloadId: "d1", url: "https://instagram.com/reel/abc/", onEvento: (evento) => eventos.push(evento) });
    expect(eventos[eventos.length - 1]).toMatchObject({ tipo: "concluido" });
    expect((await servico.obter_estado()).ultimoResultado).toMatchObject({ downloadId: "d1", tipo: "concluido" });
    await expect(servico.abrir_arquivo_download({ downloadId: "d1" })).resolves.toBeUndefined();
    await expect(servico.obter_historico()).rejects.toMatchObject({ codigo: "HISTORICO_INDISPONIVEL" });
    expect(await servico.obter_historico()).toMatchObject([{ downloadId: "d1" }]);
  });

  it("mantém registro indisponível sem varrer ou procurar o arquivo", async () => {
    const servico = new ServicoCliporaSimulado({ atrasoPassoDownloadMs: 0 });
    servico.definirPastaParaTeste({ caminho: "/d", estado: "valida" });
    await servico.iniciar_download({ downloadId: "missing", url: "https://instagram.com/reel/arquivo-ausente/", onEvento: () => {} });
    expect(await servico.obter_historico()).toMatchObject([{ downloadId: "missing", disponivel: false }]);
    await expect(servico.abrir_arquivo_download({ downloadId: "missing" })).rejects.toMatchObject({ codigo: "ARQUIVO_AUSENTE" });
    await expect(servico.abrir_pasta_download({ downloadId: "missing" })).resolves.toBeUndefined();
  });

  it("segue os formatos aceitos de TikTok curto/canônico sem presumir equivalência", async () => {
    const servico = new ServicoCliporaSimulado({ atrasoPassoDownloadMs: 0 });
    servico.definirPastaParaTeste({ caminho: "/d", estado: "valida" });
    await servico.iniciar_download({ downloadId: "d1", url: "https://www.tiktok.com/@p/video/123", onEvento: () => {} });

    for (const url of [
      "https://m.tiktok.com/@p/video/123",
      "https://www.tiktok.com/@p/video/123",
    ]) {
      expect(await servico.consultar_historico({ url })).toMatchObject({ downloadId: "d1" });
    }
    for (const url of ["https://vm.tiktok.com/short-token/", "https://vt.tiktok.com/another-token/"]) {
      expect(await servico.consultar_historico({ url })).toBeNull();
    }
    for (const url of [
      "https://vm.tiktok.com/@p/video/123",
      "https://vt.tiktok.com/@p/video/123",
      "https://www.tiktok.com/@/video/123",
      "https://m.tiktok.com/@/video/123",
    ]) {
      await expect(servico.consultar_historico({ url })).rejects.toMatchObject({ codigo: "LINK_INVALIDO" });
    }
  });
});
