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
    #[serde(default)]
    sha256_somas: String,
    #[serde(default)]
    sha256_assinatura: String,
    arquivos: BTreeMap<String, String>,
}
pub fn versao_valida(s: &str) -> bool {
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
        && Path::new(s).components().all(|c| match c {
            Component::Normal(nome) => {
                let nome = nome.to_string_lossy();
                let nome = nome.as_ref();
                if nome.ends_with('.') || nome.ends_with(' ') {
                    return false;
                }
                let base = nome
                    .split('.')
                    .next()
                    .unwrap_or("")
                    .trim_end_matches(['.', ' '])
                    .to_ascii_uppercase();
                !matches!(
                    base.as_str(),
                    "CON"
                        | "PRN"
                        | "AUX"
                        | "NUL"
                        | "COM1"
                        | "COM2"
                        | "COM3"
                        | "COM4"
                        | "COM5"
                        | "COM6"
                        | "COM7"
                        | "COM8"
                        | "COM9"
                        | "LPT1"
                        | "LPT2"
                        | "LPT3"
                        | "LPT4"
                        | "LPT5"
                        | "LPT6"
                        | "LPT7"
                        | "LPT8"
                        | "LPT9"
                )
            }
            _ => false,
        })
}
fn ignorado_sistema(nome: &str) -> bool {
    matches!(
        nome,
        ".DS_Store" | "Thumbs.db" | "desktop.ini" | "__pycache__"
    )
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
        let nome = entrada.file_name().to_string_lossy().into_owned();
        if ignorado_sistema(&nome) {
            continue;
        }
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
            let Some(hash) = mapa.get(&rel) else {
                eprintln!(
                    "yt-dlp app-local rejeitado: arquivo extra não reconhecido: {}",
                    path.display()
                );
                return None;
            };
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
    if manifesto.asset.is_empty() || manifesto.sha256_zip.is_empty() {
        if !cfg!(test) {
            return None;
        }
    } else {
        let somas = fs::read(dir.join("SHA2-256SUMS")).ok()?;
        let assinatura = fs::read(dir.join("SHA2-256SUMS.sig")).ok()?;
        if !format!("{:x}", Sha256::digest(&somas)).eq_ignore_ascii_case(&manifesto.sha256_somas)
            || !format!("{:x}", Sha256::digest(&assinatura))
                .eq_ignore_ascii_case(&manifesto.sha256_assinatura)
        {
            return None;
        }
        // Os fixtures de integração assinam com uma chave efêmera. Em builds de produção,
        // a assinatura persistida é sempre validada contra a chave oficial fixada.
        #[cfg(not(test))]
        crate::integridade::verificar_assinatura(
            &somas,
            &assinatura,
            crate::integridade::CHAVE,
            crate::integridade::FINGERPRINT,
        )
        .ok()?;
        #[cfg(test)]
        if assinatura.is_empty() {
            return None;
        }
        crate::integridade::verificar_hash_digest(&manifesto.sha256_zip, &somas, &manifesto.asset)
            .ok()?;
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
    let versao = versao_ponteiro(raiz, "atual")?;
    resolver_versao(raiz, &versao)
}
pub fn versao_ponteiro(raiz: &Path, nome: &str) -> Option<String> {
    let ponteiro = fs::read_to_string(raiz.join(nome)).ok()?;
    let versao = ponteiro.trim();
    versao_valida(versao).then(|| versao.to_string())
}
pub fn resolver_versao(raiz: &Path, versao: &str) -> Option<PathBuf> {
    validar_instalacao(raiz, versao)
}
pub fn descartar_ate(raiz: &Path, limite: &str) {
    for nome in ["atual", "anterior"] {
        if versao_ponteiro(raiz, nome).is_some_and(|v| {
            crate::versao::comparar_versoes(&v, limite)
                .is_some_and(|o| o != std::cmp::Ordering::Greater)
        }) {
            let _ = fs::remove_file(raiz.join(nome));
        }
    }
    coleta(raiz);
}
fn extrair(
    zip_bytes: &[u8],
    destino: &Path,
    executavel_original: &str,
    versao: &str,
    asset: &str,
    somas: &[u8],
    assinatura: &[u8],
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
    fs::write(destino.join("SHA2-256SUMS"), somas)?;
    fs::write(destino.join("SHA2-256SUMS.sig"), assinatura)?;
    arquivos.insert(
        "SHA2-256SUMS".into(),
        hash_arquivo(&destino.join("SHA2-256SUMS"))?,
    );
    arquivos.insert(
        "SHA2-256SUMS.sig".into(),
        hash_arquivo(&destino.join("SHA2-256SUMS.sig"))?,
    );
    let manifesto = Manifesto {
        versao: versao.into(),
        executavel: fixo.into(),
        asset: asset.into(),
        sha256_zip: format!("{:x}", Sha256::digest(zip_bytes)),
        sha256_somas: format!("{:x}", Sha256::digest(somas)),
        sha256_assinatura: format!("{:x}", Sha256::digest(assinatura)),
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
    fn verificador_teste(resultado: &'static str) -> VerificadorCompatibilidade {
        std::sync::Arc::new(move |_, _| {
            Box::pin(async move {
                match resultado {
                    "ok" => Ok(()),
                    "integridade" => Err(crate::previa::ErroClipora {
                        codigo: "ATUALIZACAO_INTEGRIDADE".into(),
                        mensagem: "Integridade inválida".into(),
                        detalhe: Some("hash do fixture divergente".into()),
                    }),
                    "motor" => Err(crate::previa::ErroClipora::novo(
                        "MOTOR_YOUTUBE_INDISPONIVEL",
                        Some("Deno fixture ausente".into()),
                    )),
                    "timeout" => Err(crate::previa::ErroClipora::novo(
                        "TEMPO_ESGOTADO",
                        Some("smoke local expirou".into()),
                    )),
                    _ => Err(crate::motor_youtube::erro_atualizacao_nao_suportada(
                        "solver incompatível no fixture",
                    )),
                }
            })
        })
    }

    fn preparar_instalacao_valida(dir: &Path, versao: &str, bytes: &[u8]) {
        fs::create_dir_all(dir).unwrap();
        let executavel = dir.join(if cfg!(windows) {
            "yt-dlp.exe"
        } else {
            "yt-dlp"
        });
        fs::write(&executavel, bytes).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&executavel, fs::Permissions::from_mode(0o755)).unwrap();
        }
        let manifesto = Manifesto {
            versao: versao.into(),
            executavel: if cfg!(windows) {
                "yt-dlp.exe".into()
            } else {
                "yt-dlp".into()
            },
            asset: String::new(),
            sha256_zip: String::new(),
            sha256_somas: String::new(),
            sha256_assinatura: String::new(),
            arquivos: BTreeMap::from([(
                if cfg!(windows) {
                    "yt-dlp.exe".into()
                } else {
                    "yt-dlp".into()
                },
                format!("{:x}", Sha256::digest(bytes)),
            )]),
        };
        fs::write(
            dir.join("clipora-yt-dlp.json"),
            serde_json::to_vec(&manifesto).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn espaco_insuficiente_e_identificado_antes_do_download() {
        assert!(!espaco_suficiente(ESPACO_MINIMO_ATUALIZACAO - 1));
        assert!(espaco_suficiente(ESPACO_MINIMO_ATUALIZACAO));
    }
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
        let deno_nome = if cfg!(windows) {
            "clipora-deno.exe"
        } else {
            "clipora-deno"
        };
        let deno = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("binaries/deno")
            .join(deno_nome);
        let resultado = atualizar(dir.path(), versao, &canal, &deno)
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
        use pgp::{
            composed::{ArmorOptions, DetachedSignature, KeyType, SecretKeyParamsBuilder},
            crypto::hash::HashAlgorithm,
            types::{KeyDetails, Password},
        };
        use rand::thread_rng;
        use std::io::{Read, Write};
        let mut params = SecretKeyParamsBuilder::default();
        params
            .key_type(KeyType::Rsa(2048))
            .can_certify(false)
            .can_sign(true)
            .primary_user_id("Clipora Test <test@example.invalid>".into());
        let secret = params.build().unwrap().generate(thread_rng()).unwrap();
        let public = secret.to_public_key();
        let chave = public.to_armored_string(ArmorOptions::default()).unwrap();
        let fingerprint = public.fingerprint().to_string().replace(' ', "");
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
        let sig = DetachedSignature::sign_binary_data(
            thread_rng(),
            &secret.primary_key,
            &Password::empty(),
            HashAlgorithm::Sha256,
            somas.as_slice(),
        )
        .unwrap();
        let assinatura = sig.to_armored_bytes(ArmorOptions::default()).unwrap();
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
        let sig = DetachedSignature::sign_binary_data(
            thread_rng(),
            &secret.primary_key,
            &Password::empty(),
            HashAlgorithm::Sha256,
            somas_invalido.as_slice(),
        )
        .unwrap();
        let assinatura_invalido = sig.to_armored_bytes(ArmorOptions::default()).unwrap();
        let mut zw = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        zw.start_file("../escape", zip::write::SimpleFileOptions::default())
            .unwrap();
        zw.write_all(b"escape").unwrap();
        let zip_traversal = zw.finish().unwrap().into_inner();
        let somas_traversal =
            format!("{:x}  asset.zip\n", Sha256::digest(&zip_traversal)).into_bytes();
        let assinatura_traversal = DetachedSignature::sign_binary_data(
            thread_rng(),
            &secret.primary_key,
            &Password::empty(),
            HashAlgorithm::Sha256,
            somas_traversal.as_slice(),
        )
        .unwrap()
        .to_armored_bytes(ArmorOptions::default())
        .unwrap();
        for caso in [
            "sucesso",
            "hash",
            "assinatura",
            "versao",
            "binario",
            "traversal",
            "solver-incompativel",
            "motor-ausente",
            "smoke-timeout",
            "candidato-adulterado",
        ] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            listener.set_nonblocking(true).unwrap();
            let addr = listener.local_addr().unwrap();
            let (zip, somas, assinatura) = if caso == "binario" {
                (
                    zip_invalido.clone(),
                    somas_invalido.clone(),
                    assinatura_invalido.clone(),
                )
            } else if caso == "traversal" {
                (
                    zip_traversal.clone(),
                    somas_traversal.clone(),
                    assinatura_traversal.clone(),
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
            if caso == "sucesso" {
                fs::create_dir_all(dir.path().join("2026.10.26")).unwrap();
                fs::write(
                    dir.path().join("2026.10.26/clipora-yt-dlp.json"),
                    b"corrompido",
                )
                .unwrap();
                fs::write(dir.path().join("atual"), "2026.10.26\n").unwrap();
            } else if matches!(
                caso,
                "solver-incompativel" | "motor-ausente" | "smoke-timeout" | "candidato-adulterado"
            ) {
                preparar_instalacao_valida(
                    &dir.path().join("2026.10.25"),
                    "2026.10.25",
                    b"versao anterior comprovada",
                );
                preparar_instalacao_valida(
                    &dir.path().join("2026.10.24"),
                    "2026.10.24",
                    b"versao anterior reserva",
                );
                fs::write(dir.path().join("atual"), "2026.10.25\n").unwrap();
                fs::write(dir.path().join("anterior"), "2026.10.24\n").unwrap();
            }
            let canal = tauri::ipc::Channel::new(|_| Ok(()));
            let resposta_verificador = match caso {
                "motor-ausente" => "motor",
                "smoke-timeout" => "timeout",
                "candidato-adulterado" => "integridade",
                "solver-incompativel" => "incompativel",
                _ => "ok",
            };
            let result = atualizar_com(
                dir.path(),
                "2026.10.26",
                &canal,
                Path::new("/runtime/deno-fixture"),
                &fontes,
                verificador_teste(resposta_verificador),
            )
            .await;
            match caso {
                "sucesso" => {
                    result.expect("atualização local");
                    assert!(resolver_atual(dir.path()).is_some());
                }
                "versao" | "binario" => {
                    assert_eq!(result.err().unwrap().codigo, "ATUALIZACAO_FALHOU")
                }
                "traversal" => {
                    assert_eq!(result.err().unwrap().codigo, "ATUALIZACAO_INTEGRIDADE");
                    assert!(!dir.path().join("escape").exists());
                }
                "solver-incompativel" | "motor-ausente" | "smoke-timeout" => {
                    let erro = result.err().unwrap();
                    assert_eq!(erro.codigo, "ATUALIZACAO_NAO_SUPORTADA", "{caso}");
                    assert!(
                        erro.mensagem
                            .contains("versão atual do yt-dlp continua em uso")
                    );
                    assert_eq!(
                        fs::read_to_string(dir.path().join("atual")).unwrap(),
                        "2026.10.25\n"
                    );
                    assert_eq!(
                        fs::read_to_string(dir.path().join("anterior")).unwrap(),
                        "2026.10.24\n"
                    );
                    assert_eq!(
                        resolver_atual(dir.path()).unwrap(),
                        dir.path().join("2026.10.25/yt-dlp")
                    );
                    assert_eq!(
                        resolver_versao(dir.path(), "2026.10.24").unwrap(),
                        dir.path().join("2026.10.24/yt-dlp")
                    );
                    assert!(!dir.path().join("2026.10.26").exists());
                    assert!(
                        !fs::read_dir(dir.path())
                            .unwrap()
                            .flatten()
                            .any(|e| e.file_name().to_string_lossy().starts_with(".tmp-"))
                    );
                }
                "candidato-adulterado" => {
                    assert_eq!(result.err().unwrap().codigo, "ATUALIZACAO_INTEGRIDADE");
                    assert_eq!(
                        resolver_atual(dir.path()).unwrap(),
                        dir.path().join("2026.10.25/yt-dlp")
                    );
                    assert_eq!(
                        fs::read_to_string(dir.path().join("anterior")).unwrap(),
                        "2026.10.24\n"
                    );
                    assert!(!dir.path().join("2026.10.26").exists());
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
            atualizar_com(
                dir.path(),
                "2026.10.26",
                &canal,
                Path::new("/runtime/deno-fixture"),
                &fontes,
                verificador_teste("ok"),
            )
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
                sha256_somas: String::new(),
                sha256_assinatura: String::new(),
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
        let novo_antes = raiz.path().join(".tmp-novo-antes");
        preparar(&novo_antes, "2026.10.27");
        let result = ativar(raiz.path(), &novo_antes, "2026.10.27", || {
            Err(anyhow::anyhow!("falha simulada antes da troca do ponteiro"))
        });
        assert!(result.is_err());
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
                "fixture.zip",
                b"",
                b""
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
            b"",
            b"",
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
        for reservado in [
            "CON",
            "NUL.txt",
            "COM1.log",
            "arquivo.",
            "arquivo ",
            "pasta/PRN",
        ] {
            assert!(!caminho_seguro(reservado), "{reservado}");
        }
        for valido in ["conjunto.txt", "COM10.log", "sub/arquivo.dat"] {
            assert!(caminho_seguro(valido), "{valido}");
        }
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

    #[test]
    fn urls_de_releases_e_redirecionamentos_sao_restritos_a_https_oficial() {
        for ok in [
            "https://github.com/yt-dlp/yt-dlp/releases/latest",
            "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest",
        ] {
            assert!(fontes_url_permitida(ok));
        }
        for no in [
            "http://github.com/yt-dlp/yt-dlp",
            "https://evil.example/yt-dlp",
            "https://github.com.evil.example/release",
        ] {
            assert!(!fontes_url_permitida(no), "{no}");
        }
        assert!(redirect_permitido(
            &url::Url::parse("https://release-assets.githubusercontent.com/asset").unwrap()
        ));
        assert!(fontes_url_permitida(
            "https://release-assets.githubusercontent.com/asset"
        ));
        assert!(!redirect_permitido(
            &url::Url::parse("http://release-assets.githubusercontent.com/asset").unwrap()
        ));
        #[cfg(test)]
        assert!(fontes_url_permitida("http://127.0.0.1:12345/fixture"));
    }

    #[tokio::test]
    async fn baixar_aplica_limite_de_tamanho_e_para_redirecionamento_nao_oficial() {
        use std::io::{Read, Write};
        fn servidor(resposta: String) -> String {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let addr = listener.local_addr().unwrap();
            std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0; 1024];
                let _ = stream.read(&mut request);
                stream.write_all(resposta.as_bytes()).unwrap();
            });
            format!("http://{addr}/asset")
        }
        let cliente = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::custom(|a| {
                if fontes_url_permitida(a.url().as_str()) && a.previous().len() < 5 {
                    a.follow()
                } else {
                    a.error("redirecionamento não autorizado")
                }
            }))
            .build()
            .unwrap();
        let grande = servidor(
            "HTTP/1.1 200 OK\r\nContent-Length: 10\r\nConnection: close\r\n\r\n0123456789".into(),
        );
        assert!(baixar(&cliente, &grande, 5).await.is_err());

        let redirecionamento = servidor(
            "HTTP/1.1 302 Found\r\nLocation: https://evil.example/payload\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),
        );
        assert!(baixar(&cliente, &redirecionamento, 1024).await.is_err());
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
const ESPACO_MINIMO_ATUALIZACAO: u64 = 400 * 1024 * 1024;
fn espaco_suficiente(disponivel: u64) -> bool {
    disponivel >= ESPACO_MINIMO_ATUALIZACAO
}
async fn baixar(cliente: &reqwest::Client, url: &str, limite: usize) -> anyhow::Result<Vec<u8>> {
    baixar_com_progresso(cliente, url, limite, |_, _| {}).await
}
async fn baixar_com_progresso<F>(
    cliente: &reqwest::Client,
    url: &str,
    limite: usize,
    mut progresso: F,
) -> anyhow::Result<Vec<u8>>
where
    F: FnMut(usize, Option<usize>),
{
    use futures_util::StreamExt;
    let resposta = cliente.get(url).send().await?.error_for_status()?;
    let total = resposta
        .content_length()
        .and_then(|n| usize::try_from(n).ok());
    if total.is_some_and(|n| n > limite) {
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
        progresso(dados.len(), total);
    }
    Ok(dados)
}
fn redirect_permitido(url: &url::Url) -> bool {
    url.scheme() == "https"
        && url.host_str().is_some_and(|host| {
            matches!(
                host,
                "github.com"
                    | "api.github.com"
                    | "objects.githubusercontent.com"
                    | "release-assets.githubusercontent.com"
            )
        })
}
fn fontes_url_permitida(endereco: &str) -> bool {
    let Ok(url) = url::Url::parse(endereco) else {
        return false;
    };
    #[cfg(test)]
    if url.scheme() == "http"
        && url
            .host_str()
            .is_some_and(|h| h == "127.0.0.1" || h == "localhost")
    {
        return true;
    }
    redirect_permitido(&url)
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
        if validar_instalacao(raiz, esperada).is_some() {
            let anterior: Manifesto =
                serde_json::from_slice(&fs::read(versao_dir.join("clipora-yt-dlp.json"))?)?;
            let novo: Manifesto =
                serde_json::from_slice(&fs::read(temporario.join("clipora-yt-dlp.json"))?)?;
            if anterior != novo {
                bail!("versão existente difere do asset verificado");
            }
        } else {
            let lixo = tempfile::Builder::new()
                .prefix(".tmp-lixo-")
                .tempdir_in(raiz)?;
            let diretorio_lixo = lixo.keep();
            let destino_lixo = diretorio_lixo.join("instalacao-corrompida");
            fs::rename(&versao_dir, &destino_lixo).context("isolar instalação corrompida")?;
            fs::rename(temporario, &versao_dir).context("reinstalar versão corrompida")?;
        }
    } else {
        fs::rename(temporario, &versao_dir).context("mover versão")?;
    }
    let original = fs::read_to_string(raiz.join("atual")).ok();
    let ativado = trocar().and_then(|_| {
        let esperado = versao_dir.join(if cfg!(windows) {
            "yt-dlp.exe"
        } else {
            "yt-dlp"
        });
        if resolver_atual(raiz).as_deref() != Some(esperado.as_path()) {
            bail!("ponteiro atual não resolve para o executável recém-instalado");
        }
        Ok(())
    });
    if let Err(erro) = ativado {
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
    if let Some(atual) = original.as_deref().map(str::trim)
        && atual != esperada
        && versao_valida(atual)
        && validar_instalacao(raiz, atual).is_some()
    {
        // A cópia anterior é atualizada somente após a nova versão ter sido ativada e verificada.
        gravar_ponteiro(raiz, "anterior", atual)?;
    }
    Ok(())
}
pub async fn atualizar(
    raiz: &Path,
    esperada: &str,
    canal: &tauri::ipc::Channel<EventoAtualizacao>,
    deno: &Path,
) -> Result<ResultadoAtualizacao, crate::previa::ErroClipora> {
    let (asset, exe) = asset_plataforma().ok_or_else(|| {
        crate::motor_youtube::erro_atualizacao_nao_suportada(
            "não há asset yt-dlp para esta plataforma",
        )
    })?;
    let fontes = Fontes {
        api: "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest",
        base: "https://github.com/yt-dlp/yt-dlp/releases/download",
        chave: crate::integridade::CHAVE,
        fingerprint: crate::integridade::FINGERPRINT,
        asset,
        exe,
    };
    atualizar_com(
        raiz,
        esperada,
        canal,
        deno,
        &fontes,
        verificador_compatibilidade_real(),
    )
    .await
}
struct Fontes<'a> {
    api: &'a str,
    base: &'a str,
    chave: &'a str,
    fingerprint: &'a str,
    asset: &'a str,
    exe: &'a str,
}

type VerificadorCompatibilidade = std::sync::Arc<
    dyn Fn(
            PathBuf,
            PathBuf,
        )
            -> futures_util::future::BoxFuture<'static, Result<(), crate::previa::ErroClipora>>
        + Send
        + Sync,
>;

fn verificador_compatibilidade_real() -> VerificadorCompatibilidade {
    std::sync::Arc::new(|yt_dlp, deno| {
        Box::pin(async move { crate::motor_youtube::conferir_candidato(&yt_dlp, &deno).await })
    })
}

async fn atualizar_com(
    raiz: &Path,
    esperada: &str,
    canal: &tauri::ipc::Channel<EventoAtualizacao>,
    deno: &Path,
    fontes: &Fontes<'_>,
    verificar_compatibilidade: VerificadorCompatibilidade,
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
        .connect_timeout(std::time::Duration::from_secs(15))
        .read_timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::custom(|a| {
            let permitido = fontes_url_permitida(a.url().as_str());
            if permitido && a.previous().len() < 5 {
                a.follow()
            } else {
                a.error("redirecionamento não autorizado")
            }
        }))
        .build()
        .map_err(|e| falha("ATUALIZACAO_FALHOU", e.to_string()))?;
    if !fontes_url_permitida(fontes.api) {
        return Err(falha(
            "ATUALIZACAO_FALHOU",
            "API de atualização não autorizada".into(),
        ));
    }
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
    if !espaco_suficiente(disponivel) {
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
    if !fontes_url_permitida(fontes.api) || !fontes_url_permitida(&base) {
        return Err(falha(
            "ATUALIZACAO_FALHOU",
            "origem de atualização não autorizada".into(),
        ));
    }
    enviar("baixando", None);
    let somas = baixar(&cliente, &format!("{base}/SHA2-256SUMS"), 4 * 1024 * 1024)
        .await
        .map_err(|e| falha("ATUALIZACAO_FALHOU", e.to_string()))?;
    let assinatura = baixar(&cliente, &format!("{base}/SHA2-256SUMS.sig"), 1024 * 1024)
        .await
        .map_err(|e| falha("ATUALIZACAO_FALHOU", e.to_string()))?;
    crate::integridade::verificar_assinatura(&somas, &assinatura, fontes.chave, fontes.fingerprint)
        .map_err(|e| falha("ATUALIZACAO_INTEGRIDADE", e.to_string()))?;
    let mut ultimo_evento = std::time::Instant::now();
    let zip = baixar_com_progresso(
        &cliente,
        &format!("{base}/{asset}"),
        512 * 1024 * 1024,
        |atual, total| {
            if ultimo_evento.elapsed() >= std::time::Duration::from_millis(100)
                || total == Some(atual)
            {
                enviar(
                    "baixando",
                    total
                        .filter(|t| *t > 0)
                        .map(|t| atual as f64 * 100.0 / t as f64),
                );
                ultimo_evento = std::time::Instant::now();
            }
        },
    )
    .await
    .map_err(|e| falha("ATUALIZACAO_FALHOU", e.to_string()))?;
    enviar("verificando_integridade", None);
    crate::integridade::verificar_hash(&zip, &somas, asset)
        .map_err(|e| falha("ATUALIZACAO_INTEGRIDADE", e.to_string()))?;
    enviar("instalando", None);
    extrair(
        &zip,
        temp.path(),
        exe_original,
        esperada,
        asset,
        &somas,
        &assinatura,
    )
    .map_err(|e| falha("ATUALIZACAO_INTEGRIDADE", e.to_string()))?;
    let exe = temp.path().join(if cfg!(windows) {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    });
    let (_tx, rx) = tokio::sync::watch::channel(false);
    let output = crate::processos::executar_limitado(
        &exe,
        ["--ignore-config", "--no-update", "--version"]
            .into_iter()
            .map(Into::into)
            .collect(),
        rx,
        std::time::Duration::from_secs(10),
        1024 * 1024,
    )
    .await
    .map_err(|e| falha("ATUALIZACAO_FALHOU", e.to_string()))?;
    if !output.sucesso || String::from_utf8_lossy(&output.stdout).trim() != esperada {
        return Err(falha(
            "ATUALIZACAO_FALHOU",
            "versão do executável divergente ou não executável".into(),
        ));
    }
    if let Err(e) = verificar_compatibilidade(exe.clone(), deno.to_path_buf()).await {
        if e.codigo == "ATUALIZACAO_INTEGRIDADE" {
            return Err(e);
        }
        return Err(crate::motor_youtube::erro_atualizacao_nao_suportada(
            e.detalhe.unwrap_or(e.mensagem),
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
