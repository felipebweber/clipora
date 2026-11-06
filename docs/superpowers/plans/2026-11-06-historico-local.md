# Histórico local — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Entregar histórico persistente local, abertura de vídeo e aviso de link já baixado sem complicar o fluxo principal.

**Architecture:** Rust mantém repositório JSON versionado com escrita atômica e sincronização; downloads concluídos alimentam o histórico. Comandos IPC por ID validam os arquivos. React usa um hook próprio e seção recolhível, com consultas protegidas contra respostas obsoletas.

**Tech Stack:** Tauri 2, Rust, serde/tempfile existentes, React 19, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-06-historico-local-design.md`

## Global Constraints

- Desenvolvimento autorizado até terminar; coordenador verifica e faz commits locais em pt-BR. Agentes não commitam.
- Preservar `projeto-aplicativo.md` e `plano-clipora.md`.
- Não apagar vídeos; não receber caminhos arbitrários do frontend; não adicionar servidor, fila ou dependências sem necessidade.
- Histórico falho não invalida download concluído; links repetidos continuam podendo ser baixados.
- Sem push/publicação antes de testes Windows/Linux registrados.

## Review Focus

- Caminhos manipulados no JSON, symlinks e arquivos ausentes: nunca executar conteúdo arbitrário nem apagar vídeo ao limpar.
- Corrupção/permissão de disco: preservar dados e conclusão, mostrar falha do histórico.
- Equivalência de URLs: não comparar vídeos distintos, inclusive TikTok de usuários diferentes e links curtos.
- Concorrência entre limpar, concluir e consultar: não perder registro novo nem ressuscitar lista limpa.
- Eventos de prévia/histórico atrasados e recuperação após recarga: não aplicar aviso ao link errado.

## Tarefa 1 — Núcleo e contrato (Ferrugem)

**Files:** criar `src-tauri/src/historico.rs`; modificar `src-tauri/src/lib.rs`, `src-tauri/src/download.rs`, `docs/contrato-ipc.md`; testes nos módulos Rust.

**Interfaces:** produz `ItemHistorico` e os quatro comandos novos definidos na especificação; estende abrir_pasta_download para persistência. Não modifica `src/`.

- [x] Criar testes que falham: persistir/reabrir, mais recente primeiro, só sucesso registrado, equivalência Instagram/TikTok, arquivos indisponíveis, limpar sem apagar vídeo, corrupção preservada e operações concorrentes.
- [x] Executar testes e registrar a falha esperada antes da implementação.
- [x] Implementar repositório JSON, integração de conclusão e comandos Tauri por ID; preservar abertura da conclusão se histórico falhar. Testar validação de caminhos e abertura sem chamar app externo nos testes.
- [x] Rodar `pnpm test:rust`, Clippy e fmt; esperado exit 0. Relatório em `.maestri/relatorio-historico-ferrugem.md` com arquivos e evidência RED/GREEN.
- [x] Coordenador verifica entrega e integra em commit após a revisão da evolução.

## Tarefa 2 — Interface e serviços (Vitral)

**Files:** modificar tipos/serviços em `src/servicos/` e `src/tipos/contrato.ts`, `src/estado/useClipora.ts`, `src/App.tsx`, `src/App.css`, `src/erros/mensagens.ts`; criar `src/estado/useHistorico.ts`, `src/componentes/HistoricoPainel.tsx` e respectivos testes; atualizar testes de integração existentes.

**Interfaces:** consome exatamente o contrato da especificação; a fonte de verdade final do IPC é `docs/contrato-ipc.md`. Mantém implementação real e simulada em paridade. Usa eventos/resultado de useClipora para recarregar lista, sem ciclos de consulta.

- [x] Criar testes que falham para lista vazia/preenchida, abrir arquivo/pasta por ID, confirmação de limpeza, preservar arquivos simulados, erro e retentativa, duplicidade e novo download permitido.
- [x] Verificar RED antes de implementar.
- [x] Implementar hook/componente acessível nos temas existentes, botão Abrir vídeo na conclusão, aviso da prévia, proteção de resposta atrasada e de duplo clique. Cobrir arquivos indisponíveis, troca rápida de link, limpar durante consulta e download recuperado.
- [x] Rodar `pnpm typecheck`, `pnpm test`, `pnpm build`; esperado exit 0. Relatório `.maestri/relatorio-historico-vitral.md`.
- [x] Coordenador verifica integração real e simulada antes do commit.

## Tarefa 3 — Revisão, documentação e fechamento (Lince/Estaleiro/Timoneiro)

**Files:** `README.md`, `docs/usuario/README.md`, `docs/verificacao.md`, plano e relatórios `.maestri/`.

**Interfaces:** revisão cobre Tasks 1 e 2 e contrato real, sem modificar código dos implementadores durante suas tarefas.

- [x] Lince revisa integração inteira e cinco pontos do Review Focus; reporta achados com caminhos/impacto em `.maestri/revisao-historico-lince.md`.
- [x] Resolver achados relevantes com testes de regressão e rodar novamente as suítes afetadas.
- [x] Estaleiro documenta histórico local, privacidade, abrir vídeo, duplicidade e limpeza sem apagar arquivos; não amplia compatibilidade declarada.
- [x] Timoneiro roda frontend typecheck/test/build; Rust test/clippy/fmt; actionlint e sintaxe dos scripts, guardando logs.
- [x] Timoneiro valida a UI por testes React e o backend com downloads públicos reais, reabertura do repositório, consulta equivalente, ID persistido, arquivo movido e limpeza sem apagar. Smoke nativo confirmou abertura, histórico vazio e configurações. CUA bloqueou a sequência interativa: fluxos completos na janela e navegador permanecem não verificados; registrar essa limitação sem atribuir ao pacote final o smoke do candidato.
- [ ] Commit local explícito dos arquivos entregues, build do commit em worktree isolado, conferência do pacote e atualização do handoff. Nenhum push.
