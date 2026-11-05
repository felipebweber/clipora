use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EstadoPasta {
    NaoDefinida,
    Valida,
    Ausente,
    SemPermissao,
}
#[derive(Serialize)]
pub struct PastaDestino {
    pub caminho: Option<String>,
    pub estado: EstadoPasta,
}
#[derive(Serialize, Deserialize)]
struct Config {
    caminho: PathBuf,
}
pub struct ConfigPasta {
    dir: PathBuf,
}
impl ConfigPasta {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }
    fn arquivo(&self) -> PathBuf {
        self.dir.join("config.json")
    }
    pub fn obter(&self) -> PastaDestino {
        let config = fs::read(self.arquivo())
            .ok()
            .and_then(|s| serde_json::from_slice::<Config>(&s).ok());
        match config {
            None => PastaDestino {
                caminho: None,
                estado: EstadoPasta::NaoDefinida,
            },
            Some(config) => PastaDestino {
                caminho: Some(config.caminho.to_string_lossy().into_owned()),
                estado: validar(&config.caminho),
            },
        }
    }
    pub fn salvar(&self, caminho: &Path) -> Result<(), &'static str> {
        match validar(caminho) {
            EstadoPasta::Valida => (),
            EstadoPasta::Ausente => return Err("PASTA_AUSENTE"),
            _ => return Err("PASTA_SEM_PERMISSAO"),
        }
        fs::create_dir_all(&self.dir).map_err(|_| "ERRO_INTERNO")?;
        let mut temp = tempfile::NamedTempFile::new_in(&self.dir).map_err(|_| "ERRO_INTERNO")?;
        serde_json::to_writer(
            &mut temp,
            &Config {
                caminho: caminho.to_path_buf(),
            },
        )
        .map_err(|_| "ERRO_INTERNO")?;
        temp.flush()
            .and_then(|_| temp.as_file().sync_all())
            .map_err(|_| "ERRO_INTERNO")?;
        temp.persist(self.arquivo()).map_err(|_| "ERRO_INTERNO")?;
        Ok(())
    }
}
pub fn validar(caminho: &Path) -> EstadoPasta {
    if !caminho.is_dir() {
        return EstadoPasta::Ausente;
    }
    match tempfile::NamedTempFile::new_in(caminho) {
        Ok(t) => match t.close() {
            Ok(()) => EstadoPasta::Valida,
            Err(_) => EstadoPasta::SemPermissao,
        },
        Err(_) => EstadoPasta::SemPermissao,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    #[test]
    fn persiste_unicode_e_rele_apos_reinicio() {
        let raiz = tempfile::tempdir().unwrap();
        let destino = raiz.path().join("vídeos 🎬");
        fs::create_dir(&destino).unwrap();
        let config = raiz.path().join("config");
        let repo = ConfigPasta::new(config.clone());
        repo.salvar(&destino).unwrap();
        let nova = ConfigPasta::new(config);
        assert_eq!(nova.obter().estado, EstadoPasta::Valida);
        assert_eq!(nova.obter().caminho.as_deref(), destino.to_str());
    }
    #[test]
    fn ausente_arquivo_e_corrompido() {
        let raiz = tempfile::tempdir().unwrap();
        let destino = raiz.path().join("destino");
        fs::create_dir(&destino).unwrap();
        let repo = ConfigPasta::new(raiz.path().join("config"));
        assert_eq!(repo.obter().estado, EstadoPasta::NaoDefinida);
        repo.salvar(&destino).unwrap();
        fs::remove_dir(&destino).unwrap();
        assert_eq!(repo.obter().estado, EstadoPasta::Ausente);
        fs::write(&destino, b"arquivo").unwrap();
        assert_eq!(repo.obter().estado, EstadoPasta::Ausente);
        fs::write(repo.arquivo(), b"{ quebrado").unwrap();
        assert_eq!(repo.obter().estado, EstadoPasta::NaoDefinida);
    }
    #[cfg(unix)]
    #[test]
    fn detecta_sem_permissao_de_escrita() {
        use std::os::unix::fs::PermissionsExt;
        let raiz = tempfile::tempdir().unwrap();
        let destino = raiz.path().join("pasta");
        fs::create_dir(&destino).unwrap();
        let repo = ConfigPasta::new(raiz.path().join("config"));
        repo.salvar(&destino).unwrap();
        fs::set_permissions(&destino, fs::Permissions::from_mode(0o555)).unwrap();
        assert_eq!(repo.obter().estado, EstadoPasta::SemPermissao);
        fs::set_permissions(&destino, fs::Permissions::from_mode(0o755)).unwrap();
    }
}
