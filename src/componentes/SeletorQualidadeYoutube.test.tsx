import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SeletorQualidadeYoutube } from "./SeletorQualidadeYoutube";

describe("SeletorQualidadeYoutube", () => {
  it("mostra Melhor compatível e somente alturas recebidas, incluindo o rótulo 4K", () => {
    render(
      <SeletorQualidadeYoutube alturas={[2160, 1440, 1080, 720]} altura={null} desabilitado={false} aoAlterar={() => {}} />,
    );

    const seletor = screen.getByRole("combobox", { name: "Qualidade" });
    expect(seletor).toHaveValue("");
    expect([...seletor.querySelectorAll("option")].map((opcao) => opcao.textContent)).toEqual([
      "Melhor compatível",
      "2160p (4K)",
      "1440p",
      "1080p",
      "720p",
    ]);
    expect(screen.queryByRole("option", { name: "4320p" })).not.toBeInTheDocument();
  });

  it("emite a altura exata escolhida e respeita o bloqueio de download", () => {
    const aoAlterar = vi.fn();
    const { rerender } = render(
      <SeletorQualidadeYoutube alturas={[1080, 720]} altura={null} desabilitado={false} aoAlterar={aoAlterar} />,
    );
    const seletor = screen.getByRole("combobox", { name: "Qualidade" });
    fireEvent.change(seletor, { target: { value: "720" } });
    expect(aoAlterar).toHaveBeenCalledWith(720);

    rerender(<SeletorQualidadeYoutube alturas={[1080, 720]} altura={720} desabilitado aoAlterar={aoAlterar} />);
    expect(screen.getByRole("combobox", { name: "Qualidade" })).toBeDisabled();
  });

  it("marca alturas sem H.264 e avisa quando uma delas é escolhida", () => {
    const { rerender } = render(
      <SeletorQualidadeYoutube
        alturas={[2160, 1080, 720]}
        compativeis={[1080, 720]}
        altura={null}
        desabilitado={false}
        aoAlterar={() => {}}
      />,
    );
    const seletor = screen.getByRole("combobox", { name: "Qualidade" });
    expect([...seletor.querySelectorAll("option")].map((opcao) => opcao.textContent)).toEqual([
      "Melhor compatível",
      "2160p (4K) · pode exigir VLC",
      "1080p",
      "720p",
    ]);
    expect(screen.queryByText(/pode não abrir/)).not.toBeInTheDocument();

    rerender(
      <SeletorQualidadeYoutube
        alturas={[2160, 1080, 720]}
        compativeis={[1080, 720]}
        altura={2160}
        desabilitado={false}
        aoAlterar={() => {}}
      />,
    );
    expect(screen.getByText(/pode não abrir no QuickTime/)).toBeInTheDocument();
  });

  it("sem lista de compatíveis (backend antigo) não marca nenhuma altura", () => {
    render(<SeletorQualidadeYoutube alturas={[2160, 1080]} altura={2160} desabilitado={false} aoAlterar={() => {}} />);
    expect(screen.queryByText(/VLC/)).not.toBeInTheDocument();
  });
});
