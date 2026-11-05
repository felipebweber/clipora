import type {
  EstadoPersistido,
  EventoAtualizacao,
  EventoDownload,
  PastaDestino,
  Previa,
  ResultadoAtualizacao,
  VerificacaoYtdlp,
} from "../tipos/contrato";

/**
 * Camada de serviço: espelha 1:1 os comandos de docs/contrato-ipc.md.
 *
 * PONTO DE TROCA: esta interface é o único contrato que o reducer e a UI
 * conhecem. A implementação simulada (`./simulado.ts`) é usada nas etapas
 * 2 e implementa tudo localmente, com atrasos e falhas simuladas. Nas
 * etapas 3–5, uma implementação real (`./tauri.ts`, ainda não escrita)
 * chamará `invoke()` de `@tauri-apps/api/core` para cada método e criará
 * internamente um `Channel` real para repassar eventos ao `onEvento` —
 * a assinatura abaixo usa um callback simples em vez do tipo `Channel`
 * do Tauri de propósito, para que nada aqui dependa do runtime do Tauri
 * (o que permitiria usar isso nos testes em jsdom). A troca entre as duas
 * implementações acontece em um único lugar: `./index.ts`.
 */
export interface ServicoClipora {
  obter_previa(args: { url: string; requisicaoId: number }): Promise<Previa>;

  iniciar_download(args: {
    downloadId: string;
    url: string;
    onEvento: (evento: EventoDownload) => void;
  }): Promise<void>;

  obter_estado(): Promise<EstadoPersistido>;

  abrir_pasta_download(args: { downloadId: string }): Promise<void>;

  obter_pasta_destino(): Promise<PastaDestino>;

  selecionar_pasta_destino(): Promise<string | null>;

  verificar_ytdlp(): Promise<VerificacaoYtdlp>;

  atualizar_ytdlp(args: {
    versaoEsperada: string;
    onEvento: (evento: EventoAtualizacao) => void;
  }): Promise<ResultadoAtualizacao>;
}
