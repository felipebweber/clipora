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

## O que este teste conclui

O conjunto proposto conseguiu obter e baixar anonimamente um vídeo normal em
duas resoluções exatas, com áudio. Há evidência suficiente para iniciar a
implementação do desenho aprovado.

A interface, o backend novo, a escolha automática final, o updater compatível,
o pacote com Deno, o histórico YouTube e os fluxos completos do Clipora ainda
precisam ser implementados e testados. Não foram comprovados aqui outros codecs,
reprodução nos players, macOS 11 real, Intel, Windows nem Linux. Este teste
exploratório não é aceitação da funcionalidade pronta ou da distribuição.
