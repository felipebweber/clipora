import { afterEach, describe, expect, it, vi } from "vitest";

const { dentroDoTauri } = vi.hoisted(() => ({ dentroDoTauri: { valor: false } }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class {},
  isTauri: () => dentroDoTauri.valor,
}));

afterEach(() => {
  vi.resetModules();
});

describe("seleção do serviço (src/servicos/index.ts)", () => {
  it("usa o serviço simulado fora do Tauri (navegador e testes)", async () => {
    dentroDoTauri.valor = false;
    const modulo = await import("./index");
    expect(modulo.servico).toBeInstanceOf(modulo.ServicoCliporaSimulado);
  });

  it("usa o serviço real dentro da janela do Tauri", async () => {
    dentroDoTauri.valor = true;
    const modulo = await import("./index");
    expect(modulo.servico).toBeInstanceOf(modulo.ServicoCliporaTauri);
  });
});
