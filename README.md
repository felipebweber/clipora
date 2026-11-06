# Clipora

Clipora é um aplicativo desktop em desenvolvimento para baixar um vídeo público por vez do Instagram Reels, TikTok e YouTube. No YouTube, aceita vídeos normais públicos sem login. O processamento ocorre no computador. Consulte o [guia do usuário](docs/usuario/README.md) e o [estado da distribuição](docs/distribuicao.md).

O app mantém no próprio dispositivo um histórico dos downloads concluídos. Você pode abrir um vídeo pelo histórico ou pela tela de conclusão. Se colar um link já baixado, o Clipora avisa e permite abrir o arquivo disponível ou baixar outra cópia. O histórico começa vazio: downloads anteriores não são importados nem procurados nas pastas. Limpar o histórico remove somente os registros; os vídeos salvos permanecem. Links, títulos, datas e caminhos do histórico ficam localmente no dispositivo e não são enviados pelo Clipora.

## Licença escolhida

O Clipora será publicado como open source sob **GPL-3.0-or-later** (GNU GPL versão 3 ou posterior), conforme decisão de Felipe em 2026-11-06. A aprovação e os itens a conferir antes da publicação estão em [Licenças, seção 6.1](docs/licencas.md#61-decisão-aprovada--2026-11-06). Os componentes de terceiros mantêm suas próprias licenças.

## Pré-requisitos

- Node.js e pnpm (ambiente verificado: Node v26.12.1 e pnpm 10.32.1).
- Rust e Cargo 1.99.1, fixados por `rust-toolchain.toml`; instale localmente a toolchain quando necessário (os targets de compilação são instalados por alvo no CI).
- Dependências de desenvolvimento do Tauri v2 para seu sistema. No macOS, Xcode e suas ferramentas de linha de comando (verificado: Xcode 27.2, build 27B52).

## Desenvolvimento

Para preparar o runtime Deno usado pelo YouTube antes de executar ou empacotar o app:

```sh
node scripts/obter-deno.mjs
```

O app distribuído inclui esse runtime; quem usa o Clipora não precisa instalar Deno separadamente. Para os outros binários necessários ao desenvolvimento e ao pacote, consulte [a documentação de distribuição](docs/distribuicao.md).

```sh
source "$HOME/.cargo/env"
pnpm install
pnpm tauri dev
```

`pnpm dev` inicia apenas o frontend no Vite.

No YouTube, a prévia mostra apenas as alturas disponíveis para aquele vídeo. **Melhor disponível** é a escolha padrão; uma altura escolhida é respeitada sem troca silenciosa para outra qualidade. Se ela deixar de estar disponível antes do download, atualize a prévia e escolha novamente. O arquivo final é MP4 com áudio AAC; o vídeo pode usar AVC/H.264, VP9 ou AV1, e alguns players não reproduzem VP9 ou AV1.

O Clipora não baixa Shorts, lives, Stories nem playlists inteiras. O suporte ao YouTube é para vídeos normais públicos, sem login.

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
