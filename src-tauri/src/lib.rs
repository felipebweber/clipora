mod binarios;
mod download;
mod links;
mod pasta;
mod previa;
mod processos;

use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

fn config_pasta(app: &tauri::AppHandle) -> Result<pasta::ConfigPasta, previa::ErroClipora> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| previa::ErroClipora::novo("ERRO_INTERNO", Some(e.to_string())))?;
    Ok(pasta::ConfigPasta::new(dir))
}
#[tauri::command]
fn obter_pasta_destino(app: tauri::AppHandle) -> Result<pasta::PastaDestino, previa::ErroClipora> {
    Ok(config_pasta(&app)?.obter())
}
#[tauri::command]
async fn selecionar_pasta_destino(
    app: tauri::AppHandle,
) -> Result<Option<String>, previa::ErroClipora> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |pasta| {
        let _ = tx.send(pasta);
    });
    let escolha = rx
        .await
        .map_err(|e| previa::ErroClipora::novo("ERRO_INTERNO", Some(e.to_string())))?;
    let Some(caminho) = escolha else {
        return Ok(None);
    };
    let caminho = caminho
        .into_path()
        .map_err(|e| previa::ErroClipora::novo("ERRO_INTERNO", Some(e.to_string())))?;
    config_pasta(&app)?
        .salvar(&caminho)
        .map_err(|c| previa::ErroClipora::novo(c, None))?;
    Ok(Some(caminho.to_string_lossy().into_owned()))
}

#[tauri::command]
fn obter_estado(
    controle: State<'_, download::Controle>,
) -> Result<download::Estado, previa::ErroClipora> {
    let dados = controle
        .0
        .lock()
        .map_err(|_| previa::ErroClipora::novo("ERRO_INTERNO", None))?;
    Ok(download::Estado {
        download: dados.ativo.clone(),
        atualizacao_em_andamento: dados.atualizacao,
    })
}
#[tauri::command]
async fn iniciar_download(
    app: tauri::AppHandle,
    controle: State<'_, download::Controle>,
    download_id: String,
    url: String,
    on_evento: tauri::ipc::Channel<download::Evento>,
) -> Result<(), previa::ErroClipora> {
    let (normalizada, _) = links::validar(&url).map_err(|c| previa::ErroClipora::novo(c, None))?;
    let pasta = config_pasta(&app)?.obter();
    let codigo = match pasta.estado {
        pasta::EstadoPasta::NaoDefinida => Some("PASTA_NAO_DEFINIDA"),
        pasta::EstadoPasta::Ausente => Some("PASTA_AUSENTE"),
        pasta::EstadoPasta::SemPermissao => Some("PASTA_SEM_PERMISSAO"),
        pasta::EstadoPasta::Valida => None,
    };
    if let Some(codigo) = codigo {
        return Err(previa::ErroClipora::novo(codigo, None));
    }
    let destino = std::path::PathBuf::from(
        pasta
            .caminho
            .ok_or_else(|| previa::ErroClipora::novo("PASTA_NAO_DEFINIDA", None))?,
    );
    let bin = binarios::resolver(&app, "clipora-yt-dlp")
        .map_err(|e| previa::ErroClipora::novo("DOWNLOAD_FALHOU", Some(e)))?;
    let ffmpeg = binarios::resolver(&app, "clipora-ffmpeg")
        .map_err(|e| previa::ErroClipora::novo("FFMPEG_INDISPONIVEL", Some(e)))?;
    binarios::resolver(&app, "clipora-ffprobe")
        .map_err(|e| previa::ErroClipora::novo("FFMPEG_INDISPONIVEL", Some(e)))?;
    let mut dados = controle
        .0
        .lock()
        .map_err(|_| previa::ErroClipora::novo("ERRO_INTERNO", None))?;
    if dados.atualizacao {
        return Err(previa::ErroClipora::novo("ATUALIZACAO_EM_ANDAMENTO", None));
    }
    if dados.ativo.is_some() || dados.arquivos.contains_key(&download_id) {
        return Err(previa::ErroClipora::novo("DOWNLOAD_EM_ANDAMENTO", None));
    }
    dados.ativo = Some(download::EstadoDownload {
        download_id: download_id.clone(),
        percentual: None,
        etapa: "preparando".into(),
    });
    let shared = controle.0.clone();
    let tarefa = tauri::async_runtime::spawn(download::executar(
        shared,
        on_evento,
        download_id,
        normalizada.to_string(),
        destino,
        bin,
        ffmpeg,
    ));
    dados.tarefa = Some(tarefa.inner().abort_handle());
    Ok(())
}
#[tauri::command]
async fn abrir_pasta_download(
    controle: State<'_, download::Controle>,
    download_id: String,
) -> Result<(), previa::ErroClipora> {
    let caminho = controle
        .0
        .lock()
        .map_err(|_| previa::ErroClipora::novo("ERRO_INTERNO", None))?
        .arquivos
        .get(&download_id)
        .cloned()
        .ok_or_else(|| previa::ErroClipora::novo("ERRO_INTERNO", None))?;
    tauri::async_runtime::spawn_blocking(move || tauri_plugin_opener::reveal_item_in_dir(caminho))
        .await
        .map_err(|e| previa::ErroClipora::novo("ERRO_INTERNO", Some(e.to_string())))?
        .map_err(|e| previa::ErroClipora::novo("ERRO_INTERNO", Some(e.to_string())))
}

#[tauri::command]
async fn obter_previa(
    app: tauri::AppHandle,
    estado: State<'_, previa::ControlePrevia>,
    url: String,
    requisicao_id: u64,
) -> Result<previa::Previa, previa::ErroClipora> {
    let cancelado = estado
        .iniciar(requisicao_id)
        .map_err(|c| previa::ErroClipora::novo(c, None))?;
    links::validar(&url).map_err(|c| previa::ErroClipora::novo(c, None))?;
    let bin = binarios::resolver(&app, "clipora-yt-dlp")
        .map_err(|e| previa::ErroClipora::novo("PREVIA_INDISPONIVEL", Some(e)))?;
    let ffmpeg = binarios::resolver(&app, "clipora-ffmpeg")
        .map_err(|e| previa::ErroClipora::novo("FFMPEG_INDISPONIVEL", Some(e)))?;
    previa::obter(url, requisicao_id, cancelado, &bin, &ffmpeg).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(previa::ControlePrevia::default());
            app.manage(download::Controle::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            obter_previa,
            obter_estado,
            obter_pasta_destino,
            selecionar_pasta_destino,
            iniciar_download,
            abrir_pasta_download
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit)
                && let Ok(dados) = app.state::<download::Controle>().0.lock()
                && let Some(tarefa) = &dados.tarefa
            {
                tarefa.abort();
            }
        });
}
