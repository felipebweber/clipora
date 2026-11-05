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
    // Cada chamada Rust consome seu Channel. Em particular, uma rejeição por
    // PASTA_* destrói o canal no Drop; a retentativa mantém o ID e callback
    // lógico, mas precisa de outra instância JS para receber eventos.
    const canal = new Channel<EventoDownload>();
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
