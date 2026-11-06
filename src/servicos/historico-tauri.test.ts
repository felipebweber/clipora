import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock, Channel: class {}, isTauri: () => true }));
import { ServicoCliporaTauri } from "./tauri";

beforeEach(() => invokeMock.mockReset());

describe("comandos de histórico", () => {
  it("usa os nomes e argumentos definidos no contrato IPC", async () => {
    invokeMock.mockResolvedValueOnce([]).mockResolvedValueOnce(null).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
    const servico = new ServicoCliporaTauri();
    await servico.obter_historico();
    await servico.consultar_historico({ url: "https://instagram.com/reel/abc/" });
    await servico.limpar_historico();
    await servico.abrir_arquivo_download({ downloadId: "download-1" });
    expect(invokeMock.mock.calls).toEqual([
      ["obter_historico", undefined],
      ["consultar_historico", { url: "https://instagram.com/reel/abc/" }],
      ["limpar_historico", undefined],
      ["abrir_arquivo_download", { downloadId: "download-1" }],
    ]);
  });
});
