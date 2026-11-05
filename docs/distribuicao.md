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
| yt-dlp embutido | Binários PyInstaller oficiais do GitHub (`yt-dlp.exe`, `yt-dlp_arm64.exe`, `yt-dlp_macos`, `yt-dlp_linux`, `yt-dlp_linux_aarch64`), com versão fixa, verificação de SHA-256 e da assinatura GPG de `SHA2-256SUMS`. |
| FFmpeg embutido | Build **próprio, mínimo e LGPL** (apenas remux, sem `--enable-gpl`), compilado a partir do tarball oficial assinado do ffmpeg.org, para os 6 alvos. Inclui `ffmpeg` e `ffprobe`. |
| Nomes dos sidecars | `clipora-yt-dlp`, `clipora-ffmpeg`, `clipora-ffprobe` (com prefixo, para não colidir com `/usr/bin/yt-dlp` e `/usr/bin/ffmpeg` no `.deb`/`.rpm`). |
| yt-dlp atualizável | Cópia em `app_local_data_dir()/bin/` (fora do pacote assinado), baixada pelo próprio app via HTTPS, com verificação GPG + SHA-256, troca atômica e cópia anterior preservada. Não usar `yt-dlp -U`. |
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

**Proposta de layout (mudança em `tauri.conf.json` a pedir para Ferrugem):**

```jsonc
// src-tauri/tauri.conf.json (trecho proposto — NÃO aplicado)
"bundle": {
  "externalBin": [
    "binaries/clipora-yt-dlp",
    "binaries/clipora-ffmpeg",
    "binaries/clipora-ffprobe"
  ]
}
```

| Target triple | yt-dlp (asset oficial → arquivo local) | FFmpeg/ffprobe |
|---|---|---|
| `x86_64-pc-windows-msvc` | `yt-dlp.exe` → `clipora-yt-dlp-x86_64-pc-windows-msvc.exe` | build próprio win64 |
| `aarch64-pc-windows-msvc` | `yt-dlp_arm64.exe` → `clipora-yt-dlp-aarch64-pc-windows-msvc.exe` | build próprio winarm64 |
| `universal-apple-darwin` | `yt-dlp_macos` → `clipora-yt-dlp-universal-apple-darwin` | build próprio arm64 + x64 combinado com `lipo` |
| `aarch64-apple-darwin` / `x86_64-apple-darwin` | `yt-dlp_macos` (o mesmo arquivo universal) | build próprio por arquitetura |
| `x86_64-unknown-linux-gnu` | `yt-dlp_linux` → `clipora-yt-dlp-x86_64-unknown-linux-gnu` | build próprio linux64 |
| `aarch64-unknown-linux-gnu` | `yt-dlp_linux_aarch64` → `clipora-yt-dlp-aarch64-unknown-linux-gnu` | build próprio linuxarm64 |

**[validar]** o sufixo `-universal-apple-darwin` no primeiro build universal (o bundler substitui `-{target}`, e o target nesse caso é `universal-apple-darwin`).

**Notas para o núcleo (registrar, a repassar a Ferrugem pelo coordenador):**
- Passar ao yt-dlp `--ffmpeg-location <caminho absoluto de clipora-ffmpeg>`. O yt-dlp deriva o ffprobe trocando “ffmpeg” por “ffprobe” no nome do arquivo (`clipora-ffmpeg` → `clipora-ffprobe`, inclusive com `.exe`) **[verificado no código: `yt_dlp/postprocessor/ffmpeg.py::_determine_executables`]**. Assim não depende do `PATH`.
- Considerar `--ignore-config` (ou `--no-config-locations`) e `--no-update`, para que uma configuração do yt-dlp do usuário não altere o comportamento do app.
- Os binários PyInstaller *onefile* se extraem num diretório temporário a cada execução: a partida é mais lenta (ordem de 1 s) e exige um `TMPDIR` gravável **[validar tempos]**.

### 4.2 yt-dlp: origem e integridade
- **Origem oficial**: releases do GitHub `yt-dlp/yt-dlp`. Última estável na consulta: **2026.10.26** (publicada em 2026-10-26) **[verificado via API do GitHub]**. <https://github.com/yt-dlp/yt-dlp/releases>
- **Integridade**: cada release publica `SHA2-256SUMS`, `SHA2-512SUMS` e as assinaturas GPG `SHA2-256SUMS.sig` e `SHA2-512SUMS.sig`. A chave pública fica em <https://github.com/yt-dlp/yt-dlp/blob/master/public.key> **[verificado]**. Procedimento oficial:
  ```sh
  curl -L https://github.com/yt-dlp/yt-dlp/raw/master/public.key | gpg --import
  gpg --verify SHA2-256SUMS.sig SHA2-256SUMS
  sha256sum -c --ignore-missing SHA2-256SUMS
  ```
  A API do GitHub também expõe `digest: sha256:...` por asset **[verificado]**, que serve de verificação cruzada mas não substitui a assinatura.
- Teste local (macOS, 2026-11-05): `yt-dlp_macos` e `yt-dlp.exe` da 2026.10.26 baixados com `curl`; `shasum -a 256 -c` → **OK** para os dois **[verificado]**. A verificação GPG **não** foi executada porque não há `gpg` instalado nesta máquina; o script de obtenção deve fazê-la no CI.
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
- **Execução local não testada**: rodar `yt-dlp_macos --version` foi bloqueado pela política de permissões desta sessão. Fica pendente para o teste de pacote (etapa 7, último item).
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
- Ponto de partida do `configure` (**[validar]** com links reais do Instagram/TikTok e com os *fixups* do yt-dlp):
  ```sh
  ./configure --disable-gpl --disable-nonfree --disable-autodetect \
    --disable-doc --disable-ffplay --disable-network --disable-everything \
    --enable-ffmpeg --enable-ffprobe --enable-static --disable-shared \
    --enable-protocol=file,pipe \
    --enable-demuxer=mov,matroska,mp3,aac,mpegts,hls,concat \
    --enable-muxer=mp4,mov,ipod,matroska,webm,mpegts,adts,mp3 \
    --enable-parser=h264,hevc,aac,av1,vp9,opus,mpegaudio \
    --enable-bsf=aac_adtstoasc,h264_mp4toannexb,hevc_mp4toannexb,extract_extradata,vp9_superframe \
    --enable-decoder=aac,mp3,opus,h264,hevc,vp9,av1 # só p/ ffprobe/metadados; remover se dispensável
  ```
  A lista de componentes deve ser ajustada pelos testes da etapa 5 (merge, `FFmpegFixupM3u8PP`, `FFmpegFixupDuplicateMoovPP`, `FFmpegFixupTimestampPP`). Se faltar algo, ampliar a lista em vez de mudar para GPL.
- **Alternativa mais rápida**: BtbN `lgpl` com tag mensal fixa (nunca `latest`) para Windows e Linux, mais build próprio só no macOS. Desvantagens: pacotes muito maiores e duas origens diferentes.
- Em qualquer opção: guardar no repositório, no script de obtenção, a URL exata, o SHA-256 esperado e a impressão digital da chave PGP, e falhar o build se algo divergir.
- Fontes: <https://ffmpeg.org/download.html>, <https://ffmpeg.org/legal.html>, <https://github.com/BtbN/FFmpeg-Builds>, <https://github.com/yt-dlp/FFmpeg-Builds>, <https://www.gyan.dev/ffmpeg/builds/>, <https://evermeet.cx/ffmpeg/>

### 4.4 Script de obtenção (a criar em `scripts/`)
Ainda não criado, pois esta tarefa era só documentação. Especificação:
1. Recebe o target triple; lê `scripts/binarios.lock` (versão do yt-dlp, URL, SHA-256 por asset, impressão digital da chave GPG; versão do FFmpeg, SHA-256 do tarball, impressão digital da chave).
2. Baixa o asset do yt-dlp, `SHA2-256SUMS` e `.sig`; verifica a assinatura GPG contra a chave fixada; confere o SHA-256 contra o arquivo de somas **e** contra o lock.
3. Baixa e verifica o tarball do FFmpeg (`.asc`), compila com a configuração da seção 4.3 e combina com `lipo` no macOS.
4. Grava `src-tauri/binaries/clipora-*-<triple>[.exe]` com permissão 755. Esse diretório deve ir para o `.gitignore`; pedir a Ferrugem.
5. No Windows, assina os sidecars com o certificado do projeto antes do `tauri build`. **Não confirmei no código do bundler que o Tauri assine `externalBin` no Windows**; no macOS ele assina, de dentro para fora, junto com o `.app` **[verificado em `macos/app.rs`]**.

---

## 5. Assinatura e notarização

### 5.1 macOS
- **Requisitos [fonte]**: Apple Developer Program pago (US$ 99/ano); certificado **Developer ID Application**, que só o *Account Holder* pode criar; um Mac para assinar; **notarização** obrigatória com Developer ID; *Hardened Runtime* obrigatório para notarizar.
- Credenciais para o Tauri: `APPLE_CERTIFICATE` (.p12 em base64), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` e, para notarizar, **ou** `APPLE_API_ISSUER` + `APPLE_API_KEY` + `APPLE_API_KEY_PATH` (chave da API do App Store Connect, preferível no CI) **ou** `APPLE_ID` + `APPLE_PASSWORD` (senha de app) + `APPLE_TEAM_ID`.
- O Tauri assina sidecars e frameworks antes do `.app`, aplicando a **mesma** configuração de entitlements e Hardened Runtime a todos os executáveis **[verificado em `macos/app.rs` e `macos/sign.rs`]**.
- **Risco principal [validar]**: o `yt-dlp_macos` é PyInstaller *onefile*. Assinado de novo com Hardened Runtime, ele extrai bibliotecas Python com assinatura ad-hoc para o diretório temporário e as carrega. A validação de bibliotecas do Hardened Runtime pode recusar essas bibliotecas. Opções, em ordem de preferência:
  1. Testar sem entitlements extras. Pode funcionar.
  2. Adicionar `com.apple.security.cs.disable-library-validation` (e, se preciso, `com.apple.security.cs.allow-unsigned-executable-memory`). O Tauri aplicaria isso também ao executável principal: enfraquece pouco, mas a Apple recomenda o mínimo de entitlements.
  3. Usar `yt-dlp_macos.zip` (*onedir*) e assinar cada dylib com a nossa identidade.
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

### 6.2 Local proposto
`app_local_data_dir()/bin/` (Tauri `PathResolver`), resolvido como `local_data_dir/<identifier>` **[verificado em `crates/tauri/src/path/desktop.rs`]**:

| Sistema | Caminho (identifier atual `app.clipora.desktop`) |
|---|---|
| Windows | `%LOCALAPPDATA%\app.clipora.desktop\bin\clipora-yt-dlp.exe` (Local, não Roaming: binário não deve sincronizar entre máquinas) |
| macOS | `~/Library/Application Support/app.clipora.desktop/bin/clipora-yt-dlp` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/app.clipora.desktop/bin/clipora-yt-dlp` |

Se o `identifier` mudar antes da primeira release, os caminhos mudam junto. Por isso convém decidir o identifier antes de publicar (seção 9).

### 6.3 Fluxo recomendado (para o núcleo; registrar, não aplicar)
1. **Seleção do binário**: usar a cópia do app data se existir, passar na verificação (manifesto com versão e SHA-256 conferidos ao iniciar) e for mais nova que a embutida; caso contrário, usar o sidecar embutido. O sidecar é sempre o *fallback* funcional.
2. **Verificar versão disponível**: `GET https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest` (tag), com tolerância a limite de taxa e ausência de rede.
3. **Atualizar (só por ação do usuário e nunca durante download)**: baixar o asset do sistema, `SHA2-256SUMS` e `SHA2-256SUMS.sig` por HTTPS com `reqwest`; **verificar a assinatura GPG com a chave pública do yt-dlp embutida no app** (impressão digital fixada; crates como `pgp`/`sequoia-openpgp`, a avaliar); conferir o SHA-256; gravar num arquivo temporário no mesmo diretório; `chmod 755`; testar com `--version`; renomear atomicamente; manter a versão anterior como `.old` para rollback; gravar o manifesto.
4. Escolher o asset por SO e arquitetura **em tempo de execução** (por exemplo, `yt-dlp_arm64.exe` em Windows ARM), com o mesmo mapeamento da tabela 4.1.

### 6.4 Implicações por sistema
- **macOS: quarentena e Gatekeeper.** Arquivos baixados pelo próprio app com `reqwest` (app sem App Sandbox) não recebem `com.apple.quarantine`, então o Gatekeeper não avalia o executável. Teste local: o `yt-dlp_macos` baixado com `curl` ficou só com `com.apple.provenance`, sem `com.apple.quarantine` **[verificado]**. Como o binário oficial é ad-hoc e o `spctl` o **rejeita** **[verificado]**, ele **nunca** pode receber quarentena: não baixar via navegador ou `NSWorkspace`; se o atributo aparecer, removê-lo só depois de verificar a assinatura GPG e o hash. **Não habilitar App Sandbox**, porque apps em sandbox colocam quarentena em tudo o que gravam. A cópia do app data roda **sem** o nosso Hardened Runtime (é outro executável), o que evita o problema da seção 5.1 nas versões atualizadas. **[validar]** a execução real no macOS 11 e no mais recente.
- **Windows: SmartScreen e Smart App Control.** O SmartScreen de reputação de arquivo age sobre arquivos com *Mark-of-the-Web* (`Zone.Identifier`), que navegadores e anexos adicionam; um download via `reqwest` não adiciona MOTW **[validar]**. O **Smart App Control**, quando ligado, pode bloquear o `yt-dlp.exe` atualizado por não ter assinatura **[fonte + verificado sem Authenticode]**. Nesse caso a atualização deve falhar de forma limpa, manter o sidecar embutido (assinado por nós) e explicar a situação ao usuário. Políticas corporativas (AppLocker/WDAC) costumam bloquear executáveis em `%LOCALAPPDATA%`: registrar como limitação conhecida. O antivírus pode colocar o PyInstaller em quarentena **[validar]**.
- **Linux: AppImage imutável.** A atualização só funciona fora da imagem; o app data em `~/.local/share` resolve. Se `$HOME` estiver montado com `noexec` (raro), o binário atualizado não executa e o app deve cair no embutido. Para o `.deb`/`.rpm` vale o mesmo caminho.

---

## 7. Checklist de testes de pacote (etapa 7, último item)
Para cada artefato (Win x64, Win arm64, macOS arm64, macOS x64, Linux x64, Linux arm64):
- [ ] Instalar a partir de download pelo navegador (para exercitar SmartScreen/Gatekeeper com MOTW/quarentena reais).
- [ ] `clipora-yt-dlp --version` e `clipora-ffmpeg -version` executam a partir do pacote instalado.
- [ ] Prévia, escolha de pasta, download com merge de vídeo e áudio, abertura da pasta.
- [ ] Atualização manual do yt-dlp: sucesso, sem rede, arquivo adulterado (o hash ou a assinatura devem falhar), falha no meio da gravação (rollback).
- [ ] macOS: `codesign --verify --deep --strict`, `spctl -a -vv Clipora.app`, `xcrun stapler validate`.
- [ ] Windows: `Get-AuthenticodeSignature` no instalador, no executável e nos sidecars; teste com Smart App Control ligado, se possível.
- [ ] Linux: instalar o `.deb` numa máquina que já tenha os pacotes `yt-dlp` e `ffmpeg` da distro (verifica que não há conflito de arquivos).

---

## 8. Próximos passos do Estaleiro (após decisões)
1. Criar `scripts/binarios.lock` e `scripts/obter-binarios.*` (seção 4.4) e o build do FFmpeg mínimo.
2. Criar `.github/workflows/` com a matriz da seção 3 (depende da existência de um repositório remoto e de segredos).
3. Pedir a Ferrugem as mudanças em `tauri.conf.json` (`externalBin`, `minimumSystemVersion`, assinatura, entitlements) e no `.gitignore`.

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
