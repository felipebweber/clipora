import type {
  EstadoPersistido,
  Licencas,
  ItemHistorico,
  TipoLinkLicenca,
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
 * conhecem. Há duas implementações: a simulada (`./simulado.ts`, usada no
 * navegador e nos testes, com atrasos e falhas simuladas) e a real
 * (`./tauri.ts`, que chama `invoke()` e cria internamente um `Channel` do
 * Tauri para repassar eventos ao `onEvento`). A assinatura usa um callback
 * simples em vez do tipo `Channel` de propósito, para que nada aqui dependa
 * do runtime do Tauri. A escolha entre as duas acontece em `./index.ts`.
 */
export interface ServicoClipora {
  obter_historico(): Promise<ItemHistorico[]>;
  consultar_historico(args: { url: string }): Promise<ItemHistorico | null>;
  limpar_historico(): Promise<void>;
  abrir_arquivo_download(args: { downloadId: string }): Promise<void>;
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

  obter_licencas(): Promise<Licencas>;

  abrir_link_licenca(args: { componenteId: string; tipo: TipoLinkLicenca }): Promise<void>;
}
