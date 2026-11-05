mod binarios;
mod links;
mod previa;
mod processos;

use serde::Serialize;
use tauri::{Manager, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Estado {
    download: Option<EstadoDownload>,
    atualizacao_em_andamento: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EstadoDownload {
    download_id: String,
    percentual: Option<f64>,
    etapa: String,
}

#[tauri::command]
fn obter_estado() -> Estado {
    Estado {
        download: None,
        atualizacao_em_andamento: false,
    }
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
        .setup(|app| {
            app.manage(previa::ControlePrevia::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![obter_previa, obter_estado])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
