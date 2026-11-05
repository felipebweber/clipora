# Fixtures de teste: yt-dlp, FFmpeg e ffprobe falsos

Responsável: Lince (qualidade). São executáveis falsos para os casos [I] e [E2E] do [roteiro de verificação](../../docs/verificacao.md). Não acessam a rede. São escritos em Node.js, só com módulos nativos (Node ≥ 18; verificado com v24.16.0).

```
tests/fixtures/
├── bin/                     ← aponte CLIPORA_BIN_DIR para cá (macOS/Linux)
│   ├── clipora-yt-dlp       wrappers CommonJS com shebang (#!/usr/bin/env node)
│   ├── clipora-ffmpeg
│   ├── clipora-ffprobe
│   └── package.json         {"type":"commonjs"} para os wrappers sem extensão
├── lib/
│   ├── ytdlp-falso.mjs      lógica do yt-dlp falso
│   ├── ffmpeg-falso.mjs     lógica do ffmpeg/ffprobe falsos
│   ├── cenarios.mjs         lista de cenários (fonte da verdade)
│   └── comum.mjs            registro, formatação, config por pasta
└── preparar-bin.mjs         monta pastas variantes (sem ffmpeg, não executável, cenário fixo)
```

Os testes que provam os cenários estão em [`tests/unit/fixtures.test.mjs`](../unit/fixtures.test.mjs):

```sh
pnpm vitest run tests/unit/fixtures.test.mjs
```

## Como o backend aponta para os fixtures

`CLIPORA_BIN_DIR` está definido pelo coordenador, com a implementação a cargo do Ferrugem:

- Só vale em builds de depuração (`debug_assertions`). Em release, é ignorada.
- Aponta para uma pasta com `clipora-yt-dlp`, `clipora-ffmpeg` e `clipora-ffprobe` (com `.exe` no Windows).
- Quando definida, o backend usa **somente** essa pasta. Se um executável faltar ali, ele é tratado como ausente, sem cair no sidecar empacotado, na cópia atualizada ou no PATH. É isso que permite testar "FFmpeg ausente" e "yt-dlp ausente".
- O backend passa `--ffmpeg-location <CLIPORA_BIN_DIR>/clipora-ffmpeg`, apontando para o **arquivo** (ver [armadilha 4](#armadilhas-reais-que-os-fixtures-reproduzem)).

Exemplo manual:

```sh
CLIPORA_BIN_DIR="$PWD/tests/fixtures/bin" CLIPORA_FALSO_CENARIO=lento pnpm tauri dev
```

Exemplo em teste Rust (cada teste com a própria pasta, sem `std::env::set_var`, que é `unsafe` na edição 2024 e disputado entre testes paralelos):

```rust
// Prepara uma pasta com cenário fixo; o yt-dlp falso lê clipora-falso.json ao lado do executável.
let dir = tempfile::tempdir()?; // ou qualquer pasta temporária própria do teste
let status = std::process::Command::new("node")
    .args(["tests/fixtures/preparar-bin.mjs"]).arg(dir.path())
    .args(["--cenario", "login", "--registro"]).arg(dir.path().join("registro.jsonl"))
    .current_dir(env!("CARGO_MANIFEST_DIR").to_owned() + "/..")
    .status()?;
assert!(status.success());
// Depois, passe dir.path().join("clipora-yt-dlp") e dir.path().join("clipora-ffmpeg") à função testada,
// ou rode o app com CLIPORA_BIN_DIR=dir.
```

## Variáveis de ambiente

Todas são opcionais. Também podem ser postas num `clipora-falso.json` na mesma pasta dos executáveis (`{"CLIPORA_FALSO_CENARIO": "login"}`). Valores já definidos no ambiente têm prioridade sobre o arquivo. Os filhos (o ffmpeg chamado pelo yt-dlp) herdam tudo.

| Variável | Efeito |
| --- | --- |
| `CLIPORA_FALSO_CENARIO` | Nome do cenário (tabela abaixo). Padrão: `sucesso`. |
| `CLIPORA_FALSO_CENARIO_ARQUIVO` | JSON que ajusta ou cria um cenário: `{"base": "sucesso", "metadados": {"title": "X"}, "atrasoMs": 200, "download": {"uniao": false}}`. Campos em `lib/cenarios.mjs`. |
| `CLIPORA_FALSO_REGISTRO` | Arquivo JSONL onde cada processo falso acrescenta eventos (ver [Registro](#registro)). |
| `CLIPORA_FALSO_ATRASO_MS` | Atraso antes de responder. Sobrescreve o do cenário. |
| `CLIPORA_FALSO_INTERVALO_MS` | Intervalo entre linhas de progresso. Padrão: 10 ms, com 5 linhas por parte. |
| `CLIPORA_FALSO_PASTA_FORA` | Pasta onde `caminho-fora` põe o arquivo "fora da pasta de destino". Padrão: `<tmp do sistema>/clipora-fixtures-fora/` (um único `fora.mp4`, sobrescrito). |
| `CLIPORA_FALSO_VERSAO` | Texto de `--version`. Padrão: `2026.10.26`. |
| `CLIPORA_FALSO_PERMISSIVO` | `1` aceita opções desconhecidas, registrando-as em `ignoradas`. Sem isso, opção desconhecida → exit 2, para pegar erros de digitação no backend. |
| `CLIPORA_FFMPEG_FALSO` | `sucesso` (padrão), `falha` (conversão falha, `-version` funciona) ou `quebrado` (até `-version` falha). |
| `CLIPORA_FFPROBE_FALSO` | Mesmos modos, para o ffprobe. |
| `CLIPORA_FFMPEG_ATRASO_MS` | Atraso do ffmpeg e do ffprobe. |

"Ausente" não é um modo: o executável simplesmente não existe. Use `preparar-bin.mjs --sem-ffmpeg`, `--sem-ytdlp` ou `--ytdlp-nao-executavel`.

## Cenários

A coluna "Esperado no backend" é o que o Clipora deve fazer segundo o [contrato v2](../../docs/contrato-ipc.md) e o roteiro. O fixture só produz a saída. As mensagens imitam a saída real do yt-dlp e **devem ser revalidadas com o binário real** de `scripts/binarios.lock` antes de fechar as etapas 3 e 5.

### Prévia / metadados

| Cenário | Comportamento do falso | Esperado no backend |
| --- | --- | --- |
| `sucesso` | JSON de metadados (`id`, `title`, `duration`, `thumbnail`, `requested_formats`…), exit 0 | Prévia normal |
| `lento` | Igual a `sucesso` após 1500 ms (ou `CLIPORA_FALSO_ATRASO_MS`) | Resposta antiga descartada (V2-04, V3-11) |
| `travado` | Nunca termina | `TEMPO_ESGOTADO` em 30 s e processo morto (V3-13) |
| `com-filho` | Cria um filho `node` de longa duração no mesmo grupo e trava. O PID do filho fica no registro (`evento: "filho"`) | Cancelar ou esgotar o tempo mata pai **e** filho (V3-12, V5-25) |
| `sem-titulo-sem-capa` | `title: ""` e sem `thumbnail` | `titulo: null` (não `""`) e `capaDataUrl: null` (V2-08) |
| `post-video-unico` | Vídeo único num link `/p/` | Prévia normal (V3-17) |
| `carrossel` | `_type: "playlist"` com 2 `entries`, exit 0. No download, baixa os 2 | `CONTEUDO_NAO_SUPORTADO` já na prévia (V3-17) |
| `foto` | `ERROR: [Instagram] <id>: There is no video in this post`, exit 1 | `CONTEUDO_NAO_SUPORTADO` |
| `login` | Mensagem do Instagram: "Requested content is not available, rate-limit reached or login required…", exit 1 | `LOGIN_NECESSARIO`. A mensagem também contém "not available" e "rate-limit": a ordem de classificação importa |
| `login-tiktok` | "…Log in for access…", exit 1 | `LOGIN_NECESSARIO` |
| `privado` | "This video is private", exit 1 | `CONTEUDO_PRIVADO_OU_REMOVIDO` |
| `removido` | "Video not available, status code 10204" (sem "unavailable"), exit 1 | `CONTEUDO_PRIVADO_OU_REMOVIDO` |
| `limite` | "HTTP Error 429: Too Many Requests", exit 1 | `LIMITE_DE_ACESSO` |
| `sem-conexao`, `-linux`, `-windows` | "Failed to resolve '<host>' ([Errno 8] …/[Errno -3] …/[Errno 11001] getaddrinfo failed)", exit 1 | `SEM_CONEXAO` nos três textos |
| `extrator-quebrado` | "Unable to extract … Confirm you are on the latest version using  yt-dlp -U", exit 1 | `PREVIA_INDISPONIVEL` com sugestão de atualizar o yt-dlp |
| `json-invalido` | stdout `<html>…`, exit 0 | `PREVIA_INDISPONIVEL` |
| `falha-muda` | Nada em stdout e stderr, exit 1 | `PREVIA_INDISPONIVEL` |
| (URL de outro site) | `ERROR: Unsupported URL: <url>`, exit 1, em qualquer cenário | Não deve chegar ao yt-dlp: a validação do Rust rejeita antes |

### Download

| Cenário | Comportamento do falso | Esperado no backend |
| --- | --- | --- |
| `sucesso` | Vídeo (256 KiB) e áudio (64 KiB) com progresso, união pelo ffmpeg falso, final de 320 KiB, partes apagadas, exit 0 | `concluido` com caminho e tamanho certos (V5-01, V5-02) |
| `arquivo-unico` | Um formato (320 KiB), sem chamar o ffmpeg para converter | `concluido` |
| `progresso-indeterminado` | Progresso sem `total_bytes` nem percentual | `percentual: null` (V5-03) |
| (arquivo final já existe) | Em **qualquer** cenário de download: "has already been downloaded" (só fora do modo silencioso), **exit 0**, imprime em `after_move` o caminho **antigo**, nada alterado | Nunca chegar aqui (nome único antes), ou `ARQUIVO_INCOMPLETO` (V5-10 a V5-13) |
| `ja-baixado` | A mesma mensagem e exit 0, mesmo sem arquivo existente | `ARQUIVO_INCOMPLETO` (V5-13) |
| `sem-arquivo` | Progresso completo, exit 0, nenhum arquivo e nenhum `after_move` | `ARQUIVO_INCOMPLETO` (V5-14) |
| `arquivo-vazio` | Final com 0 bytes, exit 0 | `ARQUIVO_INCOMPLETO` (V5-15) |
| `so-part` | Só `…fv1080.mp4.part`, exit 0 | `ARQUIVO_INCOMPLETO` e limpeza (V5-15) |
| `caminho-fora` | `after_move` com `<CLIPORA_FALSO_PASTA_FORA ou tmp/clipora-fixtures-fora>/fora.mp4` (o arquivo existe e é sobrescrito a cada execução, sem acumular), exit 0 | `ARQUIVO_INCOMPLETO` (V5-16) |
| `rede-cai` | Para a 50% do vídeo: "unable to download video data: ('Connection broken: IncompleteRead…", exit 1, `.part` fica | `SEM_CONEXAO` e limpeza (V5-22) |
| `sem-espaco` | Para a 50%: "[Errno 28] No space left on device", exit 1, `.part` fica | `ESPACO_INSUFICIENTE` (V5-23) |
| `CLIPORA_FFMPEG_FALSO=falha` | "ERROR: Postprocessing: Conversion failed!", exit 1. Ficam `.fv1080.mp4`, `.fa128.m4a` e `.temp.mp4` parcial | `DOWNLOAD_FALHOU` e limpeza (V5-21) |
| FFmpeg ausente/quebrado, sem `-f` | `WARNING: ffmpeg not found…`, baixa um formato **único** de 128 KiB, **exit 0** | `FFMPEG_INDISPONIVEL`, verificado pelo backend **antes** do spawn (V5-20) |
| FFmpeg ausente, com `-f bv*+ba` | `WARNING: … ffmpeg is not installed. The formats won't be merged`, duas partes separadas, exit 0, `after_move` imprime `NA` | `FFMPEG_INDISPONIVEL` (V5-20) |
| `versao-quebrada` | `--version` falha (exit 1) | Atualização rejeitada ou rollback (V6-10, V6-19) |

## Formato da saída

### Metadados

`-J`/`--dump-single-json` imprime um objeto JSON numa linha no stdout. `-j` imprime um por vídeo. Ambos implicam simulação (sem download), salvo com `--no-simulate`. `--print`/`-O` com `video:` ou sem prefixo também simula.

### Progresso

- **Modo silencioso.** `--print`, `-J`, `-j` e `-q` ativam o modo silencioso, como no yt-dlp real. Nele, o progresso **só aparece com `--progress`**, e mensagens de tela e progresso vão para o **stderr**. Fora do modo silencioso, vão para o stdout.
- `--newline`: uma linha por atualização. Sem a opção, as atualizações são separadas por `\r`.
- **Formato padrão:**
  ```
  [download]  25.0% of  256.00KiB at    4.81MiB/s ETA 00:00
  [download] 100% of 256.00KiB in 00:00 at 5.10MiB/s
  ```
  Com tamanho desconhecido: `[download]   64.00KiB at  1.30MiB/s (00:00)`.
- **Duas partes.** O percentual vai de 0 a 100 **duas vezes**, vídeo e depois áudio. O percentual global é responsabilidade do backend.
- **`--progress-template`.** Aceita `download:` (ou nenhum prefixo) com `%(progress.CAMPO)s`, `%(info.CAMPO)s` e `%(progress)j`.
  - Campos de `progress`: `status`, `downloaded_bytes`, `total_bytes` (ausente se desconhecido), `speed`, `eta`, `elapsed`, `filename`, `tmpfilename`, `_percent_str`, `_total_bytes_str`, `_downloaded_bytes_str`, `_speed_str`, `_eta_str`, `_elapsed_str`.
  - Campos de `info` (da parte em andamento): `id`, `title`, `format_id` (`v1080`/`a128`/`b`), `ext`, `vcodec`, `acodec`.
  - Campo ausente vira `NA`, como no real.
  - Sugestão para o backend: `--progress-template 'download:[clipora] %(info.vcodec)s %(progress.downloaded_bytes)s %(progress.total_bytes)s'`. Distinguir vídeo e áudio por `vcodec != none`.

### Caminho final

- `--print after_move:filepath` (ou `after_move:%(filepath)s`) imprime o caminho final no **stdout**, uma linha, depois da união e da movimentação.
- `-P`/`--paths` (`home:`, `temp:` ou pasta simples) e `-o`/`--output` com `%(title)s`, `%(id)s` e `%(ext)s` (padrão `%(title)s [%(id)s].%(ext)s`). A `/` no título vira `⧸`.
- Arquivos intermediários: `<base>.f<format_id>.<ext>.part` → `<base>.f<format_id>.<ext>` → união em `<base>.temp.mp4` → `<base>.mp4`. Partes vão para `temp:`, se definido.

## Armadilhas reais que os fixtures reproduzem

1. **`--print` silencia o progresso.** Sem `--progress`, não há nenhuma linha de progresso, e com ela as linhas vão para o stderr.
2. **Arquivo existente = exit 0 com o caminho antigo.** O backend precisa escolher um nome livre antes e conferir o resultado. Exit 0 sozinho não prova nada.
3. **FFmpeg ausente não falha.** Sem `-f`, o yt-dlp troca para um formato único e sai com 0. O backend deve conferir o FFmpeg antes de iniciar.
4. **`--ffmpeg-location <pasta>` procura `ffmpeg`, não `clipora-ffmpeg`.** Passe o caminho do arquivo. Risco a validar com o yt-dlp real: com um arquivo de nome prefixado, o yt-dlp pode procurar o ffprobe como `<pasta>/ffprobe`, e não `clipora-ffprobe`. Se for o caso, os nomes com prefixo de `docs/distribuicao.md` precisam de ajuste, por exemplo uma pasta privada com `ffmpeg`/`ffprobe`.
5. **Opções proibidas** (`--exec`, `--cookies*`, `--username`/`--password`, `--netrc*`, `-U`/`--update*`, `--no-check-certificates`, `--batch-file`, `--load-info-json`, `--config-locations`) → exit 2 com "opção proibida pelo contrato do Clipora". Opções desconhecidas → exit 2.

## Registro

Com `CLIPORA_FALSO_REGISTRO`, cada processo acrescenta linhas JSON:

```json
{"ts":"…","pid":4135,"ppid":4130,"programa":"yt-dlp","evento":"inicio","argv":["--ignore-config","…","--","https://…"],"cwd":"…","cenario":"sucesso","separador":true,"urls":["https://…"],"urlsAntesDoSeparador":[],"ignoradas":[]}
{"ts":"…","pid":4135,"programa":"yt-dlp","evento":"ffmpeg","disponivel":true,"origem":"ffmpeg-location","caminho":"…/clipora-ffmpeg"}
{"ts":"…","pid":4136,"ppid":4135,"programa":"ffmpeg","evento":"inicio","argv":["-version"],"modo":"sucesso"}
{"ts":"…","pid":4135,"programa":"yt-dlp","evento":"fim","codigo":0}
```

Outros eventos: `filho` (`filhoPid`), `ja-baixado` (`final`), `caminho-fora` (`fora`) e `erroOpcao` no `inicio`. Um processo morto por sinal **não** registra `fim`.

## Windows (pendente)

O Windows ignora o shebang, e o backend não deve executar `.cmd`/`.bat`: o Rust passa por `cmd.exe`, o que contradiz "sem shell" e altera o escape de URLs com `&`. Proposta para quando houver máquina Windows na matriz:

1. **Preferida:** um lançador nativo mínimo em Rust (crate só de teste, por exemplo `tests/fixtures/lancador`, sem dependências). Compilado como `clipora-yt-dlp.exe`, `clipora-ffmpeg.exe` e `clipora-ffprobe.exe`, ele faz `Command::new("node").arg(<lib>/…-falso.mjs).args(args)`, repassa stdin, stdout e stderr e devolve o código de saída. Os testes de árvore de processos continuam válidos porque o Job Object mata o lançador, o node e os filhos.
2. **Alternativa:** Node SEA (single executable application) para gerar `.exe` autocontidos. Mais pesado e depende da versão do Node.

Até lá, os fixtures funcionam no macOS e no Linux. `tests/unit/fixtures.test.mjs` é pulado inteiro no Windows.

## Limitações

- As mensagens imitam o yt-dlp, mas são aproximações: revalidar com o binário real (V3-18, V5-27).
- Processa apenas a primeira URL. O subconjunto de templates é o descrito acima. `-f` só é examinado para a presença de `+`.
- Sem rede: a `thumbnail` aponta para hosts reais de CDN, mas nada é baixado. Para testar a capa (V3-16), use um cenário com `metadados.thumbnail` apontando para um servidor HTTPS local de teste.
