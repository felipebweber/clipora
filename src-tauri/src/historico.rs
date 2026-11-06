use crate::{links::Plataforma, previa::ErroClipora};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemHistorico {
    pub download_id: String,
    pub url_original: String,
    pub url_normalizada: String,
    pub titulo: Option<String>,
    pub plataforma: Plataforma,
    pub caminho: String,
    pub nome_arquivo: String,
    pub concluido_em: u64,
    #[serde(skip_deserializing, default)]
    pub disponivel: bool,
}
// Um único estado gerenciado pelo Tauri serializa leitura, registro e limpeza.
// Pendentes sobrevivem a falhas de disco na sessão e são tentados novamente ao consultar.
pub struct Repositorio {
    arquivo: PathBuf,
    estado: Mutex<Vec<ItemHistorico>>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Documento {
    versao: u32,
    itens: Vec<ItemHistorico>,
}
fn erro(detalhe: impl ToString) -> ErroClipora {
    ErroClipora::novo("HISTORICO_INDISPONIVEL", Some(detalhe.to_string()))
}
fn ausente() -> ErroClipora {
    ErroClipora::novo("ARQUIVO_AUSENTE", None)
}
pub fn id_valido(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
}
fn validar_item(item: &ItemHistorico) -> Result<(), ErroClipora> {
    let caminho = Path::new(&item.caminho);
    if !id_valido(&item.download_id)
        || !caminho.is_absolute()
        || caminho.components().any(|c| {
            matches!(
                c,
                std::path::Component::ParentDir | std::path::Component::CurDir
            )
        })
        || caminho.extension().is_none_or(|e| e != "mp4")
        || caminho.file_name().and_then(|n| n.to_str()) != Some(item.nome_arquivo.as_str())
    {
        return Err(erro("Registro inválido"));
    }
    for url in [&item.url_original, &item.url_normalizada] {
        let (_, plataforma) = crate::links::validar(url).map_err(erro)?;
        if plataforma != item.plataforma {
            return Err(erro("Plataforma incoerente"));
        }
    }
    Ok(())
}
impl Repositorio {
    pub fn novo(arquivo: PathBuf) -> Self {
        Self {
            arquivo,
            estado: Mutex::new(vec![]),
        }
    }
    fn ler(&self) -> Result<Vec<ItemHistorico>, ErroClipora> {
        if !self.arquivo.is_absolute() {
            return Err(erro("Diretório local indisponível"));
        }
        match std::fs::symlink_metadata(&self.arquivo) {
            Ok(m) if !m.is_file() || m.file_type().is_symlink() => {
                return Err(erro("Histórico não é arquivo regular"));
            }
            Ok(_) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
            Err(e) => return Err(erro(e)),
        }
        let bytes = std::fs::read(&self.arquivo).map_err(erro)?;
        let doc: Documento = serde_json::from_slice(&bytes).map_err(erro)?;
        if doc.versao != 1 {
            return Err(erro("Versão de histórico não suportada"));
        }
        let mut ids = std::collections::HashSet::new();
        for item in &doc.itens {
            validar_item(item)?;
            if !ids.insert(&item.download_id) {
                return Err(erro("ID duplicado"));
            }
        }
        Ok(doc.itens)
    }
    fn gravar(&self, itens: &[ItemHistorico]) -> Result<(), ErroClipora> {
        use std::io::Write;
        let pai = self
            .arquivo
            .parent()
            .ok_or_else(|| erro("Diretório ausente"))?;
        std::fs::create_dir_all(pai).map_err(erro)?;
        let mut temp = tempfile::NamedTempFile::new_in(pai).map_err(erro)?;
        serde_json::to_writer(
            &mut temp,
            &Documento {
                versao: 1,
                itens: itens.to_vec(),
            },
        )
        .map_err(erro)?;
        temp.flush().map_err(erro)?;
        temp.as_file().sync_all().map_err(erro)?;
        temp.persist(&self.arquivo).map_err(erro)?;
        Ok(())
    }
    fn sincronizar(
        &self,
        pendentes: &mut Vec<ItemHistorico>,
    ) -> Result<Vec<ItemHistorico>, ErroClipora> {
        let mut itens = self.ler()?;
        if !pendentes.is_empty() {
            for item in pendentes.iter() {
                validar_item(item)?;
                itens.retain(|i| i.download_id != item.download_id);
                itens.push(item.clone());
            }
            self.gravar(&itens)?;
            pendentes.clear();
        }
        itens.sort_by(|a, b| {
            b.concluido_em
                .cmp(&a.concluido_em)
                .then_with(|| b.download_id.cmp(&a.download_id))
        });
        Ok(itens)
    }
    pub fn registrar(&self, item: ItemHistorico) -> Result<(), ErroClipora> {
        let mut pendentes = self.estado.lock().map_err(erro)?;
        pendentes.retain(|i| i.download_id != item.download_id);
        pendentes.push(item);
        self.sincronizar(&mut pendentes).map(|_| ())
    }
    fn snapshot(&self) -> Result<Vec<ItemHistorico>, ErroClipora> {
        let mut pendentes = self.estado.lock().map_err(erro)?;
        self.sincronizar(&mut pendentes)
    }
    pub fn listar(&self) -> Result<Vec<ItemHistorico>, ErroClipora> {
        self.listar_com_validacao(|p| validar_arquivo(p).is_ok())
    }
    fn listar_com_validacao(
        &self,
        validar: impl Fn(&Path) -> bool,
    ) -> Result<Vec<ItemHistorico>, ErroClipora> {
        // Snapshot libera o mutex antes de tocar nos volumes que contêm vídeos.
        let mut itens = self.snapshot()?;
        for item in &mut itens {
            item.disponivel = validar(Path::new(&item.caminho));
        }
        Ok(itens)
    }
    pub fn consultar(&self, url: &str) -> Result<Option<ItemHistorico>, ErroClipora> {
        let chave = chave_url(url)?;
        let correspondentes: Vec<_> = self
            .listar()?
            .into_iter()
            .filter(|item| {
                [&item.url_original, &item.url_normalizada]
                    .iter()
                    .any(|u| chave_url(u).is_ok_and(|c| c == chave))
            })
            .collect();
        Ok(correspondentes
            .iter()
            .find(|item| item.disponivel)
            .or(correspondentes.first())
            .cloned())
    }
    pub fn limpar(&self) -> Result<(), ErroClipora> {
        let mut pendentes = self.estado.lock().map_err(erro)?;
        self.ler()?; // Recusa sobrescrever silenciosamente dados corrompidos.
        self.gravar(&[])?;
        pendentes.clear();
        Ok(())
    }
    pub fn caminho(&self, id: &str) -> Result<PathBuf, ErroClipora> {
        if !id_valido(id) {
            return Err(ausente());
        }
        validar_arquivo(&self.caminho_registrado(id)?)
    }
    pub fn caminho_registrado(&self, id: &str) -> Result<PathBuf, ErroClipora> {
        if !id_valido(id) {
            return Err(ausente());
        }
        // Abrir um ID não precisa fazer stat dos demais vídeos do histórico.
        let item = self
            .snapshot()?
            .into_iter()
            .find(|i| i.download_id == id)
            .ok_or_else(ausente)?;
        Ok(PathBuf::from(item.caminho))
    }
}
fn chave_url(input: &str) -> Result<String, ErroClipora> {
    let (url, plataforma) = crate::links::validar(input).map_err(|c| ErroClipora::novo(c, None))?;
    let partes: Vec<_> = url
        .path_segments()
        .into_iter()
        .flatten()
        .filter(|s| !s.is_empty())
        .collect();
    match plataforma {
        Plataforma::Youtube => {
            let id = url
                .query_pairs()
                .find(|(k, _)| k == "v")
                .map(|(_, v)| v.into_owned())
                .ok_or_else(ausente)?;
            Ok(format!("youtube:{id}"))
        }
        Plataforma::Instagram => Ok(format!("instagram:{}", partes.last().unwrap_or(&""))),
        Plataforma::Tiktok if partes.len() == 3 && partes[1] == "video" => {
            Ok(format!("tiktok:{}", partes[2]))
        }
        Plataforma::Tiktok => {
            let host = match url.host_str().unwrap_or("") {
                "www.tiktok.com" | "m.tiktok.com" => "tiktok.com",
                h => h,
            };
            Ok(format!("curto:{host}/{}", partes.join("/")))
        }
    }
}
// Não segue symlinks em qualquer componente nem delega abertura ao shell.
// O contêiner MP4 precisa conter uma caixa ftyp, como os arquivos finalizados pelo download.
pub fn validar_arquivo(caminho: &Path) -> Result<PathBuf, ErroClipora> {
    use std::io::Read;
    if !caminho.is_absolute() || caminho.extension().is_none_or(|e| e != "mp4") {
        return Err(ausente());
    }
    validar_componentes(caminho)?;
    let meta = std::fs::symlink_metadata(caminho).map_err(|_| ausente())?;
    if !meta.is_file() || meta.len() < 12 {
        return Err(ausente());
    }
    let mut arquivo = std::fs::File::open(caminho).map_err(|_| ausente())?;
    let mut cabecalho = [0u8; 12];
    arquivo.read_exact(&mut cabecalho).map_err(|_| ausente())?;
    if &cabecalho[4..8] != b"ftyp" {
        return Err(ausente());
    }
    Ok(caminho.to_path_buf())
}
pub fn validar_diretorio(caminho: &Path) -> Result<PathBuf, ErroClipora> {
    validar_componentes(caminho)?;
    if !caminho.is_dir() {
        return Err(ausente());
    }
    Ok(caminho.to_path_buf())
}
fn validar_componentes(caminho: &Path) -> Result<(), ErroClipora> {
    if !caminho.is_absolute() {
        return Err(ausente());
    }
    let mut prefixo = PathBuf::new();
    for componente in caminho.components() {
        if matches!(
            componente,
            std::path::Component::ParentDir | std::path::Component::CurDir
        ) {
            return Err(ausente());
        }
        prefixo.push(componente);
        if std::fs::symlink_metadata(&prefixo)
            .map_err(|_| ausente())?
            .file_type()
            .is_symlink()
        {
            return Err(ausente());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    fn item(dir: &Path, id: &str, data: u64) -> ItemHistorico {
        let caminho = dir
            .canonicalize()
            .unwrap()
            .join(format!("Vídeo [{id}].mp4"));
        std::fs::write(
            &caminho,
            b"\x00\x00\x00\x18ftypisom\x00\x00\x00\x00isommp42",
        )
        .unwrap();
        ItemHistorico {
            download_id: id.into(),
            url_original: "https://instagram.com/reel/abc/?utm=x".into(),
            url_normalizada: "https://instagram.com/reel/abc/".into(),
            titulo: Some("Vídeo".into()),
            plataforma: Plataforma::Instagram,
            caminho: caminho.to_string_lossy().into(),
            nome_arquivo: caminho.file_name().unwrap().to_string_lossy().into(),
            concluido_em: data,
            disponivel: false,
        }
    }
    #[test]
    fn youtube_historico_aliases_preserva_registros_antigos() {
        let dir = tempfile::tempdir().unwrap();
        let arquivo = dir.path().join("historico.json");
        let r = Repositorio::novo(arquivo.clone());
        let antigo = item(dir.path(), "instagram-antigo", 1);
        r.registrar(antigo.clone()).unwrap();
        let bytes = std::fs::read(&arquivo).unwrap();
        let r = Repositorio::novo(arquivo.clone());
        assert_eq!(r.listar().unwrap()[0].download_id, "instagram-antigo");
        assert_eq!(std::fs::read(&arquivo).unwrap(), bytes);
        let mut yt = item(dir.path(), "youtube", 2);
        yt.url_original = "https://youtu.be/YE7VzlLtp-4?si=x".into();
        yt.url_normalizada = "https://www.youtube.com/watch?v=YE7VzlLtp-4".into();
        yt.plataforma = serde_json::from_str("\"youtube\"").unwrap();
        r.registrar(yt).unwrap();
        let r = Repositorio::novo(arquivo);
        assert_eq!(r.listar().unwrap().len(), 2);
        assert_eq!(
            r.consultar("http://m.youtube.com/watch?v=YE7VzlLtp-4&t=3&list=abc#x")
                .unwrap()
                .unwrap()
                .download_id,
            "youtube"
        );
        assert!(
            r.consultar("https://youtu.be/jNQXAC9IVRw")
                .unwrap()
                .is_none()
        );
        assert!(Path::new(&antigo.caminho).exists());
    }
    #[test]
    fn persiste_reabre_ordena_e_limpa_sem_apagar() {
        let d = tempfile::tempdir().unwrap();
        let arquivo = d.path().join("historico.json");
        let r = Repositorio::novo(arquivo.clone());
        let a = item(d.path(), "a", 10);
        let b = item(d.path(), "b", 20);
        r.registrar(b.clone()).unwrap();
        r.registrar(a.clone()).unwrap();
        let r = Repositorio::novo(arquivo);
        let lista = r.listar().unwrap();
        assert_eq!(
            lista
                .iter()
                .map(|x| x.download_id.as_str())
                .collect::<Vec<_>>(),
            ["b", "a"]
        );
        assert!(lista[0].disponivel);
        r.limpar().unwrap();
        assert!(r.listar().unwrap().is_empty());
        assert!(Path::new(&a.caminho).exists());
        assert!(Path::new(&b.caminho).exists());
    }
    #[test]
    fn equivalencia_sem_confundir_videos_ou_curtos() {
        let d = tempfile::tempdir().unwrap();
        let r = Repositorio::novo(d.path().join("historico.json"));
        r.registrar(item(d.path(), "a", 1)).unwrap();
        for u in [
            "http://m.instagram.com/p/abc#x",
            "https://www.instagram.com/reels/abc?igsh=x",
            "https://instagram.com/usuario/reel/abc/",
        ] {
            assert!(r.consultar(u).unwrap().is_some(), "{u}");
        }
        assert!(
            r.consultar("https://instagram.com/reel/outro/")
                .unwrap()
                .is_none()
        );
        let mut t = item(d.path(), "t", 2);
        t.plataforma = Plataforma::Tiktok;
        t.url_original = "https://vm.tiktok.com/curto/?a=b".into();
        t.url_normalizada = "https://www.tiktok.com/@user/video/123".into();
        r.registrar(t).unwrap();
        for u in [
            "https://m.tiktok.com/@outro/video/123?x=y",
            "https://vm.tiktok.com/curto#x",
        ] {
            assert_eq!(r.consultar(u).unwrap().unwrap().download_id, "t");
        }
        assert!(
            r.consultar("https://vt.tiktok.com/curto")
                .unwrap()
                .is_none()
        );
        assert!(
            r.consultar("https://vm.tiktok.com/diferente")
                .unwrap()
                .is_none()
        );
        assert!(
            r.consultar("https://tiktok.com/@user/video/124")
                .unwrap()
                .is_none()
        );
    }
    #[test]
    fn consulta_prefere_copia_disponivel_e_preserva_aviso_se_todas_sumiram() {
        let d = tempfile::tempdir().unwrap();
        let r = Repositorio::novo(d.path().join("historico.json"));
        let a = item(d.path(), "a", 1);
        let b = item(d.path(), "b", 2);
        r.registrar(a.clone()).unwrap();
        r.registrar(b.clone()).unwrap();
        std::fs::remove_file(&b.caminho).unwrap();
        assert_eq!(
            r.consultar(&a.url_original).unwrap().unwrap().download_id,
            "a"
        );
        std::fs::remove_file(&a.caminho).unwrap();
        let aviso = r.consultar(&a.url_original).unwrap().unwrap();
        assert_eq!(aviso.download_id, "b");
        assert!(!aviso.disponivel);
    }
    #[test]
    fn ausente_permanece_e_abertura_so_por_id_validado() {
        let d = tempfile::tempdir().unwrap();
        let r = Repositorio::novo(d.path().join("historico.json"));
        let a = item(d.path(), "a", 1);
        r.registrar(a.clone()).unwrap();
        assert_eq!(r.caminho("a").unwrap(), PathBuf::from(&a.caminho));
        assert_eq!(r.caminho(&a.caminho).unwrap_err().codigo, "ARQUIVO_AUSENTE");
        std::fs::remove_file(&a.caminho).unwrap();
        assert!(!r.listar().unwrap()[0].disponivel);
        assert_eq!(r.caminho("a").unwrap_err().codigo, "ARQUIVO_AUSENTE");
    }
    #[test]
    fn corrupcao_nao_sobrescreve_e_registro_pendente_pode_ser_recuperado() {
        let d = tempfile::tempdir().unwrap();
        let arquivo = d.path().join("historico.json");
        std::fs::write(&arquivo, b"{corrompido").unwrap();
        let r = Repositorio::novo(arquivo.clone());
        assert_eq!(
            r.registrar(item(d.path(), "a", 1)).unwrap_err().codigo,
            "HISTORICO_INDISPONIVEL"
        );
        for _ in 0..2 {
            assert!(r.listar().is_err());
            assert!(r.limpar().is_err());
            assert_eq!(std::fs::read(&arquivo).unwrap(), b"{corrompido");
        }
        std::fs::write(&arquivo, br#"{"versao":1,"itens":[]}"#).unwrap();
        assert_eq!(r.listar().unwrap()[0].download_id, "a");
        assert_eq!(Repositorio::novo(arquivo).listar().unwrap().len(), 1);
    }
    #[test]
    fn erro_de_disco_nao_some_ate_gravacao_bem_sucedida() {
        let d = tempfile::tempdir().unwrap();
        let pai = d.path().join("bloqueio");
        std::fs::write(&pai, b"arquivo").unwrap();
        let r = Repositorio::novo(pai.join("historico.json"));
        assert!(r.registrar(item(d.path(), "a", 1)).is_err());
        assert!(r.listar().is_err());
        std::fs::remove_file(&pai).unwrap();
        std::fs::create_dir(&pai).unwrap();
        assert_eq!(r.listar().unwrap().len(), 1);
    }
    #[test]
    fn concorrencia_serializa_registros_e_limpeza() {
        let d = tempfile::tempdir().unwrap();
        let r = Arc::new(Repositorio::novo(d.path().join("historico.json")));
        std::thread::scope(|s| {
            for i in 0..20 {
                let r = r.clone();
                let a = item(d.path(), &format!("id{i}"), i);
                s.spawn(move || r.registrar(a).unwrap());
            }
        });
        assert_eq!(r.listar().unwrap().len(), 20);
        std::thread::scope(|s| {
            let r1 = r.clone();
            s.spawn(move || r1.limpar().unwrap());
            let r2 = r.clone();
            let a = item(d.path(), "novo", 100);
            s.spawn(move || r2.registrar(a).unwrap());
        });
        let itens = r.listar().unwrap();
        assert!(itens.len() <= 1);
        if let Some(a) = itens.first() {
            assert_eq!(a.download_id, "novo");
        }
        r.registrar(item(d.path(), "depois", 101)).unwrap();
        assert!(
            r.listar()
                .unwrap()
                .iter()
                .any(|a| a.download_id == "depois")
        );
    }
    #[test]
    fn rejeita_caminhos_nao_video_diretorios_e_symlinks() {
        let d = tempfile::tempdir().unwrap();
        let a = item(d.path(), "a", 1);
        assert!(validar_arquivo(Path::new(&a.caminho)).is_ok());
        let exe = d.path().join("programa.mp4");
        std::fs::write(&exe, b"#!/bin/sh\nexit 0").unwrap();
        assert!(validar_arquivo(&exe).is_err());
        assert!(validar_arquivo(d.path()).is_err());
        assert!(validar_arquivo(Path::new("relativo.mp4")).is_err());
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let link = d.path().join("link.mp4");
            symlink(&a.caminho, &link).unwrap();
            assert!(validar_arquivo(&link).is_err());
            let pai = d.path().join("atalho");
            symlink(d.path(), &pai).unwrap();
            assert!(validar_arquivo(&pai.join("Vídeo [a].mp4")).is_err());
        }
    }
    #[cfg(unix)]
    #[test]
    fn validacao_de_video_nao_mantem_mutex_do_repositorio() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let d = tempfile::tempdir().unwrap();
        let r = Repositorio::novo(d.path().join("historico.json"));
        r.registrar(item(d.path(), "a", 1)).unwrap();
        let observou = AtomicBool::new(false);
        r.listar_com_validacao(|_| {
            assert!(
                r.estado.try_lock().is_ok(),
                "stat/leitura de vídeo não deve manter mutex"
            );
            observou.store(true, Ordering::SeqCst);
            false
        })
        .unwrap();
        assert!(observou.load(Ordering::SeqCst));
    }
    #[test]
    fn json_manipulado_rejeita_id_duplicado_nome_e_plataforma_incoerentes() {
        let d = tempfile::tempdir().unwrap();
        let arquivo = d.path().join("historico.json");
        for tipo in 0..4 {
            let mut a = item(d.path(), "a", 1);
            if tipo == 0 {
                a.download_id = "../fora".into();
            }
            if tipo == 1 {
                a.nome_arquivo = "outro.mp4".into();
            }
            if tipo == 2 {
                a.plataforma = Plataforma::Tiktok;
            }
            let itens = if tipo == 3 {
                vec![a.clone(), a]
            } else {
                vec![a]
            };
            std::fs::write(
                &arquivo,
                serde_json::to_vec(&serde_json::json!({"versao":1,"itens":itens})).unwrap(),
            )
            .unwrap();
            assert!(
                Repositorio::novo(arquivo.clone()).listar().is_err(),
                "tipo {tipo}"
            );
        }
    }
}
