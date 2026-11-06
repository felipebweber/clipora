mod binarios;
mod download;
mod historico;
mod instalacao;
pub mod integridade;
mod links;
mod motor_youtube;
mod pasta;
mod previa;
mod processos;
mod versao;
pub mod youtube;

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
    altura_youtube: Option<u32>,
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
    if !historico::id_valido(&download_id) {
        return Err(previa::ErroClipora::novo(
            "LINK_INVALIDO",
            Some("ID de download inválido".into()),
        ));
    }
    let (normalizada, plataforma) =
        links::validar(&url).map_err(|c| previa::ErroClipora::novo(c, None))?;
    download::validar_altura(plataforma, altura_youtube)?;
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
    let ffprobe = binarios::resolver(&app, "clipora-ffprobe")
        .map_err(|e| previa::ErroClipora::novo("FFMPEG_INDISPONIVEL", Some(e)))?;
    let deno = if plataforma == links::Plataforma::Youtube {
        Some(
            binarios::resolver_motor(&app)
                .map_err(|e| previa::ErroClipora::novo("MOTOR_YOUTUBE_INDISPONIVEL", Some(e)))?,
        )
    } else {
        None
    };
    let destino = destino
        .canonicalize()
        .map_err(|e| previa::ErroClipora::novo("PASTA_AUSENTE", Some(e.to_string())))?;
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
        altura_youtube,
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
        app.state::<std::sync::Arc<historico::Repositorio>>()
            .inner()
            .clone(),
        on_evento,
        download_id,
        url,
        destino,
        download::FerramentasDownload {
            yt_dlp: bin,
            ffmpeg,
            ffprobe,
            deno,
        },
        altura_youtube,
    ));
    dados.tarefa = Some(tarefa.inner().abort_handle());
    Ok(())
}
#[tauri::command]
async fn obter_historico(
    historico: State<'_, std::sync::Arc<historico::Repositorio>>,
) -> Result<Vec<historico::ItemHistorico>, previa::ErroClipora> {
    let historico = historico.inner().clone();
    tauri::async_runtime::spawn_blocking(move || historico.listar())
        .await
        .map_err(|e| previa::ErroClipora::novo("HISTORICO_INDISPONIVEL", Some(e.to_string())))?
}
#[tauri::command]
async fn consultar_historico(
    historico: State<'_, std::sync::Arc<historico::Repositorio>>,
    url: String,
) -> Result<Option<historico::ItemHistorico>, previa::ErroClipora> {
    let historico = historico.inner().clone();
    tauri::async_runtime::spawn_blocking(move || historico.consultar(&url))
        .await
        .map_err(|e| previa::ErroClipora::novo("HISTORICO_INDISPONIVEL", Some(e.to_string())))?
}
#[tauri::command]
async fn limpar_historico(
    historico: State<'_, std::sync::Arc<historico::Repositorio>>,
) -> Result<(), previa::ErroClipora> {
    let historico = historico.inner().clone();
    tauri::async_runtime::spawn_blocking(move || historico.limpar())
        .await
        .map_err(|e| previa::ErroClipora::novo("HISTORICO_INDISPONIVEL", Some(e.to_string())))?
}
fn localizar_download(
    controle: &download::Controle,
    historico: &historico::Repositorio,
    id: &str,
) -> Result<std::path::PathBuf, previa::ErroClipora> {
    if !historico::id_valido(id) {
        return Err(previa::ErroClipora::novo("ARQUIVO_AUSENTE", None));
    }
    let caminho = controle
        .0
        .lock()
        .map_err(|_| previa::ErroClipora::novo("ERRO_INTERNO", None))?
        .arquivos
        .get(id)
        .cloned();
    match caminho {
        Some(caminho) => Ok(caminho),
        None => historico.caminho_registrado(id),
    }
}
fn caminho_download(
    controle: &download::Controle,
    historico: &historico::Repositorio,
    id: &str,
) -> Result<std::path::PathBuf, previa::ErroClipora> {
    if !historico::id_valido(id) {
        return Err(previa::ErroClipora::novo("ARQUIVO_AUSENTE", None));
    }
    let caminho = controle
        .0
        .lock()
        .map_err(|_| previa::ErroClipora::novo("ERRO_INTERNO", None))?
        .arquivos
        .get(id)
        .cloned();
    match caminho {
        Some(caminho) => historico::validar_arquivo(&caminho),
        None => historico.caminho(id),
    }
}
enum DestinoPasta {
    Revelar(std::path::PathBuf),
}
fn destino_pasta(
    controle: &download::Controle,
    historico: &historico::Repositorio,
    id: &str,
) -> Result<DestinoPasta, previa::ErroClipora> {
    let caminho = localizar_download(controle, historico, id)?;
    match std::fs::symlink_metadata(&caminho) {
        Ok(_) => Ok(DestinoPasta::Revelar(historico::validar_arquivo(&caminho)?)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let pai = caminho
                .parent()
                .ok_or_else(|| previa::ErroClipora::novo("PASTA_AUSENTE", None))?;
            historico::validar_diretorio(pai)
                .map(DestinoPasta::Revelar)
                .map_err(|_| previa::ErroClipora::novo("PASTA_AUSENTE", None))
        }
        Err(_) => Err(previa::ErroClipora::novo("ARQUIVO_AUSENTE", None)),
    }
}
#[tauri::command]
async fn abrir_arquivo_download(
    app: tauri::AppHandle,
    controle: State<'_, download::Controle>,
    historico: State<'_, std::sync::Arc<historico::Repositorio>>,
    download_id: String,
) -> Result<(), previa::ErroClipora> {
    let caminho = caminho_download(&controle, &historico, &download_id)?;
    app.opener()
        .open_path(caminho.to_string_lossy(), None::<&str>)
        .map_err(|e| previa::ErroClipora::novo("ERRO_INTERNO", Some(e.to_string())))
}
#[tauri::command]
async fn abrir_pasta_download(
    controle: State<'_, download::Controle>,
    historico: State<'_, std::sync::Arc<historico::Repositorio>>,
    download_id: String,
) -> Result<(), previa::ErroClipora> {
    // Revela também o diretório pai de arquivo ausente: nunca open_path em
    // diretórios persistidos, pois um pacote .app poderia ser executado no macOS.
    let DestinoPasta::Revelar(caminho) = destino_pasta(&controle, &historico, &download_id)?;
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
    let (_, plataforma) = links::validar(&url).map_err(|c| previa::ErroClipora::novo(c, None))?;
    let bin = cache
        .resolver(&app)
        .await
        .map(|(p, _)| p)
        .map_err(|e| previa::ErroClipora::novo("YTDLP_INDISPONIVEL", Some(e)))?;
    let ffmpeg = binarios::resolver(&app, "clipora-ffmpeg")
        .map_err(|e| previa::ErroClipora::novo("FFMPEG_INDISPONIVEL", Some(e)))?;
    let deno = if plataforma == links::Plataforma::Youtube {
        Some(
            binarios::resolver_motor(&app)
                .map_err(|e| previa::ErroClipora::novo("MOTOR_YOUTUBE_INDISPONIVEL", Some(e)))?,
        )
    } else {
        None
    };
    let resultado = previa::obter_com_motor(
        url,
        requisicao_id,
        cancelado,
        &bin,
        &ffmpeg,
        deno.as_deref(),
    )
    .await;
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
            app.manage(std::sync::Arc::new(historico::Repositorio::novo(
                app.path()
                    .app_local_data_dir()
                    .map(|p| p.join("historico.json"))
                    .unwrap_or_default(),
            )));
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
            abrir_pasta_download,
            abrir_arquivo_download,
            obter_historico,
            consultar_historico,
            limpar_historico
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
    fn abertura_por_id_preserva_pasta_quando_video_foi_removido() {
        let dir = tempfile::tempdir().unwrap();
        let raiz = dir.path().canonicalize().unwrap();
        let arquivo = raiz.join("Vídeo [abc].mp4");
        std::fs::write(
            &arquivo,
            b"\x00\x00\x00\x18ftypisom\x00\x00\x00\x00isommp42",
        )
        .unwrap();
        let controle = download::Controle::default();
        let h = historico::Repositorio::novo(raiz.join("historico.json"));
        controle
            .0
            .lock()
            .unwrap()
            .arquivos
            .insert("a".into(), arquivo.clone());
        assert!(matches!(
            destino_pasta(&controle, &h, "a").unwrap(),
            DestinoPasta::Revelar(_)
        ));
        std::fs::remove_file(&arquivo).unwrap();
        assert!(
            matches!(destino_pasta(&controle,&h,"a").unwrap(),DestinoPasta::Revelar(p) if p==raiz)
        );
        assert_eq!(
            caminho_download(&controle, &h, "a").unwrap_err().codigo,
            "ARQUIVO_AUSENTE"
        );
        assert!(destino_pasta(&controle, &h, "desconhecido").is_err());
    }
    #[test]
    fn abertura_de_id_persistido_sem_mapa_e_fallback_validam_caminho() {
        let dir = tempfile::tempdir().unwrap();
        let raiz = dir.path().canonicalize().unwrap();
        let arquivo = raiz.join("Vídeo [abc].mp4");
        std::fs::write(
            &arquivo,
            b"\x00\x00\x00\x18ftypisom\x00\x00\x00\x00isommp42",
        )
        .unwrap();
        let h = historico::Repositorio::novo(raiz.join("historico.json"));
        h.registrar(historico::ItemHistorico {
            download_id: "persistido".into(),
            url_original: "https://instagram.com/reel/abc".into(),
            url_normalizada: "https://instagram.com/p/abc".into(),
            titulo: None,
            plataforma: links::Plataforma::Instagram,
            caminho: arquivo.to_string_lossy().into(),
            nome_arquivo: "Vídeo [abc].mp4".into(),
            concluido_em: 1,
            disponivel: true,
        })
        .unwrap();
        let h = historico::Repositorio::novo(raiz.join("historico.json"));
        let controle = download::Controle::default();
        assert_eq!(
            caminho_download(&controle, &h, "persistido").unwrap(),
            arquivo
        );
        std::fs::remove_file(&arquivo).unwrap();
        assert!(
            matches!(destino_pasta(&controle,&h,"persistido").unwrap(),DestinoPasta::Revelar(p) if p==raiz)
        );
        assert_eq!(
            caminho_download(&controle, &h, "persistido")
                .unwrap_err()
                .codigo,
            "ARQUIVO_AUSENTE"
        );
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(raiz.join("historico.json"), &arquivo).unwrap();
            assert!(destino_pasta(&controle, &h, "persistido").is_err());
        }
    }
    #[test]
    fn pasta_app_persistida_com_video_ausente_so_pode_ser_revelada() {
        let dir = tempfile::tempdir().unwrap();
        let raiz = dir.path().canonicalize().unwrap();
        let pacote = raiz.join("Armadilha.app");
        std::fs::create_dir(&pacote).unwrap();
        let arquivo = pacote.join("Vídeo [abc].mp4");
        let h = historico::Repositorio::novo(raiz.join("historico.json"));
        h.registrar(historico::ItemHistorico {
            download_id: "persistido".into(),
            url_original: "https://instagram.com/reel/abc".into(),
            url_normalizada: "https://instagram.com/reel/abc".into(),
            titulo: None,
            plataforma: links::Plataforma::Instagram,
            caminho: arquivo.to_string_lossy().into(),
            nome_arquivo: "Vídeo [abc].mp4".into(),
            concluido_em: 1,
            disponivel: false,
        })
        .unwrap();
        let controle = download::Controle::default();
        assert!(
            matches!(destino_pasta(&controle,&h,"persistido").unwrap(),DestinoPasta::Revelar(p) if p==pacote)
        );
        assert!(caminho_download(&controle, &h, "persistido").is_err());
    }
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
