use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::SystemTime,
};
use tauri::{AppHandle, Manager};

#[derive(Clone, Debug, PartialEq, Eq)]
struct AssinaturaCache {
    versao: String,
    exe_tamanho: u64,
    exe_modificado: Option<SystemTime>,
    manifesto_tamanho: u64,
    manifesto_modificado: Option<SystemTime>,
}
#[derive(Default, Clone)]
pub struct CacheYtdlp(Arc<Mutex<HashMap<PathBuf, (AssinaturaCache, PathBuf)>>>);

impl CacheYtdlp {
    async fn resolver_versao(&self, raiz: &Path, versao: &str) -> Option<PathBuf> {
        let exe_nome = if cfg!(windows) {
            "yt-dlp.exe"
        } else {
            "yt-dlp"
        };
        let dir = raiz.join(versao);
        let exe = dir.join(exe_nome);
        let manifesto = dir.join("clipora-yt-dlp.json");
        let sig = assinatura_cache(&exe, &manifesto, versao)?;
        if let Ok(cache) = self.0.lock()
            && let Some((antiga, caminho)) = cache.get(raiz)
            && antiga == &sig
            && caminho == &exe
        {
            return Some(caminho.clone());
        }
        let raiz_validacao = raiz.to_path_buf();
        let versao_validacao = versao.to_string();
        let valido = tokio::task::spawn_blocking(move || {
            crate::instalacao::resolver_versao(&raiz_validacao, &versao_validacao)
        })
        .await
        .ok()
        .flatten()?;
        self.0
            .lock()
            .ok()?
            .insert(raiz.to_path_buf(), (sig, valido.clone()));
        Some(valido)
    }

    pub async fn aquecer(&self, app: &AppHandle) {
        let _ = self.resolver(app).await;
    }

    pub async fn resolver(&self, app: &AppHandle) -> Result<(PathBuf, &'static str), String> {
        #[cfg(debug_assertions)]
        if let Some(dir) = std::env::var_os("CLIPORA_BIN_DIR") {
            let nome = if cfg!(windows) {
                "clipora-yt-dlp.exe"
            } else {
                "clipora-yt-dlp"
            };
            let path = PathBuf::from(dir).join(nome);
            return if path.is_file() {
                Ok((path, "empacotada"))
            } else {
                Err("Fixture yt-dlp não encontrado".into())
            };
        }

        let recursos = app.path().resource_dir().map_err(|e| e.to_string())?;
        let (embutido, manifesto_embutido) = {
            let exe = if cfg!(windows) {
                "yt-dlp.exe"
            } else {
                "yt-dlp"
            };
            let empacotado = recursos.join("yt-dlp");
            #[cfg(debug_assertions)]
            let (base, _) = if empacotado.join(exe).is_file() {
                (empacotado, ())
            } else {
                (
                    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries/yt-dlp"),
                    (),
                )
            };
            #[cfg(not(debug_assertions))]
            let base = empacotado;
            (base.join(exe), base.join("clipora-yt-dlp.json"))
        };
        let manifest: serde_json::Value = serde_json::from_slice(
            &std::fs::read(&manifesto_embutido)
                .map_err(|e| format!("manifesto yt-dlp embutido indisponível: {e}"))?,
        )
        .map_err(|e| format!("manifesto yt-dlp embutido inválido: {e}"))?;
        let versao_embutida = manifest
            .get("versao")
            .and_then(serde_json::Value::as_str)
            .filter(|v| crate::instalacao::versao_valida(v))
            .ok_or("versão embutida ausente ou inválida")?;
        let raiz = app
            .path()
            .app_local_data_dir()
            .map_err(|e| e.to_string())?
            .join("bin/yt-dlp");
        if let Some(versao_local) = crate::instalacao::versao_ponteiro(&raiz, "atual") {
            if crate::versao::comparar_versoes(&versao_local, versao_embutida)
                .is_some_and(|ordem| ordem != std::cmp::Ordering::Greater)
            {
                crate::instalacao::descartar_ate(&raiz, versao_embutida);
            } else if let Some(path) = self.resolver_versao(&raiz, &versao_local).await {
                return Ok((path, "atualizada"));
            }
        }
        if let Some(versao_anterior) = crate::instalacao::versao_ponteiro(&raiz, "anterior")
            && crate::versao::comparar_versoes(&versao_anterior, versao_embutida)
                .is_some_and(|ordem| ordem == std::cmp::Ordering::Greater)
            && let Some(path) = self.resolver_versao(&raiz, &versao_anterior).await
        {
            return Ok((path, "atualizada"));
        }
        if embutido.is_file() {
            Ok((embutido, "empacotada"))
        } else {
            Err("yt-dlp empacotado não encontrado".into())
        }
    }
}

fn assinatura_cache(exe: &Path, manifesto: &Path, versao: &str) -> Option<AssinaturaCache> {
    let e = std::fs::metadata(exe).ok()?;
    let m = std::fs::metadata(manifesto).ok()?;
    Some(AssinaturaCache {
        versao: versao.into(),
        exe_tamanho: e.len(),
        exe_modificado: e.modified().ok(),
        manifesto_tamanho: m.len(),
        manifesto_modificado: m.modified().ok(),
    })
}

pub fn resolver(app: &AppHandle, nome: &str) -> Result<PathBuf, String> {
    let executavel = if cfg!(windows) {
        format!("{nome}.exe")
    } else {
        nome.to_string()
    };
    #[cfg(debug_assertions)]
    if let Some(dir) = std::env::var_os("CLIPORA_BIN_DIR") {
        let caminho = PathBuf::from(dir).join(&executavel);
        return if caminho.is_file() {
            Ok(caminho)
        } else {
            Err(format!("Fixture {nome} não encontrado"))
        };
    }
    let ao_lado = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or("diretório do executável ausente")?
        .join(&executavel);
    if ao_lado.is_file() {
        return Ok(ao_lado);
    }
    let recurso = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join(&executavel);
    if recurso.is_file() {
        return Ok(recurso);
    }
    #[cfg(debug_assertions)]
    {
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(format!(
                "{nome}-{}{}",
                env!("CLIPORA_TARGET"),
                std::env::consts::EXE_SUFFIX
            ));
        if dev.is_file() {
            return Ok(dev);
        }
    }
    Err(format!("Sidecar {nome} não encontrado"))
}
