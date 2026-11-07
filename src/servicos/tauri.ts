import { Channel, invoke } from "@tauri-apps/api/core";
import { normalizarErro } from "../erros/normalizar";
import type {
  EstadoPersistido,
  EventoAtualizacao,
  EventoDownload,
  Licencas,
  ItemHistorico,
  PastaDestino,
  TipoLinkLicenca,
  Previa,
  ResultadoAtualizacao,
  VerificacaoYtdlp,
} from "../tipos/contrato";
import type { ServicoClipora } from "./tipos";

/**
 * Implementação real de `ServicoClipora`: cada método chama o comando
 * homônimo de docs/contrato-ipc.md via `invoke()`, com argumentos em
 * camelCase exatamente como o contrato define. Eventos de download e de
 * atualização chegam por um `Channel` do Tauri, cujo `onmessage` repassa
 * cada mensagem (na ordem em que o backend as enviou) para o callback
 * `onEvento` da camada de serviço.
 * `iniciar_download` cria um canal novo por tentativa IPC: o Rust pode
 * destruí-lo ao rejeitar uma chamada que pede seleção de pasta.
 *
 * Toda rejeição passa por `normalizarErro`: um `ErroClipora` válido chega
 * intacto; qualquer outra coisa (string do runtime, objeto malformado,
 * exceção) vira `ERRO_INTERNO`.
 */
export class ServicoCliporaTauri implements ServicoClipora {
  private async chamar<T>(comando: string, args?: Record<string, unknown>): Promise<T> {
    try {
      return await invoke<T>(comando, args);
    } catch (erro) {
      throw normalizarErro(erro);
    }
  }

  async obter_previa({ url, requisicaoId }: { url: string; requisicaoId: number }): Promise<Previa> {
    const previa = await this.chamar<Previa & { qualidadesYoutube?: number[] | null }>("obter_previa", { url, requisicaoId });
    return { ...previa, qualidadesYoutube: previa.qualidadesYoutube ?? null };
  }

  obter_historico(): Promise<ItemHistorico[]> {
    return this.chamar<ItemHistorico[]>("obter_historico");
  }

  consultar_historico({ url }: { url: string }): Promise<ItemHistorico | null> {
    return this.chamar<ItemHistorico | null>("consultar_historico", { url });
  }

  limpar_historico(): Promise<void> {
    return this.chamar<void>("limpar_historico");
  }

  abrir_arquivo_download({ downloadId }: { downloadId: string }): Promise<void> {
    return this.chamar<void>("abrir_arquivo_download", { downloadId });
  }

  iniciar_download({
    downloadId,
    url,
    alturaYoutube,
    onEvento,
  }: {
    downloadId: string;
    url: string;
    alturaYoutube?: number | null;
    onEvento: (evento: EventoDownload) => void;
  }): Promise<void> {
    // Cada chamada Rust consome seu Channel. Em particular, uma rejeição por
    // PASTA_* destrói o canal no Drop; a retentativa mantém o ID e callback
    // lógico, mas precisa de outra instância JS para receber eventos.
    const canal = new Channel<EventoDownload>();
    canal.onmessage = onEvento;
    const args: Record<string, unknown> = { downloadId, url, onEvento: canal };
    if (alturaYoutube !== undefined) args.alturaYoutube = alturaYoutube;
    return this.chamar<void>("iniciar_download", args);
  }

  cancelar_download({ downloadId }: { downloadId: string }): Promise<void> {
    return this.chamar<void>("cancelar_download", { downloadId });
  }

  async obter_estado(): Promise<EstadoPersistido> {
    const estado = await this.chamar<EstadoPersistido>("obter_estado");
    const download = estado.download ? {
      ...estado.download,
      alturaYoutube: estado.download.alturaYoutube ?? null,
      cancelando: estado.download.cancelando ?? false,
      previa: estado.download.previa
        ? { ...estado.download.previa, qualidadesYoutube: estado.download.previa.qualidadesYoutube ?? null }
        : null,
    } : null;
    const ultimoResultado = estado.ultimoResultado
      ? { ...estado.ultimoResultado, alturaYoutube: estado.ultimoResultado.alturaYoutube ?? null }
      : null;
    return { ...estado, download, ultimoResultado };
  }

  abrir_pasta_download({ downloadId }: { downloadId: string }): Promise<void> {
    return this.chamar<void>("abrir_pasta_download", { downloadId });
  }

  obter_pasta_destino(): Promise<PastaDestino> {
    return this.chamar<PastaDestino>("obter_pasta_destino");
  }

  selecionar_pasta_destino(): Promise<string | null> {
    return this.chamar<string | null>("selecionar_pasta_destino");
  }

  verificar_ytdlp(): Promise<VerificacaoYtdlp> {
    return this.chamar<VerificacaoYtdlp>("verificar_ytdlp");
  }

  atualizar_ytdlp({
    versaoEsperada,
    onEvento,
  }: {
    versaoEsperada: string;
    onEvento: (evento: EventoAtualizacao) => void;
  }): Promise<ResultadoAtualizacao> {
    const canal = new Channel<EventoAtualizacao>();
    canal.onmessage = onEvento;
    return this.chamar<ResultadoAtualizacao>("atualizar_ytdlp", {
      versaoEsperada,
      onEvento: canal,
    });
  }

  obter_licencas(): Promise<Licencas> {
    return this.chamar<Licencas>("obter_licencas");
  }

  abrir_link_licenca({
    componenteId,
    tipo,
  }: {
    componenteId: string;
    tipo: TipoLinkLicenca;
  }): Promise<void> {
    return this.chamar<void>("abrir_link_licenca", { componenteId, tipo });
  }
}
