# Clipora

Clipora é um aplicativo desktop em desenvolvimento para baixar um vídeo público por vez de links compatíveis do Instagram Reels e TikTok. O processamento ocorre no computador. Consulte o [guia do usuário](docs/usuario/README.md) e o [estado da distribuição](docs/distribuicao.md).

## Pré-requisitos

- Node.js e pnpm (ambiente verificado: Node v26.12.1 e pnpm 10.32.1).
- Rust e Cargo 1.99.1, fixados por `rust-toolchain.toml`; instale localmente a toolchain quando necessário (os targets de compilação são instalados por alvo no CI).
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

O identificador `app.clipora.desktop` é provisório e depende de decisão antes da distribuição. Consulte [o contrato IPC](docs/contrato-ipc.md).

Os testes Rust (`pnpm test:rust`) desativam `externalBin` somente na configuração temporária do processo de teste e não exigem sidecars. Para executar ou empacotar o aplicativo, obtenha yt-dlp, FFmpeg/FFprobe e gere os avisos conforme [a documentação de distribuição](docs/distribuicao.md).
