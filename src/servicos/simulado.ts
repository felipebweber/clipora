import type {
  CodigoErro,
  EstadoPersistido,
  EtapaDownload,
  EventoAtualizacao,
  EventoDownload,
  ErroClipora,
  Licencas,
  ItemHistorico,
  PastaDestino,
  TipoLinkLicenca,
  Plataforma,
  Previa,
  ResultadoAtualizacao,
  ResultadoTerminal,
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

  private downloadAtivo: { downloadId: string; alturaYoutube: number | null; percentual: number | null; etapa: EtapaDownload } | null =
    null;
  private ultimoResultado: ResultadoTerminal | null = null;
  private readonly downloadsConcluidos = new Map<
    string,
    { caminho: string; nomeArquivo: string }
  >();
  private readonly arquivosSimuladosAusentes = new Set<string>();
  private readonly historico = new Map<string, ItemHistorico>();
  private readonly historicoPendente = new Map<string, ItemHistorico>();
  private readonly previasPorOriginal = new Map<string, Previa>();
  private readonly falhaHistorico: CodigoErro | null;
  private falhasPersistenciaHistoricoRestantes: number;
  private sequenciaHistorico = 0;

  private atualizando = false;
  private readonly falhaAtualizacao: CodigoErro | null;
  private readonly licencasIndisponiveis: boolean;

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
      /** Simula o arquivo de licenças ausente (como em dev sem o gerador). */
      licencasIndisponiveis?: boolean;
      falhaHistorico?: CodigoErro;
      falhasPersistenciaHistoricoRestantes?: number;
    } = {},
  ) {
    this.atrasoPreviaMs = opcoes.atrasoPreviaMs ?? 400;
    this.tempoLimitePreviaMs = opcoes.tempoLimitePreviaMs ?? 30_000;
    this.atrasoPassoDownloadMs = opcoes.atrasoPassoDownloadMs ?? 250;
    if (opcoes.pastaInicial) this.pastaAtual = opcoes.pastaInicial;
    if (opcoes.verificacaoYtdlpInicial) this.verificacaoYtdlp = opcoes.verificacaoYtdlpInicial;
    this.falhaAtualizacao = opcoes.falhaAtualizacao ?? null;
    this.licencasIndisponiveis = opcoes.licencasIndisponiveis ?? false;
    this.falhaHistorico = opcoes.falhaHistorico ?? null;
    this.falhasPersistenciaHistoricoRestantes = opcoes.falhasPersistenciaHistoricoRestantes ?? 0;
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
          const previa = this.gerarPreviaFalsa(url, requisicaoId);
          this.previasPorOriginal.set(url, previa);
          resolve(previa);
        });
      }, this.atrasoPreviaMs);

      this.previaEmAndamento = {
        requisicaoId,
        cancelar: (erro) => finalizar(() => reject(erro)),
      };
    });
  }

  private erroSimuladoDePrevia(url: string): ErroClipora | null {
    if (url.includes("erro-motor-youtube")) {
      return { codigo: "MOTOR_YOUTUBE_INDISPONIVEL", mensagem: "YouTube runtime unavailable" };
    }
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
    const plataforma = plataformaDaUrl(url);
    const urlNormalizada = plataforma === "youtube" ? normalizarUrlYoutube(url) : normalizarEsquema(url);
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
      qualidadesYoutube: plataforma === "youtube" && !url.includes("sem-qualidades") ? [1080, 720, 480] : null,
    };
  }

  async iniciar_download({
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
    const plataforma = plataformaDaUrl(url);
    if (alturaYoutube != null && plataforma !== "youtube") {
      throw { codigo: "QUALIDADE_INDISPONIVEL", mensagem: "quality is only valid for YouTube" } satisfies ErroClipora;
    }
    const alturaCapturada = plataforma === "youtube" ? alturaYoutube ?? null : null;
    if (plataforma === "youtube" && url.includes("erro-motor-youtube")) {
      throw { codigo: "MOTOR_YOUTUBE_INDISPONIVEL", mensagem: "YouTube runtime unavailable" } satisfies ErroClipora;
    }
    const previaConhecida = this.previasPorOriginal.get(url);
    if (plataforma === "youtube" && alturaCapturada !== null &&
      (!previaConhecida?.qualidadesYoutube?.includes(alturaCapturada) || url.includes("erro-qualidade-indisponivel"))) {
      throw { codigo: "QUALIDADE_INDISPONIVEL", mensagem: "selected quality is no longer available" } satisfies ErroClipora;
    }
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

    // Um novo download aceito limpa o resultado terminal anterior, como no backend.
    this.ultimoResultado = null;
    this.downloadAtivo = { downloadId, alturaYoutube: alturaCapturada, percentual: null, etapa: "preparando" };

    try {
      for (let i = 0; i < etapas.length; i++) {
        const etapa = etapas[i];
        await this.esperar(this.atrasoPassoDownloadMs);

        if (falhaNaEtapa && etapa === falhaNaEtapa) {
          const erro: ErroClipora = { codigo: "DOWNLOAD_FALHOU", mensagem: "simulated failure" };
          this.ultimoResultado = { downloadId, alturaYoutube: alturaCapturada, tipo: "erro", erro };
          this.downloadAtivo = null;
          onEvento({ tipo: "erro", erro });
          throw erro;
        }

        const percentual =
          indeterminado && i < etapas.length - 1 ? null : Math.round(((i + 1) / etapas.length) * 100);
        this.downloadAtivo = { downloadId, alturaYoutube: alturaCapturada, percentual, etapa };
        onEvento({ tipo: "progresso", etapa, percentual });
      }

      const nomeArquivo = this.nomeArquivoFalso(url);
      const caminho = `${this.pastaAtual.caminho}/${nomeArquivo}`;
      const previa = this.previasPorOriginal.get(url);
      const plataforma: Plataforma = previa?.plataforma ?? plataformaDaUrl(url);
      this.downloadsConcluidos.set(downloadId, { caminho, nomeArquivo });
      if (url.includes("arquivo-ausente")) this.arquivosSimuladosAusentes.add(downloadId);
      const item: ItemHistorico = {
        downloadId,
        urlOriginal: url,
        urlNormalizada: previa?.urlNormalizada ?? normalizarEsquema(url),
        titulo: previa?.titulo ?? `Vídeo simulado de ${plataforma}`,
        plataforma,
        caminho,
        nomeArquivo,
        concluidoEm: Date.now() + ++this.sequenciaHistorico,
        disponivel: !this.arquivosSimuladosAusentes.has(downloadId),
      };
      this.historicoPendente.set(downloadId, item);
      try { this.persistirHistoricoPendente(); } catch { /* sucesso do vídeo permanece independente do histórico */ }
      this.ultimoResultado = { downloadId, alturaYoutube: alturaCapturada, tipo: "concluido", caminho, nomeArquivo, renomeado: false };
      this.downloadAtivo = null;
      onEvento({ tipo: "concluido", caminho, nomeArquivo, renomeado: false });
    } finally {
      this.downloadAtivo = null;
    }
  }

  private nomeArquivoFalso(url: string): string {
    const plataforma = plataformaDaUrl(url);
    return `Vídeo simulado de ${plataforma}.mp4`;
  }

  private esperar(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async obter_estado(): Promise<EstadoPersistido> {
    return {
      download: this.downloadAtivo ? { ...this.downloadAtivo, previa: null } : null,
      atualizacaoEmAndamento: this.atualizando,
      ultimoResultado: this.ultimoResultado,
    };
  }

  async obter_historico(): Promise<ItemHistorico[]> {
    this.exigirHistoricoDisponivel();
    this.persistirHistoricoPendente();
    return [...this.historico.values()].sort((a, b) => b.concluidoEm - a.concluidoEm).map((item) => ({ ...item }));
  }

  async consultar_historico({ url }: { url: string }): Promise<ItemHistorico | null> {
    this.exigirHistoricoDisponivel();
    const chave = chaveVideo(url);
    this.persistirHistoricoPendente();
    const encontrados = [...this.historico.values()]
      .filter((item) => [item.urlOriginal, item.urlNormalizada].some((salva) => chaveVideo(salva) === chave))
      .sort((a, b) => b.concluidoEm - a.concluidoEm);
    const item = encontrados.find((candidato) => candidato.disponivel) ?? encontrados[0];
    return item ? { ...item } : null;
  }

  async limpar_historico(): Promise<void> {
    this.exigirHistoricoDisponivel();
    this.historico.clear();
    this.historicoPendente.clear();
    // downloadsConcluidos representa os arquivos físicos simulados e fica intacto.
  }

  async abrir_arquivo_download({ downloadId }: { downloadId: string }): Promise<void> {
    if (!this.downloadsConcluidos.has(downloadId) || this.arquivosSimuladosAusentes.has(downloadId)) {
      throw { codigo: "ARQUIVO_AUSENTE", mensagem: "unknown downloadId" } satisfies ErroClipora;
    }
  }

  private exigirHistoricoDisponivel(): void {
    if (this.falhaHistorico) {
      throw { codigo: this.falhaHistorico, mensagem: "simulated history failure" } satisfies ErroClipora;
    }
  }

  private persistirHistoricoPendente(): void {
    this.exigirHistoricoDisponivel();
    if (this.falhasPersistenciaHistoricoRestantes > 0 && this.historicoPendente.size > 0) {
      this.falhasPersistenciaHistoricoRestantes--;
      throw { codigo: "HISTORICO_INDISPONIVEL", mensagem: "simulated history write failure" } satisfies ErroClipora;
    }
    for (const [id, item] of this.historicoPendente) this.historico.set(id, item);
    this.historicoPendente.clear();
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

  async obter_licencas(): Promise<Licencas> {
    if (this.licencasIndisponiveis) {
      throw {
        codigo: "LICENCAS_INDISPONIVEIS",
        mensagem: "licencas/licencas.json not found in resource_dir",
      } satisfies ErroClipora;
    }
    return LICENCAS_SIMULADAS;
  }

  /** Links abertos (para testes); nenhum navegador é aberto de verdade. */
  readonly linksAbertos: Array<{ componenteId: string; tipo: TipoLinkLicenca }> = [];

  async abrir_link_licenca(args: { componenteId: string; tipo: TipoLinkLicenca }): Promise<void> {
    if (!LICENCAS_SIMULADAS.resumo.componentes.some((c) => c.id === args.componenteId)) {
      throw { codigo: "ERRO_INTERNO", mensagem: "unknown component" } satisfies ErroClipora;
    }
    this.linksAbertos.push(args);
  }

  /** Utilitário para testes: define a pasta de destino "persistida" diretamente. */
  definirPastaParaTeste(pasta: PastaDestino): void {
    this.pastaAtual = pasta;
  }
}

function chaveVideo(url: string): string {
  try {
    const parsed = new URL(url);
    const autoridade = url.split("://")[1]?.split(/[/?#]/)[0] ?? "";
    const partes = parsed.pathname.split("/").filter(Boolean);
    const host = parsed.hostname.toLowerCase();
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.port || autoridade.includes(":") || autoridade.includes("@")) throw new Error();
    if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(host)) {
      const id = idYoutube(url);
      if (!id) throw new Error();
      return `youtube:${id}`;
    }
    const plataforma = host.includes("tiktok") ? "tiktok" : "instagram";
    if (plataforma === "instagram") {
      if (!["instagram.com", "www.instagram.com", "m.instagram.com"].includes(host)) throw new Error();
      const perfil = partes.length === 3 && partes[1] === "reel";
      const post = partes.length === 2 && ["reel", "reels", "p"].includes(partes[0]);
      if (!perfil && !post) throw new Error();
      return "instagram:" + partes[partes.length - 1];
    } else {
      if (!["tiktok.com", "www.tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"].includes(host)) throw new Error();
      const hostCanonico = ["tiktok.com", "www.tiktok.com", "m.tiktok.com"].includes(host);
      if (hostCanonico && partes.length === 3 && partes[0].length > 1 && partes[0].startsWith("@") && partes[1] === "video" && /^\d+$/.test(partes[2])) {
        return "tiktok:" + partes[2];
      }
      if (hostCanonico && partes.length === 2 && partes[0] === "t") return "curto:tiktok.com/" + partes.join("/");
      if (["vm.tiktok.com", "vt.tiktok.com"].includes(host) && partes.length === 1) {
        return "curto:" + host + "/" + partes[0];
      }
      throw new Error();
    }
  } catch {
    throw { codigo: "LINK_INVALIDO", mensagem: "unsupported video URL" } satisfies ErroClipora;
  }
}

function plataformaDaUrl(url: string): Plataforma {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(host)) return "youtube";
    return host.includes("tiktok.com") ? "tiktok" : "instagram";
  } catch {
    return "instagram";
  }
}

function idYoutube(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    let id: string | null = null;
    if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host) && ["/watch", "/watch/"].includes(parsed.pathname)) {
      const valores = parsed.searchParams.getAll("v");
      if (valores.length === 1) id = valores[0];
    } else if (host === "youtu.be") {
      const partes = parsed.pathname.split("/").filter(Boolean);
      if (partes.length === 1) id = partes[0];
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function normalizarUrlYoutube(url: string): string {
  const id = idYoutube(url);
  if (!id) throw { codigo: "LINK_INVALIDO", mensagem: "unsupported YouTube URL" } satisfies ErroClipora;
  return `https://www.youtube.com/watch?v=${id}`;
}

function normalizarEsquema(url: string): string {
  return url.startsWith("http://") ? "https://" + url.slice("http://".length) : url;
}

/** Amostra no formato de src-tauri/binaries/licencas/licencas.json (formato 1). */
const LICENCAS_SIMULADAS: Licencas = {
  resumo: {
    formato: 1,
    app: { nome: "Clipora", versao: "0.1.0" },
    alvo: "simulado",
    componentes: [
      {
        id: "yt-dlp",
        nome: "yt-dlp",
        versao: "2024.08.06",
        licenca: "GPL-3.0-or-later (executável PyInstaller; código do yt-dlp: Unlicense)",
        papel: "Obtém o vídeo público a partir do link.",
        codigoFonte: "https://github.com/yt-dlp/yt-dlp/releases/download/2024.08.06/yt-dlp.tar.gz",
        projeto: "https://github.com/yt-dlp/yt-dlp",
      },
      {
        id: "ffmpeg",
        nome: "FFmpeg (ffmpeg e ffprobe)",
        versao: "8.1.3",
        licenca: "LGPL-2.1-or-later",
        papel: "Junta vídeo e áudio sem recodificar (remux).",
        codigoFonte: "https://ffmpeg.org/releases/ffmpeg-8.1.3.tar.xz",
        sha256Fonte: "7138d28c96d9d3e3af4ee3d8cad72741f8ffb40da90c1112235dea3ecd3178a3",
        projeto: "https://ffmpeg.org/",
      },
    ],
    crates: [
      { nome: "tauri", versao: "2.9.0", licenca: "Apache-2.0 OR MIT" },
      { nome: "serde", versao: "1.0.228", licenca: "MIT OR Apache-2.0" },
      { nome: "pgp", versao: "0.21.0", licenca: "MIT OR Apache-2.0" },
    ],
    npm: [
      { nome: "react", versao: "19.3.1", licenca: "MIT", projeto: "https://react.dev/" },
      { nome: "react-dom", versao: "19.3.1", licenca: "MIT", projeto: "https://react.dev/" },
    ],
    arquivoCompleto: "THIRD_PARTY_LICENSES.txt",
  },
  textoCompleto: [
    "Clipora 0.1.0 — avisos de licença de terceiros (simulado)",
    "",
    "<script>alert('isto deve aparecer como texto, nunca executar')</script>",
    "",
    "GNU GENERAL PUBLIC LICENSE",
    "Version 3, 29 June 2007",
    "",
    "GNU LESSER GENERAL PUBLIC LICENSE",
    "Version 2.1, February 1999",
  ].join("\n"),
};
