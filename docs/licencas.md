# Licenças dos componentes distribuídos com o Clipora

Responsável: Estaleiro (distribuição). Complementa [distribuicao.md](distribuicao.md).

**Data de consulta das fontes: 2026-11-05.** Este documento é um levantamento técnico e **não é parecer jurídico**. Se o Clipora for distribuído comercialmente ou em larga escala, recomenda-se revisão por advogado (ver “Decisões pendentes”).

---

## 1. Resumo

| Componente distribuído | Licença efetiva do que vamos redistribuir | Obrigações principais |
|---|---|---|
| yt-dlp, código-fonte | Unlicense (domínio público) | Nenhuma obrigatória |
| **yt-dlp, binário PyInstaller** (`yt-dlp.exe`, `yt-dlp_macos`, `yt-dlp_linux`…) | **GPLv3+** (obra combinada), com componentes PSF, MIT, BSD, Apache-2.0, LGPL etc. | Incluir o texto da GPLv3 e o `THIRD_PARTY_LICENSES.txt`; disponibilizar o código-fonte correspondente; não impor restrições adicionais |
| **FFmpeg (build próprio mínimo, recomendado)** | **LGPL v2.1+** (sem `--enable-gpl` e sem `--enable-nonfree`) | Publicar o código-fonte exato, a linha de `configure` e eventuais patches junto dos binários; avisos no site e na tela “Sobre” |
| FFmpeg de terceiros com `--enable-gpl` (gyan.dev, evermeet.cx, BtbN `gpl`) | GPL v2+ (ou v3 com `--enable-version3`) | Iguais às da GPL; **evitar** |
| FFmpeg com `--enable-nonfree` | **Não redistribuível** | Proibido distribuir |
| Código do Clipora (Tauri, Rust, React) | A definir pelo usuário | Avisos das dependências, gerados por `scripts/gerar-licencas.mjs` e incluídos em cada pacote |

Como o Clipora executa o yt-dlp e o FFmpeg como **processos separados** (linha de comando), sem ligá-los ao executável do app, a interpretação usual (FAQ da GPL sobre “agregação”) é que a licença do Clipora **não** fica sujeita à GPL/LGPL. As obrigações recaem sobre a redistribuição desses binários. **[validar com assessoria jurídica se houver uso comercial]**

---

## 2. yt-dlp

### 2.1 Fatos [verificado no README e nos arquivos do repositório]
- O código-fonte é **Unlicense**: “This is free and unencumbered software released into the public domain.” <https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE>
- Do README, seção *Licensing*: “While yt-dlp is licensed under the Unlicense, many of the release files contain code from other projects with different licenses. **Most notably, the PyInstaller-bundled executables include GPLv3+ licensed code, and as such the combined work is licensed under GPLv3+.**” <https://github.com/yt-dlp/yt-dlp#release-files>
- O repositório Git, o sdist e o wheel do PyPI contêm apenas código Unlicense. O executável *zipimport* `yt-dlp` e o `yt-dlp.tar.gz` contêm também código ISC (meriyah) e MIT (astring).
- O `THIRD_PARTY_LICENSES.txt` lista os componentes embutidos nos binários: <https://github.com/yt-dlp/yt-dlp/blob/master/THIRD_PARTY_LICENSES.txt>. Entre eles:
  - **GPL**: GNU Readline (GPL-3.0-or-later), mutagen (GPL-2.0-or-later), libgcc/libstdc++ (GPL-3.0 com GCC Runtime Library Exception).
  - **LGPL**: libidn2 e libunistring (LGPL-3.0-or-later), libintl (LGPL-2.1-or-later).
  - **Outras**: Python (PSF-2.0), OpenSSL (Apache-2.0; OpenSSL 1.x só nos `.exe`), curl/curl_cffi/curl-impersonate, BoringSSL, certifi (MPL-2.0), brotli, zstd, sqlite (domínio público), zlib, bzip2, liblzma, websockets, requests, urllib3, PyCryptodome, código distribuível da Microsoft (somente builds Windows) etc.

### 2.2 Por que usar o binário PyInstaller mesmo sendo GPLv3+
A alternativa só com Unlicense/MIT/ISC (`yt-dlp` *zipimport*) exige Python 3.11+ instalado no sistema (README: “Python versions 3.11+ … are supported”), o que contraria a especificação (“sem exigir instalação manual de dependências”). Por isso a recomendação é **redistribuir os binários PyInstaller oficiais e cumprir a GPLv3**.

### 2.3 Obrigações ao redistribuir o binário (GPLv3 §4–§6) e como cumprir
1. **Texto da licença**: incluir o texto completo da GPLv3 e o `THIRD_PARTY_LICENSES.txt` da **mesma tag** do binário.
2. **Código-fonte correspondente**: a GPLv3 §6 permite entregar o código junto com o binário, oferecê-lo por escrito (válido por 3 anos) ou, quando o binário é distribuído pela rede, dar acesso equivalente ao código “no mesmo lugar”, com instruções claras de onde encontrá-lo (§6(d)). Proposta prática:
   - publicar, na mesma página de release do Clipora, o `yt-dlp.tar.gz` da tag embutida, o `THIRD_PARTY_LICENSES.txt` e um link para o workflow de build do yt-dlp naquela tag (`.github/workflows/build.yml`);
   - **[validar juridicamente]** se é preciso espelhar também o código dos componentes GPL de terceiros (por exemplo, Readline) ou se basta apontar para a release do yt-dlp. O mais conservador é espelhar.
3. **Sem restrições adicionais**: o EULA ou os termos do Clipora não podem proibir engenharia reversa, modificação ou redistribuição do yt-dlp, nem impor condições contrárias à GPL sobre ele.
4. **Atualizações baixadas pelo app** (seção 6 de distribuicao.md): o app baixa o binário direto do GitHub do yt-dlp, por ação do usuário. Para essas cópias, quem as distribui é o próprio projeto yt-dlp. Mesmo assim, a tela de licenças deve indicar a versão em uso e onde obter o código daquela versão.
5. Assinar o binário com o nosso certificado (macOS/Windows) não altera a licença e não conflita com a GPLv3 para software de desktop.

---

## 3. FFmpeg

### 3.1 Fatos [verificado]
- `LICENSE.md` do FFmpeg: “Most files in FFmpeg are under the GNU LGPL v2.1 or later… In combination the LGPL v2.1+ applies to FFmpeg.” As partes GPL “are not used by default, you have to explicitly pass `--enable-gpl` … In this case, FFmpeg's license changes to GPL v2+.” `--enable-version3` muda para (L)GPLv3. <https://github.com/FFmpeg/FFmpeg/blob/master/LICENSE.md>
- `--enable-nonfree` (por exemplo, fdk-aac) gera binários **não redistribuíveis**. <https://ffmpeg.org/legal.html>
- Bibliotecas GPL comuns em builds prontos: libx264, libx265, libxvid, rubberband, vidstab etc. O BtbN descreve a variante `lgpl` como “lacking libraries that are GPL-only. Most prominently libx264 and libx265” **[fonte]**. <https://github.com/BtbN/FFmpeg-Builds>
- Builds prontos citados pelo ffmpeg.org: gyan.dev (Windows, GPL), BtbN (Windows/Linux, GPL ou LGPL), evermeet.cx (macOS Intel, configurado com `--enable-gpl` **[verificado]**). Não há build LGPL pronto e oficial para macOS arm64.

### 3.2 Checklist de conformidade LGPL do ffmpeg.org, adaptado ao Clipora
Fonte: <https://ffmpeg.org/legal.html> (“License Compliance Checklist”). Escrito para quem **liga** as bibliotecas ao próprio programa; no nosso caso o `ffmpeg`/`ffprobe` é executável separado, então alguns itens mudam:

| Item do checklist | Aplicação no Clipora |
|---|---|
| Compilar sem `--enable-gpl` e sem `--enable-nonfree` | **Sim**: build próprio mínimo (distribuicao.md §4.3). |
| Usar ligação dinâmica | Não se aplica: o Clipora não liga libav*, apenas executa o `ffmpeg`. Um `ffmpeg` estático é, ele próprio, uma obra LGPL completa. |
| Distribuir o código-fonte do FFmpeg, modificado ou não, correspondendo exatamente ao binário | **Sim**: publicar o tarball oficial usado (ex.: `ffmpeg-8.1.3.tar.xz`) no mesmo lugar dos instaladores. |
| `git diff > changes.diff` e arquivo com a linha de `configure` | **Sim**: publicar `ffmpeg-build-info.txt` (versão, SHA-256 do tarball, `configure` completo por alvo, compilador) e `changes.diff`, vazio se não houver patches. |
| Hospedar o código no mesmo servidor do binário | **Sim**: mesma página de release. |
| Texto em toda página de download: “This software uses code of FFmpeg licensed under the LGPLv2.1 and its source can be downloaded here” | **Sim**: versão em português na página de download. |
| Mencionar na tela “Sobre”: “This software uses libraries from the FFmpeg project under the LGPLv2.1” | **Sim**: proposta de texto: “Este software usa o FFmpeg, do projeto FFmpeg, sob a licença LGPLv2.1.” Depende de quem implementa a interface. |
| EULA: mencionar o uso do FFmpeg sob LGPLv2.1, não reivindicar a propriedade dele e não proibir engenharia reversa | **Sim**, se houver EULA. |
| Não renomear DLLs de forma ofuscada; prefixo ou sufixo é aceitável | Usaremos `clipora-ffmpeg`/`clipora-ffprobe` (prefixo). Acrescentar a observação “clipora-ffmpeg é o FFmpeg sem modificações” na tela de licenças. |
| Escrever “FFmpeg” corretamente | Sim. |
| Repetir o checklist para bibliotecas LGPL externas compiladas junto | O build mínimo não usa bibliotecas externas (`--disable-autodetect`). |
| Garantir que nenhuma biblioteca GPL entrou | Verificar no CI: `ffmpeg -version` não pode conter `--enable-gpl` e `ffmpeg -L` deve indicar LGPL. |

### 3.3 Recomendação de build por sistema
| Sistema | Recomendado | Alternativa aceitável | Evitar |
|---|---|---|---|
| Windows x64/arm64 | Build próprio mínimo **LGPL** a partir do tarball oficial assinado | BtbN `lgpl` (estático) com tag mensal fixa | gyan.dev (GPL), qualquer `gpl`/`nonfree` |
| macOS arm64/x64 | Build próprio mínimo **LGPL** (combinado com `lipo` em universal) | nenhuma pronta e confiável | evermeet.cx (GPL, só Intel) |
| Linux x64/arm64 | Build próprio mínimo **LGPL** na base Ubuntu 22.04 | BtbN `lgpl` | `gpl`/`nonfree` |

### 3.4 Build efetivo do Clipora (registro exigido pela LGPL)
Gerado por `scripts/compilar-ffmpeg.mjs` (flags em `FLAGS_COMUNS` e `flagsAlvo`; manter este trecho sincronizado). Cada build também grava `src-tauri/binaries/ffmpeg-build-info-<triple>.txt`, que deve ser publicado junto do código-fonte.

- **Código-fonte**: <https://ffmpeg.org/releases/ffmpeg-8.1.3.tar.xz>, SHA-256 `7138d28c96d9d3e3af4ee3d8cad72741f8ffb40da90c1112235dea3ecd3178a3`, assinatura `.asc` verificada com a chave de release do FFmpeg `FCF986EA15E6E293A5644F10B4322F04D67658D8`. **Sem modificações** (`changes.diff` vazio).
- **Flags comuns a todos os alvos**:
  ```
  --disable-gpl --disable-nonfree --disable-version3 --disable-autodetect --disable-everything
  --disable-network --disable-doc --disable-ffplay --disable-debug --enable-ffmpeg --enable-ffprobe
  --enable-static --disable-shared --extra-version=clipora
  --enable-protocol=file,pipe
  --enable-demuxer=mov,matroska,mp3,aac,mpegts,hls,concat
  --enable-muxer=mp4,mov,ipod,matroska,webm,mpegts,adts,mp3
  --enable-parser=vp8,vp9,av1,h264,hevc,aac,opus,mpegaudio,ac3
  --enable-bsf=vp9_superframe,vp9_superframe_split,aac_adtstoasc,extract_extradata,h264_mp4toannexb,hevc_mp4toannexb,av1_frame_merge,av1_frame_split,setts,null
  --enable-decoder=aac,mp3,vp9
  ```
- **Flags por alvo**:
  - macOS (`aarch64`/`x86_64`): `--cc=clang --arch=<aarch64|x86_64> --target-os=darwin --enable-cross-compile --extra-cflags='-arch <arm64|x86_64> -mmacosx-version-min=11.0' --extra-ldflags='-arch <arm64|x86_64> -mmacosx-version-min=11.0'`, mais `--disable-x86asm` em x86_64. O universal é o `lipo -create` das duas arquiteturas.
  - Linux x86_64: `--disable-x86asm`. Linux aarch64: nenhuma.
  - Windows (`x86_64`/`aarch64`, compilação cruzada com llvm-mingw `20261020`): `--arch=<arch> --target-os=mingw32 --enable-cross-compile --cross-prefix=<arch>-w64-mingw32- --cc=<arch>-w64-mingw32-clang --enable-w32threads --extra-ldflags=-static`, mais `--disable-x86asm` em x86_64. O runtime mingw-w64 e o compiler-rt ligados estaticamente têm licenças permissivas (ZPL/MIT/BSD, e Apache-2.0 com exceção LLVM); não muda a licença LGPL do build **[validar a lista exata de avisos do mingw-w64 se exigida]**.
- **Componentes resultantes [verificado em 2026-11-05, aarch64-apple-darwin]**: `-encoders` vazio (nenhum codificador); `-decoders` = só `vp9`, `aac` e `mp3`; `-bsfs` = os da lista mais `pgs_frame_merge` e `vvc_mp4toannexb`, que o `configure` liga sozinho como dependências dos muxers; `ffmpeg -L` declara “GNU Lesser General Public License … version 2.1 or later”. Liga apenas bibliotecas do sistema (`libSystem`, `CoreFoundation`, `CoreVideo`, `CoreMedia`), que se enquadram na exceção de bibliotecas do sistema da LGPL.
- **Por que há decodificadores** (eles só servem para o `libavformat` descobrir parâmetros do fluxo; o app não transcodifica):
  - `aac`, `mp3`: sem eles, o *fixup* de HLS do yt-dlp (MPEG-TS → MP4 com `aac_adtstoasc`) falha com “sample rate not set”.
  - `vp9`: sem ele, o *muxer* MP4 não sabe o formato de pixel do VP9 (“Unsupported pixel format (-1)”) e grava uma caixa `vpcC` vazia. O arquivo resultante é inválido: tanto o nosso `ffprobe` quanto o do Homebrew recusam com “Empty VP Codec Configuration box”. Foi o que aconteceu com um Reel do Instagram (VP9 + AAC) em 2026-11-05. Parsers e bsfs **não** resolvem: um build experimental com todos eles e sem o decodificador `vp9` reproduziu o erro (detalhes em `docs/distribuicao.md` §4.3).

**Patentes**: o ffmpeg.org lembra que H.264, AAC e outros padrões podem estar sujeitos a patentes em algumas jurisdições. Um build só de *remux*, sem codificadores e com o mínimo de decodificadores (hoje só VP9, AAC e MP3, §3.4; o VP9 é publicado pelo Google com licença de patentes gratuita), reduz essa exposição, mas **não** a elimina. É tema para revisão jurídica se houver uso comercial. <https://ffmpeg.org/legal.html>

---

## 4. Demais componentes

### 4.1 Crates Rust (ligadas ao executável do Clipora) [verificado em 2026-11-05 com cargo-about 0.9.2]
`cargo about generate` (configuração em `scripts/licencas/about.toml`) foi conferido com cargo-about 0.9.2 nas plataformas do projeto. A troca de `sequoia-openpgp` por `pgp` (rPGP 0.21.0) foi aplicada no núcleo. **Não há exceções LGPL para sequoia/buffered-reader** em `about.toml`; o gerador falha quando encontra licença não aprovada.
- A árvore atual inclui `bzip2-1.0.6`, dependência permissiva do `libbz2-rs-sys` usada pelo parser OpenPGP. Seu aviso de copyright e licença precisa permanecer nos avisos distribuídos; por isso a licença está aceita em `about.toml` sem suprimir o texto correspondente.
- **MPL-2.0** (`cssparser`, `cssparser-macros`, `dtoa-short`, `selectors`, dependências do Tauri/WebKit, e `option-ext`): copyleft **por arquivo**. Exige oferecer o código-fonte dos arquivos MPL usados (basta apontar para a versão publicada no crates.io) e manter os avisos. Não alcança o restante do Clipora.

### 4.2 npm (empacotado pelo Vite na interface)
`pnpm licenses list --prod`: `@tauri-apps/api` 2.12.4 (Apache-2.0 OR MIT), `react` e `react-dom` 19.3.1 e `scheduler` 0.28.0 (MIT). O gerador inclui o arquivo `LICENSE` de cada um.

### 4.3 Outros
- **WebView2**: com o modo padrão `downloadBootstrapper`, o runtime não é redistribuído por nós. Se usarmos `offlineInstaller`/`fixedVersion`, valem os termos de redistribuição da Microsoft. **[revisar se mudar o modo]**
- **WebKitGTK** (Linux, LGPL): é dependência do sistema no `.deb`/`.rpm`. O **AppImage** pode embutir bibliotecas do sistema via linuxdeploy; nesse caso, verificar quais bibliotecas LGPL entram e publicar avisos e fontes correspondentes. **[validar ao gerar o primeiro AppImage no CI]**
- **Runtime mingw-w64 / compiler-rt** no FFmpeg de Windows: licenças permissivas, ligadas estaticamente (§3.4). **[validar se precisam de aviso próprio]**

---

## 5. Entregáveis de conformidade

### 5.1 Implementados (2026-11-05)
1. **`scripts/gerar-licencas.mjs`** (no CI: passo “THIRD_PARTY_LICENSES” de cada alvo) gera em `src-tauri/binaries/licencas/`:
   - `THIRD_PARTY_LICENSES.txt` (~740 KB), com quatro seções:
     1. **yt-dlp**: versão, URL do binário e do `yt-dlp.tar.gz` da mesma tag, link para o workflow de build, `THIRD_PARTY_LICENSES.txt` do próprio build PyInstaller e texto da GPLv3;
     2. **FFmpeg**: aviso exigido pelo ffmpeg.org, URL e SHA-256 da fonte exata, linha de `configure` completa do alvo e texto da LGPL-2.1;
     3. **crates Rust** (cargo-about, por alvo; o universal junta as duas fatias);
     4. **npm** de produção;
   - `licencas.json`: resumo estruturado (componentes, versões, licenças, links) para a tela “Sobre / Licenças”.
   - Textos GPL/LGPL vendorizados de fonte verificada (`scripts/licencas/LEIAME.md`). Falha se o build do FFmpeg tiver `--enable-gpl|nonfree|version3` ou se o yt-dlp extraído não for a versão do lock.
2. **Verificação no CI** (estágio `ffmpeg`): falha se o `configure` registrado tiver `--enable-gpl|nonfree|version3` ou não tiver `--disable-gpl`/`--disable-nonfree`. Onde executável, exige `-L` LGPL e 0 codificadores. Os SHA-256 do yt-dlp são conferidos contra o lock e o `SHA2-256SUMS` assinado.

### 5.2 Incluído no pacote e pendente de publicação
- `tauri.conf.json` inclui `binaries/licencas/` como recurso para os três sistemas. `scripts/conferir-pacote.mjs` exige `THIRD_PARTY_LICENSES.txt` e `licencas.json` em cada pacote e falha se faltar ou se aparecer conteúdo extra na pasta `licencas/`.
- Continua pendente a página/release com instaladores, `SHA256SUMS`, código-fonte correspondente do FFmpeg e yt-dlp e avisos públicos. O destino de hospedagem ainda depende do usuário.

### 5.3 Tela “Sobre e licenças”
A tela foi implementada por Vitral em `src/componentes/SobreLicencas.tsx` e está integrada à configuração. Lê `licencas/licencas.json` do pacote por comando Rust de leitura e disponibiliza os avisos completos por uma ação do app. Exibe a versão do yt-dlp em uso, os componentes principais, as licenças de crates/npm, links de fonte e um link para o FFmpeg. Os links externos abrem pelo comando Rust, fora da webview. Os testes de interface estão em `src/componentes/SobreLicencas.test.tsx`. A funcionalidade está implementada; o texto final da tela ainda aguarda definição do usuário, e a revisão visual no app empacotado e em ambos os temas depende de teste interativo.

---

## 6. Decisões pendentes do usuário
1. **Licença do próprio Clipora** (proprietária, MIT, GPL…) e se o código será público. Isso afeta, por exemplo, a elegibilidade à SignPath Foundation.
2. **Distribuição gratuita ou comercial**. No caso comercial, recomenda-se revisão jurídica (GPLv3 do yt-dlp, patentes de codecs, termos de uso do Instagram/TikTok).
3. **Onde hospedar** os instaladores e o código-fonte correspondente (mesmo servidor, exigência prática da LGPL/GPL), por quanto tempo manter e quem responde a pedidos de código-fonte (contato para a oferta escrita, se usada).
4. **EULA ou termos de uso**: haverá? Se sim, precisa das cláusulas da seção 3.2 e não pode restringir o yt-dlp nem o FFmpeg.
5. **FFmpeg**: confirmar o build próprio mínimo LGPL (recomendado) em vez de builds prontos.
6. **Espelhar ou não** o código-fonte dos componentes GPL de terceiros embutidos no binário PyInstaller do yt-dlp (opção conservadora: espelhar).
7. **Texto final** da tela “Sobre / Licenças” (funcionalidade já implementada; ver §5.3) e da página de download (aviso do FFmpeg em português).
