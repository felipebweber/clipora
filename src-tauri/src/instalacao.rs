use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
};

#[derive(Serialize, Deserialize, PartialEq, Eq)]
struct Manifesto {
    versao: String,
    executavel: String,
    #[serde(default)]
    asset: String,
    #[serde(default, rename = "sha256Zip")]
    sha256_zip: String,
    arquivos: BTreeMap<String, String>,
}
fn versao_valida(s: &str) -> bool {
    let p: Vec<_> = s.split('.').collect();
    (p.len() == 3 || p.len() == 4)
        && p[0].len() == 4
        && p[1].len() == 2
        && p[2].len() == 2
        && p.iter()
            .all(|x| !x.is_empty() && x.bytes().all(|c| c.is_ascii_digit()))
        && s.len() <= 64
}
fn caminho_seguro(s: &str) -> bool {
    !s.is_empty()
        && !s
            .split('/')
            .any(|parte| parte.is_empty() || parte == "." || parte == "..")
        && !s.contains('\\')
        && !s.contains(':')
        && Path::new(s)
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
}
fn hash_arquivo(path: &Path) -> std::io::Result<String> {
    let mut arquivo = fs::File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = arquivo.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(format!("{:x}", h.finalize()))
}
fn validar_arvore(dir: &Path, pasta: &Path, mapa: &BTreeMap<String, String>) -> Option<()> {
    for entrada in fs::read_dir(pasta).ok()? {
        let entrada = entrada.ok()?;
        let ty = entrada.file_type().ok()?;
        if ty.is_symlink() {
            return None;
        }
        if ty.is_dir() {
            validar_arvore(dir, &entrada.path(), mapa)?;
        } else if ty.is_file() {
            let path = entrada.path();
            let rel = path
                .strip_prefix(dir)
                .ok()?
                .to_str()?
                .replace(std::path::MAIN_SEPARATOR, "/");
            if rel == "clipora-yt-dlp.json" {
                continue;
            }
            let hash = mapa.get(&rel)?; // rejeita qualquer arquivo extra
            if !hash_arquivo(&path).ok()?.eq_ignore_ascii_case(hash) {
                return None;
            }
        } else {
            return None;
        }
    }
    Some(())
}
fn validar_instalacao(raiz: &Path, versao: &str) -> Option<PathBuf> {
    if !versao_valida(versao) {
        return None;
    }
    let dir = raiz.join(versao);
    if fs::symlink_metadata(&dir).ok()?.file_type().is_symlink() {
        return None;
    }
    let manifesto_path = dir.join("clipora-yt-dlp.json");
    if !fs::symlink_metadata(&manifesto_path)
        .ok()?
        .file_type()
        .is_file()
    {
        return None;
    }
    let manifesto: Manifesto = serde_json::from_slice(&fs::read(manifesto_path).ok()?).ok()?;
    let esperado = if cfg!(windows) {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    };
    if manifesto.versao != versao
        || manifesto.executavel != esperado
        || !manifesto.arquivos.contains_key(esperado)
    {
        return None;
    }
    validar_arvore(&dir, &dir, &manifesto.arquivos)?;
    for (rel, hash) in &manifesto.arquivos {
        if !caminho_seguro(rel) || hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return None;
        }
        let arq = dir.join(rel);
        if !fs::symlink_metadata(&arq).ok()?.file_type().is_file()
            || !hash_arquivo(&arq).ok()?.eq_ignore_ascii_case(hash)
        {
            return None;
        }
    }
    let executavel = dir.join(esperado);
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        let path = std::ffi::CString::new(executavel.as_os_str().as_bytes()).ok()?;
        // SAFETY: o ponteiro é uma string C válida durante a chamada.
        if unsafe { libc::access(path.as_ptr(), libc::X_OK) } != 0 {
            return None;
        }
    }
    Some(executavel)
}
pub fn resolver_atual(raiz: &Path) -> Option<PathBuf> {
    let ponteiro = fs::read_to_string(raiz.join("atual")).ok()?;
    let versao = ponteiro.strip_suffix('\n').unwrap_or(&ponteiro);
    validar_instalacao(raiz, versao)
}
fn extrair(
    zip_bytes: &[u8],
    destino: &Path,
    executavel_original: &str,
    versao: &str,
    asset: &str,
) -> anyhow::Result<()> {
    use anyhow::{Context, bail};
    use std::io::Write;
    let inicio = zip_bytes.len().saturating_sub(65557);
    let fim = zip_bytes[inicio..]
        .windows(4)
        .rposition(|p| p == b"PK\x05\x06")
        .map(|p| p + inicio)
        .context("fim do ZIP ausente")?;
    if zip_bytes.len() < fim + 22 {
        bail!("fim do ZIP truncado");
    }
    let total = u16::from_le_bytes([zip_bytes[fim + 10], zip_bytes[fim + 11]]);
    let tamanho = u32::from_le_bytes(zip_bytes[fim + 12..fim + 16].try_into()?);
    let offset = u32::from_le_bytes(zip_bytes[fim + 16..fim + 20].try_into()?);
    if total == u16::MAX || tamanho == u32::MAX || offset == u32::MAX {
        bail!("ZIP64 não suportado");
    }
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(zip_bytes))?;
    if zip.len() > 10000 {
        bail!("zip tem entradas demais");
    }
    let mut arquivos = BTreeMap::new();
    let mut total = 0u64;
    for i in 0..zip.len() {
        let mut item = zip.by_index(i)?;
        let nome = item.name().to_string();
        if item.encrypted()
            || item.is_symlink()
            || !caminho_seguro(nome.trim_end_matches('/'))
            || item.enclosed_name().is_none()
        {
            bail!("entrada zip insegura: {nome}");
        }
        if nome == "clipora-yt-dlp.json" {
            bail!("manifesto pré-existente");
        }
        // Campos extras têm cabeçalho little-endian (ID, comprimento).
        if let Some(mut extra) = item.extra_data() {
            while !extra.is_empty() {
                if extra.len() < 4 {
                    bail!("campo extra inválido");
                }
                let id = u16::from_le_bytes([extra[0], extra[1]]);
                let len = u16::from_le_bytes([extra[2], extra[3]]) as usize;
                if id == 1 {
                    bail!("ZIP64 não suportado");
                }
                if extra.len() < 4 + len {
                    bail!("campo extra truncado");
                }
                extra = &extra[4 + len..];
            }
        }
        let alvo = destino.join(&nome);
        if item.is_dir() {
            fs::create_dir_all(alvo)?;
            continue;
        }
        total = total.checked_add(item.size()).context("tamanho excedido")?;
        if total > 1024 * 1024 * 1024 {
            bail!("zip expandido excede limite");
        }
        if let Some(pai) = alvo.parent() {
            fs::create_dir_all(pai)?;
        }
        let mut arquivo = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&alvo)?;
        std::io::copy(&mut item, &mut arquivo)?;
        arquivo.sync_all()?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let modo = item.unix_mode().unwrap_or(0);
            fs::set_permissions(
                &alvo,
                fs::Permissions::from_mode(if modo & 0o111 != 0 { 0o755 } else { 0o644 }),
            )?;
        }
        arquivos.insert(nome, hash_arquivo(&alvo)?);
    }
    let fixo = if cfg!(windows) {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    };
    let hash = arquivos
        .remove(executavel_original)
        .context("executável ausente")?;
    if executavel_original != fixo {
        fs::rename(destino.join(executavel_original), destino.join(fixo))?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(destino.join(fixo), fs::Permissions::from_mode(0o755))?;
    }
    arquivos.insert(fixo.into(), hash);
    let manifesto = Manifesto {
        versao: versao.into(),
        executavel: fixo.into(),
        asset: asset.into(),
        sha256_zip: format!("{:x}", Sha256::digest(zip_bytes)),
        arquivos,
    };
    let mut arquivo = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destino.join("clipora-yt-dlp.json"))?;
    serde_json::to_writer(&mut arquivo, &manifesto)?;
    arquivo.flush()?;
    arquivo.sync_all()?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore = "download real da release oficial para diretório temporário"]
    async fn atualizacao_real_github_temporaria() {
        let cliente = reqwest::Client::builder()
            .user_agent("Clipora")
            .build()
            .unwrap();
        let release: serde_json::Value = cliente
            .get("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest")
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .bytes()
            .await
            .map(|b| serde_json::from_slice(&b).unwrap())
            .unwrap();
        let versao = release["tag_name"].as_str().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let canal = tauri::ipc::Channel::new(|_| Ok(()));
        let resultado = atualizar(dir.path(), versao, &canal)
            .await
            .expect("atualização real falhou");
        assert_eq!(resultado.versao_instalada, versao);
        let exe = resolver_atual(dir.path()).expect("manifesto atualizado inválido");
        println!(
            "Atualização real: versão={} executável={}",
            versao,
            exe.display()
        );
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn atualizacao_local_assinada_e_falhas() {
        use sequoia_openpgp::{
            cert::CertBuilder,
            policy::StandardPolicy,
            serialize::{
                Serialize as _,
                stream::{Message, Signer},
            },
        };
        use std::io::{Read, Write};
        let (cert, _) = CertBuilder::general_purpose(Some("Clipora Test <test@example.invalid>"))
            .generate()
            .unwrap();
        let politica = StandardPolicy::new();
        let key = cert
            .keys()
            .secret()
            .with_policy(&politica, None)
            .supported()
            .alive()
            .revoked(false)
            .for_signing()
            .next()
            .unwrap()
            .key()
            .clone()
            .into_keypair()
            .unwrap();
        let mut pubkey = Vec::new();
        cert.armored().serialize(&mut pubkey).unwrap();
        let chave = String::from_utf8(pubkey).unwrap();
        let fingerprint = cert.fingerprint().to_hex();
        let mut zip_writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        zip_writer
            .start_file(
                "fixture",
                zip::write::SimpleFileOptions::default().unix_permissions(0o755),
            )
            .unwrap();
        zip_writer
            .write_all(b"#!/usr/bin/env node\nconsole.log('2026.10.26')\n")
            .unwrap();
        let zip = zip_writer.finish().unwrap().into_inner();
        let somas = format!("{:x}  asset.zip\n", Sha256::digest(&zip)).into_bytes();
        let mut assinatura = Vec::new();
        {
            let msg = Message::new(&mut assinatura);
            let mut sign = Signer::new(msg, key).unwrap().detached().build().unwrap();
            sign.write_all(&somas).unwrap();
            sign.finalize().unwrap();
        }
        let mut zip_writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        zip_writer
            .start_file(
                "fixture",
                zip::write::SimpleFileOptions::default().unix_permissions(0o755),
            )
            .unwrap();
        zip_writer.write_all(b"executavel invalido").unwrap();
        let zip_invalido = zip_writer.finish().unwrap().into_inner();
        let somas_invalido =
            format!("{:x}  asset.zip\n", Sha256::digest(&zip_invalido)).into_bytes();
        let key = cert
            .keys()
            .secret()
            .with_policy(&politica, None)
            .supported()
            .alive()
            .revoked(false)
            .for_signing()
            .next()
            .unwrap()
            .key()
            .clone()
            .into_keypair()
            .unwrap();
        let mut assinatura_invalido = Vec::new();
        {
            let msg = Message::new(&mut assinatura_invalido);
            let mut sign = Signer::new(msg, key).unwrap().detached().build().unwrap();
            sign.write_all(&somas_invalido).unwrap();
            sign.finalize().unwrap();
        }
        for caso in ["sucesso", "hash", "assinatura", "versao", "binario"] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            listener.set_nonblocking(true).unwrap();
            let addr = listener.local_addr().unwrap();
            let (zip, somas, assinatura) = if caso == "binario" {
                (
                    zip_invalido.clone(),
                    somas_invalido.clone(),
                    assinatura_invalido.clone(),
                )
            } else {
                (zip.clone(), somas.clone(), assinatura.clone())
            };
            let nome = caso.to_string();
            std::thread::spawn(move || {
                let inicio = std::time::Instant::now();
                let mut atendidos = 0;
                while atendidos < 4 && inicio.elapsed() < std::time::Duration::from_secs(5) {
                    match listener.accept() {
                        Ok((mut stream, _)) => {
                            stream.set_nonblocking(false).unwrap();
                            atendidos += 1;
                            let mut buf = [0u8; 4096];
                            let n = stream.read(&mut buf).unwrap();
                            let req = String::from_utf8_lossy(&buf[..n]);
                            let path = req.split_whitespace().nth(1).unwrap_or("");
                            let body = if path == "/latest" {
                                if nome == "versao" {
                                    b"{\"tag_name\":\"2026.11.01\"}".to_vec()
                                } else {
                                    b"{\"tag_name\":\"2026.10.26\"}".to_vec()
                                }
                            } else if path.ends_with("SHA2-256SUMS.sig") {
                                if nome == "assinatura" {
                                    b"assinatura invalida".to_vec()
                                } else {
                                    assinatura.clone()
                                }
                            } else if path.ends_with("SHA2-256SUMS") {
                                somas.clone()
                            } else if nome == "hash" {
                                b"arquivo alterado".to_vec()
                            } else {
                                zip.clone()
                            };
                            write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).unwrap();
                            stream.write_all(&body).unwrap();
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                            std::thread::sleep(std::time::Duration::from_millis(5))
                        }
                        Err(_) => break,
                    }
                }
            });
            let api = format!("http://{addr}/latest");
            let base = format!("http://{addr}/download");
            let fontes = Fontes {
                api: &api,
                base: &base,
                chave: &chave,
                fingerprint: &fingerprint,
                asset: "asset.zip",
                exe: "fixture",
            };
            let dir = tempfile::tempdir().unwrap();
            let canal = tauri::ipc::Channel::new(|_| Ok(()));
            let result = atualizar_com(dir.path(), "2026.10.26", &canal, &fontes).await;
            match caso {
                "sucesso" => {
                    result.expect("atualização local");
                    assert!(resolver_atual(dir.path()).is_some());
                }
                "versao" | "binario" => {
                    assert_eq!(result.err().unwrap().codigo, "ATUALIZACAO_FALHOU")
                }
                _ => assert_eq!(
                    result.err().unwrap().codigo,
                    "ATUALIZACAO_INTEGRIDADE",
                    "{caso}"
                ),
            }
        }
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        drop(listener);
        let api = format!("http://{addr}/latest");
        let base = format!("http://{addr}/download");
        let fontes = Fontes {
            api: &api,
            base: &base,
            chave: &chave,
            fingerprint: &fingerprint,
            asset: "asset.zip",
            exe: "fixture",
        };
        let dir = tempfile::tempdir().unwrap();
        let canal = tauri::ipc::Channel::new(|_| Ok(()));
        assert_eq!(
            atualizar_com(dir.path(), "2026.10.26", &canal, &fontes)
                .await
                .err()
                .unwrap()
                .codigo,
            "ATUALIZACAO_FALHOU"
        );
        assert!(!dir.path().join("atual").exists());
    }
    #[test]
    fn falha_na_troca_preserva_versao_apos_reinicio() {
        let raiz = tempfile::tempdir().unwrap();
        fn preparar(dir: &Path, versao: &str) {
            fs::create_dir_all(dir).unwrap();
            fs::write(dir.join("yt-dlp"), b"abc").unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(dir.join("yt-dlp"), fs::Permissions::from_mode(0o755)).unwrap();
            }
            let m = Manifesto {
                versao: versao.into(),
                executavel: "yt-dlp".into(),
                asset: String::new(),
                sha256_zip: String::new(),
                arquivos: BTreeMap::from([(
                    "yt-dlp".into(),
                    format!("{:x}", Sha256::digest(b"abc")),
                )]),
            };
            fs::write(
                dir.join("clipora-yt-dlp.json"),
                serde_json::to_vec(&m).unwrap(),
            )
            .unwrap();
        }
        preparar(&raiz.path().join("2026.10.25"), "2026.10.25");
        gravar_ponteiro(raiz.path(), "atual", "2026.10.25").unwrap();
        let novo = raiz.path().join(".tmp-novo");
        preparar(&novo, "2026.10.26");
        let result = ativar(raiz.path(), &novo, "2026.10.26", || {
            gravar_ponteiro(raiz.path(), "atual", "2026.10.26")?;
            Err(anyhow::anyhow!("falha simulada após troca"))
        });
        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(raiz.path().join("atual"))
                .unwrap()
                .trim(),
            "2026.10.25"
        );
        assert_eq!(
            resolver_atual(raiz.path()).unwrap(),
            raiz.path().join("2026.10.25/yt-dlp")
        );
    }
    #[test]
    fn extracao_recusa_traversal_e_cria_manifesto() {
        use std::io::Write;
        fn zip(nome: &str) -> Vec<u8> {
            let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
            writer
                .start_file(nome, zip::write::SimpleFileOptions::default())
                .unwrap();
            writer.write_all(b"abc").unwrap();
            writer.finish().unwrap().into_inner()
        }
        let dir = tempfile::tempdir().unwrap();
        assert!(
            extrair(
                &zip("../fora"),
                dir.path(),
                "yt-dlp_macos",
                "2026.10.26",
                "fixture.zip"
            )
            .is_err()
        );
        let bom = tempfile::tempdir().unwrap();
        extrair(
            &zip("yt-dlp_macos"),
            bom.path(),
            "yt-dlp_macos",
            "2026.10.26",
            "fixture.zip",
        )
        .unwrap();
        assert!(bom.path().join("yt-dlp").is_file());
        assert!(bom.path().join("clipora-yt-dlp.json").is_file());
    }
    #[test]
    fn rejeita_ponteiro_e_manifesto_adulterado() {
        let dir = tempfile::tempdir().unwrap();
        assert!(versao_valida("2026.10.26"));
        assert!(versao_valida("2026.10.26.1"));
        assert!(!versao_valida("../2026.10.26"));
        std::fs::write(dir.path().join("atual"), "../teste").unwrap();
        assert!(resolver_atual(dir.path()).is_none());
        let pasta = dir.path().join("2026.10.26");
        std::fs::create_dir(&pasta).unwrap();
        std::fs::write(pasta.join("yt-dlp"), b"abc").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(pasta.join("yt-dlp"), fs::Permissions::from_mode(0o755)).unwrap();
        }
        std::fs::write(pasta.join("clipora-yt-dlp.json"), r#"{"versao":"2026.10.26","executavel":"yt-dlp","arquivos":{"yt-dlp":"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"}}"#).unwrap();
        std::fs::write(dir.path().join("atual"), "2026.10.26\n").unwrap();
        assert!(resolver_atual(dir.path()).is_some());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(pasta.join("yt-dlp"), fs::Permissions::from_mode(0o644)).unwrap();
            assert!(resolver_atual(dir.path()).is_none());
            fs::set_permissions(pasta.join("yt-dlp"), fs::Permissions::from_mode(0o755)).unwrap();
        }
        std::fs::write(pasta.join("yt-dlp"), b"adulterado").unwrap();
        assert!(resolver_atual(dir.path()).is_none());
    }
}

#[derive(Serialize, Clone)]
#[serde(tag = "tipo", rename_all = "snake_case")]
pub enum EventoAtualizacao {
    Progresso {
        etapa: String,
        percentual: Option<f64>,
    },
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultadoAtualizacao {
    pub versao_instalada: String,
}

fn asset_plataforma() -> Option<(&'static str, &'static str)> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", _) => Some(("yt-dlp_macos.zip", "yt-dlp_macos")),
        ("windows", "x86_64") => Some(("yt-dlp_win.zip", "yt-dlp.exe")),
        ("windows", "aarch64") => Some(("yt-dlp_win_arm64.zip", "yt-dlp_arm64.exe")),
        ("linux", "x86_64") => Some(("yt-dlp_linux.zip", "yt-dlp_linux")),
        ("linux", "aarch64") => Some(("yt-dlp_linux_aarch64.zip", "yt-dlp_linux_aarch64")),
        _ => None,
    }
}
async fn baixar(cliente: &reqwest::Client, url: &str, limite: usize) -> anyhow::Result<Vec<u8>> {
    use futures_util::StreamExt;
    let resposta = cliente.get(url).send().await?.error_for_status()?;
    if resposta.content_length().is_some_and(|n| n > limite as u64) {
        anyhow::bail!("arquivo excede limite");
    }
    let mut fluxo = resposta.bytes_stream();
    let mut dados = Vec::new();
    while let Some(chunk) = fluxo.next().await {
        let chunk = chunk?;
        if dados.len() + chunk.len() > limite {
            anyhow::bail!("arquivo excede limite");
        }
        dados.extend_from_slice(&chunk);
    }
    Ok(dados)
}
fn gravar_ponteiro(raiz: &Path, nome: &str, valor: &str) -> anyhow::Result<()> {
    use std::io::Write;
    let mut temp = tempfile::NamedTempFile::new_in(raiz)?;
    writeln!(temp, "{valor}")?;
    temp.flush()?;
    temp.as_file().sync_all()?;
    temp.persist(raiz.join(nome))?;
    #[cfg(unix)]
    fs::File::open(raiz)?.sync_all()?;
    Ok(())
}
pub fn coleta(raiz: &Path) {
    let atual = fs::read_to_string(raiz.join("atual")).unwrap_or_default();
    let anterior = fs::read_to_string(raiz.join("anterior")).unwrap_or_default();
    if let Ok(entradas) = fs::read_dir(raiz) {
        for entrada in entradas.flatten() {
            let nome = entrada.file_name().to_string_lossy().into_owned();
            if !entrada
                .file_type()
                .is_ok_and(|t| t.is_dir() && !t.is_symlink())
            {
                continue;
            }
            let temporario_antigo = nome.starts_with(".tmp-")
                && entrada
                    .metadata()
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.elapsed().ok())
                    .is_some_and(|idade| idade >= std::time::Duration::from_secs(24 * 60 * 60));
            if temporario_antigo
                || (versao_valida(&nome) && nome != atual.trim() && nome != anterior.trim())
            {
                let _ = fs::remove_dir_all(entrada.path());
            }
        }
    }
}
fn ativar<F: FnOnce() -> anyhow::Result<()>>(
    raiz: &Path,
    temporario: &Path,
    esperada: &str,
    trocar: F,
) -> anyhow::Result<()> {
    use anyhow::{Context, bail};
    let versao_dir = raiz.join(esperada);
    if versao_dir.exists() {
        let anterior: Manifesto =
            serde_json::from_slice(&fs::read(versao_dir.join("clipora-yt-dlp.json"))?)?;
        let novo: Manifesto =
            serde_json::from_slice(&fs::read(temporario.join("clipora-yt-dlp.json"))?)?;
        if validar_instalacao(raiz, esperada).is_none() || anterior != novo {
            bail!("versão existente difere do asset verificado");
        }
    } else {
        fs::rename(temporario, &versao_dir).context("mover versão")?;
    }
    let original = fs::read_to_string(raiz.join("atual")).ok();
    if let Some(atual) = original.as_deref() {
        let atual = atual.trim();
        if atual != esperada && versao_valida(atual) && validar_instalacao(raiz, atual).is_some() {
            gravar_ponteiro(raiz, "anterior", atual)?;
        }
    }
    if let Err(erro) = trocar() {
        let rollback = match original {
            Some(ref atual) => gravar_ponteiro(raiz, "atual", atual.trim_end_matches('\n')),
            None => match fs::remove_file(raiz.join("atual")) {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(e) => Err(e.into()),
            },
        };
        return match rollback {
            Ok(()) => Err(erro),
            Err(e) => Err(erro.context(format!("rollback do ponteiro falhou: {e}"))),
        };
    }
    Ok(())
}
pub async fn atualizar(
    raiz: &Path,
    esperada: &str,
    canal: &tauri::ipc::Channel<EventoAtualizacao>,
) -> Result<ResultadoAtualizacao, crate::previa::ErroClipora> {
    let (asset, exe) = asset_plataforma()
        .ok_or_else(|| crate::previa::ErroClipora::novo("ATUALIZACAO_NAO_SUPORTADA", None))?;
    let fontes = Fontes {
        api: "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest",
        base: "https://github.com/yt-dlp/yt-dlp/releases/download",
        chave: crate::integridade::CHAVE,
        fingerprint: crate::integridade::FINGERPRINT,
        asset,
        exe,
    };
    atualizar_com(raiz, esperada, canal, &fontes).await
}
struct Fontes<'a> {
    api: &'a str,
    base: &'a str,
    chave: &'a str,
    fingerprint: &'a str,
    asset: &'a str,
    exe: &'a str,
}
async fn atualizar_com(
    raiz: &Path,
    esperada: &str,
    canal: &tauri::ipc::Channel<EventoAtualizacao>,
    fontes: &Fontes<'_>,
) -> Result<ResultadoAtualizacao, crate::previa::ErroClipora> {
    let falha =
        |codigo: &str, detalhe: String| crate::previa::ErroClipora::novo(codigo, Some(detalhe));
    if !versao_valida(esperada) {
        return Err(falha("ATUALIZACAO_FALHOU", "versão inválida".into()));
    }
    let asset = fontes.asset;
    let exe_original = fontes.exe;
    let enviar = |etapa: &str, percentual| {
        let _ = canal.send(EventoAtualizacao::Progresso {
            etapa: etapa.into(),
            percentual,
        });
    };
    let cliente = reqwest::Client::builder()
        .user_agent("Clipora")
        .timeout(std::time::Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::custom(|a| {
            if a.url().scheme() == "https" && a.previous().len() < 5 {
                a.follow()
            } else {
                a.stop()
            }
        }))
        .build()
        .map_err(|e| falha("ATUALIZACAO_FALHOU", e.to_string()))?;
    enviar("verificando", None);
    let api = baixar(&cliente, fontes.api, 1024 * 1024)
        .await
        .map_err(|e| falha("ATUALIZACAO_FALHOU", e.to_string()))?;
    let api: serde_json::Value =
        serde_json::from_slice(&api).map_err(|e| falha("ATUALIZACAO_FALHOU", e.to_string()))?;
    if api.get("tag_name").and_then(|v| v.as_str()) != Some(esperada) {
        return Err(falha("ATUALIZACAO_FALHOU", "versão publicada mudou".into()));
    }
    fs::create_dir_all(raiz).map_err(|e| falha("ATUALIZACAO_FALHOU", e.to_string()))?;
    let disponivel =
        fs2::available_space(raiz).map_err(|e| falha("ATUALIZACAO_FALHOU", e.to_string()))?;
    if disponivel < 400 * 1024 * 1024 {
        return Err(falha(
            "ESPACO_INSUFICIENTE",
            "são necessários ao menos 400 MiB livres".into(),
        ));
    }
    let temp = tempfile::Builder::new()
        .prefix(".tmp-")
        .tempdir_in(raiz)
        .map_err(|e| falha("ATUALIZACAO_FALHOU", e.to_string()))?;
    let base = format!("{}/{esperada}", fontes.base);
    enviar("baixando", None);
    let somas = baixar(&cliente, &format!("{base}/SHA2-256SUMS"), 4 * 1024 * 1024)
        .await
        .map_err(|e| falha("ATUALIZACAO_FALHOU", e.to_string()))?;
    let assinatura = baixar(&cliente, &format!("{base}/SHA2-256SUMS.sig"), 1024 * 1024)
        .await
        .map_err(|e| falha("ATUALIZACAO_FALHOU", e.to_string()))?;
    let zip = baixar(&cliente, &format!("{base}/{asset}"), 512 * 1024 * 1024)
        .await
        .map_err(|e| falha("ATUALIZACAO_FALHOU", e.to_string()))?;
    enviar("verificando_integridade", None);
    crate::integridade::verificar_assinatura(&somas, &assinatura, fontes.chave, fontes.fingerprint)
        .and_then(|_| crate::integridade::verificar_hash(&zip, &somas, asset))
        .map_err(|e| falha("ATUALIZACAO_INTEGRIDADE", e.to_string()))?;
    enviar("instalando", None);
    extrair(&zip, temp.path(), exe_original, esperada, asset)
        .map_err(|e| falha("ATUALIZACAO_INTEGRIDADE", e.to_string()))?;
    let exe = temp.path().join(if cfg!(windows) {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    });
    let mut cmd = tokio::process::Command::new(exe);
    cmd.args(["--ignore-config", "--no-update", "--version"])
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    let output = tokio::time::timeout(std::time::Duration::from_secs(60), cmd.output())
        .await
        .map_err(|e| falha("ATUALIZACAO_FALHOU", e.to_string()))?
        .map_err(|e| falha("ATUALIZACAO_FALHOU", e.to_string()))?;
    if !output.status.success() || String::from_utf8_lossy(&output.stdout).trim() != esperada {
        return Err(falha(
            "ATUALIZACAO_FALHOU",
            "versão do executável divergente ou não executável".into(),
        ));
    }
    let resultado = ativar(raiz, temp.path(), esperada, || {
        gravar_ponteiro(raiz, "atual", esperada)
    });
    resultado.map_err(|e| falha("ATUALIZACAO_FALHOU", e.to_string()))?;
    coleta(raiz);
    enviar("concluido", Some(100.0));
    Ok(ResultadoAtualizacao {
        versao_instalada: esperada.into(),
    })
}
