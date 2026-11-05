// Configuração global dos testes de frontend (Vitest + Testing Library).
// Carregado via `test.setupFiles` em vite.config.ts.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Sem `test.globals: true`, a limpeza automática do Testing Library não é
// registrada (ela depende de um `afterEach` global). Registramos aqui para
// que cada teste comece com o DOM limpo.
afterEach(() => {
  cleanup();
});
