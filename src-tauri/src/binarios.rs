use std::path::PathBuf;
use tauri::{AppHandle, Manager};

// Somente o binário empacotado até existir instalador de atualizações com
// verificação de assinatura, hash e versão; não executar cópias não verificadas.
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
