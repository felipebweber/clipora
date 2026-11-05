# Contrato IPC v2

Contrato para integração; salvo indicação contrária, comandos futuros ainda não estão implementados. Comandos usam snake_case, argumentos e campos camelCase (`#[serde(rename_all = "camelCase")]`). Erros rejeitam a chamada com `ErroClipora`. Uniões usam discriminante `tipo`. O frontend é dono das mensagens em português por código; `mensagem` é fallback e `detalhe` é técnico e não exibido por padrão.

## Tipos TypeScript

```ts
type CodigoErro = 'LINK_INVALIDO' | 'PLATAFORMA_NAO_SUPORTADA' | 'PREVIA_CANCELADA' | 'TEMPO_ESGOTADO' | 'SEM_CONEXAO' | 'LOGIN_NECESSARIO' | 'CONTEUDO_PRIVADO_OU_REMOVIDO' | 'LIMITE_DE_ACESSO' | 'CONTEUDO_NAO_SUPORTADO' | 'PREVIA_INDISPONIVEL' | 'PASTA_NAO_DEFINIDA' | 'PASTA_AUSENTE' | 'PASTA_SEM_PERMISSAO' | 'ESPACO_INSUFICIENTE' | 'FFMPEG_INDISPONIVEL' | 'ARQUIVO_INCOMPLETO' | 'DOWNLOAD_EM_ANDAMENTO' | 'DOWNLOAD_FALHOU' | 'ATUALIZACAO_EM_ANDAMENTO' | 'ATUALIZACAO_INTEGRIDADE' | 'ATUALIZACAO_NAO_SUPORTADA' | 'ATUALIZACAO_FALHOU' | 'YTDLP_INDISPONIVEL' | 'ERRO_INTERNO';
type ErroClipora = { codigo: CodigoErro; mensagem: string; detalhe?: string };
type Plataforma = 'instagram' | 'tiktok';
type Previa = { requisicaoId: number; urlOriginal: string; urlNormalizada: string; titulo: string | null; plataforma: Plataforma; duracaoSegundos: number | null; capaDataUrl: string | null };
type EtapaDownload = 'preparando' | 'baixando_video' | 'baixando_audio' | 'unindo' | 'finalizando';
type EventoDownload =
  | { tipo: 'progresso'; etapa: EtapaDownload; percentual: number | null; bytesBaixados?: number; bytesTotais?: number }
  | { tipo: 'concluido'; caminho: string; nomeArquivo: string; renomeado: boolean }
  | { tipo: 'erro'; erro: ErroClipora };
type EstadoDownload = { downloadId: string; percentual: number | null; etapa: EtapaDownload };
type Estado = { download: EstadoDownload | null; atualizacaoEmAndamento: boolean };
type PastaDestino = { caminho: string | null; estado: 'nao_definida' | 'valida' | 'ausente' | 'sem_permissao' };
type VerificacaoYtdlp = { versaoAtual: string; versaoDisponivel: string | null; atualizacaoDisponivel: boolean; origem: 'empacotada' | 'atualizada'; erroVerificacao: ErroClipora | null };
type EventoAtualizacao = { tipo: 'progresso'; etapa: string; percentual: number | null };
// Channel<T> é importado de @tauri-apps/api/core.
type Comandos = {
  obter_previa: (args: { url: string; requisicaoId: number }) => Promise<Previa>;
  iniciar_download: (args: { downloadId: string; url: string; onEvento: Channel<EventoDownload> }) => Promise<void>;
  obter_estado: () => Promise<Estado>;
  abrir_pasta_download: (args: { downloadId: string }) => Promise<void>;
  obter_pasta_destino: () => Promise<PastaDestino>;
  selecionar_pasta_destino: () => Promise<string | null>;
  verificar_ytdlp: () => Promise<VerificacaoYtdlp>;
  atualizar_ytdlp: (args: { versaoEsperada: string; onEvento: Channel<EventoAtualizacao> }) => Promise<{ versaoInstalada: string }>;
};
```

## Tipos Rust

As assinaturas abaixo são a forma lógica do contrato; `State` e `AppHandle` são injetados pelo Tauri. `Option` serializa como `null`, exceto campos opcionais de erro e bytes, omitidos quando ausentes. Os enums de texto usam `#[serde(rename_all = "snake_case")]`; erros usam `SCREAMING_SNAKE_CASE`.

```rust
use serde::Serialize;
use tauri::ipc::Channel;
#[derive(Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum CodigoErro { LinkInvalido, PlataformaNaoSuportada, PreviaCancelada, TempoEsgotado, SemConexao, LoginNecessario, ConteudoPrivadoOuRemovido, LimiteDeAcesso, ConteudoNaoSuportado, PreviaIndisponivel, PastaNaoDefinida, PastaAusente, PastaSemPermissao, EspacoInsuficiente, FfmpegIndisponivel, ArquivoIncompleto, DownloadEmAndamento, DownloadFalhou, AtualizacaoEmAndamento, AtualizacaoIntegridade, AtualizacaoNaoSuportada, AtualizacaoFalhou, YtdlpIndisponivel, ErroInterno }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ErroClipora { codigo: CodigoErro, mensagem: String, #[serde(skip_serializing_if = "Option::is_none")] detalhe: Option<String> }
#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
enum Plataforma { Instagram, Tiktok }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Previa { requisicao_id: u64, url_original: String, url_normalizada: String, titulo: Option<String>, plataforma: Plataforma, duracao_segundos: Option<f64>, capa_data_url: Option<String> }
#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
enum EtapaDownload { Preparando, BaixandoVideo, BaixandoAudio, Unindo, Finalizando }
#[derive(Serialize)]
#[serde(tag = "tipo", rename_all = "snake_case", rename_all_fields = "camelCase")]
enum EventoDownload {
  Progresso { etapa: EtapaDownload, percentual: Option<f64>, #[serde(skip_serializing_if = "Option::is_none")] bytes_baixados: Option<u64>, #[serde(skip_serializing_if = "Option::is_none")] bytes_totais: Option<u64> },
  Concluido { caminho: String, nome_arquivo: String, renomeado: bool },
  Erro { erro: ErroClipora },
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EstadoDownload { download_id: String, percentual: Option<f64>, etapa: EtapaDownload }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Estado { download: Option<EstadoDownload>, atualizacao_em_andamento: bool }
#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
enum EstadoPasta { NaoDefinida, Valida, Ausente, SemPermissao }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PastaDestino { caminho: Option<String>, estado: EstadoPasta }
#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
enum OrigemYtdlp { Empacotada, Atualizada }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VerificacaoYtdlp { versao_atual: String, versao_disponivel: Option<String>, atualizacao_disponivel: bool, origem: OrigemYtdlp, erro_verificacao: Option<ErroClipora> }
#[derive(Serialize)]
#[serde(tag = "tipo", rename_all = "snake_case")]
enum EventoAtualizacao { Progresso { etapa: String, percentual: Option<f64> } }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ResultadoAtualizacao { versao_instalada: String }
// Assinaturas lógicas:
async fn obter_previa(url: String, requisicao_id: u64) -> Result<Previa, ErroClipora>;
async fn iniciar_download(download_id: String, url: String, on_evento: Channel<EventoDownload>) -> Result<(), ErroClipora>;
fn obter_estado() -> Result<Estado, ErroClipora>;
async fn abrir_pasta_download(download_id: String) -> Result<(), ErroClipora>;
fn obter_pasta_destino() -> Result<PastaDestino, ErroClipora>;
async fn selecionar_pasta_destino() -> Result<Option<String>, ErroClipora>;
async fn verificar_ytdlp() -> Result<VerificacaoYtdlp, ErroClipora>;
async fn atualizar_ytdlp(versao_esperada: String, on_evento: Channel<EventoAtualizacao>) -> Result<ResultadoAtualizacao, ErroClipora>;
```

## Prévia e política de URL

O frontend gera `requisicaoId` e ignora `PREVIA_CANCELADA`. A última chamada recebida vence, mesmo que o contador reinicie; nova prévia cancela e mata a árvore do processo anterior; prazo de 30 s retorna `TEMPO_ESGOTADO`. O backend ecoa a URL original, sua forma normalizada e o ID. Aceita HTTP(S), sem credenciais ou porta; HTTP é normalizado para HTTPS: `instagram.com` e `www.`/`m.` em `/reel/`, `/reels/`, `/p/` e `/<usuario>/reel/<id>/`; `tiktok.com/@u/video/id` (também `www.` e `m.`), `vm.tiktok.com`, `vt.tiktok.com` e `tiktok.com/t/`. Post `/p/` aceita apenas um vídeo; foto ou carrossel com vários itens retorna `CONTEUDO_NAO_SUPORTADO`. A validação Rust é autoritativa; frontend apenas pré-filtra. A miniatura é baixada no Rust com limite de tamanho e Content-Type `image/*`, retornada como data URL ou `null`; CSP não autoriza imagens HTTPS diretamente.

## Primeiro download

1. Frontend solicita `iniciar_download` com ID próprio e canal. Caso receba `PASTA_NAO_DEFINIDA`, `PASTA_AUSENTE` ou `PASTA_SEM_PERMISSAO`, chama `selecionar_pasta_destino`.
2. Diálogo nativo aberto pelo Rust valida diretório e escrita real e persiste em `app_config_dir`. Cancelamento retorna `null` e mantém a pasta anterior; nesse caso não repetir o download. Se selecionada, repetir com o mesmo ID e canal.
3. Eventos são ordenados no canal, com percentual global calculado no backend e limitado a aproximadamente 10/s. O evento terminal é `concluido` ou `erro`; conclusão exige saída zero, arquivo final existente e não vazio, sem `.part`. Saída zero sem arquivo válido (inexistente, vazio, `.part`, mensagem `already downloaded` ou caminho fora da pasta) retorna `ARQUIVO_INCOMPLETO`. Após recarga, `obter_estado` recupera o download ativo e estado da atualização.
4. Backend sanitiza nomes para Windows, remove espaços finais e trata nomes reservados. Usa `Título [id].mp4`, depois `Título [id] (2).mp4` etc.; baixa em pasta temporária no mesmo volume e finaliza com reserva exclusiva sem sobrescrever. `renomeado` indica colisão. `abrir_pasta_download` revela exclusivamente arquivo produzido pelo backend, identificado por ID, sem aceitar caminho do frontend.

## Atualização

`verificar_ytdlp` é chamado uma vez por abertura; uma falha de consulta pode ser retornada em `erroVerificacao`. `atualizar_ytdlp` é iniciado explicitamente pelo usuário, sem `yt-dlp -U`: baixa release oficial em `app_local_data_dir()/bin`, verifica assinatura GPG do SHA2-256SUMS com chave fixada e SHA-256, executa `--version`, troca atomicamente e preserva/restaura a versão anterior em caso de falha. Prévia e download rejeitam durante atualização com `ATUALIZACAO_EM_ANDAMENTO`; atualizar durante download rejeita com `DOWNLOAD_EM_ANDAMENTO`. O canal informa progresso e o retorno ou rejeição informa resultado terminal.

Mapear erros específicos antes dos genéricos; quando o extrator falhar, sugerir atualização do yt-dlp. A lista completa de códigos é `CodigoErro` acima.
