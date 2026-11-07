# Cancelamento de download — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Cancelar um download ativo com limpeza segura e possibilidade de baixar novamente.
**Architecture:** Sinal por tentativa no Rust, resultado terminal único e limite protegido para promoção do arquivo. React mantém o estado pendente até confirmação autoritativa pelo canal ou consulta.
**Tech Stack:** Rust/Tokio/Tauri v2, React/TypeScript, Vitest.
**Spec:** docs/superpowers/specs/2026-11-06-cancelamento-download-design.md

## Global Constraints

- cancelar_download({ downloadId: string }): Promise<void>; pedido idempotente por ID, nunca cancela outro download.
- EventoDownload ganha { tipo: 'cancelado' }; ResultadoTerminal ganha { tipo: 'cancelado'; downloadId: string; alturaYoutube: number | null }; EstadoDownload ganha cancelando: boolean.
- Cancelando… até limpeza e terminal; cancelamento preserva prévia/link/qualidade, descarta parciais próprios e não gera histórico de sucesso.
- Promoção já iniciada vence; arquivo final e terminal concluido preservados. Uma única publicação terminal por tentativa.
- Sem pausa/retomada, mudança de codecs, push ou encerramento do app do usuário. Agentes não commitam; Timoneiro verifica/commita.

## Review Focus

1. Cancelar antes do aceite de iniciar_download ou durante seletor de pasta não deixa download escondido.
2. Cancelamento e promoção concorrentes não geram arquivo órfão nem apagam conclusão.
3. Temporários e descendentes terminam antes de liberar o próximo download.
4. ID atrasado/cliques repetidos/canal antigo não atingem nova tentativa.
5. Recarga recupera cancelando e terminal cancelado sem tela de erro.

### Task 1: Controle Rust e contrato IPC

**Files:** src-tauri/src/download.rs, src-tauri/src/lib.rs, src-tauri/src/processos.rs apenas se necessário; docs/contrato-ipc.md; tests/fixtures/bin apenas se necessário.
**Interfaces:** Produz exatamente os comandos/campos dos Global Constraints. Implementador define mecanismo interno mínimo com sinal por tentativa e gate de promoção, sem usar encerrar como cancelamento reutilizável.

- [ ] Escrever teste que solicita cancelamento durante transferência de fixture e exige terminal cancelado, ausência de parcial/histórico e liberação de novo download; observar RED.
- [ ] Implementar pedido por ID, propagação de cancelamento através de preparação/metadados/transferência/união/validação e publicação terminal única.
- [ ] Proteger promoção e testar resultado concluido quando ela vence; testar cancelamento antes da promoção sem arquivo final.
- [ ] Testar IDs diferentes/repetição, descendentes, temporários, cancelamento em preparação/união, estado recuperado e novo download após limpeza; preservar shutdown.
- [ ] Rodar suíte Rust completa, clippy e fmt; registrar RED/GREEN e limites no relatório. Atualizar contrato.
- [ ] Timoneiro verifica e Lince revisa spec+qualidade; corrigir achados antes da tarefa seguinte.

### Task 2: Interface e serviços

**Files:** src/ exclusivamente, incluindo contratos, serviço real/simulado, reducer, hook, App e componentes/testes/estilos necessários.
**Interfaces:** Consome exatamente a interface da Task 1. Estado cancelando pode ser flag no estado baixando; recuperação deve tolerar campo ausente. Não reutilizar ação de cancelar diálogo como prova de backend cancelado.

- [ ] Escrever teste de UI/hook que clica Cancelar download e mantém Cancelando… até terminal, sem erro nem histórico; observar RED.
- [ ] Adicionar contrato/serviços e botão acessível com foco coerente; preservar estilo atual.
- [ ] No hook serializar cancelamento com iniciar_download pendente; impedir retentativa ao fechar seletor se já cancelado; falha no pedido mantém acompanhamento e permite repetir cancelar.
- [ ] Tratar terminal cancelado pelo canal e polling, recuperar cancelando e preservar prévia/qualidade; ignorar eventos atrasados de IDs anteriores.
- [ ] Testar cliques repetidos, conclusão concorrente, cancelamento recuperado sem prévia e novo download; executar frontend completo/typecheck/build.
- [ ] Timoneiro verifica e Lince revisa spec+qualidade; corrigir achados antes da tarefa seguinte.

### Task 3: Aceitação, documentação e pacote

**Files:** docs/verificacao.md, docs/usuario/* pertinente, .maestri relatórios, testes reais com sidecars em src-tauri se necessários; alterações de núcleo ficam com Ferrugem.
**Interfaces:** Consome entrega integrada das Tasks 1 e 2.

- [ ] Revisão final independente do diff completo e resolução dos achados.
- [ ] Timoneiro roda frontend/typecheck/build, Rust/clippy/fmt, actionlint, sintaxe scripts e diff check.
- [ ] Aceitação com sidecars reais em pasta temporária: cancelar após transferência começar, confirmar limpeza/terminal/ausência de histórico e concluir nova tentativa. Teste visual apenas se ferramenta nativa habilitada; documentar limites.
- [ ] Commit local explícito das entregas revisadas; integrar por fast-forward ao main autorizado se checkout permanecer limpo.
- [ ] Build isolado do commit final; conferir pacote arm64; preservar artefato e registrar caminho/hash/evidência.
