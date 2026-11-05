import type {
  CodigoErro,
  EstadoPersistido,
  EtapaDownload,
  EventoAtualizacao,
  EventoDownload,
  ErroClipora,
  PastaDestino,
  Plataforma,
  Previa,
  ResultadoAtualizacao,
  VerificacaoYtdlp,
} from "../tipos/contrato";
import type { ServicoClipora } from "./tipos";

/**
 * Implementação simulada de ServicoClipora para a etapa 2 (interface com
 * dados simulados), usada também nos testes. Nenhuma chamada real a
 * processos, rede ou sistema de arquivos acontece aqui.
 *
 * Cenários determinísticos via marcadores na própria URL (facilita QA
 * manual e testes sem precisar injetar mocks complexos):
 *   - contém "erro-login"        -> LOGIN_NECESSARIO
 *   - contém "erro-privado"      -> CONTEUDO_PRIVADO_OU_REMOVIDO
 *   - contém "erro-limite"       -> LIMITE_DE_ACESSO
 *   - contém "erro-nao-suportado"-> CONTEUDO_NAO_SUPORTADO
 *   - contém "erro-indisponivel" -> PREVIA_INDISPONIVEL
 *   - contém "erro-rede"         -> SEM_CONEXAO
 *   - contém "sem-capa"          -> prévia sem capa (capaDataUrl: null)
 *   - contém "tiktok"            -> plataforma "tiktok" (senão "instagram")
 *
 * Para o download, iniciar_download aceita a mesma URL e reconhece:
 *   - contém "falha-download"    -> termina com erro DOWNLOAD_FALHOU
 *   - contém "indeterminado"     -> progresso sem percentual (barra indeterminada) antes de ficar determinado
 *
 * Atualização do yt-dlp: `verificacaoYtdlpInicial` controla se há versão
 * nova; `falhaAtualizacao` faz `atualizar_ytdlp` rejeitar com o código dado.
 * Como no backend real, download/prévia e atualização se excluem
 * (ATUALIZACAO_EM_ANDAMENTO / DOWNLOAD_EM_ANDAMENTO).
 */
export class ServicoCliporaSimulado implements ServicoClipora {
  private readonly atrasoPreviaMs: number;
  private readonly tempoLimitePreviaMs: number;
  private readonly atrasoPassoDownloadMs: number;

  private previaEmAndamento: {
    requisicaoId: number;
    cancelar: (erro: ErroClipora) => void;
  } | null = null;

  private pastaAtual: PastaDestino = { caminho: null, estado: "nao_definida" };
  /** Próximo valor retornado por selecionar_pasta_destino(); ajustável nos testes. */
  proximaSelecaoDePasta: string | null = "/simulado/Downloads";

  private downloadAtivo: { downloadId: string; percentual: number | null; etapa: EtapaDownload } | null =
    null;
  private readonly downloadsConcluidos = new Map<
    string,
    { caminho: string; nomeArquivo: string }
  >();

  private atualizando = false;
  private readonly falhaAtualizacao: CodigoErro | null;

  private verificacaoYtdlp: VerificacaoYtdlp = {
    versaoAtual: "2024.08.06",
    versaoDisponivel: null,
    atualizacaoDisponivel: false,
    origem: "empacotada",
    erroVerificacao: null,
  };

  constructor(
    opcoes: {
      atrasoPreviaMs?: number;
      tempoLimitePreviaMs?: number;
      atrasoPassoDownloadMs?: number;
      pastaInicial?: PastaDestino;
      verificacaoYtdlpInicial?: VerificacaoYtdlp;
      falhaAtualizacao?: CodigoErro;
    } = {},
  ) {
    this.atrasoPreviaMs = opcoes.atrasoPreviaMs ?? 400;
    this.tempoLimitePreviaMs = opcoes.tempoLimitePreviaMs ?? 30_000;
    this.atrasoPassoDownloadMs = opcoes.atrasoPassoDownloadMs ?? 250;
    if (opcoes.pastaInicial) this.pastaAtual = opcoes.pastaInicial;
    if (opcoes.verificacaoYtdlpInicial) this.verificacaoYtdlp = opcoes.verificacaoYtdlpInicial;
    this.falhaAtualizacao = opcoes.falhaAtualizacao ?? null;
  }

  async obter_previa({
    url,
    requisicaoId,
  }: {
    url: string;
    requisicaoId: number;
  }): Promise<Previa> {
    if (this.atualizando) {
      throw {
        codigo: "ATUALIZACAO_EM_ANDAMENTO",
        mensagem: "an update is running",
      } satisfies ErroClipora;
    }
    // Nova prévia cancela a anterior, que rejeita com PREVIA_CANCELADA.
    if (this.previaEmAndamento) {
      this.previaEmAndamento.cancelar({
        codigo: "PREVIA_CANCELADA",
        mensagem: "cancelled by a newer request",
      });
    }

    return new Promise<Previa>((resolve, reject) => {
      let finalizado = false;
      const finalizar = (acao: () => void) => {
        if (finalizado) return;
        finalizado = true;
        clearTimeout(limite);
        clearTimeout(passo);
        this.previaEmAndamento = null;
        acao();
      };

      const limite = setTimeout(() => {
        finalizar(() =>
          reject({ codigo: "TEMPO_ESGOTADO", mensagem: "preview timed out" } satisfies ErroClipora),
        );
      }, this.tempoLimitePreviaMs);

      const passo = setTimeout(() => {
        finalizar(() => {
          const erroSimulado = this.erroSimuladoDePrevia(url);
          if (erroSimulado) {
            reject(erroSimulado);
            return;
          }
          resolve(this.gerarPreviaFalsa(url, requisicaoId));
        });
      }, this.atrasoPreviaMs);

      this.previaEmAndamento = {
        requisicaoId,
        cancelar: (erro) => finalizar(() => reject(erro)),
      };
    });
  }

  private erroSimuladoDePrevia(url: string): ErroClipora | null {
    const mapa: Array<[string, ErroClipora["codigo"]]> = [
      ["erro-login", "LOGIN_NECESSARIO"],
      ["erro-privado", "CONTEUDO_PRIVADO_OU_REMOVIDO"],
      ["erro-limite", "LIMITE_DE_ACESSO"],
      ["erro-nao-suportado", "CONTEUDO_NAO_SUPORTADO"],
      ["erro-indisponivel", "PREVIA_INDISPONIVEL"],
      ["erro-rede", "SEM_CONEXAO"],
    ];
    for (const [marcador, codigo] of mapa) {
      if (url.includes(marcador)) {
        return { codigo, mensagem: `simulated ${codigo.toLowerCase()}` };
      }
    }
    return null;
  }

  private gerarPreviaFalsa(url: string, requisicaoId: number): Previa {
    const plataforma: Plataforma = url.includes("tiktok") ? "tiktok" : "instagram";
    const urlNormalizada = url.startsWith("http://") ? url.replace(/^http:\/\//, "https://") : url;
    const semCapa = url.includes("sem-capa");
    return {
      requisicaoId,
      urlOriginal: url,
      urlNormalizada,
      titulo: `Vídeo simulado de ${plataforma}`,
      plataforma,
      duracaoSegundos: 17.5,
      capaDataUrl: semCapa
        ? null
        : // PNG 1×1 (o backend só devolve data URLs de imagem raster).
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    };
  }

  async iniciar_download({
    downloadId,
    url,
    onEvento,
  }: {
    downloadId: string;
    url: string;
    onEvento: (evento: EventoDownload) => void;
  }): Promise<void> {
    if (this.atualizando) {
      throw {
        codigo: "ATUALIZACAO_EM_ANDAMENTO",
        mensagem: "an update is running",
      } satisfies ErroClipora;
    }
    if (this.pastaAtual.estado !== "valida") {
      const codigo =
        this.pastaAtual.estado === "nao_definida"
          ? "PASTA_NAO_DEFINIDA"
          : this.pastaAtual.estado === "ausente"
            ? "PASTA_AUSENTE"
            : "PASTA_SEM_PERMISSAO";
      throw { codigo, mensagem: `simulated ${codigo.toLowerCase()}` } satisfies ErroClipora;
    }
    if (this.downloadAtivo) {
      throw {
        codigo: "DOWNLOAD_EM_ANDAMENTO",
        mensagem: "a download is already running",
      } satisfies ErroClipora;
    }

    const etapas: EtapaDownload[] = [
      "preparando",
      "baixando_video",
      "baixando_audio",
      "unindo",
      "finalizando",
    ];
    const indeterminado = url.includes("indeterminado");
    const falhaNaEtapa = url.includes("falha-download") ? "baixando_video" : null;

    this.downloadAtivo = { downloadId, percentual: null, etapa: "preparando" };

    try {
      for (let i = 0; i < etapas.length; i++) {
        const etapa = etapas[i];
        await this.esperar(this.atrasoPassoDownloadMs);

        if (falhaNaEtapa && etapa === falhaNaEtapa) {
          const erro: ErroClipora = { codigo: "DOWNLOAD_FALHOU", mensagem: "simulated failure" };
          this.downloadAtivo = null;
          onEvento({ tipo: "erro", erro });
          throw erro;
        }

        const percentual =
          indeterminado && i < etapas.length - 1 ? null : Math.round(((i + 1) / etapas.length) * 100);
        this.downloadAtivo = { downloadId, percentual, etapa };
        onEvento({ tipo: "progresso", etapa, percentual });
      }

      const nomeArquivo = this.nomeArquivoFalso(url);
      const caminho = `${this.pastaAtual.caminho}/${nomeArquivo}`;
      this.downloadsConcluidos.set(downloadId, { caminho, nomeArquivo });
      this.downloadAtivo = null;
      onEvento({ tipo: "concluido", caminho, nomeArquivo, renomeado: false });
    } finally {
      this.downloadAtivo = null;
    }
  }

  private nomeArquivoFalso(url: string): string {
    const plataforma = url.includes("tiktok") ? "tiktok" : "instagram";
    return `Vídeo simulado de ${plataforma}.mp4`;
  }

  private esperar(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async obter_estado(): Promise<EstadoPersistido> {
    return {
      download: this.downloadAtivo,
      atualizacaoEmAndamento: this.atualizando,
    };
  }

  async abrir_pasta_download({ downloadId }: { downloadId: string }): Promise<void> {
    if (!this.downloadsConcluidos.has(downloadId)) {
      throw {
        codigo: "ERRO_INTERNO",
        mensagem: "unknown downloadId",
      } satisfies ErroClipora;
    }
    // Simulação: nenhuma janela de SO é realmente aberta.
  }

  async obter_pasta_destino(): Promise<PastaDestino> {
    return this.pastaAtual;
  }

  async selecionar_pasta_destino(): Promise<string | null> {
    if (this.proximaSelecaoDePasta === null) {
      return null; // cancelado: mantém a pasta anterior
    }
    this.pastaAtual = { caminho: this.proximaSelecaoDePasta, estado: "valida" };
    return this.pastaAtual.caminho;
  }

  async verificar_ytdlp(): Promise<VerificacaoYtdlp> {
    return this.verificacaoYtdlp;
  }

  async atualizar_ytdlp({
    versaoEsperada,
    onEvento,
  }: {
    versaoEsperada: string;
    onEvento: (evento: EventoAtualizacao) => void;
  }): Promise<ResultadoAtualizacao> {
    if (this.downloadAtivo) {
      throw {
        codigo: "DOWNLOAD_EM_ANDAMENTO",
        mensagem: "a download is running",
      } satisfies ErroClipora;
    }
    if (this.atualizando) {
      throw {
        codigo: "ATUALIZACAO_EM_ANDAMENTO",
        mensagem: "an update is already running",
      } satisfies ErroClipora;
    }
    this.atualizando = true;
    try {
      // Mesmas etapas que o backend real envia (src-tauri/src/instalacao.rs).
      for (const [etapa, percentual] of [
        ["verificando", null],
        ["baixando", null],
        ["verificando_integridade", null],
        ["instalando", null],
      ] as const) {
        await this.esperar(this.atrasoPassoDownloadMs);
        if (this.falhaAtualizacao && etapa === "verificando_integridade") {
          throw {
            codigo: this.falhaAtualizacao,
            mensagem: "simulated update failure",
          } satisfies ErroClipora;
        }
        onEvento({ tipo: "progresso", etapa, percentual });
      }
      onEvento({ tipo: "progresso", etapa: "concluido", percentual: 100 });
    } finally {
      this.atualizando = false;
    }
    this.verificacaoYtdlp = {
      ...this.verificacaoYtdlp,
      versaoAtual: versaoEsperada,
      atualizacaoDisponivel: false,
      origem: "atualizada",
    };
    return { versaoInstalada: versaoEsperada };
  }

  /** Utilitário para testes: define a pasta de destino "persistida" diretamente. */
  definirPastaParaTeste(pasta: PastaDestino): void {
    this.pastaAtual = pasta;
  }
}
