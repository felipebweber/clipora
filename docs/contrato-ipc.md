# Contrato IPC v2

Contrato para integração; salvo indicação contrária, comandos futuros ainda não estão implementados. Comandos usam snake_case, argumentos e campos camelCase (`#[serde(rename_all = "camelCase")]`). Erros rejeitam a chamada com `ErroClipora`. Uniões usam discriminante `tipo`. O frontend é dono das mensagens em português por código; `mensagem` é fallback e `detalhe` é técnico e não exibido por padrão.

## Tipos TypeScript

```ts
type CodigoErro = 'LINK_INVALIDO' | 'PLATAFORMA_NAO_SUPORTADA' | 'PREVIA_CANCELADA' | 'TEMPO_ESGOTADO' | 'SEM_CONEXAO' | 'LOGIN_NECESSARIO' | 'CONTEUDO_PRIVADO_OU_REMOVIDO' | 'LIMITE_DE_ACESSO' | 'CONTEUDO_NAO_SUPORTADO' | 'PREVIA_INDISPONIVEL' | 'PASTA_NAO_DEFINIDA' | 'PASTA_AUSENTE' | 'PASTA_SEM_PERMISSAO' | 'ESPACO_INSUFICIENTE' | 'FFMPEG_INDISPONIVEL' | 'ARQUIVO_INCOMPLETO' | 'DOWNLOAD_EM_ANDAMENTO' | 'DOWNLOAD_FALHOU' | 'ATUALIZACAO_EM_ANDAMENTO' | 'ATUALIZACAO_INTEGRIDADE' | 'ATUALIZACAO_NAO_SUPORTADA' | 'ATUALIZACAO_FALHOU' | 'YTDLP_INDISPONIVEL' | 'LICENCAS_INDISPONIVEIS' | 'HISTORICO_INDISPONIVEL' | 'ARQUIVO_AUSENTE' | 'QUALIDADE_INDISPONIVEL' | 'MOTOR_YOUTUBE_INDISPONIVEL' | 'ERRO_INTERNO';
type ErroClipora = { codigo: CodigoErro; mensagem: string; detalhe?: string };
type Plataforma = 'instagram' | 'tiktok' | 'youtube';
type Previa = { requisicaoId: number; urlOriginal: string; urlNormalizada: string; titulo: string | null; plataforma: Plataforma; duracaoSegundos: number | null; capaDataUrl: string | null; qualidadesYoutube: number[] | null; qualidadesYoutubeCompativeis?: number[] | null };
type ItemHistorico = { downloadId: string; urlOriginal: string; urlNormalizada: string; titulo: string | null; plataforma: Plataforma; caminho: string; nomeArquivo: string; concluidoEm: number; disponivel: boolean };
type EtapaDownload = 'preparando' | 'baixando_video' | 'baixando_audio' | 'unindo' | 'finalizando';
type EventoDownload =
  | { tipo: 'progresso'; etapa: EtapaDownload; percentual: number | null; bytesBaixados?: number; bytesTotais?: number }
  | { tipo: 'concluido'; caminho: string; nomeArquivo: string; renomeado: boolean }
  | { tipo: 'erro'; erro: ErroClipora }
  | { tipo: 'cancelado' };
type EstadoDownload = { downloadId: string; alturaYoutube: number | null; percentual: number | null; etapa: EtapaDownload; previa: Previa | null; cancelando: boolean };
type ResultadoTerminal =
  | { downloadId: string; alturaYoutube: number | null; tipo: 'concluido'; caminho: string; nomeArquivo: string; renomeado: boolean }
  | { downloadId: string; alturaYoutube: number | null; tipo: 'erro'; erro: ErroClipora }
  | { downloadId: string; alturaYoutube: number | null; tipo: 'cancelado' };
type Estado = { download: EstadoDownload | null; atualizacaoEmAndamento: boolean; ultimoResultado: ResultadoTerminal | null };
type PastaDestino = { caminho: string | null; estado: 'nao_definida' | 'valida' | 'ausente' | 'sem_permissao' };
type VerificacaoYtdlp = { versaoAtual: string; versaoDisponivel: string | null; atualizacaoDisponivel: boolean; origem: 'empacotada' | 'atualizada'; erroVerificacao: ErroClipora | null };
type ResumoLicencas = { formato: number; app: { nome: string; versao: string }; alvo: string; componentes: Array<{ id: string; nome: string; versao: string; licenca: string; papel: string; codigoFonte: string; projeto: string; binario?: string; sha256Fonte?: string }>; crates: Array<{ nome: string; versao: string; licenca: string }>; npm: Array<{ nome: string; versao: string; licenca: string; projeto?: string }>; arquivoCompleto: string };
type Licencas = { resumo: ResumoLicencas; textoCompleto: string };
type EventoAtualizacao = { tipo: 'progresso'; etapa: string; percentual: number | null };
// Channel<T> é importado de @tauri-apps/api/core.
type Comandos = {
  obter_previa: (args: { url: string; requisicaoId: number }) => Promise<Previa>;
  iniciar_download: (args: { downloadId: string; url: string; alturaYoutube?: number | null; onEvento: Channel<EventoDownload> }) => Promise<void>;
  cancelar_download: (args: { downloadId: string }) => Promise<void>;
  obter_estado: () => Promise<Estado>;
  abrir_pasta_download: (args: { downloadId: string }) => Promise<void>;
  abrir_arquivo_download: (args: { downloadId: string }) => Promise<void>;
  obter_historico: () => Promise<ItemHistorico[]>;
  consultar_historico: (args: { url: string }) => Promise<ItemHistorico | null>;
  limpar_historico: () => Promise<void>;
  obter_pasta_destino: () => Promise<PastaDestino>;
  selecionar_pasta_destino: () => Promise<string | null>;
  verificar_ytdlp: () => Promise<VerificacaoYtdlp>;
  atualizar_ytdlp: (args: { versaoEsperada: string; onEvento: Channel<EventoAtualizacao> }) => Promise<{ versaoInstalada: string }>;
  obter_licencas: () => Promise<Licencas>;
  abrir_link_licenca: (args: { componenteId: string; tipo: 'codigoFonte' | 'projeto' | 'codigoFonteAtualizada' }) => Promise<void>;
};
```

## Tipos Rust

As assinaturas abaixo são a forma lógica do contrato; `State` e `AppHandle` são injetados pelo Tauri. `Option` serializa como `null`, exceto campos opcionais de erro e bytes, omitidos quando ausentes. Os enums de texto usam `#[serde(rename_all = "snake_case")]`; erros usam `SCREAMING_SNAKE_CASE`.

```rust
use serde::Serialize;
use tauri::ipc::Channel;
#[derive(Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum CodigoErro { LinkInvalido, PlataformaNaoSuportada, PreviaCancelada, TempoEsgotado, SemConexao, LoginNecessario, ConteudoPrivadoOuRemovido, LimiteDeAcesso, ConteudoNaoSuportado, PreviaIndisponivel, PastaNaoDefinida, PastaAusente, PastaSemPermissao, EspacoInsuficiente, FfmpegIndisponivel, ArquivoIncompleto, DownloadEmAndamento, DownloadFalhou, AtualizacaoEmAndamento, AtualizacaoIntegridade, AtualizacaoNaoSuportada, AtualizacaoFalhou, YtdlpIndisponivel, LicencasIndisponiveis, HistoricoIndisponivel, ArquivoAusente, QualidadeIndisponivel, MotorYoutubeIndisponivel, ErroInterno }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ErroClipora { codigo: CodigoErro, mensagem: String, #[serde(skip_serializing_if = "Option::is_none")] detalhe: Option<String> }
#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
enum Plataforma { Instagram, Tiktok, Youtube }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Previa { requisicao_id: u64, url_original: String, url_normalizada: String, titulo: Option<String>, plataforma: Plataforma, duracao_segundos: Option<f64>, capa_data_url: Option<String>, qualidades_youtube: Option<Vec<u32>> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ItemHistorico { download_id: String, url_original: String, url_normalizada: String, titulo: Option<String>, plataforma: Plataforma, caminho: String, nome_arquivo: String, concluido_em: u64, disponivel: bool }
#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
enum EtapaDownload { Preparando, BaixandoVideo, BaixandoAudio, Unindo, Finalizando }
#[derive(Serialize)]
#[serde(tag = "tipo", rename_all = "snake_case", rename_all_fields = "camelCase")]
enum EventoDownload {
  Progresso { etapa: EtapaDownload, percentual: Option<f64>, #[serde(skip_serializing_if = "Option::is_none")] bytes_baixados: Option<u64>, #[serde(skip_serializing_if = "Option::is_none")] bytes_totais: Option<u64> },
  Concluido { caminho: String, nome_arquivo: String, renomeado: bool },
  Erro { erro: ErroClipora },
  Cancelado,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EstadoDownload { download_id: String, altura_youtube: Option<u32>, percentual: Option<f64>, etapa: EtapaDownload, previa: Option<Previa>, cancelando: bool }
#[derive(Serialize)]
#[serde(tag = "tipo", rename_all = "snake_case", rename_all_fields = "camelCase")]
enum ResultadoTerminal { Concluido { download_id: String, altura_youtube: Option<u32>, caminho: String, nome_arquivo: String, renomeado: bool }, Erro { download_id: String, altura_youtube: Option<u32>, erro: ErroClipora }, Cancelado { download_id: String, altura_youtube: Option<u32> } }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Estado { download: Option<EstadoDownload>, atualizacao_em_andamento: bool, ultimo_resultado: Option<ResultadoTerminal> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Licencas { resumo: serde_json::Value, texto_completo: String }
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
async fn iniciar_download(download_id: String, url: String, altura_youtube: Option<u32>, on_evento: Channel<EventoDownload>) -> Result<(), ErroClipora>;
fn cancelar_download(download_id: String) -> Result<(), ErroClipora>;
fn obter_estado() -> Result<Estado, ErroClipora>;
async fn abrir_pasta_download(download_id: String) -> Result<(), ErroClipora>;
async fn abrir_arquivo_download(download_id: String) -> Result<(), ErroClipora>;
fn obter_historico() -> Result<Vec<ItemHistorico>, ErroClipora>;
fn consultar_historico(url: String) -> Result<Option<ItemHistorico>, ErroClipora>;
fn limpar_historico() -> Result<(), ErroClipora>;
fn obter_pasta_destino() -> Result<PastaDestino, ErroClipora>;
async fn selecionar_pasta_destino() -> Result<Option<String>, ErroClipora>;
async fn verificar_ytdlp() -> Result<VerificacaoYtdlp, ErroClipora>;
async fn atualizar_ytdlp(versao_esperada: String, on_evento: Channel<EventoAtualizacao>) -> Result<ResultadoAtualizacao, ErroClipora>;
fn obter_licencas() -> Result<Licencas, ErroClipora>;
async fn abrir_link_licenca(componente_id: String, tipo: String) -> Result<(), ErroClipora>; // codigoFonte | projeto | codigoFonteAtualizada
```

`obter_estado` inclui a prévia associada ao download ativo (`null` quando não foi carregada ou pertence a outra URL), `atualizacaoEmAndamento` e `ultimoResultado`. O resultado terminal fica disponível após recarga e é mantido até o próximo download aceito. `obter_licencas` lê somente `licencas/licencas.json` e `licencas/THIRD_PARTY_LICENSES.txt` dos recursos do app, retornando `{ resumo, textoCompleto }`; arquivo ausente ou JSON inválido rejeita com `LICENCAS_INDISPONIVEIS` (inclusive em desenvolvimento sem geração dos avisos). `abrir_link_licenca` aceita apenas IDs de componentes presentes no resumo empacotado e os tipos `codigoFonte`/`projeto`, abrindo URL HTTPS no navegador padrão. O tipo `codigoFonteAtualizada` exige `componenteId: "yt-dlp"`, resolve o binário atualmente validado, lê a versão local e deriva `https://github.com/yt-dlp/yt-dlp/releases/download/{versao}/yt-dlp.tar.gz`; nenhum campo recebe URL arbitrária.

## Prévia e política de URL

O frontend gera `requisicaoId` e ignora `PREVIA_CANCELADA`. A última chamada recebida vence, mesmo que o contador reinicie; nova prévia cancela e mata a árvore do processo anterior; prazo de 30 s retorna `TEMPO_ESGOTADO`. O backend ecoa a URL original, sua forma normalizada e o ID. Aceita HTTP(S), sem credenciais ou porta; HTTP é normalizado para HTTPS: `instagram.com` e `www.`/`m.` em `/reel/`, `/reels/`, `/p/` e `/<usuario>/reel/<id>/`; `tiktok.com/@u/video/id` (também `www.` e `m.`), `vm.tiktok.com`, `vt.tiktok.com` e `tiktok.com/t/`. Post `/p/` aceita apenas um vídeo; foto ou carrossel com vários itens retorna `CONTEUDO_NAO_SUPORTADO`. A validação Rust é autoritativa; frontend apenas pré-filtra. A miniatura é baixada no Rust com limite de tamanho e Content-Type `image/*`, retornada como data URL ou `null`; CSP não autoriza imagens HTTPS diretamente.

## Primeiro download

1. Frontend solicita `iniciar_download` com ID próprio, canal novo e ouvinte lógico do download. Caso receba `PASTA_NAO_DEFINIDA`, `PASTA_AUSENTE` ou `PASTA_SEM_PERMISSAO`, chama `selecionar_pasta_destino`.
2. Diálogo nativo aberto pelo Rust valida diretório e escrita real e persiste em `app_config_dir`. Cancelamento retorna `null` e mantém a pasta anterior; nesse caso não repetir o download. Se selecionada, repetir com o mesmo ID e ouvinte lógico, criando um **novo `Channel<EventoDownload>` para cada chamada IPC/tentativa**. O Channel da chamada rejeitada foi descartado pelo Rust e não pode ser reutilizado; o frontend reanexa o ouvinte lógico ao novo canal.
3. Eventos são ordenados no canal, com percentual da transferência calculado no backend pelos bytes somados dos formatos selecionados e limitado a aproximadamente 10/s. Os tamanhos vêm de `filesize` e `total_bytes` exatos do yt-dlp, sem pesos fixos por etapa nem estimativas por bitrate. Se faltar um total confiável, `percentual` é `null`. Retomadas do mesmo formato não somam os bytes duas vezes. `100%` indica transferência dos arquivos, não conclusão da operação: `unindo` e `finalizando` têm `percentual: null` e ficam indeterminados até a validação e finalização. O evento terminal é `concluido`, `erro` ou `cancelado`; conclusão exige saída zero, arquivo final existente e não vazio, sem `.part`. Saída zero sem arquivo válido (inexistente, vazio, `.part`, mensagem `already downloaded` ou caminho fora da pasta) retorna `ARQUIVO_INCOMPLETO`. Após recarga, `obter_estado` recupera o download ativo e estado da atualização.

4. Backend forma `@perfil - descrição [id].mp4`, usando até oito palavras da descrição; na ausência dela, usa título significativo. Títulos genéricos como `Video by …` são omitidos. Sem rótulo, usa `@perfil [id].mp4`; sem perfil, usa o rótulo ou `Vídeo [id].mp4`. No Instagram, prefere `channel`, depois `uploader_id` textual e `uploader`; no TikTok, `uploader`, depois `channel` e `uploader_id`. Um perfil legível precede IDs numéricos. Normaliza um `@`, espaços, controles e caracteres incompatíveis, preserva Unicode e limita o nome completo a 255 bytes, reservando extensão e o maior sufixo de colisão. O ID entre colchetes evita nomes de dispositivo reservados no Windows. Usa ` (2)`, ` (3)` etc. em caso de colisão; baixa em pasta temporária no mesmo volume e finaliza com reserva exclusiva sem sobrescrever. `renomeado` indica colisão. `abrir_pasta_download` revela exclusivamente arquivo produzido pelo backend, identificado por ID, sem aceitar caminho do frontend.

### Cancelamento de download

`cancelar_download({ downloadId })` é idempotente e só sinaliza a tentativa ativa com o mesmo ID. ID antigo, desconhecido, já encerrado ou diferente do ativo é no-op; falhas reais ao adquirir o controle rejeitam com `ERRO_INTERNO`. O frontend deve aguardar a resposta de `iniciar_download` antes de enviar o cancelamento dessa tentativa. Enquanto a limpeza de processos e temporários não termina, `obter_estado.download` permanece ativo com `cancelando: true`, bloqueando nova tentativa. Consumidores antigos tratam `cancelando` ausente como `false`.

Cancelamento aceito termina o grupo de processos/descendentes, descarta somente temporários próprios e publica um único `{ tipo: 'cancelado' }` e `ultimoResultado: { tipo: 'cancelado', downloadId, alturaYoutube }`; não grava histórico nem cria arquivo final. Pedidos repetidos ou IDs antigos não geram terminais adicionais nem atingem outra tentativa. A promoção usa gate compartilhado com o pedido: se cancelamento vencer, não promove; se promoção vencer primeiro, o resultado normal da finalização (`concluido` ou `erro`) prevalece. `encerrar()` permanece reservado ao encerramento do aplicativo e não é a API reutilizável de cancelamento.

## Evolução YouTube e qualidade — contrato final acordado

Este bloco e os tipos acima definem a evolução aprovada em `docs/superpowers/specs/2026-11-06-youtube-qualidade-design.md`. O backend implementa catálogo/URLs, prévia e execução validada com os campos de tentativa; a UI habilita download YouTube somente com catálogo válido e mantém legado sem catálogo bloqueado. Antes de ativar uma nova versão do yt-dlp, o updater também comprova localmente compatibilidade com o Deno/EJS, conforme a seção abaixo.

- `qualidadesYoutube`: alturas reais inteiras positivas elegíveis, únicas e decrescentes, sem teto artificial; `null` fora do YouTube. Prévia YouTube sem catálogo válido não habilita download; campo ausente de backend antigo é tratado como `null`.
- `qualidadesYoutubeCompativeis`: subconjunto de `qualidadesYoutube` com vídeo H.264, que abre no QuickTime e no player padrão do Windows. As demais alturas (no YouTube, acima de 1080p só existe VP9/AV1) aparecem com o aviso "pode exigir VLC". `null` fora do YouTube; ausente em backend antigo, quando nenhuma altura é marcada. "Melhor compatível" (`alturaYoutube: null`) escolhe o melhor H.264 e só usa VP9/AV1 se não houver H.264.
- `alturaYoutube?: number | null` em `iniciar_download`: ausência/null é **Melhor compatível** (maior altura em H.264; VP9/AV1 só sem H.264); inteiro positivo até `u32::MAX` exige altura exata. Zero, negativo, fracionário e fora de u32 são recusados; altura não nula fora do YouTube é recusada. O frontend não envia IDs de formato, filtros `-f`, argumentos ou URLs de mídia.
- `alturaYoutube: number | null` no estado ativo e **nos dois ramos** de `ResultadoTerminal` é a escolha capturada para a tentativa (`null` no automático), inclusive em erro, retentativa de pasta e recuperação sem prévia. Não altera `EventoDownload`. Instagram/TikTok mantêm automático. Histórico mantém o schema atual, sem campo de qualidade, e usa chave `youtube:<id>` independentemente da resolução.
- Links: `youtube.com`/`www.`/`m.` somente `/watch` ou `/watch/` com exatamente um `v`; `youtu.be` somente um segmento de ID. ID ASCII `[A-Za-z0-9_-]{11}`. Rejeitar credenciais, portas explícitas, hosts falsos, `/shorts/`, `/live/`, embeds, canais e playlists sem vídeo. HTTP vira HTTPS antes da rede; normalizar todos os aliases para `https://www.youtube.com/watch?v=<id>`, ignorando horário/playlist/rastreamento/fragmentos sem cortar nem enfileirar o vídeo.
- Catálogo exige item único, ID coerente, `media_type=video`, `live_status=not_live`, duração finita positiva e combinações não DRM com vídeo H.264/AVC, VP9 ou AV1 e áudio AAC/MP4A combinado ou separado. Shorts por aliases, lives/estreias/classificação ausente são `CONTEUDO_NAO_SUPORTADO`; não inferir por duração/proporção. Seleção interna por altura, FPS, AVC > VP9 > AV1, depois preferência do yt-dlp; áudio AAC pela preferência do yt-dlp. Sem fallback de resolução, upscale ou transcodificação.
- `QUALIDADE_INDISPONIVEL`: **Essa qualidade não está mais disponível. Atualize a prévia e escolha outra.** A UI oferece atualizar prévia, sem repetir silenciosamente em outra resolução.
- `MOTOR_YOUTUBE_INDISPONIVEL`: **O componente necessário para baixar do YouTube está indisponível ou é incompatível. Reinstale ou atualize o Clipora.** Não tratar como falha de rede. Deno empacotado só é exigido no conteúdo do YouTube, sem afetar Instagram/TikTok.

### Execução nativa da tarefa 3

Deno 2.7.0 é recurso dedicado em `resource_dir()/deno/clipora-deno[.exe]`, com `clipora-deno.json` ao lado; não é `externalBin` nem é pesquisado no PATH. Em debug, pode vir de `CLIPORA_BIN_DIR/deno/` para fixtures ou `src-tauri/binaries/deno/` no desenvolvimento. Release ignora `CLIPORA_BIN_DIR` e não usa fallback de desenvolvimento. A verificação exige arquivo regular executável, manifesto formato 1/versão fixada/triple compatível e SHA-256 dos bytes, seguido de `--version` com limite de 10 s. Manifesto `universal-apple-darwin` é aceito somente nos slices macOS correspondentes, com as duas origens/hashes ZIP. O hash é o do executável distribuído após assinatura, conforme o manifesto de distribuição.

Motor só é resolvido/verificado na prévia/download YouTube. Esses processos recebem `--ignore-config --no-update --no-playlist --no-plugin-dirs --no-cache-dir --no-cookies --no-cookies-from-browser --no-remote-components --no-js-runtimes --js-runtimes deno:<absoluto>`, argumentos separados e URL validada/canônica após `--`. Instagram/TikTok mantêm seus argumentos anteriores e não dependem de Deno. O prazo total de prévia continua 30 s, incluindo a verificação do motor, extração e capa; nova prévia/cancelamento encerra o grupo do processo. JSON de metadados e stderr são limitados a 8 MiB cada.

O download captura a altura antes da tarefa e reobtém metadados na etapa preparando, revalida tipo/ID/catálogo e monta o seletor interno exato. Qualidade desaparecida não inicia transferência nem usa fallback. O grupo da extração também é encerrado quando a tarefa é abortada. A escolha efetiva automática é usada na conferência do arquivo, preservando `alturaYoutube: null` no estado/resultado; a resolução escolhida explicitamente permanece nos dois ramos terminais mesmo sem prévia.

Antes de finalizar ou registrar no histórico, exige arquivo MP4 regular não vazio dentro do temporário próprio, ID final coerente e ausência de `.part`. FFprobe empacotado é executado por caminho resolvido, timeout 15 s, JSON/stderr até 1 MiB cada; exige contêiner MP4, exatamente um stream de vídeo H.264/VP9/AV1, dimensões positivas, altura exata da escolha efetiva e ao menos um áudio AAC. Inconsistência retorna `ARQUIVO_INCOMPLETO`, sem finalização/histórico; somente temporários desta tentativa são removidos. Abertura por ID e política de colisões permanecem vigentes.

### Atualização segura do yt-dlp (T5)

`atualizar_ytdlp` resolve o Deno empacotado apenas quando o usuário inicia a atualização. Depois de verificar assinatura/hash da release, extrair em staging e confirmar `--version`, `conferir_candidato(yt_dlp, deno)` executa as provas locais antes de `ativar` ou trocar `atual`/`anterior`. Deno ausente/inválido, solver ausente ou não coberto pelo manifesto, ABI incompatível, diagnóstico ambíguo, saída excedida ou timeout retornam `ATUALIZACAO_NAO_SUPORTADA`; falhas de integridade continuam `ATUALIZACAO_INTEGRIDADE`. A recusa limpa somente staging. O resolvedor/cache do yt-dlp só é consultado depois de sucesso, então candidato recusado não substitui a versão antiga em memória nem após reinício.

O smoke do solver requer os arquivos regulares `_internal/yt_dlp_ejs/yt/solver/{lib.min.js,core.min.js}` no layout esperado, ambos cobertos pelo manifesto e com SHA-256 conferido. Em até 20 s no total, envia lib+core+um harness fixo por stdin ao Deno `run --ext=js --no-code-cache --no-prompt --no-remote --no-lock --node-modules-dir=none --no-config --no-npm --cached-only -`. Deno recebe somente o programa pelo stdin e não ganha permissões de rede, filesystem ou ambiente. O teste exige respostas solver `n(abc)=cba` e `sig(abc)=ok:abc`, sem respostas de erro, e parse/generate `const a = 1;` via `lib.meriyah.parse`/`lib.astring.generate`.

Em seguida, o candidato roda `--verbose --simulate --load-info-json <fixture local> --skip-download`, com as flags de isolamento YouTube e Deno absoluto. A fixture usa `https://example.invalid/` e não baixa página nem mídia. A saída precisa provar runtime `deno-2.7.0` (aceitando build metadata SemVer, por exemplo `+fb4db33`) e EJS `yt_dlp_ejs`; aviso de incompatibilidade relevante, log sem essas provas, stdout/stderr acima de 1 MiB ou timeout recusam. Cada processo é executado sem shell, com grupo encerrado no abandono. O executável Deno continua verificado pelo manifesto/hash e `--version`; o yt-dlp candidato tem assinatura/hash oficial do ZIP verificados antes do staging. Os hashes locais do manifesto exigidos pelo smoke são os dos scripts EJS usados; não se compara novamente o hash do executável instalado, que pode ter assinatura de código posterior.

O teste Rust manual, ignorado por padrão e sem rede/mídia, pode ser executado no checkout com `cargo test --manifest-path src-tauri/Cargo.toml motor_youtube::tests::conferir_candidato_real_offline -- --ignored --nocapture`. Ele usa o candidato yt-dlp e Deno já empacotados e cobre o caminho real do helper. Esse smoke prova ABI/parser e diagnóstico local, não garante algoritmos futuros do YouTube nem substitui download real. A recusa contextual é: **Não foi possível confirmar a compatibilidade desta atualização com o Clipora. A versão atual do yt-dlp continua em uso. Atualize ou reinstale o Clipora para tentar novamente.**

## Histórico local e abertura por ID (implementados)

`obter_historico` retorna somente downloads concluídos nesta evolução, ordenados por `concluidoEm` decrescente (Unix em milissegundos). `disponivel` é recalculado a cada consulta e não garante abertura futura. `titulo` pode ser `null` sem prévia. O arquivo local é `app_local_data_dir()/historico.json`, formato `{ versao: 1, itens: ItemHistorico[] }`; a disponibilidade armazenada nunca é confiada. Não há capas, servidor, importação de vídeos antigos ou varredura do disco.

Registro, leitura do JSON e limpeza compartilham mutex. Stats/leitura de cada vídeo e cálculo de disponibilidade ocorrem fora do mutex, sobre um snapshot; uma consulta em volume lento não impede registro/limpeza. Gravação usa temporário exclusivo no mesmo diretório, flush/sync e substituição atômica. JSON corrompido, versão desconhecida ou registros inválidos retornam `HISTORICO_INDISPONIVEL` e não são sobrescritos por registrar/limpar. O usuário pode reparar/restaurar o arquivo local e tentar novamente. Falha ao gravar mantém registros pendentes em memória para retentativa por `obter_historico` ou `consultar_historico`; consultas continuam rejeitando até a persistência funcionar. Esses pendentes não sobrevivem ao encerramento do aplicativo.

Falha no histórico preserva o evento e `ultimoResultado` de conclusão. A UI recarrega o histórico após concluir, inclusive em recuperação de estado, e comunica o erro separadamente. O mapa de arquivos em memória permite abrir a conclusão mesmo com histórico corrompido. `limpar_historico` remove apenas registros e pendentes anteriores à limpeza, sem apagar vídeos nem invalidar a conclusão em memória; confirmação é responsabilidade da interface.

`consultar_historico` valida a URL e compara ID do Instagram entre `/p/`, `/reel/`, `/reels/` e `/<usuario>/reel/`, ignorando HTTP, aliases www/m, rastreamento e fragmentos. TikTok canônico compara o ID numérico, independentemente do usuário. Links curtos comparam host/endereço salvo sem rastreamento; www/m de `tiktok.com/t/` são aliases. `vm` e `vt` e tokens curtos diferentes não são presumidos equivalentes. Consulta compara URL original e normalizada; se uma URL resolvida estiver disponível nesta última, também participa. A prévia atual **não resolve links curtos**: um download por link curto ainda não corresponde ao link canônico ou a outro token curto apenas por representar o mesmo vídeo. Retorna a cópia disponível mais recente, ou a mais recente indisponível quando todas faltarem, ou `null`. Não bloqueia novos downloads. A UI deve descartar respostas obsoletas após troca de URL ou limpeza.

Abertura aceita exclusivamente `downloadId` opaco (1–128 caracteres ASCII alfanuméricos, `_` ou `-`), nunca caminhos do frontend. IDs persistidos, plataforma, URLs, caminho absoluto e nome/extensão coerentes são validados. Na conclusão, somente o diretório pai é canonicalizado e esse caminho é usado no histórico e no mapa em memória: aliases legítimos como `/tmp` e `/var` funcionam sem seguir symlink no arquivo final. Abrir vídeo/revelar exige arquivo regular `.mp4` com cabeçalho de contêiner `ftyp`, acessível e sem componentes symlink. A validação é repetida imediatamente antes de delegar ao aplicativo padrão, sem shell. ID desconhecido ou vídeo indisponível retorna `ARQUIVO_AUSENTE`. Se o vídeo foi removido e o diretório original ainda existe e é válido, `abrir_pasta_download` preserva o fallback de revelar essa pasta no gerenciador de arquivos (nunca `open_path` em diretório persistido, inclusive `.app`); se também faltar, retorna `PASTA_AUSENTE`. Não procura arquivos movidos e não abre symlinks substituídos. “Produzido pelo Clipora” significa o caminho que o próprio processo gravou e que ainda passa nessa checagem. Não há assinatura do arquivo nem verificação completa/criptográfica do conteúdo de vídeo; o cabeçalho é uma checagem de formato, não atestado de origem ou integridade. O JSON é dado local não autenticado: registros manipulados são validados por essas regras, sem garantia contra um processo local capaz de substituir dados/arquivos e satisfazer as mesmas regras.

## Atualização

`verificar_ytdlp` é chamado uma vez por abertura; uma falha de consulta pode ser retornada em `erroVerificacao`. `atualizar_ytdlp` é iniciado explicitamente pelo usuário, sem `yt-dlp -U`: baixa release oficial em `app_local_data_dir()/bin`, verifica assinatura GPG do SHA2-256SUMS com chave fixada e SHA-256, executa `--version`, troca atomicamente e preserva/restaura a versão anterior em caso de falha. Prévia e download rejeitam durante atualização com `ATUALIZACAO_EM_ANDAMENTO`; atualizar durante download rejeita com `DOWNLOAD_EM_ANDAMENTO`. O canal informa progresso e o retorno ou rejeição informa resultado terminal.

O artefato `_update_spec` da distribuição do yt-dlp não faz parte da implementação atual: o Clipora não o lê nem executa. Integridade e proveniência são verificadas a partir de `SHA2-256SUMS` e sua assinatura destacada.

Mapear erros específicos antes dos genéricos; quando o extrator falhar, sugerir atualização do yt-dlp. A lista completa de códigos é `CodigoErro` acima.
