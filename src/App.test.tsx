import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App (fluxo completo com o serviço simulado)", () => {
  it(
    "permite colar um link, ver a prévia, baixar e abrir a pasta ao final",
    async () => {
      const usuario = userEvent.setup();
      render(<App />);

      const campo = screen.getByLabelText(/link do instagram reels ou do tiktok/i);
      await usuario.type(campo, "https://www.instagram.com/reel/abc123/");

      await waitFor(() => expect(screen.getByText(/carregando prévia/i)).toBeInTheDocument());

      await waitFor(
        () => expect(screen.getByRole("button", { name: /^baixar$/i })).toBeInTheDocument(),
        { timeout: 3000 },
      );
      expect(screen.getByText(/vídeo simulado de instagram/i)).toBeInTheDocument();

      await usuario.click(screen.getByRole("button", { name: /^baixar$/i }));

      // Durante o download o campo de link fica desabilitado (bloqueio de ação incompatível).
      expect(campo).toBeDisabled();

      await waitFor(
        () => expect(screen.getByRole("button", { name: /abrir pasta/i })).toBeInTheDocument(),
        { timeout: 5000 },
      );
      expect(screen.getByText(/download concluído/i)).toBeInTheDocument();
      expect(campo).not.toBeDisabled();
    },
    10_000,
  );

  it("mostra erro compreensível em português para um link inválido e permite corrigir", async () => {
    const usuario = userEvent.setup();
    render(<App />);

    const campo = screen.getByLabelText(/link do instagram reels ou do tiktok/i);
    await usuario.type(campo, "https://exemplo.com/algo");

    await waitFor(() =>
      expect(
        screen.getByText(/esse link não é do instagram reels ou do tiktok/i),
      ).toBeInTheDocument(),
    );

    await usuario.click(screen.getByRole("button", { name: /entendi/i }));
    expect(
      screen.queryByText(/esse link não é do instagram reels ou do tiktok/i),
    ).not.toBeInTheDocument();
    // O texto digitado permanece no campo, para o usuário poder corrigi-lo.
    expect(campo).toHaveValue("https://exemplo.com/algo");
  });
});
