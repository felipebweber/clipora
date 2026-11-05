mod binarios;
mod download;
mod instalacao;
pub mod integridade;
mod links;
mod pasta;
mod previa;
mod processos;
mod versao;

use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LicencasResposta {
    resumo: serde_json::Value,
    texto_completo: String,
}

fn ler_licencas(app: &tauri::AppHandle) -> Result<LicencasResposta, previa::ErroClipora> {
    let dir = app
        .path()
        .resource_dir()
        .map_err(|e| previa::ErroClipora::novo("LICENCAS_INDISPONIVEIS", Some(e.to_string())))?
        .join("licencas");
    ler_licencas_de(&dir)
}

fn ler_licencas_de(dir: &std::path::Path) -> Result<LicencasResposta, previa::ErroClipora> {
    let resumo = std::fs::read(dir.join("licencas.json"))
        .map_err(|e| previa::ErroClipora::novo("LICENCAS_INDISPONIVEIS", Some(e.to_string())))?;
    let resumo = serde_json::from_slice(&resumo)
        .map_err(|e| previa::ErroClipora::novo("LICENCAS_INDISPONIVEIS", Some(e.to_string())))?;
    let texto_completo = std::fs::read_to_string(dir.join("THIRD_PARTY_LICENSES.txt"))
        .map_err(|e| previa::ErroClipora::novo("LICENCAS_INDISPONIVEIS", Some(e.to_string())))?;
    Ok(LicencasResposta {
        resumo,
        texto_completo,
    })
}

#[tauri::command]
fn obter_licencas(app: tauri::AppHandle) -> Result<LicencasResposta, previa::ErroClipora> {
    ler_licencas(&app)
}

#[tauri::command]
async fn abrir_link_licenca(
    app: tauri::AppHandle,
    cache: State<'_, binarios::CacheYtdlp>,
    componente_id: String,
    tipo: String,
) -> Result<(), previa::ErroClipora> {
    if tipo == "codigoFonteAtualizada" {
        if componente_id != "yt-dlp" {
            return Err(previa::ErroClipora::novo("LINK_INVALIDO", None));
        }
        let (bin, _) = cache
            .resolver(&app)
            .await
            .map_err(|e| previa::ErroClipora::novo("YTDLP_INDISPONIVEL", Some(e)))?;
        let versao = versao::versao_local(&bin).await?;
        if !instalacao::versao_valida(&versao) {
            return Err(previa::ErroClipora::novo(
                "YTDLP_INDISPONIVEL",
                Some("versão local inválida".into()),
            ));
        }
        let url =
            format!("https://github.com/yt-dlp/yt-dlp/releases/download/{versao}/yt-dlp.tar.gz");
        return app
            .opener()
            .open_url(url, None::<&str>)
            .map_err(|e| previa::ErroClipora::novo("ERRO_INTERNO", Some(e.to_string())));
    }
    let licencas = ler_licencas(&app)?;
    let campo = match tipo.as_str() {
        "codigoFonte" => "codigoFonte",
        "projeto" => "projeto",
        _ => return Err(previa::ErroClipora::novo("LINK_INVALIDO", None)),
    };
    let url = licencas
        .resumo
        .get("componentes")
        .and_then(serde_json::Value::as_array)
        .and_then(|itens| {
            itens.iter().find(|item| {
                item.get("id").and_then(serde_json::Value::as_str) == Some(&componente_id)
            })
        })
        .and_then(|item| item.get(campo))
        .and_then(serde_json::Value::as_str)
        .filter(|url| url::Url::parse(url).is_ok_and(|u| u.scheme() == "https"))
        .ok_or_else(|| previa::ErroClipora::novo("LINK_INVALIDO", None))?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| previa::ErroClipora::novo("ERRO_INTERNO", Some(e.to_string())))
}

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
        ultimo_resultado: dados.ultimo_resultado.clone(),
    })
}
#[tauri::command]
async fn iniciar_download(
    app: tauri::AppHandle,
    controle: State<'_, download::Controle>,
    cache: State<'_, binarios::CacheYtdlp>,
    download_id: String,
    url: String,
    on_evento: tauri::ipc::Channel<download::Evento>,
) -> Result<(), previa::ErroClipora> {
    {
        let dados = controle
            .0
            .lock()
            .map_err(|_| previa::ErroClipora::novo("ERRO_INTERNO", None))?;
        if dados.atualizacao {
            return Err(previa::ErroClipora::novo("ATUALIZACAO_EM_ANDAMENTO", None));
        }
        if dados.ativo.is_some() {
            return Err(previa::ErroClipora::novo("DOWNLOAD_EM_ANDAMENTO", None));
        }
    }
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
    download::limpar_antigos(&destino);
    let bin = cache
        .resolver(&app)
        .await
        .map(|(p, _)| p)
        .map_err(|e| previa::ErroClipora::novo("YTDLP_INDISPONIVEL", Some(e)))?;
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
        previa: dados
            .previa
            .as_ref()
            .filter(|p| p.url_normalizada == normalizada.as_str())
            .cloned(),
    });
    dados.ultimo_resultado = None;
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
    app: tauri::AppHandle,
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
    if !caminho.is_file() {
        let pasta = caminho
            .parent()
            .filter(|p| p.is_dir())
            .ok_or_else(|| previa::ErroClipora::novo("PASTA_AUSENTE", None))?
            .to_string_lossy()
            .into_owned();
        return app
            .opener()
            .open_path(pasta, None::<&str>)
            .map_err(|e| previa::ErroClipora::novo("ERRO_INTERNO", Some(e.to_string())));
    }
    tauri::async_runtime::spawn_blocking(move || tauri_plugin_opener::reveal_item_in_dir(caminho))
        .await
        .map_err(|e| previa::ErroClipora::novo("ERRO_INTERNO", Some(e.to_string())))?
        .map_err(|e| previa::ErroClipora::novo("ERRO_INTERNO", Some(e.to_string())))
}

#[tauri::command]
async fn atualizar_ytdlp(
    app: tauri::AppHandle,
    controle: State<'_, download::Controle>,
    previa: State<'_, previa::ControlePrevia>,
    cache: State<'_, binarios::CacheYtdlp>,
    versao_esperada: String,
    on_evento: tauri::ipc::Channel<instalacao::EventoAtualizacao>,
) -> Result<instalacao::ResultadoAtualizacao, previa::ErroClipora> {
    let _guarda = controle
        .entrar_atualizacao(&previa)
        .await
        .map_err(|c| previa::ErroClipora::novo(c, None))?;
    let raiz = app
        .path()
        .app_local_data_dir()
        .map_err(|e| previa::ErroClipora::novo("ERRO_INTERNO", Some(e.to_string())))?
        .join("bin/yt-dlp");
    let resultado = instalacao::atualizar(&raiz, &versao_esperada, &on_evento).await?;
    // Validação completa fora do runtime assíncrono; registra a cópia recém-instalada.
    let _ = cache
        .resolver(&app)
        .await
        .map_err(|e| previa::ErroClipora::novo("ATUALIZACAO_FALHOU", Some(e)))?;
    Ok(resultado)
}

#[tauri::command]
async fn verificar_ytdlp(
    app: tauri::AppHandle,
    cache: State<'_, binarios::CacheYtdlp>,
) -> Result<versao::Verificacao, previa::ErroClipora> {
    let (bin, origem) = cache
        .resolver(&app)
        .await
        .map_err(|e| previa::ErroClipora::novo("YTDLP_INDISPONIVEL", Some(e)))?;
    let mut resultado = versao::verificar(&bin).await?;
    resultado.origem = origem;
    Ok(resultado)
}

#[tauri::command]
async fn obter_previa(
    app: tauri::AppHandle,
    cache: State<'_, binarios::CacheYtdlp>,
    estado: State<'_, previa::ControlePrevia>,
    controle: State<'_, download::Controle>,
    url: String,
    requisicao_id: u64,
) -> Result<previa::Previa, previa::ErroClipora> {
    let _guarda = controle
        .entrar_previa()
        .map_err(|c| previa::ErroClipora::novo(c, None))?;
    let cancelado = estado
        .iniciar(requisicao_id)
        .map_err(|c| previa::ErroClipora::novo(c, None))?;
    links::validar(&url).map_err(|c| previa::ErroClipora::novo(c, None))?;
    let bin = cache
        .resolver(&app)
        .await
        .map(|(p, _)| p)
        .map_err(|e| previa::ErroClipora::novo("YTDLP_INDISPONIVEL", Some(e)))?;
    let ffmpeg = binarios::resolver(&app, "clipora-ffmpeg")
        .map_err(|e| previa::ErroClipora::novo("FFMPEG_INDISPONIVEL", Some(e)))?;
    let resultado = previa::obter(url, requisicao_id, cancelado, &bin, &ffmpeg).await;
    if let Ok(ref previa) = resultado
        && let Ok(mut dados) = controle.0.lock()
    {
        dados.previa = Some(previa.clone());
    }
    resultado
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            app.manage(previa::ControlePrevia::default());
            app.manage(download::Controle::default());
            app.manage(binarios::CacheYtdlp::default());
            let cache = app.state::<binarios::CacheYtdlp>().inner().clone();
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                cache.aquecer(&handle).await;
            });
            if let Ok(raiz) = app.path().app_local_data_dir() {
                instalacao::coleta(&raiz.join("bin/yt-dlp"));
            }
            if let Ok(config) = config_pasta(app.handle())
                && let Some(pasta) = config.obter().caminho
            {
                download::limpar_antigos(std::path::Path::new(&pasta));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            obter_previa,
            verificar_ytdlp,
            atualizar_ytdlp,
            obter_licencas,
            abrir_link_licenca,
            obter_estado,
            obter_pasta_destino,
            selecionar_pasta_destino,
            iniciar_download,
            abrir_pasta_download
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                app.state::<download::Controle>().encerrar();
            }
        });
}

#[cfg(test)]
mod licencas_tests {
    use super::*;
    #[test]
    fn le_json_e_texto_completo_e_exige_ambos() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("licencas.json"),
            r#"{"formato":1,"componentes":[]}"#,
        )
        .unwrap();
        std::fs::write(dir.path().join("THIRD_PARTY_LICENSES.txt"), "avisos").unwrap();
        let resposta = ler_licencas_de(dir.path()).unwrap();
        assert_eq!(resposta.resumo["formato"], 1);
        assert_eq!(resposta.texto_completo, "avisos");
        std::fs::remove_file(dir.path().join("THIRD_PARTY_LICENSES.txt")).unwrap();
        assert_eq!(
            ler_licencas_de(dir.path()).unwrap_err().codigo,
            "LICENCAS_INDISPONIVEIS"
        );
    }
}
