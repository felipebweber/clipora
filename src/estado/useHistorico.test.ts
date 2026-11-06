import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { ServicoCliporaSimulado } from "../servicos/simulado";
import type { ItemHistorico, Previa } from "../tipos/contrato";
import { HistoricoPainel } from "../componentes/HistoricoPainel";
import { useHistorico } from "./useHistorico";

const previa = (url: string): Previa => ({
  requisicaoId: 1, urlOriginal: url, urlNormalizada: url, titulo: "Vídeo", plataforma: "instagram", duracaoSegundos: null, capaDataUrl: null,
});
const item: ItemHistorico = {
  downloadId: "antigo", urlOriginal: "https://instagram.com/reel/old/", urlNormalizada: "https://instagram.com/reel/old/",
  titulo: null, plataforma: "instagram", caminho: "/d/old.mp4", nomeArquivo: "old.mp4", concluidoEm: 1, disponivel: true,
};

describe("useHistorico", () => {
  it("descarta a consulta de duplicidade do link anterior e comunica falha da consulta atual", async () => {
    const servico = new ServicoCliporaSimulado();
    let resolverAntigo: (item: ItemHistorico | null) => void = () => {};
    vi.spyOn(servico, "consultar_historico").mockImplementation(({ url }) => {
      if (url.endsWith("old/")) return new Promise((resolve) => { resolverAntigo = resolve; });
      return Promise.reject({ codigo: "HISTORICO_INDISPONIVEL", mensagem: "disk" });
    });
    const hook = renderHook(({ atual }) => useHistorico(servico, atual), { initialProps: { atual: previa("https://instagram.com/reel/old/") } });
    hook.rerender({ atual: previa("https://instagram.com/reel/new/") });
    await waitFor(() => expect(hook.result.current.erroConsultaDuplicidade).toMatch(/não foi possível conferir/i));
    await act(async () => { resolverAntigo(item); await Promise.resolve(); });
    expect(hook.result.current.duplicado).toBeNull();
    expect(hook.result.current.erroConsultaDuplicidade).toMatch(/não foi possível conferir/i);
  });

  it("não restaura uma lista antiga quando uma consulta termina depois da limpeza", async () => {
    const servico = new ServicoCliporaSimulado();
    let resolverLista: (items: ItemHistorico[]) => void = () => {};
    vi.spyOn(servico, "obter_historico").mockImplementationOnce(() => new Promise((resolve) => { resolverLista = resolve; }));
    const hook = renderHook(() => useHistorico(servico));
    await act(async () => { expect(await hook.result.current.limpar()).toBe(true); });
    await act(async () => { resolverLista([item]); await Promise.resolve(); });
    expect(hook.result.current.itens).toEqual([]);
  });

  it("adia recarga durante limpeza e usa snapshot posterior mesmo se a resposta antiga chegar atrasada", async () => {
    const servico = new ServicoCliporaSimulado();
    let resolverListaAntiga: (items: ItemHistorico[]) => void = () => {};
    let resolverLimpeza: () => void = () => {};
    const listar = vi.spyOn(servico, "obter_historico")
      .mockImplementationOnce(() => new Promise((resolve) => { resolverListaAntiga = resolve; }))
      .mockResolvedValueOnce([]);
    vi.spyOn(servico, "limpar_historico").mockImplementation(() => new Promise((resolve) => { resolverLimpeza = resolve; }));
    const hook = renderHook(() => useHistorico(servico));

    let promessaLimpeza!: Promise<boolean>;
    act(() => { promessaLimpeza = hook.result.current.limpar(); });
    await act(async () => { await hook.result.current.recarregar(); });
    expect(listar).toHaveBeenCalledTimes(1);
    await act(async () => { resolverListaAntiga([item]); await Promise.resolve(); });
    expect(hook.result.current.itens).toEqual([]);
    await act(async () => { resolverLimpeza(); await promessaLimpeza; });
    await waitFor(() => expect(listar).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(hook.result.current.itens).toEqual([]));
  });

  it("descarta duplicidade antiga que termina depois de limpar e trocar a prévia", async () => {
    const servico = new ServicoCliporaSimulado();
    let resolverDuplicidadeAntiga: (item: ItemHistorico | null) => void = () => {};
    let resolverLimpeza: () => void = () => {};
    const consultar = vi.spyOn(servico, "consultar_historico").mockImplementation(({ url }) => {
      if (url.endsWith("old/")) return new Promise((resolve) => { resolverDuplicidadeAntiga = resolve; });
      return Promise.resolve(null);
    });
    vi.spyOn(servico, "limpar_historico").mockImplementation(() => new Promise((resolve) => { resolverLimpeza = resolve; }));
    const hook = renderHook(({ atual }) => useHistorico(servico, atual), { initialProps: { atual: previa("https://instagram.com/reel/old/") } });
    expect(consultar).toHaveBeenCalledTimes(1);
    let promessaLimpeza!: Promise<boolean>;
    act(() => { promessaLimpeza = hook.result.current.limpar(); });
    hook.rerender({ atual: previa("https://instagram.com/reel/new/") });
    await act(async () => { resolverLimpeza(); await promessaLimpeza; });
    await waitFor(() => expect(consultar).toHaveBeenCalledTimes(2));
    await act(async () => { resolverDuplicidadeAntiga(item); await Promise.resolve(); });
    expect(hook.result.current.duplicado).toBeNull();
  });

  it("mantém os itens carregados visíveis se a limpeza falha", async () => {
    const servico = new ServicoCliporaSimulado();
    vi.spyOn(servico, "obter_historico").mockResolvedValue([item]);
    vi.spyOn(servico, "limpar_historico").mockRejectedValue({ codigo: "HISTORICO_INDISPONIVEL", mensagem: "disk" });
    const hook = renderHook(() => useHistorico(servico));
    await waitFor(() => expect(hook.result.current.itens).toEqual([item]));
    await act(async () => { expect(await hook.result.current.limpar()).toBe(false); });
    expect(hook.result.current.itens).toEqual([item]);
    expect(hook.result.current.erro).toMatch(/não foi possível limpar/i);
  });

  it("preserva erro de limpeza se recarga de conclusão foi adiada e termina com sucesso", async () => {
    const url = "https://instagram.com/reel/concorrente/";
    const servico = new ServicoCliporaSimulado({ atrasoPassoDownloadMs: 0 });
    servico.definirPastaParaTeste({ caminho: "/d", estado: "valida" });
    await servico.iniciar_download({ downloadId: "d-concorrente", url, onEvento: () => {} });
    const obterHistoricoReal = vi.spyOn(servico, "obter_historico");
    const limparReal = servico.limpar_historico.bind(servico);
    let rejeitarLimpeza!: (motivo: unknown) => void;
    vi.spyOn(servico, "limpar_historico")
      .mockImplementationOnce(() => new Promise((_, reject) => { rejeitarLimpeza = reject; }))
      .mockImplementation(limparReal);

    const hook = renderHook(() => useHistorico(servico));
    await waitFor(() => expect(hook.result.current.itens).toHaveLength(1));
    let promessaLimpeza!: Promise<boolean>;
    act(() => { promessaLimpeza = hook.result.current.limpar(); });
    await act(async () => { await hook.result.current.recarregar("registrar"); });
    await act(async () => {
      rejeitarLimpeza({ codigo: "HISTORICO_INDISPONIVEL", mensagem: "write denied" });
      expect(await promessaLimpeza).toBe(false);
    });

    await waitFor(() => expect(hook.result.current.carregando).toBe(false));
    expect(obterHistoricoReal).toHaveBeenCalledTimes(2);
    expect(hook.result.current.itens).toHaveLength(1);
    expect(hook.result.current.erro).toEqual(expect.stringMatching(/não foi possível limpar/i));
    expect(hook.result.current.contextoErro).toBe("limpar");

    await act(async () => { expect(await hook.result.current.limpar()).toBe(true); });
    expect(hook.result.current.itens).toEqual([]);
    expect(hook.result.current.erro).toBeNull();
    expect(hook.result.current.contextoErro).toBeNull();
  });

  it("remove erro persistente e atualiza a lista quando a consulta de duplicidade recupera a leitura", async () => {
    const servico = new ServicoCliporaSimulado();
    vi.spyOn(servico, "obter_historico")
      .mockRejectedValueOnce({ codigo: "HISTORICO_INDISPONIVEL", mensagem: "pending" })
      .mockResolvedValueOnce([item]);
    vi.spyOn(servico, "consultar_historico").mockResolvedValue(item);
    const hook = renderHook(({ atual }) => useHistorico(servico, atual), { initialProps: { atual: null as Previa | null } });
    await waitFor(() => expect(hook.result.current.erro).toMatch(/não foi possível carregar/i));
    hook.rerender({ atual: previa("https://instagram.com/reel/old/") });
    await waitFor(() => expect(hook.result.current.erro).toBeNull());
    expect(hook.result.current.duplicado).toEqual(item);
    expect(hook.result.current.itens).toEqual([item]);
  });

  it("refaz a duplicidade atual após retry real da lista que persiste o pendente", async () => {
    const url = "https://instagram.com/reel/pendente/";
    const servico = new ServicoCliporaSimulado({ atrasoPreviaMs: 0, atrasoPassoDownloadMs: 0, falhasPersistenciaHistoricoRestantes: 3 });
    servico.definirPastaParaTeste({ caminho: "/d", estado: "valida" });
    const previaAtual = await servico.obter_previa({ url, requisicaoId: 1 });
    await servico.iniciar_download({ downloadId: "d-pendente", url, onEvento: () => {} });
    const hook = renderHook(() => useHistorico(servico, previaAtual));
    await waitFor(() => expect(hook.result.current.erro).toMatch(/não foi possível carregar/i));
    await waitFor(() => expect(hook.result.current.erroConsultaDuplicidade).toMatch(/não foi possível conferir/i));

    await act(async () => { await hook.result.current.recarregar(); });
    await waitFor(() => expect(hook.result.current.itens).toHaveLength(1));
    await waitFor(() => expect(hook.result.current.duplicado?.downloadId).toBe("d-pendente"));
    expect(hook.result.current.erroConsultaDuplicidade).toBeNull();
    expect((await servico.obter_estado()).ultimoResultado).toMatchObject({ downloadId: "d-pendente", tipo: "concluido" });

    const painel = render(createElement(HistoricoPainel, {
      itens: hook.result.current.itens,
      carregando: hook.result.current.carregando,
      erro: hook.result.current.erro,
      duplicado: hook.result.current.duplicado,
      aoLimpar: hook.result.current.limpar,
      aoAbrirArquivo: hook.result.current.abrirArquivo,
      aoAbrirPasta: hook.result.current.abrirPasta,
      aoBaixarNovamente: () => {},
    }));
    expect(screen.getByRole("button", { name: /abrir cópia/i })).toBeEnabled();
    expect(screen.queryByText(/não foi possível conferir/i)).not.toBeInTheDocument();
    painel.unmount();
  });
});
