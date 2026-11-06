# Progresso por bytes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** mostrar proporção real dos bytes transferidos, sem pesos por etapa.
**Architecture:** plano before_dl com IDs/tamanhos, acumulador Rust por formato e percentual total; UI separa transferência de processamento. IPC compatível em forma.
**Tech Stack:** Rust/Tokio, yt-dlp2026.10.26, React/TS.
**Spec:** docs/superpowers/specs/2026-11-06-progresso-bytes-design.md

## Global Constraints

- Um download por vez; sem login, cookies ou novas dependências.
- Sem mudança de velocidade/qualidade; sem push/publicação antes de Windows/Linux.
- Tamanho desconhecido:percentual null. Finalização:sem percentual inventado.
- Checkout compartilhado autorizado pelo usuário; escopos exclusivos. Timoneiro faz commits após validação; pacote em worktree detached.

## Review Focus

1. Vídeo muito maior que áudio: meio do vídeo representa quase metade da transferência.
2. Combinado e separados: nenhuma soma duplicada na troca/retomada de formato.
3. Tamanhos desconhecidos/inválidos: indeterminado, sem NaN ou 100% falso.
4. Registros reais before_dl/progress: IDs e total_bytes correspondem ao plano.
5. Conclusão/processamento:100% de transferência não é sucesso final nem percentual de remux.

### Task1: cálculo e integração Rust

Files:src-tauri/src/download.rs, tests/fixtures/lib/ytdlp-falso.mjs, docs/contrato-ipc.md.
Interfaces:Progresso::ler(&mut self,linha:&str)->Option<Option<f64>>, parte indica áudio; plano CLIPORA_PLAN:<objeto format_id/filesize>\t<array requested_formats format_id/filesize ou NA>; progresso download:<bytes>:<total exato ou NA>:<vcodec>:<acodec>:<ID JSON>. Sem total_bytes_estimate para inventar total.
- [x] RED: vídeo1000+áudio10, vídeo500=49,50495%; vídeo1000=99,0099%; áudio5=99,50495%; combinado500/1000=50%; desconhecidos null; retomada não duplica; entrada inválida/overflow não fabrica percentual.
- [x] GREEN: emitir plano before_dl e progresso por formato; substituir pesos pelo acumulador; unindo/finalizando null. Atualizar falso com before_dl e projeção requested_formats, mantendo total desconhecido quando cenário pede.
- [x] Rodar Rust/clippy/fmt; teste real controlado com binários empacotados, incluindo registros do plano e progresso; revisão Lince.

### Task2: apresentação e pacote

Files:src/componentes/ProgressoDownload.tsx,src/componentes/componentes.test.tsx,src/servicos/simulado.ts,docs/verificacao.md.
Interfaces:mesmo percentual number|null; representa bytes globais da transferência. preparando/unindo/finalizando indeterminados inclusive backend legado com90/95.
- [x] RED/GREEN UI: transferência50 mostra50% transferido; unindo/finalizando não exibem90/95 nem valor; tamanho desconhecido indeterminado. Simulador alinhado.
- [x] Frontend323/typecheck/build,Rust93/0/9ignorados,clippy/fmt,actionlint,sintaxe; revisão Lince semachados. Commit seletivo b9969cf pelo Timoneiro.
- [x] Pacote de b9969cf em worktreeisolado com Deno arm64 do pacote05a507c; conferência forte, cópia .maestri/artefatos/; conferência completa exit0,244,50MiB. Finder preparado para o usuário testar.
