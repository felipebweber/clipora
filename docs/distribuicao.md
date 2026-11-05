# Distribuição do Clipora

Responsável: Estaleiro (distribuição). Etapa 7 do [plano](../plano-clipora.md); requisitos em [projeto-aplicativo.md](../projeto-aplicativo.md).
Licenças: ver [licencas.md](licencas.md).

**Data de consulta de todas as fontes: 2026-11-05.** Versões citadas são as vigentes nessa data e mudam com frequência; revalidar antes de cada release.

Legenda de confiabilidade usada abaixo:

- **[verificado]**: conferido nesta data na fonte oficial ou com teste local (comando e resultado registrados).
- **[fonte]**: afirmado em documentação oficial, sem teste local.
- **[validar]**: hipótese ou recomendação que só pode ser confirmada gerando e testando o pacote no sistema correspondente.

---

## 1. Resumo das recomendações

| Tema | Recomendação |
|---|---|
| Alvos | Windows 10 22H2+/11 (x64, arm64); macOS 11+ (binário universal arm64+x64); Linux x64 e arm64 com WebKitGTK 4.1 (base Ubuntu 22.04 / Debian 12). Sem Windows 32 bits nem Linux armv7 na v1. |
| Pacotes | Windows: instalador NSIS (`-setup.exe`) como principal, MSI opcional. macOS: `.app` dentro de `.dmg`. Linux: AppImage + `.deb` (e `.rpm` opcional). |
| yt-dlp embutido | **Decidido (2026-11-05): build *onedir* oficial** (`yt-dlp_macos.zip`, `yt-dlp_win.zip`, `yt-dlp_win_arm64.zip`, `yt-dlp_linux.zip`, `yt-dlp_linux_aarch64.zip`; há onedir oficial para os 6 alvos), com versão fixa, verificação de SHA-256 e da assinatura GPG de `SHA2-256SUMS`, extraído em diretório. O *onefile* fica só como opção (`--formato onefile`): custa ~14 s em toda execução no macOS (§4.2). |
| FFmpeg embutido | Build **próprio, mínimo e LGPL** (apenas remux, sem `--enable-gpl`), compilado a partir do tarball oficial assinado do ffmpeg.org, para os 6 alvos. Inclui `ffmpeg` e `ffprobe`. |
| Nomes no pacote | FFmpeg como sidecars `clipora-ffmpeg` e `clipora-ffprobe` (o prefixo evita colisão com `/usr/bin/ffmpeg` no `.deb`/`.rpm`). yt-dlp como diretório `yt-dlp/` com executável de nome fixo `yt-dlp[.exe]` (macOS: `Contents/Helpers/yt-dlp/`; Windows/Linux: `resource_dir()/yt-dlp/`). Proposta completa em §4.5. |
| yt-dlp atualizável | Diretório versionado `app_local_data_dir()/bin/yt-dlp/<versao>/` com ponteiro `atual` trocado atomicamente (fora do pacote assinado), baixado pelo próprio app via HTTPS com verificação GPG + SHA-256; versão anterior preservada. Não usar `yt-dlp -U`. Ver §6. |
| Assinatura | macOS: Developer ID + notarização (exige conta paga da Apple). Windows: certificado OV em HSM/nuvem ou Azure Artifact Signing (se elegível). Linux: somente somas SHA-256 publicadas (e GPG opcional). |

---

## 2. Arquiteturas e versões mínimas propostas

| Sistema | Arquiteturas | Mínimo proposto | Fatores limitantes |
|---|---|---|---|
| Windows | x64 (`x86_64-pc-windows-msvc`), arm64 (`aarch64-pc-windows-msvc`) | Windows 10 22H2 | yt-dlp: “Windows (Win10+)” e o `_update_spec` bloqueia Windows 8/2012 a partir de 2026.10.21 **[verificado]**. BtbN: “minimum supported version is Windows 10 22H2” **[fonte]**. WebView2 já vem no Windows 10 1803+ e no 11 **[fonte]**. |
| macOS | arm64 + x64, distribuídos como binário universal (`universal-apple-darwin`) | macOS 11 Big Sur (proposta) | Tauri usa 10.13 por padrão (`bundle > macOS > minimumSystemVersion`) **[fonte]**; `yt-dlp_macos` exige 10.15+ **[verificado]**. Proponho 11.0 por ser a primeira versão com Apple Silicon e porque dificilmente haverá máquina 10.15 para testar. Decisão do usuário (seção 9). |
| Linux | x64 (`x86_64-unknown-linux-gnu`), arm64 (`aarch64-unknown-linux-gnu`) | Distribuições com WebKitGTK 4.1 e glibc ≥ da base de build (Ubuntu 22.04 → glibc 2.35; Debian 12; Fedora recente) | Tauri v2 exige WebKitGTK 4.1 e recomenda compilar na base mais antiga suportada (Ubuntu 22.04 / Debian 12) **[fonte]**. yt-dlp_linux exige glibc 2.17+ **[verificado]**; ffmpeg BtbN exige glibc 2.28 **[fonte]** (irrelevante se usarmos build próprio na mesma base). |

Fora do escopo da v1 (registrar como limitação): Windows x86 32 bits (BtbN não faz autobuilds de win32 **[fonte]**), Linux armv7 (yt-dlp só oferece `.zip` sem atualização e exige glibc 2.31 **[verificado]**), distribuições musl (Alpine), Windows 7/8.

Fontes:
- Tauri – pré-requisitos: <https://v2.tauri.app/start/prerequisites/>
- Tauri – macOS bundle (minimumSystemVersion): <https://v2.tauri.app/distribute/macos-application-bundle/>
- Tauri – AppImage/Debian/RPM (limitações de glibc): <https://v2.tauri.app/distribute/appimage/>, <https://v2.tauri.app/distribute/debian/>, <https://v2.tauri.app/distribute/rpm/>
- yt-dlp – Release files: <https://github.com/yt-dlp/yt-dlp#release-files>
- yt-dlp – `_update_spec` da release 2026.10.26: <https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/_update_spec>
- BtbN FFmpeg-Builds: <https://github.com/BtbN/FFmpeg-Builds>

---

## 3. Formatos de pacote (Tauri v2)

Versões de referência na consulta: `tauri` 2.12.5, `tauri-cli` 2.12.4, `tauri-bundler` 2.10.4 (2026-10-21) **[verificado]** em <https://github.com/tauri-apps/tauri/releases>.

### Windows
- **NSIS (`-setup.exe`)**: recomendado como principal. Suporta x64 e arm64 (o instalador NSIS roda em emulação x86 no ARM; o app fica nativo arm64) **[fonte]**. Pode ser instalado por usuário, sem privilégios de administrador.
- **MSI (WiX v3)**: só pode ser gerado em host Windows **[fonte]**; o bundler mapeia x64/x86/arm64 **[verificado no código do bundler]**. Opcional, útil para implantação corporativa.
- WebView2: manter `webviewInstallMode` padrão (`downloadBootstrapper`); o runtime já vem no Windows 10 1803+ e no 11 **[fonte]**. Usar `offlineInstaller` (~127 MB) só se houver demanda de instalação offline.
- Compilar arm64 exige “MSVC v143 – C++ ARM64 build tools” e `rustup target add aarch64-pc-windows-msvc` **[fonte]**.
- Fonte: <https://v2.tauri.app/distribute/windows-installer/>

### macOS
- **`.app`** e **`.dmg`** (distribuição fora da App Store). <https://v2.tauri.app/distribute/dmg/>
- Recomendação: um único `.dmg` universal (`tauri build --target universal-apple-darwin`). Vantagem: o `yt-dlp_macos` oficial já é universal (**[verificado]** com `file`: x86_64 + arm64), então só o FFmpeg precisa ser combinado com `lipo`.
- **Não** distribuir pela Mac App Store na v1: o App Sandbox obrigatório colocaria quarentena nos arquivos que o app grava e impediria executar o yt-dlp atualizado (seção 6).

### Linux
- **AppImage**: autocontido, mas fica entre 70 MB e mais de 100 MB **[fonte]**. Não é possível gerar AppImage ARM por compilação cruzada (o linuxdeploy não suporta): é preciso um runner arm64 (`ubuntu-22.04-arm`) ou emulação **[fonte]**.
- **`.deb`** e **`.rpm`**: dependem do WebKitGTK 4.1 do sistema. **Atenção [verificado no código do bundler]**: o Tauri instala `externalBin` em **`/usr/bin/<nome-sem-triple>`** (`debian.rs`, `rpm.rs`). Com nomes simples (`yt-dlp`, `ffmpeg`), o pacote colidiria com os pacotes `yt-dlp` e `ffmpeg` da distribuição e o dpkg recusaria a instalação. Por isso os sidecars devem ter prefixo (seção 4.1).
- Flatpak, Snap e AUR ficam fora da v1. O sandbox do Flatpak/Snap complica a execução de binários baixados.
- Fontes: <https://v2.tauri.app/distribute/appimage/>, <https://v2.tauri.app/distribute/debian/>, <https://v2.tauri.app/distribute/rpm/>, <https://v2.tauri.app/distribute/pipelines/github/>

### Matriz de build sugerida (CI)
| Artefato | Runner | Target |
|---|---|---|
| Windows x64 (NSIS + MSI) | `windows-latest` | `x86_64-pc-windows-msvc` |
| Windows arm64 (NSIS) | `windows-latest` (cruzado) ou `windows-11-arm` | `aarch64-pc-windows-msvc` |
| macOS universal (DMG) | `macos-latest` | `universal-apple-darwin` |
| Linux x64 (AppImage, deb, rpm) | `ubuntu-22.04` | `x86_64-unknown-linux-gnu` |
| Linux arm64 (AppImage, deb, rpm) | `ubuntu-22.04-arm` | `aarch64-unknown-linux-gnu` |

**[validar]**: a disponibilidade de runners arm64 depende do plano do GitHub e de o repositório ser público (a documentação do Tauri diz “Only available in public repos”). Ainda não há repositório remoto nem CI configurados.

---

## 4. yt-dlp e FFmpeg como sidecars

### 4.1 Mecanismo do Tauri
- `bundle.externalBin` em `tauri.conf.json` lista caminhos relativos a `src-tauri/`. Para cada entrada deve existir um arquivo `<nome>-<target-triple>` (com `.exe` no Windows). O bundler remove o sufixo ao empacotar **[fonte]**. Para descobrir o triple do host, use `rustc --print host-tuple` (Rust 1.84+).
- Execução: `app.shell().sidecar("<nome>")` no Rust (plugin `tauri-plugin-shell`) ou `Command.sidecar(...)` no JS com a permissão `shell:allow-execute`/`shell:allow-spawn` e `"sidecar": true` **[fonte]**. Como a interface não deve executar processos, a recomendação é chamar só pelo Rust e **não** conceder permissão de shell à webview.
- Destino no pacote: macOS `Contents/MacOS/`; Windows, a pasta de instalação; Linux `.deb`/`.rpm` `/usr/bin/`; AppImage `usr/bin/` dentro da imagem somente leitura **[verificado no código do bundler]**.
- Fonte: <https://v2.tauri.app/develop/sidecar/>, <https://v2.tauri.app/plugin/shell/>

**Estado atual (até a etapa 6).** O `tauri.conf.json` de Ferrugem tem `externalBin` com `binaries/clipora-yt-dlp`, `binaries/clipora-ffmpeg` e `binaries/clipora-ffprobe`. Por isso `pnpm binarios` grava por padrão o yt-dlp **onefile** como **arquivo** em `src-tauri/binaries/clipora-yt-dlp-<triple>[.exe]`. Um diretório nesse caminho quebra `tauri dev` e `tauri build`. O onedir fica à parte, em `src-tauri/binaries/onedir/` (`--formato onedir`).

**Proposta de layout para a etapa 6.** É mudança em `tauri.conf.json` a pedir para Ferrugem. Com a decisão pelo onedir, só o FFmpeg fica em `externalBin`; o yt-dlp vai como diretório (§4.5):

```jsonc
// src-tauri/tauri.conf.json (trecho proposto — NÃO aplicado)
"bundle": {
  "externalBin": ["binaries/clipora-ffmpeg", "binaries/clipora-ffprobe"]
  // + yt-dlp por sistema, ver §4.5 (gerado em src-tauri/binaries/onedir/tauri.binarios.json)
}
```

| Target triple | yt-dlp onedir (asset oficial → diretório local) | FFmpeg/ffprobe |
|---|---|---|
| `x86_64-pc-windows-msvc` | `yt-dlp_win.zip` → `binaries/onedir/clipora-yt-dlp-x86_64-pc-windows-msvc/yt-dlp.exe` | build próprio win64 (pendente) |
| `aarch64-pc-windows-msvc` | `yt-dlp_win_arm64.zip` → `binaries/onedir/clipora-yt-dlp-aarch64-pc-windows-msvc/yt-dlp.exe` | build próprio winarm64 (pendente) |
| `universal-apple-darwin` | `yt-dlp_macos.zip` (universal) → `binaries/onedir/clipora-yt-dlp-universal-apple-darwin/yt-dlp` | arm64 + x64 combinados com `lipo` |
| `aarch64-apple-darwin` / `x86_64-apple-darwin` | `yt-dlp_macos.zip` (o mesmo zip universal) | build próprio por arquitetura |
| `x86_64-unknown-linux-gnu` | `yt-dlp_linux.zip` → `binaries/onedir/clipora-yt-dlp-x86_64-unknown-linux-gnu/yt-dlp` | build próprio linux64 |
| `aarch64-unknown-linux-gnu` | `yt-dlp_linux_aarch64.zip` → `binaries/onedir/clipora-yt-dlp-aarch64-unknown-linux-gnu/yt-dlp` | build próprio linuxarm64 |

Dentro de cada zip, o executável oficial fica na raiz (`yt-dlp_macos`, `yt-dlp.exe`, `yt-dlp_arm64.exe`, `yt-dlp_linux`, `yt-dlp_linux_aarch64`), ao lado de `_internal/` **[verificado]**. O script o renomeia para o nome fixo `yt-dlp[.exe]`, e o PyInstaller onedir continua funcionando: a saída do `-v` mostra a variante `darwin_dir` **[verificado]**.

**[validar]** o sufixo `-universal-apple-darwin` dos sidecars do FFmpeg no primeiro build universal (o bundler substitui `-{target}`, e o target nesse caso é `universal-apple-darwin`).

**Notas para o núcleo (registrar, a repassar a Ferrugem pelo coordenador):**
- Passar ao yt-dlp `--ffmpeg-location <caminho absoluto de clipora-ffmpeg>`. O yt-dlp deriva o ffprobe trocando “ffmpeg” por “ffprobe” no nome do arquivo (`clipora-ffmpeg` → `clipora-ffprobe`, inclusive com `.exe`) **[verificado no código: `yt_dlp/postprocessor/ffmpeg.py::_determine_executables`]**. Assim não depende do `PATH`.
- Considerar `--ignore-config` (ou `--no-config-locations`) e `--no-update`, para que uma configuração do yt-dlp do usuário não altere o comportamento do app.
- Os binários PyInstaller *onefile* se extraem num diretório temporário a cada execução e exigem um `TMPDIR` gravável. No macOS isso custou cerca de 14 s por execução (medição na seção 4.2). Ver a recomendação de onedir.

### 4.2 yt-dlp: origem e integridade
- **Origem oficial**: releases do GitHub `yt-dlp/yt-dlp`. Última estável na consulta: **2026.10.26** (publicada em 2026-10-26) **[verificado via API do GitHub]**. <https://github.com/yt-dlp/yt-dlp/releases>
- **Integridade**: cada release publica `SHA2-256SUMS`, `SHA2-512SUMS` e as assinaturas GPG `SHA2-256SUMS.sig` e `SHA2-512SUMS.sig`. A chave pública fica em <https://github.com/yt-dlp/yt-dlp/blob/master/public.key> **[verificado]**. Procedimento oficial:
  ```sh
  curl -L https://github.com/yt-dlp/yt-dlp/raw/master/public.key | gpg --import
  gpg --verify SHA2-256SUMS.sig SHA2-256SUMS
  sha256sum -c --ignore-missing SHA2-256SUMS
  ```
  A API do GitHub também expõe `digest: sha256:...` por asset **[verificado]**, que serve de verificação cruzada mas não substitui a assinatura.
- Teste local (macOS, 2026-11-05): `yt-dlp_macos` e `yt-dlp.exe` da 2026.10.26 baixados com `curl`; `shasum -a 256 -c` → **OK** para os dois **[verificado]**. Assinatura GPG do `SHA2-256SUMS` → `VALIDSIG … AC0CBBE6848D6A873464AF4E57CF65933B5A7581` (chave “Simon Sawicki (yt-dlp signing key)”) **[verificado]** com GnuPG 2.5.24, também pelo `pnpm binarios`.
- SHA-256 de referência (release 2026.10.26), copiados do `SHA2-256SUMS`:

  | Asset | SHA-256 |
  |---|---|
  | `yt-dlp.exe` | `f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d` |
  | `yt-dlp_arm64.exe` | `0066dbac3c124028e2dcae2a197fccee33cd91f456313d24f7af89fd54590e98` |
  | `yt-dlp_macos` | `0f922c15ccc0b83eefa1c8bc9104e434318c4bf16e408e1ee93b7745a6efe0aa` |
  | `yt-dlp_linux` | `767ba9dce7052aa196f8b12652f433d76de128ba168966fa84b6394d5e6c6795` |
  | `yt-dlp_linux_aarch64` | `e87e9533e89fe5889abaa21f5114dfe7756d6aa6219b83551add04d48b18e483` |

- **Estado de assinatura de código dos binários oficiais [verificado]**:
  - `yt-dlp_macos`: `codesign -dvv` → `Signature=adhoc`, `TeamIdentifier=not set`; `spctl -a -t exec` → **rejected**. Funciona sem quarentena, mas o Gatekeeper bloquearia se o arquivo tivesse `com.apple.quarantine`.
  - `yt-dlp.exe`: cabeçalho PE sem diretório de segurança (tamanho 0), ou seja, **sem assinatura Authenticode**.
- **Execução local [verificado em 2026-11-05, macOS arm64]**: `src-tauri/binaries/clipora-yt-dlp-aarch64-apple-darwin --version` → `2026.10.26`. Com `-v --ignore-config --no-update --ffmpeg-location …/clipora-ffmpeg-aarch64-apple-darwin`, o yt-dlp reporta `exe versions: ffmpeg 8.1.3-clipora (setts), ffprobe 8.1.3-clipora`, ou seja, acha o ffprobe pela troca de nome.
- **Builds onedir oficiais disponíveis** (README, tabela *Release Files*: “Unpackaged … executable (no auto-update)”) **[verificado]**. Todos constam no `SHA2-256SUMS` assinado:

  | Asset | Plataforma | Executável na raiz | Arquivos | SHA-256 (2026.10.26) |
  |---|---|---|---|---|
  | `yt-dlp_macos.zip` | macOS 10.15+ universal | `yt-dlp_macos` | 134 | `20d98fa608998eff87d1d35a6e9fb65e4b874639a6cc89addc19da3becde3ef1` |
  | `yt-dlp_win.zip` | Windows 10+ x64 | `yt-dlp.exe` | 140 | `fd51b212cf8380c7a52ee08c0d6be7f3c59b2f2c832eaf7b45acfae6eab57419` |
  | `yt-dlp_win_arm64.zip` | Windows 10+ ARM64 | `yt-dlp_arm64.exe` | 134 | `5eaa4c61f3c09189f3a551bf1855c13aad61fb865cc33f06012a6c2dbe287a45` |
  | `yt-dlp_linux.zip` | Linux glibc 2.17+ x86_64 | `yt-dlp_linux` | — | `f34053415136e55073dd64ba5326d161ecc23ce0e98c081d8752867b37809450` |
  | `yt-dlp_linux_aarch64.zip` | Linux glibc 2.17+ aarch64 | `yt-dlp_linux_aarch64` | — | `74708e707e8fa8177c8347e58152337edf320149cd7b225defd453f7cde47822` |

  Também existem `yt-dlp_win_x86.zip`, `yt-dlp_linux_armv7l.zip` e as variantes musl, fora do escopo da v1. Os zips só usam entradas *stored* ou *deflate*, sem links simbólicos; os de macOS e Linux guardam permissões Unix **[verificado com `zipinfo`]**. O macOS extraído ocupa 124 MB (o zip tem 54 MB).
- **Tempo de partida, macOS arm64 [verificado em 2026-11-05, `/usr/bin/time -p … --version`]**:

  | Build | 1ª execução | Execuções seguintes |
  |---|---|---|
  | `yt-dlp_macos` (onefile) | 13,9 s | **13,5–14,5 s todas as vezes** (CPU ~0,5 s) |
  | onedir extraído por `pnpm binarios` | **13,98 s** | **0,18 s / 0,19 s** |
  | o mesmo onedir copiado para outra pasta (arquivos novos) | 14,33 s | 0,18 s |

- **Causa (macOS) [verificado com `/usr/bin/log show`]**: avaliação do Gatekeeper/XProtect em **cada biblioteca nova** com assinatura ad-hoc. Durante uma execução do onefile:
  - o `amfid` registra, para cada `.so`/dylib extraída em `$TMPDIR/_MEIxxxx/`, “`not valid: … The file is adhoc signed or signed by an unknown certificate chain`” (56 ocorrências);
  - para cada uma, o `syspolicyd` faz `GK performScan` e consulta o `XprotectFramework.AnalysisService` (61 scans, ~0,2 s cada, de 11:55:57.4 a 11:56:09.9, que somam os ~14 s);
  - o resultado fica em cache **por arquivo**: no onedir já executado houve 0 rejeições e 0 scans (0,31 s); ao copiar o mesmo onedir para uma pasta nova, foram 60 rejeições e 65 scans (14,33 s), e depois 0,18 s;
  - o onefile cria arquivos novos (`_MEIxxxx` aleatório) em **toda** execução, por isso paga sempre. A própria documentação do PyInstaller diz que o onefile “is a little slower to start” por extrair para `_MEIxxxx` a cada execução (<https://github.com/pyinstaller/pyinstaller/blob/develop/doc/operating-mode.rst>).
- **Consequências para o onedir**: paga ~14 s **uma vez** por instalação ou extração. Prever aquecimento (§4.5) e o teste `--version` na atualização (§6), que absorve esse custo. **[validar]** se uma cópia assinada com Developer ID e notarizada evita totalmente o scan.
- **Windows e Linux (não medido; o que se sabe)**: o onefile também extrai para `%TEMP%\_MEIxxxx` ou `/tmp/_MEIxxxx` a cada execução [fonte: PyInstaller]. No Windows, o Defender examina DLLs e `.pyd` recém-gravados, e se espera penalidade por execução semelhante **[validar]**. No Linux, sem varredura do sistema, o custo deve ser só a descompressão **[validar]**. A decisão por onedir vale para todos os sistemas por consistência; medir no CI e nas máquinas de teste.
- Executáveis PyInstaller costumam gerar falsos positivos em antivírus no Windows **[validar]**. Prever orientação na documentação de suporte.

### 4.3 FFmpeg: origem, integridade e build recomendado

Opções avaliadas:

| Fonte | Plataformas | Licença do build | Integridade | Observação |
|---|---|---|---|---|
| Tarball oficial ffmpeg.org (compilar) | todas | **LGPL 2.1+** se compilado sem `--enable-gpl`/`--enable-nonfree` | assinatura PGP `.asc` (chave `ffmpeg-devel.asc`) e assinatura pós-quântica `.pq.asc` **[verificado na página]** | Versões atuais: 9.0.2 e 8.1.3 **[verificado]**. <https://ffmpeg.org/download.html> |
| BtbN/FFmpeg-Builds (GitHub) | win64, winarm64, linux64, linuxarm64 | variantes `gpl`, `lgpl`, `*-shared` | `checksums.sha256` por release (sem GPG) | Estáticos com muitas bibliotecas: ~115–175 MB compactados por pacote LGPL **[verificado]**. A tag `latest` muda diariamente; builds diários ficam 14 dias e o último de cada mês fica 2 anos **[fonte]**. **Sem macOS.** |
| yt-dlp/FFmpeg-Builds | win64, win32, winarm64, linux64, linuxarm64 | GPL (variantes LGPL na wiki) | checksums | Hoje equivalente ao upstream, sem patches **[fonte]**. **Sem macOS.** |
| gyan.dev | Windows x64 | **somente GPL** | SHA-256 no site | Não serve para LGPL. |
| evermeet.cx | macOS **Intel** | **GPL** (`--enable-gpl`) **[verificado]** | assinatura GPG | Sem arm64 e sem LGPL. |

**Recomendação**: compilar um **FFmpeg mínimo LGPL** a partir do tarball oficial assinado, igual para os 6 alvos, só com o necessário para *remux* (`-c copy`), que é o que o yt-dlp faz ao unir vídeo e áudio:
- Menor (estimativa de poucos MB por binário em vez de 100+ MB **[validar]**), licença uniforme LGPL e nenhum codec GPL. Sem codificadores, a exposição a questões de patentes de codecs também diminui. Isto não é parecer jurídico; ver licencas.md.
- Mesmo procedimento em todos os sistemas e código-fonte correspondente fácil de publicar junto com os binários (obrigação LGPL).
- **Implementado** em `scripts/compilar-ffmpeg.mjs` com FFmpeg **8.1.3** (as flags exatas estão em [licencas.md §3.4](licencas.md)). Resultados em 2026-11-05 no macOS arm64 **[verificado]**:
  - build em ~24 s (14 núcleos); `clipora-ffmpeg` 4,1 MB e `clipora-ffprobe` 3,9 MB (universal: 8,3 e 7,9 MB); `minos 11.0`; liga só frameworks do sistema; `ffmpeg -L` declara LGPL 2.1+; 0 codificadores; decodificadores só `vp9`, `aac` e `mp3`;
  - SHA-256 arm64: ffmpeg `a09766758b6d99563e9ff258384e36d888f9f99b12576e23853d0287104629df`, ffprobe `e96184a78967b0cd19b970322ae59a00ad36d79161d7566e1cd6d361a94fe5a0`. Com a mesma máquina e as mesmas ferramentas, o build se repete; não testei reprodutibilidade entre máquinas;
  - remux H.264 (mp4) + AAC (m4a) → mp4 com `-c copy -movflags +faststart`: OK;
  - VP9 + Opus (webm) → webm e mkv: OK;
  - *fixup* HLS (MPEG-TS → mp4 com `-bsf:a aac_adtstoasc`, como no `FFmpegFixupM3u8PP`): **falhou** sem decodificador AAC (“sample rate not set”); **OK** depois de `--enable-decoder=aac,mp3`;
  - os três arquivos gerados decodificam sem erros no ffmpeg do Homebrew (conferência independente);
  - **Bug VP9 em MP4 (corrigido em 2026-11-05)**. Sintoma: um Reel do Instagram (VP9 + AAC) foi baixado, mas `clipora-ffprobe` saiu com código 1 e a mensagem “Empty VP Codec Configuration box”. O mesmo link com o FFmpeg do Homebrew funcionou; um TikTok (H.264) funcionou com os nossos binários.
    - **Causa confirmada**: para escrever a caixa `vpcC`, o *muxer* MP4 chama `ff_isom_get_vpcc_features`, que precisa do formato de pixel do fluxo. Sem decodificador VP9, o formato fica desconhecido (aviso “Unsupported pixel format (-1)”) e a caixa sai vazia. O arquivo fica inválido para **qualquer** leitor: o `ffprobe` do Homebrew também o recusa.
    - **Prova**: um build experimental com todos os parsers e bsfs pedidos, mas sem decodificador `vp9`, falhou nas combinações vp9+aac e vp9+opus, nos dois `ffprobe`. Com `--enable-decoder=aac,mp3,vp9`, todas as combinações passam.
    - **Correção**: `--enable-decoder=aac,mp3,vp9`. Aproveitei para ampliar parsers e bsfs: os parsers `vp8, vp9, av1, h264, hevc, aac, opus, mpegaudio, ac3` e os bsfs `vp9_superframe(_split)`, `aac_adtstoasc`, `extract_extradata`, `h264/hevc_mp4toannexb`, `av1_frame_merge/split`, `setts` e `null`. Continua sem codificadores, com `--disable-gpl --disable-nonfree`.
  - **Matriz offline [verificado em 2026-11-05]**. Entradas geradas pelo ffmpeg do Homebrew: vídeo de 2 s em VP9, AV1, HEVC (`hvc1`) e H.264 (mp4) e áudio AAC (m4a) e Opus (webm). Cada par foi unido em MP4 com `-c copy -map 0:v:0 -map 1:a:0 -movflags +faststart` e conferido com o `ffprobe` do build e com o do Homebrew:

    | build | vp9+aac | vp9+opus | av1+aac | av1+opus | hevc+aac | hevc+opus | h264+aac | h264+opus |
    |---|---|---|---|---|---|---|---|---|
    | experimental, sem decodificador vp9 | **ERRO / ERRO** | **ERRO / ERRO** | OK | OK | OK | OK | OK | OK |
    | arm64 final | OK | OK | OK | OK | OK | OK | OK | OK |
    | universal final (fatia arm64) | OK | OK | OK | OK | OK | OK | OK | OK |

    “OK” significa merge com código 0 e os dois `ffprobe` listando os dois fluxos sem nada em stderr. O aviso “track 1: codec frame size is not set” em Opus → MP4 também aparece com o ffmpeg do Homebrew; os pacotes saem idênticos e os arquivos decodificam inteiros, então é inofensivo. Também passaram com os binários finais o *fixup* MPEG-TS → MP4 (h264+aac) e VP9+Opus → webm, os dois decodificando sem erro no Homebrew. O script da matriz é reproduzível; posso movê-lo para `scripts/` se quiserem como teste de regressão.
  - o universal (`--target universal-apple-darwin`) compila em ~71 s e `lipo -info` mostra x86_64 + arm64. A fatia x86_64 **não foi executada**, pois esta máquina não tem Rosetta **[validar em Mac Intel ou com Rosetta]**.
- Ainda **[validar]** com links reais (etapa 5): `FFmpegFixupDuplicateMoovPP`, `FFmpegFixupTimestampPP`, e o Reel VP9 com os binários corrigidos (Ferrugem vai repetir). HEVC e AV1 já passam na matriz offline. Se faltar algo, ampliar a lista de componentes em vez de mudar para GPL.
- **Alternativa mais rápida**: BtbN `lgpl` com tag mensal fixa (nunca `latest`) para Windows e Linux, mais build próprio só no macOS. Desvantagens: pacotes muito maiores e duas origens diferentes.
- Em qualquer opção: guardar no repositório, no script de obtenção, a URL exata, o SHA-256 esperado e a impressão digital da chave PGP, e falhar o build se algo divergir.
- Fontes: <https://ffmpeg.org/download.html>, <https://ffmpeg.org/legal.html>, <https://github.com/BtbN/FFmpeg-Builds>, <https://github.com/yt-dlp/FFmpeg-Builds>, <https://www.gyan.dev/ffmpeg/builds/>, <https://evermeet.cx/ffmpeg/>

### 4.4 Scripts de obtenção (implementados em 2026-11-05)
- `scripts/binarios.lock`: versões, URLs, SHA-256 e impressões digitais das chaves GPG. As chaves públicas fixadas ficam em `scripts/chaves/`.
- `scripts/obter-binarios.mjs` (`pnpm binarios`): yt-dlp para o triple do host (`rustc -vV`, ou `--target`). Verifica o SHA-256 do `SHA2-256SUMS` contra o lock, a assinatura GPG (chaveiro temporário isolado, sem tocar no `~/.gnupg`; sem gpg → aviso claro; `--exigir-gpg` faz falhar) e o SHA-256 do asset contra o lock e contra o `SHA2-256SUMS`. É idempotente. O topo do arquivo documenta o que o núcleo deve configurar.
  - `--formato onefile` (**padrão**, porque o `externalBin` atual o espera) → arquivo `src-tauri/binaries/clipora-yt-dlp-<triple>[.exe]`.
  - `--formato onedir` → diretório `src-tauri/binaries/onedir/clipora-yt-dlp-<triple>/` com `yt-dlp[.exe]` (o executável oficial com nome fixo), `_internal/` e o manifesto `clipora-yt-dlp.json` (versão, asset, SHA-256 do zip e de **cada** arquivo). A idempotência confere todos os hashes do manifesto (~0,3 s); um arquivo adulterado provoca nova extração **[verificado]**. A troca é feita por renomeação (`.novo` → destino, anterior em `.antigo`).
  - Os dois formatos coexistem. Cada execução grava uma sobreposição de configuração sugerida (`tauri.binarios.json`) ao lado do formato gerado.
  - Resultados em 2026-11-05 (macOS arm64) **[verificado]**: onefile 1ª execução → baixou e gravou; 2ª → “já presente e íntegro… Nada a baixar”. Onedir 1ª → extraiu 134 arquivos; 2ª → pulou em 0,27 s. A extração é idêntica byte a byte à do `ditto` da Apple, e as assinaturas ad-hoc ficam intactas (`codesign -v`).
- `scripts/zip.mjs`: extrator ZIP só com módulos nativos do Node (stored/deflate, CRC-32 conferido, sem ZIP64, criptografia nem links simbólicos). Rejeita caminhos absolutos ou com `..`; teste com `../fora.txt` → “ZIP com caminho inseguro” **[verificado]**. Evita depender de `unzip`/`tar`, que variam por sistema.
- `scripts/comum.mjs`: utilitários (download com novas tentativas, hash, GPG).
- `scripts/compilar-ffmpeg.mjs`: build mínimo LGPL (macOS arm64/x64/universal; Linux nativo; Windows pendente). É idempotente por carimbo gravado em `ffmpeg-build-info-<triple>.txt`.
- `src-tauri/binaries/` está no `.gitignore`.

Especificação original (mantida como referência):
1. Recebe o target triple; lê `scripts/binarios.lock` (versão do yt-dlp, URL, SHA-256 por asset, impressão digital da chave GPG; versão do FFmpeg, SHA-256 do tarball, impressão digital da chave).
2. Baixa o asset do yt-dlp, `SHA2-256SUMS` e `.sig`; verifica a assinatura GPG contra a chave fixada; confere o SHA-256 contra o arquivo de somas **e** contra o lock.
3. Baixa e verifica o tarball do FFmpeg (`.asc`), compila com a configuração da seção 4.3 e combina com `lipo` no macOS.
4. Grava `src-tauri/binaries/clipora-*-<triple>[.exe]` com permissão 755. Esse diretório deve ir para o `.gitignore`; pedir a Ferrugem.
5. No Windows, assina os sidecars com o certificado do projeto antes do `tauri build`. **Não confirmei no código do bundler que o Tauri assine `externalBin` no Windows**; no macOS ele assina, de dentro para fora, junto com o `.app` **[verificado em `macos/app.rs`]**.

### 4.5 Proposta: empacotar o yt-dlp onedir (para Ferrugem, etapa 6 — NÃO aplicada)

**Origem**: `pnpm binarios --formato onedir` → `src-tauri/binaries/onedir/clipora-yt-dlp-<triple>/{yt-dlp[.exe], _internal/, clipora-yt-dlp.json}`.

**1. Por que não `externalBin`**: o `externalBin` espera um **arquivo** `<nome>-<triple>` e o copia com `copy_file` para `Contents/MacOS/`, a pasta de instalação ou `/usr/bin` (§4.1). Não serve para um diretório com `_internal/`. Ao migrar, **remover `binaries/clipora-yt-dlp` do `externalBin`**.

**2. Configuração por sistema.** O script gera `src-tauri/binaries/onedir/tauri.binarios.json` para o triple atual. Ele pode ser usado como `tauri dev|build --config src-tauri/binaries/onedir/tauri.binarios.json` (a CLI v2 mescla JSON passado por `--config`) ou copiado para `tauri.conf.json`. Como o triple varia por arquitetura dentro do mesmo SO, um arquivo gerado por build é mais simples que `tauri.<plataforma>.conf.json`. **[validar]** se os caminhos relativos do `--config` são resolvidos a partir de `src-tauri/`, como os do `tauri.conf.json`.

| Sistema | Configuração | Destino no pacote | Observações |
|---|---|---|---|
| macOS | `bundle.macOS.files: {"Helpers/yt-dlp": "binaries/onedir/clipora-yt-dlp-<triple>"}` | `Clipora.app/Contents/Helpers/yt-dlp/yt-dlp` | O bundler copia diretórios em `macOS.files` (`copy_custom_files_to_bundle` → `copy_dir`) **[verificado no código]**. `Helpers/` é o lugar convencional para ferramentas auxiliares; `Contents/Resources` não deve conter código. O Tauri **não** assina esses arquivos (só `externalBin` e frameworks entram na lista de assinatura) **[verificado em `macos/app.rs`]**, então é preciso pré-assinar (item 4). |
| Windows | `bundle.resources: {"binaries/onedir/clipora-yt-dlp-<triple>/": "yt-dlp/"}` | `<pasta de instalação>\yt-dlp\yt-dlp.exe` (`resource_dir()` = pasta do executável) | O NSIS assina recursos só com extensão `.exe`/`.dll` e ainda não assinados (`should_sign`) **[verificado]**. Os `.pyd` ficariam sem assinatura, então é preciso pré-assinar. |
| Linux | o mesmo `bundle.resources` | `.deb`/`.rpm`: `/usr/lib/<productName>/yt-dlp/yt-dlp`; AppImage: `$APPDIR/usr/lib/<productName>/yt-dlp/yt-dlp` | Caminhos conforme a documentação de `resource_dir` no `tauri-utils` **[fonte: código]**. **[validar]** que o bit de execução se preserva no `.deb`/`.rpm`/AppImage. |

**3. Resolução do executável no Rust**, nesta ordem:
1. **Cópia atualizada** (§6): ler `app_local_data_dir()/bin/yt-dlp/atual` e validar (§6.3); usar `…/yt-dlp/<versao>/yt-dlp[.exe]`.
2. **Cópia embutida**:
   - macOS: `std::env::current_exe()?.parent()` (= `Contents/MacOS`) → `../Helpers/yt-dlp/yt-dlp`;
   - Windows/Linux: `app.path().resource_dir()?.join("yt-dlp").join(EXE)`.
3. **Desenvolvimento** (`cfg!(debug_assertions)`, `tauri dev` não monta o `.app`): `env!("CARGO_MANIFEST_DIR")/binaries/onedir/clipora-yt-dlp-<TARGET>/yt-dlp[.exe]`, com `<TARGET>` exportado pelo `build.rs` (`println!("cargo:rustc-env=CLIPORA_TARGET={}", std::env::var("TARGET")?)`).
4. Esboço:
   ```rust
   const EXE: &str = if cfg!(windows) { "yt-dlp.exe" } else { "yt-dlp" };
   fn ytdlp_embutido(app: &tauri::AppHandle) -> Option<PathBuf> {
       #[cfg(target_os = "macos")]
       let dir = std::env::current_exe().ok()?.parent()?.join("../Helpers/yt-dlp");
       #[cfg(not(target_os = "macos"))]
       let dir = app.path().resource_dir().ok()?.join("yt-dlp");
       let exe = dir.join(EXE);
       if exe.is_file() { return Some(exe); }
       if cfg!(debug_assertions) {
           let dev = Path::new(env!("CARGO_MANIFEST_DIR"))
               .join("binaries/onedir").join(concat!("clipora-yt-dlp-", env!("CLIPORA_TARGET"))).join(EXE);
           if dev.is_file() { return Some(dev); }
       }
       None
   }
   ```
   Executar com `std::process::Command`/`tokio::process::Command` (ou `tauri_plugin_shell` `Command::new(caminho)`), não com `sidecar()`. Argumentos em vetor, sem shell. Manter `--ffmpeg-location`, `--ignore-config` e `--no-update`.
5. **Aquecimento**: a primeira execução de um onedir recém-instalado ou extraído com assinatura ad-hoc leva ~14 s no macOS (§4.2). Sugestão: ao iniciar o app, disparar `yt-dlp --version` em segundo plano. A primeira prévia não espera esse custo se o aquecimento já tiver acabado, e o resultado ainda informa a versão em uso para o aviso de atualização.

**4. Pré-assinatura (antes do `tauri build`)**, a implementar por Estaleiro como `scripts/assinar-yt-dlp.mjs` quando houver certificados:
- **macOS**: localizar todos os Mach-O do diretório pelos *magic bytes* (`feedfacf`, `cffaedfe`, `cafebabe`, `bebafeca`) e assinar **de dentro para fora**: primeiro tudo em `_internal/`, por último o `yt-dlp`:
  `codesign --force --timestamp --options runtime --sign "$APPLE_SIGNING_IDENTITY" <arquivo>`.
  Com **todas** as bibliotecas assinadas pelo mesmo Team ID, a validação de bibliotecas do Hardened Runtime passa **sem** `disable-library-validation`. Só acrescentar entitlements (por exemplo, `allow-unsigned-executable-memory`) se o teste mostrar necessidade **[validar]**. Depois, o `tauri build` assina o `.app`, e o selo cobre `Contents/Helpers`; verificar com `codesign --verify --deep --strict`, `spctl -a -vv` e o log do `notarytool`. **[validar]** se o `_internal/Python.framework` (cópias de arquivos, sem links simbólicos) é aceito pelo `codesign` como arquivos soltos.
- **Windows**: `signtool sign /fd sha256 /tr <timestamp> /td sha256` em `yt-dlp.exe` e em todos os `_internal/**/*.dll` e `*.pyd`. O Tauri pula o que já estiver assinado.
- **Linux**: não há assinatura de código. A integridade vem do pacote e das `SHA256SUMS` publicadas.
- A re-assinatura altera os bytes, então o script de assinatura deve **regenerar o manifesto**. No Rust, a cópia embutida é protegida pela assinatura do pacote; os hashes por arquivo são exigidos só das cópias do app data (§6).
- Sem conta Apple: assinatura ad-hoc (`-`) dos mesmos arquivos. Funciona, mas o primeiro uso paga o scan de ~14 s (por isso o aquecimento).

---

## 5. Assinatura e notarização

### 5.1 macOS
- **Requisitos [fonte]**: Apple Developer Program pago (US$ 99/ano); certificado **Developer ID Application**, que só o *Account Holder* pode criar; um Mac para assinar; **notarização** obrigatória com Developer ID; *Hardened Runtime* obrigatório para notarizar.
- Credenciais para o Tauri: `APPLE_CERTIFICATE` (.p12 em base64), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` e, para notarizar, **ou** `APPLE_API_ISSUER` + `APPLE_API_KEY` + `APPLE_API_KEY_PATH` (chave da API do App Store Connect, preferível no CI) **ou** `APPLE_ID` + `APPLE_PASSWORD` (senha de app) + `APPLE_TEAM_ID`.
- O Tauri assina sidecars e frameworks antes do `.app`, aplicando a **mesma** configuração de entitlements e Hardened Runtime a todos os executáveis **[verificado em `macos/app.rs` e `macos/sign.rs`]**.
- **Risco principal: tratado com a decisão pelo onedir.** O `yt-dlp_macos` *onefile* extrai a cada execução bibliotecas Python com assinatura ad-hoc para um diretório temporário novo. Se o reassinássemos com Hardened Runtime, a validação de bibliotecas recusaria essas cópias, e só `com.apple.security.cs.disable-library-validation` resolveria. Ele também paga ~14 s de scan do XProtect em **toda** execução (§4.2). Com o **onedir**, as bibliotecas ficam em arquivos fixos dentro do `.app` (`Contents/Helpers/yt-dlp/_internal/`), e o script assina cada uma com o nosso Developer ID, de dentro para fora (§4.5 item 4). Com o mesmo Team ID no executável e nas bibliotecas, a validação de bibliotecas passa **sem** entitlements extras. Ainda **[validar]** com certificado real:
  1. se a notarização aceita o `_internal/Python.framework` copiado como arquivos soltos (sem links simbólicos);
  2. se algum módulo precisa de `com.apple.security.cs.allow-unsigned-executable-memory` (não esperado: o CPython não tem JIT habilitado no build do PyInstaller);
  3. o tempo da primeira execução depois da instalação por `.dmg` com quarentena.
- **Entitlements dos sidecars**: o Tauri aplica a configuração de Hardened Runtime a todos os `externalBin`, que passam a ser só `clipora-ffmpeg` e `clipora-ffprobe`. São binários estáticos que só ligam frameworks do sistema, então não precisam de entitlements.
- **Sem conta paga**: assinatura ad-hoc (`signingIdentity: "-"`) permite rodar em Apple Silicon, mas o usuário precisa liberar o app em Ajustes do Sistema › Privacidade e Segurança **[fonte]**. Nas versões recentes do macOS, o atalho Control-clique › Abrir deixou de contornar o Gatekeeper **[validar a versão exata]**. Para usuários leigos, essa experiência é ruim.
- Fontes: <https://v2.tauri.app/distribute/sign/macos/>, <https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution>, <https://developer.apple.com/documentation/security/hardened_runtime>, <https://developer.apple.com/developer-id/>

### 5.2 Windows
- Assinar é opcional para executar, mas sem assinatura o SmartScreen avisa ao abrir o instalador baixado pelo navegador **[fonte]**.
- **Desde 2024, certificado EV não dá reputação imediata no SmartScreen**: OV e EV constroem reputação do mesmo jeito **[fonte: Tauri]**. Assinar todas as releases com o mesmo certificado acumula reputação.
- Desde junho de 2023 (requisitos do CA/B Forum), a chave privada de certificados públicos de assinatura de código precisa ficar em hardware (token ou HSM em nuvem). Não existe mais `.pfx` exportável comum, então no CI será preciso `signCommand` com a ferramenta da AC (ou relic/Azure Key Vault) **[fonte]**.
- **Validade máxima de 460 dias** para certificados de assinatura de código emitidos a partir de 2026-03-01 (Ballot CSC-31) **[fonte]**. Prever renovação anual.
- Opções:
  1. **Azure Artifact Signing** (antigo Trusted Signing): cerca de US$ 9,99/mês. Disponível para organizações dos EUA, Canadá, UE e Reino Unido, e para pessoas físicas só nos EUA e Canadá. Há relato (Q&A da Microsoft, mar/2026) de restrições novas e de cadastro de pessoa física pausado **[fonte, conflitante: confirmar no portal]**.
  2. **Certificado OV** de uma AC (US$ 150–300/ano segundo a Microsoft), com token ou HSM em nuvem. Disponível para pessoa física ou jurídica no Brasil, conforme a AC.
  3. **SignPath Foundation** (gratuito para projetos de código aberto que cumpram os critérios) **[validar elegibilidade]**.
- Configuração no Tauri: `bundle > windows > certificateThumbprint`/`timestampUrl` (certificado no repositório de certificados) ou `bundle > windows > signCommand` (qualquer ferramenta). Isso é mudança em `tauri.conf.json` e deve ser pedida a Ferrugem.
- **Smart App Control (Windows 11)**: bloqueia código “desconhecido e não assinado” em máquinas com o recurso ligado **[fonte]**. Afeta o instalador sem assinatura e também o **yt-dlp atualizado baixado para o app data**, porque o `yt-dlp.exe` oficial não tem Authenticode **[verificado]** (seção 6).
- Fontes: <https://v2.tauri.app/distribute/sign/windows/>, <https://learn.microsoft.com/windows/apps/package-and-deploy/code-signing-options>, <https://azure.microsoft.com/products/artifact-signing>, <https://cabforum.org/working-groups/code-signing/requirements/>, <https://learn.microsoft.com/windows/apps/develop/smart-app-control/overview>, <https://support.microsoft.com/en-us/topic/what-is-smart-app-control-285ea03d-fa88-4d56-882e-6698afdb7003>

### 5.3 Linux
- Assinatura não é exigida. O AppImage aceita assinatura GPG embutida (`SIGN=1`, `SIGN_KEY`, `APPIMAGETOOL_SIGN_PASSPHRASE`), mas **não é verificada automaticamente** **[fonte]**. Recomendação: publicar `SHA256SUMS` dos artefatos e, opcionalmente, assiná-lo com GPG do projeto.
- Fonte: <https://v2.tauri.app/distribute/sign/linux/>

---

## 6. yt-dlp atualizável fora do pacote assinado

### 6.1 Por que fora do pacote
- macOS: alterar qualquer arquivo dentro de `Clipora.app` invalida a assinatura e a notarização, e `/Applications` pode não ser gravável pelo usuário.
- Windows: `Program Files` (instalação para todas as contas) exige administrador; mesmo na instalação por usuário, trocar um arquivo assinado do pacote é frágil.
- Linux: o AppImage é um squashfs **somente leitura**; no `.deb`/`.rpm` o binário fica em `/usr/bin`, que pertence ao root.
- O `yt-dlp -U` atualiza **no próprio lugar** (renomeia `.new`/`.old` ao lado do executável) e só verifica o SHA-256 obtido do próprio `SHA2-256SUMS`, sem GPG. Se o hash não estiver lá, ele segue “skipping verification” **[verificado em `yt_dlp/update.py`]**. **Não usar `-U`.**

### 6.2 Local proposto: diretório versionado com ponteiro `atual`
Raiz: `app_local_data_dir()/bin/yt-dlp/` (Tauri `PathResolver`), resolvido como `local_data_dir/<identifier>` **[verificado em `crates/tauri/src/path/desktop.rs`]**. Como o onedir é um **diretório** (`yt-dlp[.exe]` + `_internal/`), cada versão fica numa pasta própria, e um arquivo-ponteiro diz qual está em uso:

```
<app_local_data_dir>/bin/yt-dlp/
├── atual                    # arquivo de texto: "2026.11.20\n" (versão em uso)
├── anterior                 # arquivo de texto: versão usada antes da última troca (rollback)
├── 2026.10.26/              # versão anterior, preservada
│   ├── yt-dlp[.exe]         # renomeado do nome do asset para nome fixo
│   ├── _internal/…
│   └── clipora-yt-dlp.json  # manifesto: versão, asset, sha256 do zip, sha256 por arquivo
├── 2026.11.20/              # versão atual
└── .tmp-2026.11.20-<rand>/  # só existe durante uma atualização; lixo se o app cair no meio
```

| Sistema | Raiz (identifier atual `app.clipora.desktop`) |
|---|---|
| Windows | `%LOCALAPPDATA%\app.clipora.desktop\bin\yt-dlp\` (Local, não Roaming: binário não deve sincronizar entre máquinas) |
| macOS | `~/Library/Application Support/app.clipora.desktop/bin/yt-dlp/` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/app.clipora.desktop/bin/yt-dlp/` |

**Por que um arquivo-ponteiro e não um link simbólico ou renomear o diretório**:
- No Windows, links simbólicos exigem privilégio ou Modo de Desenvolvedor.
- Num diretório em uso por um `yt-dlp.exe` rodando, o Windows não permite renomear nem apagar.
- `rename` de diretório sobre outro diretório não vazio falha em todos os sistemas.

Trocar um arquivo pequeno com `rename` é atômico nos três sistemas. No Windows, o `std::fs::rename` usa `MoveFileExW` com `MOVEFILE_REPLACE_EXISTING`.

Se o `identifier` mudar antes da primeira release, os caminhos mudam junto. Por isso convém decidir o identifier antes de publicar (seção 9).

### 6.3 Fluxo recomendado (para Ferrugem, etapa 6; registrar, não aplicar)
**A. Seleção ao iniciar** (barata, sem rede):
1. Ler `bin/yt-dlp/atual`. Aceitar só se o conteúdo, sem espaços, casar com `^\d{4}\.\d{2}\.\d{2}(\.\d+)?$`. Isso impede `../` e caminhos absolutos.
2. Em `bin/yt-dlp/<versao>/`, exigir `clipora-yt-dlp.json` com `versao == <versao>` e o executável `yt-dlp[.exe]` presente.
3. Conferir o SHA-256 de **todos** os arquivos listados no manifesto e recusar arquivos extras executáveis. O onedir macOS arm64 tem 124 MB em 135 arquivos; `shasum -a 256` de todos levou 0,32 s **[verificado]**, e no Rust deve ser parecido **[validar]**. Fazer em segundo plano junto com o aquecimento (§4.5, item 3, passo 5), antes da primeira prévia.
4. Usar essa cópia só se ela for **mais nova** que a embutida, comparando a data `AAAA.MM.DD` numericamente. Depois de uma atualização do app, a embutida pode ser a mais nova.
5. Em qualquer falha, usar a cópia embutida (§4.5 item 3) e registrar no log. A cópia embutida é sempre o *fallback* funcional. Mostrar ao usuário só se a falha vier de adulteração (hash divergente).

**B. Verificar versão disponível**: `GET https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest` (campo `tag_name`), tolerando limite de taxa e ausência de rede. Só canal estável.

**C. Atualizar** (só por ação do usuário, nunca durante um download; um *mutex* global serializa atualização e downloads):
1. Escolher o asset onedir por SO/arquitetura **em tempo de execução**, com o mesmo mapeamento do `binarios.lock` (por exemplo, `yt-dlp_win_arm64.zip`, executável `yt-dlp_arm64.exe`).
2. Baixar por HTTPS (`reqwest`) o zip, o `SHA2-256SUMS` e o `SHA2-256SUMS.sig` para `bin/yt-dlp/.tmp-<versao>-<rand>/` (mesmo sistema de arquivos do destino).
3. **Verificar a assinatura GPG** do `SHA2-256SUMS` com a chave pública do yt-dlp **embutida no app**, com a impressão digital fixada (`AC0CBBE6848D6A873464AF4E57CF65933B5A7581`); crates candidatas: `pgp` (rPGP) ou `sequoia-openpgp`. Depois, conferir o SHA-256 do zip contra a linha do asset. Abortar em qualquer divergência.
4. Extrair o zip com as mesmas defesas do `scripts/zip.mjs`:
   - rejeitar nomes absolutos, com letra de unidade, com `..` ou `\`;
   - rejeitar links simbólicos, ZIP64 e criptografia;
   - conferir o CRC;
   - aplicar modo 0755 a arquivos com bit de execução Unix e a `.exe/.dll/.pyd`.

   A crate `zip` serve, desde que se valide `enclosed_name()` em cada entrada.
5. Renomear o executável do asset para o nome fixo `yt-dlp[.exe]` e escrever o `clipora-yt-dlp.json` com o SHA-256 de cada arquivo (mesmo formato do script).
6. **Teste de fumaça**: `yt-dlp --ignore-config --no-update --version` com *timeout* de ~60 s. No macOS, a primeira execução paga ~14 s de scan do XProtect; isso acontece **aqui**, e não no primeiro download do usuário. A saída deve ser igual à versão esperada.
7. Mover `.tmp-<versao>-<rand>/` para `<versao>/` com `rename` atômico. Se `<versao>/` já existir (resto de uma tentativa anterior), validá-lo como em A.2–A.3; se for válido, reutilizá-lo; senão, apagá-lo antes.
8. Gravar `anterior.tmp` com o conteúdo antigo de `atual`, `fsync`, e renomear para `anterior`. Gravar `atual.tmp` com `<versao>\n`, `fsync`, e **renomear para `atual`**. Esse é o único passo que muda a versão em uso, e é atômico: uma queda antes dele mantém a versão antiga; uma queda depois já usa a nova.
9. **Coleta de lixo** (no fim da atualização e ao iniciar o app): apagar diretórios `.tmp-*` e versões que não sejam `atual` nem `anterior`. Com ~124 MB por versão no macOS, o app data ocupa até ~250 MB mais um `.tmp` durante a atualização. Antes de baixar, conferir se há ~400 MB livres. No Windows, ignorar erros de arquivo em uso e tentar de novo no próximo início.

**D. Rollback**: ação “Voltar para a versão anterior”, que troca o conteúdo de `atual` pelo de `anterior` (mesma técnica de gravação atômica). Também se oferece a ação “Usar a versão embutida”, que apaga `atual`.

**E. Nunca usar `yt-dlp -U`** nem o `--update-to`: eles trocam arquivos no próprio lugar e não verificam GPG (§6.1). Sempre passar `--no-update`.

### 6.4 Implicações por sistema
- **macOS: quarentena e Gatekeeper.** Arquivos baixados pelo próprio app com `reqwest` (app sem App Sandbox) não recebem `com.apple.quarantine`, então o Gatekeeper não avalia o executável. Teste local: o `yt-dlp_macos` baixado com `curl` ficou só com `com.apple.provenance`, sem `com.apple.quarantine` **[verificado]**. Como o binário oficial é ad-hoc e o `spctl` o **rejeita** **[verificado]**, ele **nunca** pode receber quarentena: não baixar via navegador ou `NSWorkspace`; se o atributo aparecer, removê-lo só depois de verificar a assinatura GPG e o hash. **Não habilitar App Sandbox**, porque apps em sandbox colocam quarentena em tudo o que gravam. A cópia do app data é outro processo, com a assinatura ad-hoc oficial e **sem** o nosso Hardened Runtime, então a validação de bibliotecas não se aplica a ela. O scan do XProtect (~14 s, §4.2) acontece uma vez por arquivo novo e fica em cache; o teste de fumaça do passo C.6 o absorve **[verificado com o onedir oficial: 1ª execução 13,98 s, seguintes 0,18 s, §4.2]**. **[validar]** a execução real no macOS 11 e no mais recente.
- **Windows: SmartScreen e Smart App Control.** O onedir oficial traz `yt-dlp.exe`, `.dll` e `.pyd` sem Authenticode. O SmartScreen de reputação de arquivo age sobre arquivos com *Mark-of-the-Web* (`Zone.Identifier`), que navegadores e anexos adicionam; um download via `reqwest` não adiciona MOTW **[validar]**. O **Smart App Control**, quando ligado, pode bloquear o `yt-dlp.exe` atualizado por não ter assinatura **[fonte + verificado sem Authenticode]**. Nesse caso a atualização deve falhar de forma limpa, manter o sidecar embutido (assinado por nós) e explicar a situação ao usuário. Políticas corporativas (AppLocker/WDAC) costumam bloquear executáveis em `%LOCALAPPDATA%`: registrar como limitação conhecida. O antivírus pode colocar o PyInstaller em quarentena **[validar]**.
- **Linux: AppImage imutável.** A atualização só funciona fora da imagem; o app data em `~/.local/share` resolve. Se `$HOME` estiver montado com `noexec` (raro), o binário atualizado não executa e o app deve cair no embutido. Para o `.deb`/`.rpm` vale o mesmo caminho.

---

## 7. Checklist de testes de pacote (etapa 7, último item)
Para cada artefato (Win x64, Win arm64, macOS arm64, macOS x64, Linux x64, Linux arm64):
- [ ] Instalar a partir de download pelo navegador (para exercitar SmartScreen/Gatekeeper com MOTW/quarentena reais).
- [ ] O `yt-dlp` embutido (macOS: `Clipora.app/Contents/Helpers/yt-dlp/yt-dlp`; Windows/Linux: `resource_dir()/yt-dlp/yt-dlp[.exe]`) responde a `--version`; medir a 1ª e a 2ª execução. `clipora-ffmpeg -version` e `clipora-ffprobe -version` executam a partir do pacote instalado.
- [ ] Merge sem transcodificar nas combinações VP9/AV1/HEVC/H.264 × AAC/Opus, com saída aceita pelo `clipora-ffprobe` e por um ffprobe independente (matriz da §4.3).
- [ ] Prévia, escolha de pasta, download com merge de vídeo e áudio, abertura da pasta.
- [ ] Atualização manual do yt-dlp (§6.3): sucesso (`atual` aponta para a nova versão, `anterior` para a antiga); sem rede; `SHA2-256SUMS.sig` inválido e zip adulterado (os dois devem abortar sem mexer em `atual`); app encerrado no meio da extração (`atual` continua na versão antiga e o `.tmp-*` é limpo no próximo início).
- [ ] Adulteração depois de instalada: alterar um arquivo em `bin/yt-dlp/<versao>/_internal/` → o app usa a cópia embutida e avisa. `atual` com conteúdo inválido (`../x`, vazio, versão inexistente) → é ignorado.
- [ ] Rollback para a versão anterior e para a embutida; a coleta de lixo mantém só `atual` e `anterior`; no Windows, atualizar com um `yt-dlp.exe` antigo ainda em execução.
- [ ] macOS: `codesign --verify --deep --strict`, `spctl -a -vv Clipora.app`, `xcrun stapler validate`; `codesign -dv` em uma dylib de `Contents/Helpers/yt-dlp/_internal/` mostra o nosso Team ID.
- [ ] Windows: `Get-AuthenticodeSignature` no instalador, no executável, nos sidecars e em `yt-dlp\yt-dlp.exe` e `yt-dlp\_internal\**\*.dll|*.pyd`; teste com Smart App Control ligado, se possível.
- [ ] Linux: instalar o `.deb` numa máquina que já tenha os pacotes `yt-dlp` e `ffmpeg` da distro (verifica que não há conflito de arquivos).

---

## 8. Próximos passos do Estaleiro (após decisões)
1. ~~Criar `scripts/binarios.lock`, a obtenção do yt-dlp e o build do FFmpeg mínimo~~ (feito em 2026-11-05, seção 4.4), incluindo o modo onedir e a correção VP9 do FFmpeg (§4.3). Falta o FFmpeg para Windows (MSYS2/clang no CI) e testar a fatia x86_64 do universal (Mac Intel ou Rosetta).
2. Criar `.github/workflows/` com a matriz da seção 3 (depende da existência de um repositório remoto e de segredos).
3. Pedir a Ferrugem as mudanças em `tauri.conf.json` (`externalBin` só com ffmpeg/ffprobe, `bundle.macOS.files`/`bundle.resources` do onedir conforme §4.5, `minimumSystemVersion`, assinatura) e a resolução e atualização do yt-dlp (§4.5 item 3 e §6.3). O `.gitignore` já ignora `src-tauri/binaries/`.
4. Quando houver certificados: `scripts/assinar-yt-dlp.mjs` (pré-assinatura do onedir, §4.5 item 4) e os segredos do CI.
5. Opcional: levar a matriz de remux da §4.3 para `scripts/` como teste de regressão do FFmpeg no CI.

---

## 9. Decisões pendentes do usuário

1. **Conta Apple Developer** (US$ 99/ano, pessoa física ou jurídica). Sem ela não há notarização, e no macOS o usuário precisa liberar o app manualmente. Se houver conta: Team ID, certificado Developer ID Application exportado em .p12 e chave da API do App Store Connect para o CI.
2. **Assinatura no Windows**: (a) certificado OV de uma AC, com token ou HSM em nuvem (renovação ~anual, validade máx. 460 dias); (b) Azure Artifact Signing, se a pessoa ou empresa for elegível; (c) SignPath Foundation, se o projeto for open source; ou (d) distribuir sem assinatura e aceitar os avisos do SmartScreen e o bloqueio pelo Smart App Control.
3. **Identifier do app**: hoje é `app.clipora.desktop`. Deve ser um domínio reverso que você controle e é definitivo após a primeira release, porque muda os caminhos de dados (seção 6.2) e a identidade na Apple. Confirmar ou trocar.
4. **Versões mínimas**: Windows 10 22H2 (proposto); macOS **11** (proposto) ou 10.15 (limite do yt-dlp); Linux com base Ubuntu 22.04 / Debian 12. Confirmar.
5. **Arquiteturas**: confirmar Windows arm64 e Linux arm64 na v1. Exigem runners arm64 e máquinas arm64 para o teste real.
6. **macOS universal** (um `.dmg`) ou dois `.dmg` separados (arm64 e x64).
7. **FFmpeg**: build próprio mínimo LGPL (recomendado) ou BtbN `lgpl` (maior, sem macOS).
8. **Onde publicar** os instaladores e o código-fonte correspondente do FFmpeg/yt-dlp (por exemplo, GitHub Releases de um repositório do projeto). Isso define a URL da oferta de código-fonte exigida pelas licenças. Público ou privado?
9. **Mac App Store / Microsoft Store**: fora da v1 (incompatível com o modelo de yt-dlp atualizável no macOS). Confirmar.
10. **Linux**: só AppImage + `.deb`, ou também `.rpm`.
11. ~~**yt-dlp onefile × onedir**~~: **decidido em 2026-11-05: onedir.** A proposta de empacotamento, resolução, assinatura e atualização está em §4.5 e §6. Falta Ferrugem aceitar ou ajustar a proposta e decidir em qual etapa migrar; até lá, o padrão do script continua *onefile* no caminho do sidecar.
