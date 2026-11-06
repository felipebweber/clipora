# Viabilidade do YouTube sem login — 2026-11-06

Executado pelo Timoneiro no macOS arm64, fora do aplicativo e sem alterar seus
binários. yt-dlp empacotado **2026.10.26**, FFmpeg/FFprobe do Clipora e Deno
oficial isolado. Configurações, plugins, cache, cookies importados e componentes
remotos desativados; runtime passado por caminho absoluto, sem sessão do navegador.

## Motor e compatibilidade

O Deno 2.9.8 oficial/hash verificado executou no host atual, mas seu Mach-O
arm64 declarou `minos 12.0`, incompatível com o mínimo macOS 11 do Clipora.
Foi descartado como versão distribuída. O Deno **2.7.0** oficial arm64 foi
verificado por SHA-256 e declarou `minos 11.0`; tornou-se a versão fixada no plano.
Conferir também Intel e os outros sistemas continua obrigatório.

- ZIP 2.7.0 arm64: `1b239846bc513ab3e29a7bf054738c0f937753a6abf3513c95afb320b1f24eb6`.
- Executável extraído: `b7074aa95c2ede178c9705d5ed5cd6121daa0c8f42f702282b37684ccb169781`.
- Metadados oficiais e hashes dos seis alvos estão no [plano](superpowers/plans/2026-11-06-youtube-qualidade.md).

## Acesso e downloads reais

As primeiras extrações, com Deno 2.9.8 somente como ferramenta exploratória no
host atual, obtiveram `media_type=video`, `live_status=not_live` e áudio AAC para
`YE7VzlLtp-4` e `jNQXAC9IVRw`, sem autenticação. A primeira amostra ofereceu alturas
1080/720/480/360/240/144; a segunda 240/144. Isso é uma observação da execução,
não garantia de disponibilidade futura ou qualidade original.

Depois foram baixados arquivos completos com **Deno 2.7.0**, não instalado
globalmente, do vídeo `https://www.youtube.com/watch?v=jNQXAC9IVRw`:

| Escolha | Código de saída | FFprobe | Mídia verificada | Tamanho | Duração da tentativa |
| --- | --- | --- | --- | --- | --- |
| 240p — maior altura elegível nesta amostra | 0 | 0 | H.264 320×240 + AAC; 19,063583 s | 744.378 bytes | 4,08 s |
| 144p | 0 | 0 | H.264 192×144 + AAC; 19,063583 s | 505.983 bytes | 3,44 s |

Finalizações em 16:54:56 e 16:55:00 UTC (13:54:56/13:55:00 em São Paulo).
Não houve timeout. Seleção por altura exata, remux MP4, sem transcodificação;
fallback da expressão exploratória era somente entre formatos da mesma altura.
Os arquivos e resultados locais estão em `.maestri/youtube-preflight/`:
`download-zoo-240.json`, `download-zoo-144.json` e `zoo-deno270-*.mp4`.

O link `https://www.youtube.com/watch?v=tjjjtzRLHvA` retornou `media_type=short`
com Deno 2.7.0, mostrando que a classificação identifica essa amostra de Short
mesmo pelo caminho `/watch`. Nenhuma mídia desse Short foi baixada.

## Conferência adicional dos codecs de maior resolução

Para verificar os dois codecs que podem ser necessários quando AVC não está
disponível numa altura maior, o vídeo `YE7VzlLtp-4` foi baixado integralmente em
1080p, com Deno 2.7.0 e áudio AAC, pelos mesmos sidecars do Clipora:

| Seleção de vídeo | Saída yt-dlp/FFprobe | Arquivo conferido | Tamanho | Tempo |
| --- | --- | --- | --- | --- |
| VP9, formato `248-sr` | 0 / 0 | MP4, 1920×1080 VP9 + AAC, 596,520635 s | 106.582.581 bytes | 13,44 s |
| AV1, formato `399-sr` | 0 / 0 | MP4, 1920×1080 AV1 + AAC, 596,520635 s | 82.055.992 bytes | 12,28 s |

Finalizações em 17:03:28 e 17:03:41 UTC. O yt-dlp emitiu o aviso
`Unknown codec iamf.001.001.Opus` ao enumerar um formato do catálogo. Esse formato
não foi selecionado: os arquivos resultantes têm AAC, confirmado pelo FFprobe.
Não esconder esse aviso como se a saída tivesse sido totalmente limpa.
Evidências locais `download-1080-{vp9,av1}.json` e `bigbuck-1080-{vp9,av1}.mp4`.

O smoke local do solver também passou em Deno 2.7.0 sem permissões de rede/FS:
respostas N/SIG esperadas e parse/generate de programa fixo. A simulação com
fixture JSON local detectou Deno `2.7.0+fb4db33` e EJS `0.8.0`, sem baixar mídia.
Isso valida a viabilidade do mecanismo local de conferência de atualizações,
não os algoritmos que versões futuras do YouTube possam passar a exigir.

## Diagnóstico de assinatura do runtime no macOS

Uma cópia isolada de Deno2.7.0 foi reassinada ad-hoc com hardened runtime e sem
entitlements. O original executou `console.log(42)` com saída0; a cópia sem
entitlements caiu com saída-5 ao executar JavaScript. Reassinar outra cópia com
somente `com.apple.security.cs.allow-jit=true` restaurou a execução e o smoke
N/SIG do solver, ambos saída0 e sem stderr. Nenhuma cópia instalada do app foi
alterada nesse diagnóstico.

Evidências locais: `assinatura-javascript-resumo.json`,
`assinatura-jit-minimo-resumo.json` e `ejs-smoke-assinado-jit-resumo.json`.

A [assinatura do bundler Tauri CLI2.12.4](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.4/crates/tauri-bundler/src/bundle/macos/sign.rs)
aplica os entitlements do app a todos os alvos de assinatura; a
[rotina codesign](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.4/crates/tauri-macos-sign/src/keychain.rs)
não preserva os anteriores automaticamente. Por isso o plano passou a distribuir
Deno em recurso dedicado, como já ocorre com o yt-dlp, assinado pelo fluxo próprio
antes de selar o app. A aceitação do pacote final deverá repetir o solver com o
executável que estiver realmente dentro do pacote.

## Identificador da versão executada

O recurso oficial verificado de Deno 2.7.0 informa `deno 2.7.0+fb4db33
(canary, release, aarch64-apple-darwin)` em `--version`; o yt-dlp também detectou
`deno-2.7.0+fb4db33` no smoke local. A versão-base fixada no lock e no manifesto
continua 2.7.0. A validação da integração deve aceitar o metadado de build SemVer
após `+`, mantendo o hash e recusando outras versões, pré-releases ou prefixos
parciais. Exigir igualdade literal com `2.7.0` recusou esse mesmo recurso no
primeiro teste real do backend T3, antes de qualquer extração de rede.

## O que este teste conclui

O conjunto proposto conseguiu obter e baixar anonimamente um vídeo normal em
duas resoluções exatas, com áudio. Há evidência suficiente para iniciar a
implementação do desenho aprovado.

A interface, o backend novo, a escolha automática final, o updater compatível,
o pacote com Deno, o histórico YouTube e os fluxos completos do Clipora ainda
precisam ser implementados e testados. A reprodução nos players, macOS 11 real,
Intel, Windows e Linux não foram verificados. Este teste
exploratório não é aceitação da funcionalidade pronta ou da distribuição.
