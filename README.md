# Clipora

**[English](#english) · [Português](#português)**

---

## English

Clipora is a free, open source desktop app for **macOS, Windows and Linux** that downloads one public video at a time from **Instagram Reels, TikTok and YouTube**. Paste a link, preview the video, pick the quality and save it as an MP4 file on your computer.

> Clipora is in active development (version 0.1.0).

### What it does

- **Paste a link and download.** Works with public Instagram Reels, TikTok videos and regular public YouTube videos, no login needed.
- **Preview before downloading.** Shows the video's title and, on YouTube, only the resolutions that video actually offers. **Best available** is the default, and a resolution you pick is never silently swapped for another one.
- **MP4 output.** The file is MP4 with AAC audio. H.264 is preferred so the video opens in most players (including QuickTime); some videos are only offered as VP9 or AV1, which a few players cannot play.
- **Progress and cancel.** Follow the download progress and cancel it at any time.
- **Local history.** Clipora keeps a list of completed downloads on your device. You can open a video from the history, and if you paste a link you already downloaded, Clipora tells you and lets you open the existing file or download another copy. Clearing the history removes only the records, never your videos.
- **Private by design.** Everything runs on your computer. Links, titles, dates and file paths stay on your device and are not sent anywhere by Clipora.

Not supported: YouTube Shorts, live streams, Stories, private videos, videos that require login and whole playlists.

More details in the [user guide (Portuguese)](docs/usuario/README.md).

### Download and install

Download the installer for your system from the [Releases](../../releases) page.

The installers are **not signed** yet, so macOS and Windows show a warning the first time you open Clipora. This is expected for unsigned open source apps. To open it:

#### macOS

1. Open the `.dmg` and drag Clipora to the **Applications** folder.
2. Open Clipora. A message says Apple could not verify the app. Click **Done** / **OK** (not "Move to Trash").
3. Go to **System Settings → Privacy & Security**, scroll down and click **Open Anyway** next to the Clipora message.
4. Open Clipora again, confirm and enter your Mac password. You only need to do this once.

On macOS 15 (Sequoia) and later, right-click → **Open** no longer bypasses this warning; use the steps above.

If macOS says **"Clipora is damaged and can't be opened"**, the file is fine: this is the quarantine block for unsigned apps. Run this in Terminal and open the app again:

```bash
xattr -dr com.apple.quarantine /Applications/Clipora.app
```

#### Windows

1. **In the browser:** Edge or Chrome may say the file "isn't commonly downloaded". Click **⋯ → Keep → Show more → Keep anyway**.
2. **When running the installer:** a blue screen says "Windows protected your PC". Click **More info → Run anyway**.

On Windows 11 with **Smart App Control** turned on, unsigned apps are blocked with no way to allow them. The only option is to turn Smart App Control off, and it cannot be turned back on without reinstalling Windows.

#### Linux

Install the `.deb` (Debian/Ubuntu), the `.rpm` (Fedora/openSUSE) or run the `.AppImage` (make it executable first with `chmod +x Clipora*.AppImage`). Compare the file with the published SHA-256 checksums if you want to verify it.

### Responsible use

Clipora is a tool for saving public videos for personal use. You are responsible for respecting copyright and the terms of service of each platform. Only download content you own or have permission to save.

### License

Clipora is free software licensed under the **GNU General Public License v3.0 or later** ([GPL-3.0-or-later](LICENSE)). Bundled third-party components (yt-dlp, FFmpeg, Deno and others) keep their own licenses; see [docs/licencas.md](docs/licencas.md) (Portuguese).

Clipora is not affiliated with Instagram, TikTok, YouTube or their owners.

### Development

Requirements:

- Node.js and pnpm (tested with Node v26.12.1 and pnpm 10.32.1).
- Rust and Cargo 1.99.1, pinned by `rust-toolchain.toml`.
- The [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your system. On macOS, Xcode and its command line tools.

Prepare the Deno runtime used for YouTube, then run the app:

```sh
node scripts/obter-deno.mjs
pnpm install
pnpm tauri dev
```

`pnpm dev` starts only the Vite frontend. The other binaries needed to run and package the app (yt-dlp, FFmpeg/FFprobe) are described in [docs/distribuicao.md](docs/distribuicao.md).

Checks and build:

```sh
pnpm typecheck
pnpm test
pnpm test:rust
pnpm build
```

`pnpm build` builds the frontend; `pnpm tauri build` also builds the desktop app. The Rust tests (`pnpm test:rust`) do not need the sidecar binaries. See also the [IPC contract](docs/contrato-ipc.md).

Project documentation is written in Portuguese.

---

## Português

O Clipora é um aplicativo desktop gratuito e open source para **macOS, Windows e Linux** que baixa um vídeo público por vez do **Instagram Reels, TikTok e YouTube**. Cole um link, veja a prévia, escolha a qualidade e salve o vídeo em MP4 no seu computador.

> O Clipora está em desenvolvimento (versão 0.1.0).

### O que ele faz

- **Cole o link e baixe.** Funciona com Reels públicos do Instagram, vídeos do TikTok e vídeos normais públicos do YouTube, sem login.
- **Prévia antes de baixar.** Mostra o título do vídeo e, no YouTube, só as resoluções que aquele vídeo oferece. **Melhor disponível** é a escolha padrão, e a resolução escolhida nunca é trocada por outra sem aviso.
- **Arquivo MP4.** O arquivo é MP4 com áudio AAC. O app prioriza H.264 para o vídeo abrir na maioria dos players (inclusive no QuickTime); alguns vídeos só existem em VP9 ou AV1, que alguns players não reproduzem.
- **Progresso e cancelamento.** Acompanhe o progresso do download e cancele quando quiser.
- **Histórico local.** O Clipora guarda no seu computador a lista dos downloads concluídos. Você pode abrir um vídeo pelo histórico e, se colar um link já baixado, o app avisa e deixa abrir o arquivo existente ou baixar outra cópia. Limpar o histórico remove só os registros, nunca os vídeos.
- **Privacidade.** Tudo roda no seu computador. Links, títulos, datas e caminhos ficam no seu dispositivo e não são enviados pelo Clipora.

Não suportado: Shorts do YouTube, lives, Stories, vídeos privados, vídeos que exigem login e playlists inteiras.

Mais detalhes no [guia do usuário](docs/usuario/README.md).

### Baixar e instalar

Baixe o instalador do seu sistema na página de [Releases](../../releases).

Os instaladores ainda **não são assinados**, então o macOS e o Windows mostram um aviso na primeira vez que você abre o Clipora. Isso é normal em apps open source sem assinatura. Para abrir:

#### macOS

1. Abra o `.dmg` e arraste o Clipora para a pasta **Aplicativos**.
2. Abra o Clipora. Vai aparecer um aviso de que a Apple não pôde verificar o app. Clique em **OK** (não em "Mover para o Lixo").
3. Vá em **Ajustes do Sistema → Privacidade e Segurança**, role até o fim e clique em **Abrir Mesmo Assim** ao lado da mensagem sobre o Clipora.
4. Abra o Clipora de novo, confirme e digite a senha do Mac. Isso só é preciso na primeira vez.

No macOS 15 (Sequoia) ou mais novo, clicar com o botão direito → **Abrir** não libera mais o app; use os passos acima.

Se aparecer **"Clipora está danificado e não pode ser aberto"**, o arquivo não está estragado: é o bloqueio de quarentena para apps sem assinatura. Rode no Terminal e abra o app de novo:

```bash
xattr -dr com.apple.quarantine /Applications/Clipora.app
```

#### Windows

1. **No navegador:** o Edge ou o Chrome pode avisar que o arquivo "não é baixado com frequência". Clique em **⋯ → Manter → Mostrar mais → Manter mesmo assim**.
2. **Ao executar o instalador:** aparece a tela azul "O Windows protegeu o computador". Clique em **Mais informações → Executar assim mesmo**.

No Windows 11 com o **Controle Inteligente de Aplicativos** ativado, apps sem assinatura são bloqueados sem opção de liberar. A única saída é desativar esse recurso, e ele não pode ser reativado sem reinstalar o Windows.

#### Linux

Instale o `.deb` (Debian/Ubuntu), o `.rpm` (Fedora/openSUSE) ou execute o `.AppImage` (antes, torne-o executável com `chmod +x Clipora*.AppImage`). Se quiser conferir o arquivo, compare com as somas SHA-256 publicadas.

### Uso responsável

O Clipora é uma ferramenta para salvar vídeos públicos para uso pessoal. Você é responsável por respeitar os direitos autorais e os termos de uso de cada plataforma. Baixe apenas conteúdo seu ou que você tenha permissão para salvar.

### Licença

O Clipora é software livre sob a **GNU General Public License v3.0 ou posterior** ([GPL-3.0-or-later](LICENSE)). Os componentes de terceiros incluídos (yt-dlp, FFmpeg, Deno e outros) mantêm suas próprias licenças; consulte [docs/licencas.md](docs/licencas.md).

O Clipora não tem relação com o Instagram, o TikTok, o YouTube nem com as empresas donas dessas plataformas.

### Desenvolvimento

Pré-requisitos:

- Node.js e pnpm (verificado com Node v26.12.1 e pnpm 10.32.1).
- Rust e Cargo 1.99.1, fixados por `rust-toolchain.toml`.
- Os [pré-requisitos do Tauri v2](https://v2.tauri.app/start/prerequisites/) para o seu sistema. No macOS, Xcode e suas ferramentas de linha de comando.

Prepare o runtime Deno usado pelo YouTube e execute o app:

```sh
node scripts/obter-deno.mjs
pnpm install
pnpm tauri dev
```

`pnpm dev` inicia apenas o frontend no Vite. Os outros binários necessários para executar e empacotar o app (yt-dlp, FFmpeg/FFprobe) estão descritos em [docs/distribuicao.md](docs/distribuicao.md).

Verificações e build:

```sh
pnpm typecheck
pnpm test
pnpm test:rust
pnpm build
```

`pnpm build` compila o frontend; `pnpm tauri build` também gera o aplicativo desktop. Os testes Rust (`pnpm test:rust`) não exigem os binários auxiliares. Consulte também [o contrato IPC](docs/contrato-ipc.md).

O identificador `app.clipora.desktop` é provisório.
