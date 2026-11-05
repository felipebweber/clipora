use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub fn resolver_ytdlp(app: &AppHandle) -> Result<(PathBuf, &'static str), String> {
    #[cfg(debug_assertions)]
    if let Some(dir) = std::env::var_os("CLIPORA_BIN_DIR") {
        let nome = if cfg!(windows) {
            "clipora-yt-dlp.exe"
        } else {
            "clipora-yt-dlp"
        };
        let caminho = PathBuf::from(dir).join(nome);
        return if caminho.is_file() {
            Ok((caminho, "empacotada"))
        } else {
            Err("Fixture yt-dlp não encontrado".into())
        };
    }
    if let Ok(raiz) = app.path().app_local_data_dir()
        && let Some(exe) = crate::instalacao::resolver_atual(&raiz.join("bin/yt-dlp"))
    {
        return Ok((exe, "atualizada"));
    }
    let exe = if cfg!(windows) {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    };
    let base = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("yt-dlp");
    let empacotado = base.join(exe);
    if empacotado.is_file() {
        return Ok((empacotado, "empacotada"));
    }
    #[cfg(debug_assertions)]
    {
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries/yt-dlp")
            .join(exe);
        if dev.is_file() {
            return Ok((dev, "empacotada"));
        }
    }
    Err("yt-dlp empacotado não encontrado".into())
}

pub fn resolver(app: &AppHandle, nome: &str) -> Result<PathBuf, String> {
    let executavel = if cfg!(windows) {
        format!("{nome}.exe")
    } else {
        nome.to_string()
    };
    // Override exclusivo de debug para fixtures; nunca presente em release.
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
