import { Channel, invoke } from "@tauri-apps/api/core";
import { normalizarErro } from "../erros/normalizar";
import type {
  EstadoPersistido,
  EventoAtualizacao,
  EventoDownload,
  Licencas,
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
 *
 * Toda rejeição passa por `normalizarErro`: um `ErroClipora` válido chega
 * intacto; qualquer outra coisa (string do runtime, objeto malformado,
 * exceção) vira `ERRO_INTERNO`.
 */
export class ServicoCliporaTauri implements ServicoClipora {
  /**
   * O contrato pede que, após escolher a pasta, o download seja repetido
   * "com o mesmo ID e canal". Guardamos o canal do último `downloadId` para
   * reaproveitá-lo nessa nova tentativa.
   */
  private canalDownload: { downloadId: string; canal: Channel<EventoDownload> } | null = null;

  private async chamar<T>(comando: string, args?: Record<string, unknown>): Promise<T> {
    try {
      return await invoke<T>(comando, args);
    } catch (erro) {
      throw normalizarErro(erro);
    }
  }

  obter_previa({ url, requisicaoId }: { url: string; requisicaoId: number }): Promise<Previa> {
    return this.chamar<Previa>("obter_previa", { url, requisicaoId });
  }

  iniciar_download({
    downloadId,
    url,
    onEvento,
  }: {
    downloadId: string;
    url: string;
    onEvento: (evento: EventoDownload) => void;
  }): Promise<void> {
    let canal: Channel<EventoDownload>;
    if (this.canalDownload?.downloadId === downloadId) {
      canal = this.canalDownload.canal;
    } else {
      canal = new Channel<EventoDownload>();
      this.canalDownload = { downloadId, canal };
    }
    canal.onmessage = onEvento;
    return this.chamar<void>("iniciar_download", { downloadId, url, onEvento: canal });
  }

  obter_estado(): Promise<EstadoPersistido> {
    return this.chamar<EstadoPersistido>("obter_estado");
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
