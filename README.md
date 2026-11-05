# Clipora

Base de desenvolvimento do Clipora, aplicativo desktop para baixar vídeos públicos compatíveis do Instagram e TikTok. As funções de download ainda não foram implementadas.

## Pré-requisitos

- Node.js e pnpm (ambiente verificado: Node v26.12.1 e pnpm 10.32.1).
- Rust e Cargo (verificados: 1.99.1); carregue `source "$HOME/.cargo/env"` quando necessário.
- Dependências de desenvolvimento do Tauri v2 para seu sistema. No macOS, Xcode e suas ferramentas de linha de comando (verificado: Xcode 27.2, build 27B52).

## Desenvolvimento

```sh
source "$HOME/.cargo/env"
pnpm install
pnpm tauri dev
```

`pnpm dev` inicia apenas o frontend no Vite.

## Compilação e testes

```sh
pnpm typecheck
pnpm test
pnpm test:rust
pnpm build
```

`pnpm build` compila o frontend; `pnpm tauri build` também gera o aplicativo desktop, sujeito aos requisitos da plataforma.

O identificador `app.clipora.desktop` é provisório e depende de decisão do usuário antes da distribuição. Consulte [o contrato IPC previsto](docs/contrato-ipc.md); ele ainda não está implementado.
