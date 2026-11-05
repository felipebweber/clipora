# Roteiro de verificação do Clipora

Responsável: Lince (qualidade). Cobre as etapas 2 a 8 do [plano](../plano-clipora.md), conforme a [especificação](../projeto-aplicativo.md), o [contrato IPC](contrato-ipc.md), a [distribuição](distribuicao.md) e as [licenças](licencas.md).

> **Sincronização com o contrato v2.** Os nomes de comandos, campos e códigos de erro seguem `docs/contrato-ipc.md` v2, na versão da árvore de trabalho em 2026-11-05 (`CodigoErro`, `capaDataUrl`, `abrir_pasta_download`, `Channel<EventoDownload>`). Divergências entre código, contrato e roteiro contam como **reprovado** até a correção de um dos três.
>
> **Decisões do coordenador (2026-11-05):**
> - Links `http://` são aceitos e normalizados para `https://` antes de chamar o yt-dlp (V3-04).
> - Post `/p/` com um único vídeo é aceito. Carrossel com vários itens, ou foto, retorna `CONTEUDO_NAO_SUPORTADO` na v1 (V3-17).
> - Saída 0 sem arquivo final válido retorna `ARQUIVO_INCOMPLETO` (V5-13 a V5-16). Isso inclui arquivo inexistente, 0 bytes, só `.part`, "has already been downloaded" ou caminho fora da pasta.
>
> - yt-dlp ausente ou não executável retorna o novo código `YTDLP_INDISPONIVEL`, a ser acrescentado ao contrato pelo Ferrugem (V3-15).
> - Falha de rede, resolução ou conexão durante o download retorna `SEM_CONEXAO`. `DOWNLOAD_FALHOU` fica só como genérico (V5-22).
>
> **Fixtures:** os executáveis falsos e os cenários estão em [`tests/fixtures/`](../tests/fixtures/README.md).

## Como usar

- Cada caso tem um identificador (`V<etapa>-<nn>`), passos, critério de **aprovado** e, quando não for o inverso óbvio, de **reprovado**.
- Uma etapa só é declarada concluída quando todos os casos aplicáveis estão aprovados, ou têm pendência registrada e aceita pelo coordenador.
- Registre cada execução na [planilha de resultados](#registro-de-resultados) com data, commit, sistema, resultado e evidência (saída do comando, captura de tela ou caminho de log). **Sem evidência, o caso não conta como aprovado.**

### Tipos de verificação

| Marca | Significado |
| --- | --- |
| **[U]** | Automatizável: teste unitário (Vitest no frontend, `cargo test` no Rust). |
| **[I]** | Automatizável: integração no Rust com **yt-dlp falso** e/ou **servidor HTTP local** (ver [Fixtures](#fixtures-de-teste)). Sem rede externa. |
| **[E2E]** | Automatizável: ponta a ponta no app em `tests/e2e/` (WebDriver do Tauri; no macOS não há driver oficial, então o caso também é executado manualmente lá). |
| **[C]** | Automatizável: verificação estática de configuração (lê `tauri.conf.json`, `capabilities/*.json` e `Cargo.toml`). |
| **[M]** | Manual, executado uma vez num sistema de desenvolvimento. |
| **[M-SO]** | Manual, **obrigatório em cada sistema e arquitetura** da [matriz](#matriz-de-sistemas). |
| **[REAL]** | Depende de links públicos reais do Instagram/TikTok. O resultado pode mudar por decisão das plataformas; falha aqui não é necessariamente defeito, mas a mensagem exibida deve ser clara e correta. |

### Matriz de sistemas

A matriz abaixo é pretendida. As arquiteturas, os mínimos e os formatos finais dependem do usuário e estão na lista consolidada de decisões reservadas em [distribuicao.md §9](distribuicao.md#9-decisões-pendentes-do-usuário). Nenhuma dessas decisões foi tomada nesta atualização.

Pretendido: Windows 10 22H2+/11 x64 e arm64; macOS 11+ arm64 e x64 (pacote universal); Linux x64 e arm64 com WebKitGTK 4.1 (Ubuntu 22.04 / Debian 12 como base). Casos **[M-SO]** devem ter uma linha de resultado por combinação. Combinações sem máquina disponível são registradas como **não verificado**. Aprovar macOS arm64 não conclui a matriz.

### Fixtures de teste

Propostas para tornar os casos [I] e [E2E] reproduzíveis sem rede externa:

1. **yt-dlp falso** (`tests/fixtures/ytdlp-falso`): executável controlado por variáveis de ambiente ou arquivo de cenário. Ele:
   - grava os argumentos recebidos (um por linha) num arquivo, para conferência;
   - simula atraso, saída de progresso (`--newline`), JSON de metadados, códigos de saída e mensagens reais de `stderr` (login exigido, HTTP 429, privado, removido, "has already been downloaded");
   - cria arquivos `.part`, arquivos finais vazios ou ausentes, e processo filho (para testar a árvore de processos).
2. **ffmpeg falso**: tem sucesso, falha ou é ausente.
3. **Servidor HTTP local de atualização**: publica `SHA2-256SUMS`, `SHA2-256SUMS.sig`, `_update_spec` e binários. Os cenários incluem hash errado, assinatura errada, arquivo truncado, conexão cortada no meio, HTTP 403/429, redirecionamento para outro host e resposta lenta. Usa uma **chave GPG de teste**, injetada só em builds de teste. A chave oficial fixada no app nunca é substituível em produção.
4. **Pasta temporária por teste**, com permissões ajustáveis (`chmod` no Unix, ACL no Windows) e remoção durante a execução.

---

## Transversal: CSP, capabilities e execução de processos

Executar a cada etapa a partir da 3 e obrigatoriamente na 8.

| ID | Caso | Passos | Aprovado se | Tipo |
| --- | --- | --- | --- | --- |
| VT-01 | CSP definida | Ler `app.security.csp` em `tauri.conf.json`. | Não é `null`. Contém `default-src 'self'`, `script-src 'self'` (sem `unsafe-eval`/`unsafe-inline`), `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'` e `img-src` sem `*`. `freezePrototype: true`. | [C] |
| VT-02 | Capabilities mínimas | Ler `src-tauri/capabilities/*.json`. | Não há `opener:*`, `shell:*`, `fs:*`, `dialog:*`, `http:*` nem `process:*`. Só `core:*` necessário, com cada exceção justificada em comentário ou na revisão. | [C] |
| VT-03 | Webview não abre URL arbitrária | Na janela do app (devtools em build de depuração), chamar `window.__TAURI_INTERNALS__.invoke('plugin:opener\|open_url', { url: 'https://example.com' })` e `...reveal_item_in_dir` com `/etc` ou `C:\Windows`. | Ambos rejeitados por permissão. Nada abre. | [M] / [E2E] |
| VT-04 | Script injetado nos metadados | yt-dlp falso devolve título `<img src=x onerror=alert(1)>` e `</title><script>…`. | O título aparece como texto literal. Nenhum script executa e nenhuma requisição a `x` aparece no devtools/console. | [E2E] |
| VT-05 | Imagem externa bloqueada pela CSP | Em devtools, inserir `<img src="https://example.com/a.png">`. | O console registra violação de CSP e a imagem não carrega. A capa da prévia continua funcionando (data URL vinda do Rust). | [M] |
| VT-06 | Sem shell na execução | Inspecionar o código de spawn e rodar VT-07. | Todo processo é criado com `Command::new(<caminho absoluto>)` e argumentos em lista. Não há `sh -c`, `cmd /C`, `powershell` nem `Command::new("yt-dlp")` dependente do PATH. | [U] (revisão + teste) |
| VT-07 | Injeção via URL | Enviar, por IPC direto (sem passar pela validação da interface), URLs como `-o /tmp/x`, `--exec 'touch /tmp/pwn' https://www.tiktok.com/@a/video/1`, `https://www.tiktok.com/@a/video/1;touch /tmp/pwn`, `$(touch /tmp/pwn)` e `` `touch /tmp/pwn` ``. | Rejeitadas com `LINK_INVALIDO`, ou repassadas depois de `--` como um único argumento (conferir no log do yt-dlp falso). O arquivo `/tmp/pwn` nunca é criado. | [I] |
| VT-08 | Argumentos fixos do yt-dlp | Capturar os argumentos no yt-dlp falso, na prévia e no download. | Presentes: `--ignore-config`, `--no-playlist`, `--ffmpeg-location <caminho empacotado>` (download) e `--` antes da URL. Ausentes: `--exec`, `--cookies*` e `--username`. | [I] |
| VT-09 | Config do usuário ignorada | Criar `~/.config/yt-dlp/config` (ou `%APPDATA%\yt-dlp\config.txt`) com `--exec "touch /tmp/pwn"` e `-o /tmp/%(id)s`. Fazer um download. | Nenhum efeito do arquivo: o destino é a pasta escolhida e `/tmp/pwn` não existe. | [I] + [M-SO] |
| VT-10 | Binário empacotado prevalece | Colocar no PATH outro `yt-dlp` e outro `ffmpeg` (scripts que gravam um marcador). | Os marcadores nunca são gravados e o app usa os sidecars `clipora-*`, ou a cópia atualizada do yt-dlp. | [I] + [M-SO] |
| VT-11 | Sem janela de console (Windows) | Prévia e download em build de release no Windows. | Nenhuma janela de console pisca. | [M-SO] (Windows) |

---

## Etapa 2 — Interface inicial (dados simulados)

| ID | Caso | Passos | Aprovado se | Tipo |
| --- | --- | --- | --- | --- |
| V2-01 | Estado inicial "aguardando link" | Abrir o app. | O campo de link tem foco ou é o primeiro na ordem de tabulação. O botão Baixar está desabilitado. Não há prévia, progresso ou erro visível. | [U] + [E2E] |
| V2-02 | Transições de estado | Com o simulador: colar link válido → carregando prévia → pronto → baixar → baixando → concluído. Repetir terminando em erro em cada fase. | Cada estado mostra só os controles permitidos (tabela V2-03). Nenhuma transição inválida, como concluído sem ter passado por baixando. | [U] |
| V2-03 | Ações bloqueadas por estado | Para cada estado, tentar: Baixar, editar o link, abrir configurações, alterar a pasta, atualizar o yt-dlp e abrir a pasta. | Baixar só funciona em "pronto". Alterar a pasta e atualizar o yt-dlp ficam bloqueados em "baixando". "Abrir pasta" só aparece em "concluído". Editar o link durante "baixando" não altera o download em curso. Controles bloqueados usam `disabled` ou `aria-disabled` e explicam o motivo. | [U] |
| V2-04 | Resposta atrasada (simulada) | Simulador: prévia A demora 2 s, prévia B demora 0,2 s. Colar A e, logo em seguida, B. | Só a prévia de B aparece. A resposta de A é descartada pelo `requisicaoId`. Nenhum flash de título ou capa de A. | [U] |
| V2-05 | A→B→A | Colar A, depois B, depois A de novo antes de as respostas chegarem. | Aparece a prévia da última requisição. As respostas antigas, inclusive a da primeira A, são descartadas. | [U] |
| V2-06 | Erro cancelado não aparece | Simulador rejeita a prévia anterior com `PREVIA_CANCELADA`. | Nenhuma mensagem de erro é exibida. O estado segue a requisição atual. | [U] |
| V2-07 | Mensagens por código | Para cada código de erro do contrato, renderizar o estado de erro. | Todo código tem texto em português, específico e acionável (diz o que aconteceu e o que fazer). Nenhum código cru, texto em inglês ou `stderr` à mostra. Código desconhecido usa a mensagem genérica de `ERRO_INTERNO`. | [U] |
| V2-08 | Prévia sem capa / sem título | Simulador devolve `capaDataUrl: null` e `titulo: null`. | Aparece um espaço reservado e um texto como "Sem título". Nenhuma imagem quebrada e nenhum dado de outra prévia. | [U] |
| V2-09 | Progresso determinado e indeterminado | Simulador emite percentuais 0→100, depois `percentual: null`, e etapas `baixando_video` → `baixando_audio` → `unindo`. | A barra usa `role="progressbar"` com `aria-valuenow` quando há percentual. Sem `aria-valuenow` (modo indeterminado) quando é `null`. A etapa aparece em português. O percentual não regride na interface. | [U] |
| V2-10 | Teclado | Percorrer o fluxo inteiro só com Tab, Shift+Tab, Enter, Espaço e Esc. | Todo controle é alcançável, a ordem é lógica e o foco é visível. Enter no campo inicia a prévia ou o download conforme o estado. Esc fecha as configurações e devolve o foco a quem as abriu. | [E2E] + [M] |
| V2-11 | Rótulos e anúncios | Inspecionar a árvore de acessibilidade (VoiceOver no macOS, Narrador ou NVDA no Windows, Orca no Linux). | O campo tem rótulo associado e os botões têm nome acessível. Mudanças de estado (prévia carregada, erro, concluído) são anunciadas por `aria-live`. `html lang="pt-BR"` e título da janela "Clipora". | [U] (testing-library) + [M] |
| V2-12 | Contraste e zoom | Tema claro e escuro, se houver; zoom de 200%. | Contraste de texto ≥ 4,5:1. Nada é cortado nem sobreposto a 200%. | [M] |
| V2-13 | Sem dependência externa | Rodar a interface em modo simulado sem rede. | O fluxo completo funciona e não há requisições externas no devtools. | [E2E] / [M] |

---

## Etapa 3 — yt-dlp e prévias

### Validação de links ([U], no Rust, que é autoritativo, e no pré-filtro do frontend)

| ID | Entrada | Esperado |
| --- | --- | --- |
| V3-01 | `https://www.instagram.com/reel/ABC123/`, `https://instagram.com/reels/ABC123`, `https://www.instagram.com/p/ABC123/?igsh=xyz`, `https://m.instagram.com/reel/ABC123/` | Aceito, plataforma `instagram` |
| V3-02 | `https://www.tiktok.com/@usuario/video/7300000000000000000`, `https://vm.tiktok.com/ZM1234/`, `https://vt.tiktok.com/ZS1234/`, `https://www.tiktok.com/t/ZT1234/`, `https://m.tiktok.com/v/7300000000000000000.html` | Aceito, plataforma `tiktok` |
| V3-03 | Link com espaços nas pontas ou quebra de linha (colado de mensagem) | Aceito após `trim` |
| V3-04 | `http://www.instagram.com/reel/ABC123/`, `http://vm.tiktok.com/ZM1234/` | Aceito. `urlNormalizada` começa com `https://`, e o argumento depois de `--` no yt-dlp falso (`argumentos.jsonl`) também começa com `https://` |
| V3-05 | `ftp://instagram.com/reel/1`, `file:///etc/passwd`, `javascript:alert(1)`, `data:…` | `LINK_INVALIDO` |
| V3-06 | `https://instagram.com.evil.com/reel/1`, `https://evil.com/?u=instagram.com/reel/1`, `https://evilinstagram.com/reel/1` → `PLATAFORMA_NAO_SUPORTADA` (host comparado exatamente). `https://user:pass@www.tiktok.com/@a/video/1`, `https://www.tiktok.com:8443/@a/video/1`, `https://www.tiktok.com:443/@a/video/1` → `LINK_INVALIDO` (sem credenciais, sem porta, nem a padrão) | Rejeitado com o código indicado |
| V3-07 | `https://www.youtube.com/watch?v=x` → `PLATAFORMA_NAO_SUPORTADA`. `https://www.instagram.com/usuario/` (perfil), `https://www.instagram.com/stories/u/1/`, `https://www.tiktok.com/@usuario` (perfil) → `LINK_INVALIDO` | Rejeitado com o código indicado, sem iniciar processo |
| V3-08 | Texto vazio, `abc`, URL com 10 000 caracteres, caracteres de controle | `LINK_INVALIDO` sem iniciar processo e sem travar |
| V3-09 | Host com IDN/punycode parecido (`іnstagram.com` com i cirílico) | `PLATAFORMA_NAO_SUPORTADA` (vira `xn--…` e não bate com a lista) |

### Prévia

| ID | Caso | Passos | Aprovado se | Tipo |
| --- | --- | --- | --- | --- |
| V3-10 | Prévia automática | Colar link válido. | A prévia é pedida sem clique extra (com debounce). O título e a capa aparecem. Nenhum download começa. | [I] + [E2E] |
| V3-11 | Resposta atrasada real | yt-dlp falso: A responde em 3 s, B em 0,5 s. Colar A e depois B. | Só B é exibida. O processo de A é **encerrado** (conferir que o PID não existe mais) e A rejeita com `PREVIA_CANCELADA`. | [I] |
| V3-12 | Digitação rápida | Alterar o link 20 vezes em 2 s. | No máximo um processo de prévia vivo por vez. Ao fim, não há processos órfãos (`ps`/Gerenciador de Tarefas). | [I] |
| V3-13 | Tempo esgotado | yt-dlp falso nunca responde. | Depois do limite do contrato: `TEMPO_ESGOTADO`, processo encerrado, interface liberada para novo link. | [I] |
| V3-14 | Falhas mapeadas | yt-dlp falso devolve no `stderr`: login exigido, "Private video"/conteúdo privado, removido, HTTP 429, erro de rede/DNS, post só com foto, extrator quebrado, saída não JSON, exit ≠ 0 sem mensagem. Cenários de fixture: `login`, `privado`, `removido`, `limite`, `sem-conexao`, `foto`, `extrator-quebrado`, `json-invalido`, `falha-muda`. | Respectivamente: `LOGIN_NECESSARIO`, `CONTEUDO_PRIVADO_OU_REMOVIDO`, `CONTEUDO_PRIVADO_OU_REMOVIDO`, `LIMITE_DE_ACESSO`, `SEM_CONEXAO`, `CONTEUDO_NAO_SUPORTADO`, `PREVIA_INDISPONIVEL` (com sugestão de atualizar o yt-dlp), `PREVIA_INDISPONIVEL`, `PREVIA_INDISPONIVEL`. A mensagem 429 contém "unavailable" e **não** pode virar `CONTEUDO_PRIVADO_OU_REMOVIDO`. Nada da prévia anterior permanece na tela. | [I] |
| V3-15 | yt-dlp ausente ou não executável | `preparar-bin.mjs --sem-ytdlp` / `--ytdlp-nao-executavel` (ou remover o sidecar). Testar na prévia e no download. | `YTDLP_INDISPONIVEL` nos dois fluxos, com mensagem que sugere reinstalar. Sem panic. | [I] |
| V3-16 | Capa | Metadados com miniatura válida, miniatura 404, miniatura > limite de tamanho, Content-Type `text/html`. | Válida: aparece como data URL. Nos demais casos: prévia sem capa (`capaDataUrl: null`) com o título mantido, sem erro global. | [I] |
| V3-17 | Post `/p/`, carrossel e foto | Fixtures `post-video-unico`, `carrossel` e `foto`, e links reais equivalentes. | `/p/` com um único vídeo: prévia normal. Carrossel com vários itens (`_type: "playlist"`) ou foto: `CONTEUDO_NAO_SUPORTADO`. Nunca vários downloads, nem o primeiro item em silêncio. | [I] + [REAL] |
| V3-18 | Links reais | Prévia de 3 Reels públicos e 3 TikToks públicos (incluindo um link curto `vm.tiktok.com`). | Título e capa corretos, ou erro claro coerente com o que o yt-dlp informa. Registrar quais links foram usados e a data. | [REAL] [M-SO] |

---

## Etapa 4 — Pasta de destino

| ID | Caso | Passos | Aprovado se | Tipo |
| --- | --- | --- | --- | --- |
| V4-01 | Primeiro download pede a pasta | Config vazia → prévia → Baixar. | `iniciar_download` rejeita com `PASTA_NAO_DEFINIDA` e o seletor nativo abre. | [I] + [E2E] |
| V4-02 | Cancelar o seletor | No V4-01, cancelar. | O download **não** começa, nenhum processo yt-dlp é criado e a prévia continua pronta. Nenhuma mensagem de erro alarmante. | [E2E] + [M-SO] |
| V4-03 | Escolher e persistir | Escolher a pasta → download → fechar e reabrir o app. | O segundo download não pede pasta. As configurações mostram o caminho escolhido. | [I] + [M-SO] |
| V4-04 | Alterar nas configurações | Configurações → Alterar → escolher outra. | O próximo download vai para a nova pasta, que continua persistida após reiniciar. | [E2E] + [M] |
| V4-05 | Cancelar a alteração | Configurações → Alterar → cancelar. | Mantém a pasta anterior (config inalterada byte a byte). | [I] |
| V4-06 | Pasta removida | Escolher a pasta, fechar o app, apagar a pasta, reabrir e baixar. | `PASTA_AUSENTE`, mensagem pedindo outra pasta e seletor oferecido. O app não recria a pasta silenciosamente e não grava em outro lugar. | [I] + [M-SO] |
| V4-07 | Sem permissão de escrita | Unix: `chmod 555 <pasta>`. Windows: negar Gravar na ACL. Baixar. | `PASTA_SEM_PERMISSAO` **antes** de iniciar o yt-dlp, e seletor oferecido. | [I] + [M-SO] |
| V4-08 | Seleção inválida | No seletor, escolher uma pasta sem permissão de escrita. | `selecionar_pasta_destino` rejeita com `PASTA_SEM_PERMISSAO` e não persiste. O arquivo temporário de teste de escrita não fica para trás. | [I] |
| V4-09 | Caminho que virou arquivo | Apagar a pasta e criar um arquivo com o mesmo nome. | `PASTA_AUSENTE` (ou código equivalente do contrato). Nada é gravado. | [I] |
| V4-10 | Pasta removida durante o download | Iniciar um download lento e apagar a pasta. | Erro de pasta (`PASTA_AUSENTE`), sem "concluído" e sem arquivo em outro local. | [I] |
| V4-11 | Config corrompida | Gravar JSON inválido, vazio ou com tipo errado no arquivo de config e reabrir. | O app abre e trata como `nao_definida`. Sem panic. A config inválida é substituída só após nova escolha. | [I] |
| V4-12 | Caminhos difíceis | Pasta com espaços, acentos, emoji, `'`, `"`, `$` e caminho longo (> 260 caracteres no Windows). | Download e abertura da pasta funcionam. O caminho é exibido corretamente. | [I] + [M-SO] |
| V4-13 | Locais especiais | Unidade de rede/SMB, pasta do OneDrive/iCloud, pendrive removido entre execuções. | Funciona ou dá erro claro de pasta. Nunca há falso sucesso. | [M-SO] |
| V4-14 | Diálogo pelo Rust | Revisar capability e código. | O seletor é aberto por comando Rust. O webview não tem `dialog:*`. | [C] |

---

## Etapa 5 — Download e resultado

### Fluxo e progresso

| ID | Caso | Passos | Aprovado se | Tipo |
| --- | --- | --- | --- | --- |
| V5-01 | Download bem-sucedido | yt-dlp falso com vídeo e áudio separados + ffmpeg falso de sucesso. | `concluido` com caminho final existente, tamanho > 0 e sem `.part` ou temporários na pasta. Botão "Abrir pasta" disponível. | [I] |
| V5-02 | Progresso determinado | yt-dlp falso emite percentuais em duas partes (vídeo e áudio). | A interface recebe percentual global não decrescente de 0 a 100, com as etapas na ordem e no máximo cerca de 10 eventos/s. | [I] |
| V5-03 | Progresso indeterminado | yt-dlp falso sem total (`N/A`). | `percentual: null` e a barra em modo indeterminado. Nunca exibe um percentual inventado. | [I] |
| V5-04 | Sem corrida de eventos | yt-dlp falso conclui ou falha imediatamente (< 10 ms). | O frontend recebe o evento terminal (via `Channel`). A interface não fica presa em "baixando". | [I] + [E2E] |
| V5-05 | Um download por vez | Durante um download, chamar `iniciar_download` de novo por IPC direto. | `DOWNLOAD_EM_ANDAMENTO`. O primeiro download não é afetado. | [I] |
| V5-06 | Recarregar o webview | Durante o download, recarregar a página (build de depuração). | `obter_estado` devolve o download ativo e a interface volta a mostrar o progresso. | [E2E] / [M] |
| V5-07 | Abrir pasta | Após concluir, clicar "Abrir pasta". | O gerenciador de arquivos abre a pasta com o arquivo selecionado, quando o sistema permite. | [M-SO] |
| V5-08 | Abrir pasta não aceita caminho arbitrário | Por IPC direto, chamar `abrir_pasta_download` com `downloadId` inexistente, com o id de um download que falhou, ou com campo extra `caminho` forjado. | Rejeitado. Nada abre. | [I] |

### Colisão de nomes e falso sucesso

| ID | Caso | Passos | Aprovado se | Tipo |
| --- | --- | --- | --- | --- |
| V5-10 | Arquivo já existe | Criar na pasta `Título [id].mp4` com conteúdo conhecido. Baixar o mesmo vídeo. | Novo arquivo `Título [id] (2).mp4`. O original fica **intacto** (mesmo hash e mesma data de modificação). `renomeado: true`. A interface mostra o nome final. | [I] |
| V5-11 | Tentativas repetidas | Baixar o mesmo vídeo 3 vezes seguidas. | Três arquivos distintos: sem sufixo, (2) e (3). Nenhum sobrescrito. | [I] |
| V5-12 | Corrida na finalização | Criar o arquivo com o nome final escolhido entre o fim do download e a finalização (gancho no yt-dlp falso). | O arquivo criado por terceiro fica intacto. O app usa o próximo nome livre, sem `fs::rename` sobrescrevendo. | [I] |
| V5-13 | "has already been downloaded" com exit 0 | yt-dlp falso imprime a mensagem, sai com 0 e não cria arquivo novo. | `ARQUIVO_INCOMPLETO`. **Não** reporta sucesso. Nenhum arquivo existente é apresentado como resultado (fixture `ja-baixado`). | [I] |
| V5-14 | Exit 0 sem arquivo | yt-dlp falso sai com 0 sem gerar arquivo nem `after_move:filepath`. | `ARQUIVO_INCOMPLETO`. Nunca "concluído" (fixture `sem-arquivo`). | [I] |
| V5-15 | Arquivo vazio ou `.part` residual | yt-dlp falso deixa o final com 0 bytes, ou só `.part`. | `ARQUIVO_INCOMPLETO`. O temporário é removido e a pasta do usuário fica sem lixo (fixtures `arquivo-vazio` e `so-part`). | [I] |
| V5-16 | Caminho informado fora da pasta | yt-dlp falso imprime `after_move:filepath` apontando para `/tmp/outro.mp4`. | `ARQUIVO_INCOMPLETO`. O app não anuncia arquivo fora da pasta de destino (fixture `caminho-fora`). | [I] |
| V5-18 | Carrossel detectado só no download | Fixture `download-varios-itens`: a prévia passa (vídeo único), mas o yt-dlp baixa 2 itens e emite 2 linhas `after_move`. Chamar `iniciar_download` direto, sem prévia. | `CONTEUDO_NAO_SUPORTADO`. Nenhum arquivo finalizado na pasta de destino e `.clipora-*` removida. Nunca "concluído" com só o último item. | [I] |
| V5-17 | Sanitização de nomes | Títulos com `/ \ : * ? " < > \|`, emoji, só espaços, `CON`, `NUL.txt`, 500 caracteres e ponto final. | O nome resultante é válido em Windows, macOS e Linux, tem até ~200 bytes e preserva o id. Funciona nos três sistemas. | [U] + [M-SO] |

### FFmpeg e falhas

| ID | Caso | Passos | Aprovado se | Tipo |
| --- | --- | --- | --- | --- |
| V5-20 | FFmpeg ausente | Remover o sidecar `clipora-ffmpeg` e baixar um vídeo que exige união. | `FFMPEG_INDISPONIVEL`, sem sucesso parcial (nada de entregar só vídeo ou só áudio como concluído) e temporários limpos. | [I] |
| V5-21 | FFmpeg falha | ffmpeg falso sai com ≠ 0. | `DOWNLOAD_FALHOU`, temporários limpos, nenhum arquivo final. | [I] |
| V5-22 | Rede cai no meio | yt-dlp falso emite metade do progresso e sai com erro de rede. Manual: desligar o Wi-Fi durante um download real. | `SEM_CONEXAO`, sem "concluído" e sem `.part` na pasta. | [I] + [M] |
| V5-23 | Disco cheio | Linux: tmpfs pequeno. macOS: imagem `hdiutil create -size 5m`. Windows: VHD pequeno. Baixar para lá. | `ESPACO_INSUFICIENTE`, sem arquivo parcial. | [M-SO] (automatizável no Linux) |
| V5-24 | Fechar o app durante o download | Fechar a janela ou encerrar o app no meio. | Nenhum processo `clipora-yt-dlp`/`clipora-ffmpeg` sobrevive (conferir com `ps`/Gerenciador de Tarefas) e os temporários são removidos ou, no máximo, deixados em pasta temporária do app. | [I] (Unix) + [M-SO] |
| V5-25 | Árvore de processos | yt-dlp falso gera filho de longa duração. Provocar falha ou cancelamento. | Pai e filho são encerrados (grupo de processos no Unix, Job Object no Windows). | [I] + [M-SO] (Windows) |
| V5-26 | Panic não derruba o app | Gancho de teste que provoca panic numa task de comando. | O comando rejeita com `ERRO_INTERNO` e o app continua aberto (com `panic = "abort"` removido). | [I] |
| V5-27 | Downloads reais | Baixar 2 Reels e 2 TikToks públicos (um que exige união vídeo + áudio). | O arquivo reproduz com áudio e vídeo. O título e o nome estão corretos. Registrar `ffprobe` (codecs e duração) e links usados. | [REAL] [M-SO] |

---

## Etapa 6 — Verificação e atualização do yt-dlp

Todos os casos [I] usam o servidor HTTP local e a chave GPG de teste.

| ID | Caso | Passos | Aprovado se | Tipo |
| --- | --- | --- | --- | --- |
| V6-01 | Em dia | Servidor anuncia a mesma versão instalada. | `atualizacaoDisponivel: false`, `erroVerificacao: null` e nenhum aviso na interface. | [I] |
| V6-02 | Atualização disponível | Servidor anuncia versão mais nova. | Aviso visível e não intrusivo, com a versão nova. **Nada é baixado nem instalado sem clique.** | [I] + [E2E] |
| V6-03 | Offline | Servidor fora do ar, DNS falhando. | `versaoDisponivel: null` e `erroVerificacao` com `SEM_CONEXAO`. O estado é distinguível de "em dia". O app segue funcional e não fica tentando em loop. | [I] |
| V6-04 | Limite da API | Servidor responde 403/429 com `Retry-After`. | `LIMITE_DE_ACESSO` (ou o código do contrato) e no máximo uma verificação por abertura. | [I] |
| V6-05 | Sem atualização automática | Abrir o app com atualização disponível e esperar 5 min. | Os binários e a pasta `app_local_data_dir()/bin/` ficam inalterados (hash). | [I] |
| V6-06 | Atualização bem-sucedida | Clicar Atualizar. | O progresso é exibido. Ao final, `versaoInstalada` é igual à esperada e o `--version` do novo binário confere. A prévia e o download seguintes usam o novo binário (VT-10). A versão persiste após reiniciar. | [I] + [M-SO] |
| V6-07 | Hash inválido | O binário servido não confere com `SHA2-256SUMS`. | `ATUALIZACAO_INTEGRIDADE`, binário anterior intacto (mesmo hash) e temporário apagado. | [I] |
| V6-08 | Assinatura inválida | `SHA2-256SUMS.sig` assinado por outra chave, corrompido ou ausente. | `ATUALIZACAO_INTEGRIDADE`. O binário não é baixado ou não é instalado. | [I] |
| V6-09 | Versão diferente da esperada | O servidor troca a versão entre a verificação e a atualização. O binário novo diz outra versão no `--version`. | Rejeitado e a versão anterior mantida. | [I] |
| V6-10 | Binário não executa | O arquivo confere com o hash, mas o `--version` falha ou excede o tempo. | `ATUALIZACAO_FALHOU` e a versão anterior mantida. | [I] |
| V6-11 | Falha no meio do download | O servidor corta a conexão a 50%. | `SEM_CONEXAO`/`ATUALIZACAO_FALHOU`, anterior intacto, sem temporário residual. | [I] |
| V6-12 | Falha na troca | Tornar o diretório de destino somente leitura, ou disco cheio, no momento da troca. | Erro claro e a versão anterior **funcional** (rodar uma prévia em seguida). | [I] + [M-SO] |
| V6-13 | App encerrado durante a troca | Matar o processo (`kill -9`/Gerenciador de Tarefas) em cada ponto da troca (gancho de teste) e reabrir. | Ao reabrir, há um yt-dlp funcional (o novo completo ou o anterior). Nunca fica sem yt-dlp nem com binário truncado. | [I] |
| V6-14 | Concorrência: atualizar durante o download | Download em curso → Atualizar (botão e IPC direto). | Botão desabilitado. IPC rejeita com `DOWNLOAD_EM_ANDAMENTO`. O download conclui normalmente. | [I] + [E2E] |
| V6-15 | Concorrência: baixar ou prever durante a atualização | Atualização em curso → colar link / Baixar (botão e IPC). | `ATUALIZACAO_EM_ANDAMENTO`. Nenhum processo yt-dlp iniciado durante a troca. | [I] |
| V6-16 | Duplo clique | Chamar `atualizar_ytdlp` duas vezes em paralelo. | A segunda rejeita com `ATUALIZACAO_EM_ANDAMENTO`. Há uma única troca. | [I] |
| V6-17 | Origem restrita | O servidor redireciona para outro host, ou o app é configurado com URL `http://`. | Rejeitado. Só HTTPS para os hosts oficiais (GitHub releases e o CDN de objetos do GitHub) em produção. | [U] + [I] |
| V6-18 | `_update_spec` | Servidor publica `_update_spec` bloqueando a versão do sistema atual. | A atualização não é oferecida além da versão permitida e há mensagem clara (`ATUALIZACAO_NAO_SUPORTADA`). | [I] |
| V6-19 | Rollback após reinício | Simular uma cópia atualizada corrompida em disco e reabrir. | O app detecta a falha (`--version`), volta para a anterior ou a empacotada e informa. | [I] |
| V6-20 | Particularidades por sistema | macOS: binário atualizado executa sem bloqueio do Gatekeeper/quarentena, com o app assinado e notarizado. Windows: SmartScreen/Defender não bloqueia, ou o bloqueio é documentado. Linux: AppImage (pacote somente leitura) e `.deb` atualizam em `app_local_data_dir`. | O mecanismo funciona em cada pacote, ou a limitação está documentada e resolvida antes de declarar a funcionalidade pronta naquele sistema (plano, etapa 6). | [M-SO] |
| V6-21 | App atualizado traz yt-dlp mais novo | Cópia em `app_local_data_dir()/bin/yt-dlp` na versão X. Instalar uma versão do Clipora que embute X+1. | A prévia e o download usam X+1, a mais nova entre a atualizada e a embutida. `verificar_ytdlp` informa X+1 e a origem correta. | [I] |
| V6-22 | Reinstalar versão corrompida | A versão Y em `bin/yt-dlp/Y/` está corrompida (arquivo alterado ou removido por antivírus) e `atual` aponta para Y. Clicar Atualizar para Y. | A atualização substitui a cópia corrompida e conclui. Não falha para sempre com "versão existente difere". | [I] |
| V6-23 | Conexão lenta | Limitar a banda para ~1 Mbit/s e atualizar (zip de dezenas de MB). | Conclui. Não aborta por tempo total fixo enquanto houver progresso. Há percentual, ou indeterminado com etapa. | [I] + [M-SO] |
| V6-24 | Arquivo estranho na pasta da versão | Criar `.DS_Store`/`Thumbs.db` ou `__pycache__` em `bin/yt-dlp/<versao>/` e reabrir. | Comportamento definido e documentado: ignorado, ou cópia rejeitada com aviso. Nunca uma volta silenciosa para a embutida sem registro. | [I] |
| V6-25 | Validação pós-ativação | Após `atualizar_ytdlp` retornar sucesso. | `resolver_atual` resolve para a versão instalada. O sucesso só é retornado se o caminho de execução real aceitar a cópia. | [I] |
| V6-26 | Custo da validação | Com a cópia atualizada ativa (~120 MB, ~135 arquivos), medir o tempo de `obter_previa` em release, Windows com Defender. | A validação de hash não roda a cada chamada (cache por versão/mtime), nem bloqueia a thread do runtime assíncrono. | [I] |
| V6-27 | Duas instâncias | Abrir duas janelas/instâncias do app. Atualizar numa e baixar ou prever na outra. | Instância única, ou a exclusão vale entre processos. A coleta de uma não apaga a versão em uso pela outra. | [M-SO] |

---

## Etapa 7 — Distribuição

Executar em cada combinação da matriz, **em máquina ou VM limpa**, sem Rust/Node e **sem** yt-dlp ou ffmpeg no PATH. Repetir VT-10 com versões diferentes no PATH.

| ID | Caso | Passos | Aprovado se | Tipo |
| --- | --- | --- | --- | --- |
| V7-01 | Instalar e abrir | Instalar o pacote (NSIS/MSI, `.dmg`, AppImage/`.deb`/`.rpm`) e abrir. | Abre sem instalar dependências manualmente, com a janela "Clipora" em português. | [M-SO] |
| V7-02 | Sidecars presentes e corretos | Listar o conteúdo do pacote. Rodar `file`/`lipo -info` (macOS) e conferir a arquitetura dos binários `clipora-yt-dlp`, `clipora-ffmpeg` e `clipora-ffprobe`. | Presentes, executáveis e da arquitetura certa (universal no macOS). As versões batem com as documentadas. | [M-SO] (scriptável) |
| V7-03 | FFmpeg conforme LGPL | `clipora-ffmpeg -buildconf`. | Sem `--enable-gpl` nem `--enable-nonfree`, conforme [licencas.md](licencas.md). | [M-SO] (scriptável) |
| V7-04 | Assinatura macOS | `codesign --verify --deep --strict --verbose=2 Clipora.app`, `spctl -a -vv Clipora.app`, `xcrun stapler validate Clipora.dmg`. | Todos aprovados, incluindo os sidecars assinados. Abre com duplo clique sem aviso de desenvolvedor não identificado. | [M-SO] (macOS) |
| V7-05 | Assinatura Windows | `signtool verify /pa /v` no instalador e no executável. | Assinado, se houver certificado. Senão, registrar o aviso do SmartScreen como limitação conhecida. | [M-SO] (Windows) |
| V7-06 | Linux | Conferir as somas SHA-256 publicadas. Instalar o `.deb` num sistema com `/usr/bin/yt-dlp` do apt. | Somas conferem. Não há conflito de arquivos com os pacotes do sistema. | [M-SO] (Linux) |
| V7-07 | Fluxo completo no pacote | Prévia, primeira escolha de pasta, download, abrir pasta, verificar e atualizar o yt-dlp. | Todos aprovados (subconjunto de V3-18, V4-02, V4-03, V5-07, V5-27, V6-06 e V6-20). | [M-SO] [REAL] |
| V7-08 | Licenças e avisos | Abrir o pacote instalado e a tela "Sobre" ou "Licenças". | Textos de licença do yt-dlp (GPLv3+, com oferta ou link do código-fonte) e do FFmpeg (LGPL, com instruções de substituição), conforme [licencas.md](licencas.md). | [M-SO] |
| V7-09 | Desinstalar | Desinstalar. | O app sai do sistema. Os vídeos baixados ficam intactos. Documentar o que fica em `app_local_data_dir`. | [M-SO] |
| V7-10 | CSP e capabilities no pacote | VT-01 a VT-05 no build de release. | Iguais ao desenvolvimento. O devtools fica desabilitado no release. | [M-SO] |
| V7-11 | Avisos de licença dentro do pacote | Listar o conteúdo de cada pacote (`.app`, NSIS/MSI via `7z l`, `.deb`/`.rpm`/AppImage). | `THIRD_PARTY_LICENSES.txt` e `licencas.json` estão presentes no pacote, e não só como artefato do CI. | [M-SO] (scriptável) |
| V7-12 | Somente o necessário | Comparar a lista de arquivos do pacote com uma lista permitida. | Sem `ffmpeg-build-info` solto fora de licenças, sem `clipora-yt-dlp-<triple>` onefile, sem `.antigo`/`.novo`, sem arquivos fora do manifesto em `yt-dlp/`. | [M-SO] (scriptável) |
| V7-13 | Versão mínima do sistema | `otool -l clipora-ffmpeg \| grep -A3 LC_BUILD_VERSION` e `Info.plist` `LSMinimumSystemVersion`. | A versão mínima declarada pelo app é ≥ a dos sidecars (FFmpeg compilado com 11.0). | [M-SO] (macOS) |
| V7-14 | CI executado de fato | Rodar o workflow no repositório remoto (PR de fork e push de tag). | Todas as 12 tarefas passam, incluindo `windows-11-arm`/`ubuntu-22.04-arm`. Num PR de fork, nenhuma etapa de assinatura roda. | [M] |

---

## Etapa 8 — Revisão final

| ID | Caso | Passos | Aprovado se | Tipo |
| --- | --- | --- | --- | --- |
| V8-01 | Suite automatizada | `pnpm typecheck && pnpm test && pnpm test:rust && pnpm build`, mais os testes E2E e de configuração (VT-01, VT-02 e V4-14). | Tudo verde. A saída é anexada ao registro. Nenhum teste ignorado sem justificativa. | [U] [I] [E2E] [C] |
| V8-02 | Matriz manual completa | Todos os casos [M-SO] em cada combinação disponível. | Cada caso aprovado ou registrado como limitação. Combinações não testadas aparecem como **não verificado** na documentação. | [M-SO] |
| V8-03 | Revisão de mensagens | Percorrer todos os códigos de erro (V2-07) no app real. | Português correto, com acentos, tom consistente e ação sugerida. Nenhum texto em inglês vindo do yt-dlp. | [M] |
| V8-04 | Acessibilidade | Repetir V2-10 a V2-12 no app real em cada sistema. | Aprovado com o leitor de tela nativo de cada sistema. | [M-SO] |
| V8-05 | Escopo | Conferir a ausência de download em lote, login, histórico sincronizado e servidor. Conferir que o download só começa após ação do usuário. | Conforme a especificação. | [M] |
| V8-06 | Documentação | README e guias: instalação, uso, atualização do yt-dlp, limitações conhecidas (plataformas podem exigir login, qualidade é a disponível ao yt-dlp) e como relatar problemas. | Presente, correto e coerente com o comportamento observado. | [M] |

---

## Estado em 2026-11-05

A versão inteira não está concluída. As linhas desta data acrescentam evidência parcial. O que ainda depende do usuário está na lista única de [distribuicao.md §9](distribuicao.md#9-decisões-pendentes-do-usuário): licença e termos, identificador, sistemas e formatos, repositório e publicação, credenciais Apple, provedor de assinatura Windows e máquinas dos outros sistemas. O formato onedir do yt-dlp e o FFmpeg próprio mínimo LGPL já constam como escolhas adotadas; lojas ficam fora da v1. Nenhuma decisão nova foi tomada pelo usuário.

Dois artefatos macOS arm64, com alcances diferentes:

- **Candidato debug.** Worktree `/private/tmp/clipora-wt-f8696a8`, base `f8696a8` mais o snapshot de `src/` e `src-tauri/`. Não é o pacote do commit `7ba19bf`. O ajuste posterior de `cfg(test)` no redirect não entrou nesse snapshot e não muda o comportamento produtivo dele. Neste app a janela percorreu fluxos completos: Instagram com pasta ausente, seletor nativo, novo destino, conclusão, Abrir pasta e ffprobe; nome `(2)` sem sobrescrever o arquivo já existente; TikTok com prévia, download, ffprobe e restauração de Downloads.
- **Build otimizado do commit `7ba19bf`.** Worktree isolado, perfil release, log `/private/tmp/clipora-build-release-7ba19bf.log`, pacote de 108,77 MiB. Smoke: o app abriu, a pasta Downloads permaneceu e Sobre carregou 367 crates e 4 pacotes npm. A conferência desse app passou em arquitetura, FFmpeg, hashes, licenças e mínimo 11.0. Esse smoke não repete os downloads do candidato debug.

Pendências que permanecem **não verificado**: Windows, Linux, macOS Intel, notarização com Developer ID, leitor de tela nativo, primeiro CI remoto, assinatura Windows integral e o conjunto de falhas de filesystem do roteiro. Rosetta não substitui hardware Intel.

## Registro de resultados

Acrescente linhas, sem apagar as anteriores. Resultado: **aprovado**, **reprovado**, **não verificado** ou **limitação**. Uma linha aprovada cobre só o caso e o artefato citados.

| Data | Commit | Caso | Sistema/arquitetura | Resultado | Evidência / observação |
| --- | --- | --- | --- | --- | --- |
| 2026-11-05 | 7b8f08e | Base (etapa 1) | macOS arm64 (dev) | aprovado | `pnpm typecheck` exit 0. `pnpm test` 1/1. `pnpm test:rust` 1 passed. `pnpm build` exit 0. Janela via `pnpm tauri dev` não verificada por Lince. |
| 2026-11-05 | f8696a8 | V8-01 — testes UI | macOS arm64 (checkout de desenvolvimento) | aprovado | Execução própria de Lince: `pnpm test` — 11 arquivos, 247 testes passaram. |
| 2026-11-05 | f8696a8 | V8-01 — build e typecheck | macOS arm64 (checkout de desenvolvimento) | aprovado | Execução própria de Lince: `pnpm build` — typecheck (`tsc --noEmit` e `tsc -p tsconfig.node.json --noEmit`) e build Vite passaram. |
| 2026-11-05 | f8696a8 | V8-01 — testes Rust | macOS arm64 (checkout de desenvolvimento) | aprovado | Execução própria de Lince: `source ~/.cargo/env && pnpm test:rust` — 36 passaram, 0 falharam, 6 ignorados. |
| 2026-11-05 | f8696a8 | V8-01 — clippy e fmt | macOS arm64 (checkout de desenvolvimento) | aprovado | Execução própria de Lince: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` e `cargo fmt --manifest-path src-tauri/Cargo.toml --check` passaram. |
| 2026-11-05 | f8696a8 | V8 — Sobre/Licenças: tema e teclado no navegador simulado | navegador simulado, 800×600 | aprovado (somente simulação) | Evidência relatada pelo Timoneiro: temas claro/escuro, modal, Shift+Tab, Esc e retorno do foco. Screenshots: `/private/tmp/clipora-qa-sobre-800-light.png` e `/private/tmp/clipora-qa-sobre-800-dark.png`. Não valida a webview nativa. |
| 2026-11-05 | f8696a8 | V8-04 — acessibilidade na webview nativa | macOS arm64 | não verificado | A checagem foi no navegador simulado; a janela nativa e leitor de tela não foram verificados nesta rodada. |
| 2026-11-05 | f8696a8 | V8-02 — matriz em outros sistemas | Windows e Linux | não verificado | Não testados nesta rodada. |
| 2026-11-05 | f8696a8 + snapshot em `/private/tmp/clipora-wt-f8696a8` | Candidato debug — build e conferência | macOS arm64 | aprovado (candidato; não é o commit `7ba19bf`) | `tauri build --bundles app` exit 0. Log `/private/tmp/clipora-build-candidato-2.log`. `scripts/conferir-pacote.mjs` exit 0: yt-dlp 2026.10.26, 131 arquivos após assinatura ad-hoc, FFmpeg 8.1.3, avisos presentes, mínimo 11.0. Sem selo de certificado e sem notarização. Evidência: `.maestri/aceitacao-candidato-2.md`. |
| 2026-11-05 | f8696a8 + snapshot em `/private/tmp/clipora-wt-f8696a8` | V4-06, V5-04, V5-07, V5-10, V5-27 — fluxos completos na janela | macOS arm64 | aprovado (candidato debug) | Instagram `https://www.instagram.com/reel/DfS6bDVMRQ8/`: prévia “Video by yogue.prem”; pasta persistida ausente; seletor nativo; destino `/private/tmp/clipora-qa-canal-b.tdYOWi`; conclusão na UI; Abrir pasta revelou o mp4 de 21,7 MB; ffprobe empacotado com vídeo e áudio, exit 0. Execução anterior do mesmo Reel concluiu como nome `(2)` e preservou o arquivo já existente. Downloads restaurado pela UI. TikTok `https://www.tiktok.com/@scout2015/video/6718335390845095173`: prévia com duração 0:10, download concluído, 2004627 bytes, ffprobe empacotado com vídeo e áudio, exit 0; Downloads restaurado de novo. Evidência: `.maestri/aceitacao-candidato-2.md`. |
| 2026-11-05 | 7ba19bf | V8-01 — testes UI | macOS arm64 | aprovado | Root: typecheck, 257 testes em 11 arquivos e build do frontend, exit 0. Log `.maestri/verificacao-timoneiro-frontend-2.txt`. Não reexecutado nesta atualização do roteiro. |
| 2026-11-05 | 7ba19bf | V8-01 e V6-17 — Rust, clippy, fmt e atualização GitHub | macOS arm64 | aprovado | Root: 42 testes passaram, 6 ignorados; os ignorados não foram executados. `clippy --all-targets -D warnings` e `cargo fmt --check` passaram. Depois da correção da allowlist em `cfg(test)`, `instalacao::tests::atualizacao_real_github_temporaria` passou em 47,68 s: release 2026.10.26 instalada em diretório temporário e executada pelo resolver. A política de teste mantém a allowlist oficial e acrescenta loopback. |
| 2026-11-05 | 7ba19bf + diff de distribuição ainda não commitado | V7-02, V7-03, V7-11, V7-12, V7-13 e V8-01 — conferidor, actionlint e sintaxe | macOS arm64 (scripts no checkout) | aprovado (ferramentas; não é o CI remoto) | Root: `actionlint`, `node --check` e `node --test scripts/test-conferir-pacote.mjs` com 4 testes (registro FFmpeg válido e inválido, PE x64/arm64/inválido, selo ausente contra erro desconhecido). Não reexecutado nesta atualização. |
| 2026-11-05 | 7ba19bf | Build otimizado isolado — smoke de abertura, Sobre e conferência | macOS arm64 | aprovado (smoke; fluxos de download ficam no candidato debug) | Worktree isolado. Log `/private/tmp/clipora-build-release-7ba19bf.log`: perfil release, `Clipora.app` de 108,77 MiB. O app abriu, Downloads permaneceu e Sobre carregou 367 crates e 4 pacotes npm. Conferência desse app: arquitetura, FFmpeg, hashes, licenças e mínimo 11.0 passaram. Sem notarização. |
| 2026-11-05 | 7ba19bf | V8-04 — leitor de tela nativo | macOS arm64 | não verificado | A simulação de teclado no navegador permanece na linha anterior. VoiceOver, Narrador, NVDA e Orca não foram executados. |
| 2026-11-05 | 7ba19bf | V7 e V8-02 — demais sistemas, assinatura e CI | Windows, Linux, macOS Intel; notarização Apple; assinatura Windows | não verificado | A matriz é pretendida. Decisões e máquinas estão em `docs/distribuicao.md` §9. O primeiro run remoto, a extração Windows/Linux, o hardware Intel e a notarização com Developer ID seguem sem execução. `CLIPORA_ASSINAR_WINDOWS=true` permanece bloqueado até a pré-assinatura integral do onedir. A versão inteira não está concluída. |
