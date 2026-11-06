# YouTube com seleção de qualidade — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Baixar um vídeo normal do YouTube por vez, sem login, em MP4 com áudio e resolução escolhida num seletor exclusivo dessa plataforma.

**Architecture:** Reutilizar prévia, controle de download e histórico existentes. Concentrar regras de conteúdo/formato em `youtube.rs` e dependência/compatibilidade local em `motor_youtube.rs`; React recebe apenas alturas e envia uma escolha tipada, nunca argumentos do yt-dlp.

**Tech Stack:** Tauri 2, Rust/Tokio, React/TypeScript, yt-dlp 2026.10.26/EJS empacotado, FFmpeg/FFprobe mínimos existentes e Deno 2.7.0 fixado.

**Spec:** `docs/superpowers/specs/2026-11-06-youtube-qualidade-design.md`, aprovado pelo usuário em 2026-11-06. Ler os dois documentos antes de executar.

## Global Constraints

- Padrão **Melhor disponível**; altura explícita deve ser respeitada exatamente, sem fallback silencioso, upscale ou transcodificação.
- Somente vídeos normais: `media_type=video` e `live_status=not_live`, duração finita positiva, ID coerente, combinação não DRM com vídeo AVC/VP9/AV1 e áudio AAC/MP4A.
- Sem Shorts, lives, playlists inteiras, login, cookies autenticados ou acesso a sessões do navegador. Stories permanece pendente.
- Uma opção por altura real elegível, decrescente e sem teto artificial; seletores de FPS/codec/áudio ficam fora.
- Deno só é exigido ao carregar/baixar YouTube. Instagram/TikTok preservam seu fluxo sem essa dependência.
- Atualização incompatível ou cuja compatibilidade local não possa ser verificada é recusada antes de ativar o candidato; preservar a instalação anterior de todas as plataformas após reinício.
- Não alterar `projeto-aplicativo.md` nem `plano-clipora.md`; manter mínimos/alvos atuais. Não publicar nem fazer push antes dos testes Windows/Linux exigidos pelo usuário.
- Equipe/execução já definida pelo usuário: Ferrugem (Rust/contrato), Vitral (UI), Estaleiro (distribuição), Lince (QA), Timoneiro (revisão própria/commits). Agentes não commitam. Caminhos absolutos nos briefs e ask back ao Timoneiro.
- Checkout compartilhado para implementação conforme instrução da equipe; pacote de aceitação de commit final em worktree isolado. Não criar trabalho concorrente nos mesmos arquivos.

## Review Focus

1. Alteração da disponibilidade entre prévia/download: recusar qualidade desaparecida; teste da tarefa 3 confere argumentos e ausência de arquivo/histórico.
2. IPC sem passar pela UI: altura inválida ou de outra plataforma não pode ampliar formatos nem aceitar expressão; tarefas 2/3 testam desserialização e validação.
3. Troca de janela/pasta e respostas atrasadas: a qualidade da tentativa não pode mudar; tarefa 4 testa recuperação com/sem prévia e nova tentativa IPC.
4. Atualização alterando runtime/solver: não trocar ponteiros antes da verificação local; tarefa 5 reabre instalação após cada falha.
5. Codec em MP4 aceito pelo muxer mas sem faixas/dimensão corretas: tarefa 3 recusa FFprobe inconsistente e tarefa 6 registra reprodução/codecs realmente verificados.

## Mapa de arquivos e interfaces compartilhadas

- `src-tauri/src/youtube.rs` (novo): analisar metadados e escolher um formato, sem UI, estado global ou rede.
- `src-tauri/src/motor_youtube.rs` (novo): resolver/verificar motor e conferir EJS/candidato localmente; nunca buscar executável no PATH.
- `src-tauri/src/{links,previa,processos,download,historico,lib,binarios,instalacao}.rs`: integrar módulos nas responsabilidades atuais.
- `src/componentes/SeletorQualidadeYoutube.tsx` (novo): select acessível sem efeitos de rede. `src/estado/{maquina,useClipora}.ts`: dono da seleção e captura da tentativa.
- `src/{tipos/contrato,servicos/tipos,servicos/tauri,servicos/simulado}.ts` e `docs/contrato-ipc.md`: transportar os campos abaixo e reproduzir o comportamento no simulador.
- `scripts/obter-deno.mjs` e `scripts/test-deno.mjs` (novos), `scripts/binarios.lock`, conferidor/licenças/CI: dependência empacotada, com hash por alvo e compatibilidade validada.
- Fixtures novas sob `tests/fixtures/youtube/`; reutilizar o executável falso de `tests/fixtures/bin/` e seus módulos de `tests/fixtures/lib/`.

Contrato aditivo (não renomear ao implementar):

```ts
type Plataforma = 'instagram' | 'tiktok' | 'youtube';
// Previa:
qualidadesYoutube: number[] | null;
// iniciar_download:
alturaYoutube?: number | null;
// EstadoDownloadAtivo e ambos os ramos de ResultadoTerminal:
alturaYoutube: number | null;
```

`null`/ausência na entrada é Melhor disponível. Rejeitar entrada numérica fracionária,
negativa, zero ou fora de `u32`; backend aceita `Option<u32>` e valida positividade.
Adicionar erros `QUALIDADE_INDISPONIVEL` e `MOTOR_YOUTUBE_INDISPONIVEL`.
Texto do primeiro é o texto exato do desenho. Texto do segundo:
**O componente necessário para baixar do YouTube está indisponível ou é incompatível. Reinstale ou atualize o Clipora.**

Tipos Rust públicos entre tarefas:

```rust
// youtube.rs — campos internos do catálogo ficam privados.
pub struct AnaliseYoutube { /* catálogo validado e ID */ }
pub struct EscolhaYoutube { pub altura: u32, pub seletor: String }
pub fn analisar(dados: &serde_json::Value, id_esperado: &str)
    -> Result<AnaliseYoutube, crate::previa::ErroClipora>;
pub fn alturas(analise: &AnaliseYoutube) -> Vec<u32>;
pub fn escolher(analise: &AnaliseYoutube, altura: Option<u32>)
    -> Result<EscolhaYoutube, crate::previa::ErroClipora>;

// motor_youtube.rs — biblioteca de verificação sem AppHandle nos testes.
pub async fn verificar_motor(deno: &std::path::Path)
    -> Result<(), crate::previa::ErroClipora>;
pub async fn conferir_candidato(yt_dlp: &std::path::Path, deno: &std::path::Path)
    -> Result<(), crate::previa::ErroClipora>;
```

`AnaliseYoutube` não contém URL da UI para executar. `EscolhaYoutube.seletor` é
construído somente com IDs de formato validados (`[A-Za-z0-9_-]`, 1–64 caracteres),
com um único vídeo e, se separado, um único áudio AAC. Nunca concatenar uma expressão
recebida da UI. `conferir_candidato` retorna `ATUALIZACAO_NAO_SUPORTADA` no contexto
de atualização; `verificar_motor` retorna `MOTOR_YOUTUBE_INDISPONIVEL` no fluxo de vídeo.

### Tarefa 1 — provar acesso e fixar o motor distribuído

**Responsáveis:** Timoneiro executa o teste exploratório; Estaleiro entrega aquisição/pacote após o resultado. Ferrugem consome o caminho fixo do motor nas tarefas seguintes.

**Files:** criar `scripts/obter-deno.mjs`, `scripts/test-deno.mjs`; modificar `scripts/binarios.lock`, `src-tauri/tauri.conf.json`, `scripts/{conferir-pacote,gerar-licencas}.mjs`, `.github/workflows/build.yml`; produzir `src-tauri/binaries/clipora-deno-<triple>[.exe]` e `src-tauri/binaries/deno/clipora-deno.json` (metadados).

**Interfaces:** executável em recurso `deno/clipora-deno[.exe]`, resolvido pelo backend por caminho absoluto; `deno/clipora-deno.json` registra `versao`, `triple`, `sha256Executavel` e origem/hash do ZIP. Deno NÃO entra em `externalBin`; pode haver cache de build por triple fora da pasta de recursos, mas só uma cópia é empacotada.

Ruling de empacotamento, após diagnóstico real: o bundler Tauri CLI2.12.4 re-assina `externalBin` usando os entitlements do aplicativo, sem preservar os anteriores. Reassinar Deno em hardened runtime sem `allow-jit` causou exit-5; o mesmo binário com somente `com.apple.security.cs.allow-jit=true` executou JS e solver N/SIG exit0. Usar recurso dedicado, como o yt-dlp atual, permite assinar só o runtime antes do bundle e preservar seu hash sem ampliar os entitlements do app/FFmpeg. Evidências em `.maestri/youtube-preflight/*assinatura*json` e `ejs-smoke-assinado-jit-resumo.json`.

- [ ] Em pasta isolada de teste, obter Deno **v2.7.0** oficial, verificar SHA-256 contra a tabela abaixo, conferir arquitetura, versão e mínimo do macOS (`otool -l`). Não instalar globalmente nem trocar os binários atuais do Clipora.
- [ ] Executar yt-dlp empacotado com `--ignore-config --no-plugin-dirs --no-cache-dir --no-cookies --no-cookies-from-browser --no-remote-components --no-js-runtimes --js-runtimes deno:<caminho absoluto> --no-playlist`; carregar metadados de um vídeo normal público. Usar `https://www.youtube.com/watch?v=YE7VzlLtp-4` como amostra inicial, verificando sua disponibilidade atual.
- [ ] Se acessível, baixar Melhor disponível e uma altura menor realmente listada, com FFmpeg empacotado; FFprobe deve confirmar vídeo+áudio e altura esperada. Testar também a classificação de um Short em formato `/watch`. Guardar horários, versões, argumentos e resultados em `.maestri/youtube-preflight/`, sem cookies/URLs assinadas nos documentos públicos.
- [ ] Se o acesso exigir login ou faltar uma combinação elegível, registrar o bloqueio; não iniciar a integração da funcionalidade enquanto essa condição inviabilizar a aceitação do desenho. Não introduzir autenticação. A existência de assets por alvo não comprova mínimos nem execução nativa.
- [ ] Escrever testes Node `lock_cobre_alvos`, `hash_invalido_nao_instala`, `zip_inseguro_rejeitado`, `manifesto_corresponde_ao_executavel`. Executar `node --test scripts/test-deno.mjs`: RED pela ausência do novo módulo/validação.
- [ ] Implementar aquisição idempotente em `obter-deno.mjs`, exportando `validarAssetDeno(lock, triple)` e `validarZipDeno(bytes, nomeExecutavel)`, com download HTTPS oficial, hash fixo, extração de somente `deno[.exe]` regular e troca atômica. Não executar instalador remoto. Reaproveitar utilitários de `scripts/comum.mjs`/`zip.mjs`.
- [ ] Incluir executável/manifesto como recurso dedicado no Tauri, conferir hash/arquitetura/versão nos pacotes e agregar licença Deno e seus avisos de terceiros. Para universal macOS, obter as duas arquiteturas e combinar com lipo; não exigir asset universal inexistente. Assinatura própria do Deno usa somente o entitlement JIT comprovado; testar JS/solver após assinar, não só `--version`. Gravar o arquivo staged também no ramo nativo antes de assiná-lo.
- [ ] Rodar os testes Node e conferência estática por alvo: GREEN. Conferir mínimos glibc/macOS/Windows sem elevá-los; incompatibilidade de um asset exige revisão técnica da versão escolhida, não alteração silenciosa do requisito do produto.
- [ ] Entregar caminhos/relatório ao Timoneiro para revisão e commit `feat: preparar motor JavaScript do YouTube` depois das verificações comuns.

Assets oficiais em `https://github.com/denoland/deno/releases/download/v2.7.0/` (nomes `deno-<triple>.zip`). Hashes conferidos na API oficial em 2026-11-06. O candidato inicial 2.9.8 foi descartado porque seu Mach-O exige macOS 12; o binário arm64 de 2.7.0 foi verificado como minos 11.0. Validar também Intel antes de aceitar o pacote:

| Triple | SHA-256 do ZIP |
| --- | --- |
| aarch64-apple-darwin | `1b239846bc513ab3e29a7bf054738c0f937753a6abf3513c95afb320b1f24eb6` |
| x86_64-apple-darwin | `f3a51563029919c8043a79c03e04c3737a40b13c0847f3f5ef90e993d95359b5` |
| x86_64-pc-windows-msvc | `e7895110bab2d77c4ae9878d1c75d44d0b5219f13f337322b210ebcc8867e6ff` |
| aarch64-pc-windows-msvc | `fa92eefed87636ab13fbe2d16aa59a558e369bd321b843a3dc37ac74bfd9a71b` |
| x86_64-unknown-linux-gnu | `f1ca687ba8545105ba5809688ef659d96fe4272acc11e8b4800657cdb0045b7d` |
| aarch64-unknown-linux-gnu | `04d35f9f836c92804dcfb433740e0c6dbdea2b32b444a50dc71aa03dcaf06589` |

### Tarefa 2 — catálogo, URLs, classificação e contrato canônico

**Responsável:** Ferrugem; depende do teste de viabilidade da tarefa 1, não da UI.

**Files:** criar `src-tauri/src/youtube.rs`, `tests/fixtures/youtube/{normal,short,live,sem-audio,formatos}.json`; modificar `src-tauri/src/{lib,links,previa,download,historico}.rs` e `docs/contrato-ipc.md`.

**Interfaces:** produz `AnaliseYoutube`, `EscolhaYoutube`, `analisar`, `alturas`, `escolher` definidos acima; `Plataforma::Youtube`; `Previa.qualidades_youtube: Option<Vec<u32>>`. Não alterar assinaturas TS antes do handoff à UI.

- [ ] Escrever testes Rust `youtube_urls_canonicas`, `youtube_rejeita_query_v_duplicada_e_hosts_falsos`, `youtube_short_por_alias_e_live_sao_recusados`, `youtube_catalogo_exige_audio_e_dimensoes`, `youtube_alturas_unicas_sem_teto`, `youtube_escolha_exata_sem_fallback`, `youtube_formato_id_nao_injeta_expressao`.
- [ ] Assertivas obrigatórias: aliases de `YE7VzlLtp-4` → URL canônica; query com dois `v` → erro; `media_type=short` via `/watch` → erro; `media_type` ausente → erro; entrada com alturas `[720,1080,720,2160]` → `[2160,1080,720]`; escolha 480 inexistente → `QUALIDADE_INDISPONIVEL`; altura 720 não seleciona 1080; formatos só áudio/DRM/storyboards ou sem áudio AAC elegível não geram opção.
- [ ] Rodar `pnpm test:rust` e confirmar RED nos novos casos. O wrapper atual não repassa argumentos de filtro; não usar `pnpm test:rust -- youtube` como se filtrasse a suíte.
- [ ] Implementar regras de URL exatamente como no desenho. Metadados devem representar item único do ID pedido. Extrair catálogo e escolher por altura, FPS, AVC > VP9 > AV1 e, no empate restante, ordem de preferência dos formatos do yt-dlp; escolher áudio AAC elegível pela mesma preferência. Deduplicar alturas após filtrar combinações elegíveis.
- [ ] Acrescentar plataforma/campo/erros ao contrato. Atualizar literais Rust com `qualidades_youtube: None` fora do YouTube. Ajustar matches exaustivos: histórico por `youtube:<id>` e nome pelo título/canal/`Vídeo`, sem descrição longa.
- [ ] Testar histórico antigo sem migração destrutiva e equivalência `watch`/`youtu.be` com parâmetros; nomes Unicode/colisões continuam protegidos. Rodar testes focados e clippy/fmt: GREEN.
- [ ] Entregar contrato ao Vitral e implementação ao Timoneiro; revisão própria e commit `feat: validar vídeos e qualidades do YouTube`.

### Tarefa 3 — prévia, download e validação efetiva da qualidade

**Responsável:** Ferrugem; depende das tarefas 1 e 2.

**Files:** criar `src-tauri/src/motor_youtube.rs`; modificar `src-tauri/src/{lib,binarios,processos,previa,download}.rs`, fixtures `tests/fixtures/lib/{cenarios,ytdlp-falso,ffmpeg-falso}.mjs` e wrappers de `tests/fixtures/bin/` quando necessários.

**Interfaces:** `iniciar_download` adiciona `altura_youtube: Option<u32>`; estado ativo/terminal adiciona o mesmo campo. Trocar a tupla interna de ferramentas por `FerramentasDownload { yt_dlp: PathBuf, ffmpeg: PathBuf, ffprobe: PathBuf, deno: Option<PathBuf> }`. `download::executar` recebe essa estrutura e a altura capturada. Resolver Deno somente no ramo YouTube. Os módulos puros da tarefa 2 permanecem sem I/O.

- [ ] Escrever testes `youtube_previa_retorna_alturas`, `youtube_ipc_rejeita_altura_estranha`, `youtube_motor_ausente_nao_afeta_instagram_tiktok`, `youtube_revalida_catalogo_antes_de_baixar`, `youtube_saida_confere_altura_e_audio`, `youtube_recuperacao_eco_altura_sem_previa`.
- [ ] Assertivas: captura do argv contém apenas Deno empacotado e um seletor interno; não contém fallback a outra altura; metadados frescos sem 720 retornam `QUALIDADE_INDISPONIVEL` antes de mídia/histórico; FFprobe com 1080 quando pedido 720 ou sem áudio recusa finalização; IPC de Instagram com altura 720 é recusado; sem altura mantém os argumentos atuais; Deno ausente não impede Instagram/TikTok.
- [ ] Executar testes focados: RED. Implementar `verificar_motor` por manifesto/hash, caminho absoluto e `--version` com timeout de 10 s, sem shell; usar `MOTOR_YOUTUBE_INDISPONIVEL` para ausência/versão/hash/execução inválidos. Não pesquisar PATH nem carregar configuração pessoal do Deno.
- [ ] Nos processos YouTube, usar flags de isolamento da tarefa 1 e o motor fixo; repetir validação do catálogo antes de iniciar a transferência. Manter cancelamento/prazo da prévia e encerramento de grupo ao abandonar a tarefa. Durante preparação do download, a extração extra também pertence à tarefa cancelável, sem novo download simultâneo.
- [ ] Construir `-f` com a escolha validada, sem `/` para fallback entre resoluções; download em temporário e remux MP4. Executar FFprobe por argumentos separados, saída JSON limitada e timeout de 15 s antes de `finalizar`; exigir exatamente um stream de vídeo, ao menos um de áudio AAC, dimensões positivas e altura escolhida (inclusive altura efetiva da opção automática).
- [ ] Preservar seleção em estado ativo, terminal e erros; reidratação não depende de prévia. Erros de qualidade/dependência não são confundidos com `PREVIA_INDISPONIVEL`. Nenhuma conclusão/histórico é emitida antes da conferência final.
- [ ] Rodar testes focados e suíte Rust completa/clippy/fmt: GREEN. Handoff de IPC ao Vitral; revisão própria e commit `feat: baixar YouTube na qualidade selecionada`.

### Tarefa 4 — seletor exclusivo, retentativas e histórico na UI

**Responsável:** Vitral; pode preparar testes após o contrato da tarefa 2; integrar payload real após tarefa 3.

**Files:** criar `src/componentes/SeletorQualidadeYoutube.tsx`; modificar `src/{App.tsx,App.test.tsx,tipos/contrato.ts,links/validarLink.ts}`, `src/componentes/{PreviaCard,HistoricoPainel,CampoLink,SobreLicencas}.tsx`, `src/estado/{maquina,useClipora}.ts` e respectivos testes, `src/servicos/{tipos,tauri,simulado}.ts` e respectivos testes, `src/erros/{mensagens,mensagens.test}.ts`.

**Interfaces:** seguir o contrato acima; `SeletorQualidadeYoutube({ alturas: number[], altura: number | null, desabilitado: boolean, aoAlterar: (altura: number | null) => void })`; ação `qualidade_youtube_alterada { altura: number | null }`. O reducer mantém `alturaYoutube` nos estados com prévia/tentativa; download capturado não depende de fechamento sobre estado futuro.

- [ ] Escrever testes `seletor_so_aparece_para_youtube`, `seletor_mostra_apenas_alturas_e_padrao`, `mudar_link_descarta_qualidade_e_resposta_atrasada`, `retentativa_pasta_preserva_altura_e_novo_channel`, `recuperacao_sem_previa_preserva_altura`, `atualizar_previa_reinicia_padrao`.
- [ ] Assertivas: link Instagram/TikTok não mostra select nem envia altura não nula; YouTube com `[1080,720]` mostra Melhor disponível/1080p/720p, sem 4K inventado; escolher 720 envia `alturaYoutube: 720`; nova pasta/erro de download preservam 720; editar link ou nova prévia limpa a seleção; conclusão/baixar novamente mantém 720; prévia antiga não reintroduz alturas.
- [ ] Rodar `pnpm test -- src/estado/maquina.test.ts src/estado/useClipora.test.ts src/servicos/tauri.test.ts src/App.test.tsx`: RED.
- [ ] Implementar tipos, transporte e simulador com opções determinísticas. Aceitar ausência dos campos aditivos de um backend antigo como `null`, sem inventar resoluções; prévia YouTube sem lista válida não habilita o download.
- [ ] Implementar select nativo com label **Qualidade**, opção **Melhor disponível**, resolução exata e sufixo `(4K)` para 2160. Desabilitar durante transferência; sem prévia recuperada, não mostrar controle editável. Atualizar nomes de plataforma/labels do link e mensagens para contemplar YouTube sem prometer stories.
- [ ] Adicionar ação **Atualizar prévia** para `QUALIDADE_INDISPONIVEL`, voltando ao catálogo novo/padrão; dependência ausente orienta atualizar/reinstalar o app. Não sobrescrever mensagens de erro do histórico com recargas atrasadas.
- [ ] Executar testes focados, `pnpm typecheck`, `pnpm test`, `pnpm build`: GREEN. Revisão cruzada com Ferrugem/Lince e commit pelo Timoneiro `feat: selecionar qualidade de vídeos do YouTube`.

### Tarefa 5 — impedir atualização incompatível antes da ativação

**Responsável:** Ferrugem, com revisão Lince; depende do runtime e interfaces das tarefas 1/3.

**Files:** modificar `src-tauri/src/{motor_youtube,instalacao,lib}.rs`; criar `tests/fixtures/youtube/{ejs-smoke.json,info-local.json}` e recurso de smoke compilado em `motor_youtube.rs`; ajustar `docs/contrato-ipc.md` e textos contextuais de atualização na UI em coordenação com Vitral.

**Interfaces:** `conferir_candidato` definido acima. `instalacao::atualizar(raiz, esperada, canal, deno: &Path)` executa a conferência no diretório temporário verificado, depois de `--version` e antes de `ativar`. Testes de atualização injetam o verificador/local runtime falso no mesmo seam de `atualizar_com`.

- [ ] Escrever testes `atualizacao_solver_incompativel_nao_troca_ponteiros`, `atualizacao_motor_ausente_preserva_anterior`, `atualizacao_smoke_timeout_recusa`, `atualizacao_solver_compativel_ativa`. Reabrir `Repositorio`/resolver de instalação e conferir versões `atual`/`anterior`, inclusive após falha.
- [ ] Rodar testes focados: RED. Implementar verificação local sem rede: conferir os scripts `_internal/yt_dlp_ejs/yt/solver/{lib,core}.min.js` cobertos pelo manifesto validado; ausência/layout incompatível recusa atualização.
- [ ] Enviar pelo stdin do Deno, com as flags restritas do provider upstream, `lib`, `Object.assign(globalThis, lib)`, `core` e chamada de `jsc` com entrada `type=preprocessed`, funções locais `n(s)=reverse(s)` e `sig(s)='ok:'+s`, requests com desafios `abc` e saídas esperadas `cba` e `ok:abc`. Conferir também parse/generate de um programa JS fixo via lib. O smoke prova ABI/runtime/parser, não substitui download real nem garante algoritmos futuros do YouTube.
- [ ] Executar o próprio candidato com `--verbose --simulate --load-info-json <fixture local>` e isolamento/motor explícito. A fixture não contém URLs para extração de página; simulação não transfere mídia. Exigir detecção do runtime fixado e ausência de aviso de runtime/EJS incompatível. Saída desconhecida ou sem prova de compatibilidade é recusa, não sucesso presumido.
- [ ] Timeout total de 20 s, stdout/stderr limitados a 1 MiB por processo; sem rede concedida ao Deno e sem componentes remotos. Falha → `ATUALIZACAO_NAO_SUPORTADA`, limpar somente staging e manter ponteiros/binário anterior. Falha de integridade continua com seu código próprio. O motor só é resolvido nesse comando de atualização ou nos fluxos YouTube, nunca para as prévias/downloads de Instagram/TikTok.
- [ ] Testar nova instalação válida, recusa e reinício usando fixtures existentes de servidor local/assinatura de teste. Rodar suíte Rust/clippy/fmt: GREEN; revisão e commit pelo Timoneiro `fix: preservar yt-dlp quando o motor for incompatível`.

### Tarefa 6 — aceitação, documentação e pacote final

**Responsáveis:** Lince revisa/testa, Estaleiro documenta/pacote, Timoneiro verifica e commita. Nenhum agente executa o build completo do app.

**Files:** `docs/{verificacao,distribuicao,licencas}.md`, `docs/usuario/README.md`, `README.md`, `scripts/{conferir-pacote,test-conferir-pacote}.mjs`; evidências em `.maestri/`.

- [ ] Lince revisa o diff completo contra desenho/contrato e os cinco riscos do plano. Corrigir defeitos e repetir somente os testes afetados antes da rodada completa.
- [ ] Estaleiro acrescenta YouTube, resolução exata/indisponível, limites de acesso sem login, runtime empacotado, compatibilidade MP4/codecs e política de atualização recusada. Registrar a licença/fonte/hash do Deno. Não anunciar Shorts/stories/playlists.
- [ ] Timoneiro executa pessoalmente `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:rust`, clippy `--all-targets -- -D warnings`, fmt `--check`, actionlint, sintaxe dos scripts e testes Node novos/existentes. Resultados reais, sem contar testes ignorados como executados.
- [ ] Commitar somente entregas verificadas, com `git add <caminhos>` explícitos e mensagem em português. Não incluir binários/logs não versionados fora da política existente.
- [ ] Criar worktree detached do commit final e gerar `.app` com `CARGO_TARGET_DIR` isolado/reutilizado de aceitação, sem compilar alterações paralelas. Conferir o pacote real, Deno incluso, hashes, arquitetura, mínimos e licenças.
- [ ] Aceitação local em janela: colar link normal, ler prévia/qualidades, escolher resolução menor, baixar, conferir MP4/faixas/altura por FFprobe, abrir vídeo/revelar pasta, reiniciar e confirmar histórico. Repetir Melhor disponível. Confirmar Short/live recusados sem transferência e regressão Instagram/TikTok. Registrar caso bloqueado pela plataforma sem substituí-lo por teste simulado.
- [ ] Registrar sistemas/arquiteturas não testados. Testes reais Windows/Linux antes de qualquer push/publicação; falta dessas máquinas não autoriza anunciar a entrega multiplataforma concluída.

## Autorrevisão do plano

- Cobertura: escopo/qualidades/links → tarefas 2/4; formato efetivo e recuperação → 3/4; runtime → 1/3; atualização/recusa → 5; distribuição e aceitação → 6.
- Tipos compartilhados usam `qualidadesYoutube`/`alturaYoutube` em TS e equivalentes snake_case em Rust, com `Option<u32>` na entrada e `null` para automático.
- Cada tarefa tem verificação RED/GREEN ou evidência real, interfaces de consumo e entrega verificável; não começar implementação da UI antes da viabilidade da tarefa 1.
- A existência e os hashes dos seis ZIPs do Deno foram consultados; minos do binário arm64 2.7.0 foi verificado como 11.0. Demais mínimos, execução nativa por alvo e aceitação final continuam obrigatórios.
- A política dos dois bloqueios da revisão de desenho está incorporada nas tarefas 3 e 5; nenhuma decisão adicional de produto foi transferida aos especialistas.

## Fontes fixadas durante o planejamento

- [Deno v2.7.0](https://github.com/denoland/deno/releases/tag/v2.7.0) e [metadados oficiais fixados](https://api.github.com/repos/denoland/deno/releases/tags/v2.7.0), consultados em 2026-11-06.
- [Instalação e alvos Deno](https://docs.deno.com/runtime/getting_started/installation/).
- [Provider Deno do yt-dlp 2026.10.26](https://github.com/yt-dlp/yt-dlp/blob/2026.10.26/yt_dlp/extractor/youtube/jsc/_builtin/deno.py) e [ABI do solver EJS](https://github.com/yt-dlp/yt-dlp/blob/2026.10.26/yt_dlp/extractor/youtube/jsc/_builtin/ejs.py).
