use crate::previa::ErroClipora;
use std::path::Path;
fn versao_cli_compativel(texto: &str) -> bool {
    let mut palavras = texto.split_whitespace();
    if palavras.next() != Some("deno") {
        return false;
    }
    let Some(versao) = palavras.next() else {
        return false;
    };
    if versao == "2.7.0" {
        return true;
    }
    let Some(build) = versao.strip_prefix("2.7.0+") else {
        return false;
    };
    !build.is_empty()
        && build.split('.').all(|ident| {
            !ident.is_empty()
                && ident
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        })
}
fn erro(detalhe: impl ToString) -> ErroClipora {
    ErroClipora{codigo:"MOTOR_YOUTUBE_INDISPONIVEL".into(),mensagem:"O componente necessário para baixar do YouTube está indisponível ou é incompatível. Reinstale ou atualize o Clipora.".into(),detalhe:Some(detalhe.to_string())}
}
fn hash_valido(v: &serde_json::Value) -> bool {
    v.as_str()
        .is_some_and(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()))
}
fn conferir_arquivos(deno: &Path) -> Result<(), ErroClipora> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    if !deno.is_absolute() {
        return Err(erro("Caminho do motor não é absoluto"));
    }
    let meta = std::fs::symlink_metadata(deno).map_err(erro)?;
    if !meta.is_file() || meta.file_type().is_symlink() {
        return Err(erro("Motor não é arquivo regular"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if meta.permissions().mode() & 0o111 == 0 {
            return Err(erro("Motor não executável"));
        }
    }
    let manifesto = deno
        .parent()
        .ok_or_else(|| erro("Diretório ausente"))?
        .join("clipora-deno.json");
    let m = std::fs::symlink_metadata(&manifesto).map_err(erro)?;
    if !m.is_file() || m.len() > 65536 {
        return Err(erro("Manifesto inválido"));
    }
    let m: serde_json::Value =
        serde_json::from_slice(&std::fs::read(manifesto).map_err(erro)?).map_err(erro)?;
    let triple = m["triple"].as_str().ok_or_else(|| erro("Triple ausente"))?;
    let universal = cfg!(target_os = "macos")
        && matches!(
            env!("CLIPORA_TARGET"),
            "aarch64-apple-darwin" | "x86_64-apple-darwin"
        )
        && triple == "universal-apple-darwin";
    if m["formato"] != 1
        || m["versao"] != "2.7.0"
        || (triple != env!("CLIPORA_TARGET") && !universal)
        || !hash_valido(&m["sha256Executavel"])
    {
        return Err(erro("Manifesto incompatível"));
    }
    let origem =
        |t: &str| format!("https://github.com/denoland/deno/releases/download/v2.7.0/deno-{t}.zip");
    if universal {
        let fontes = m["origemZip"]
            .as_array()
            .ok_or_else(|| erro("Origens universais inválidas"))?;
        let hashes = m["sha256Zip"]
            .as_array()
            .ok_or_else(|| erro("Hashes universais inválidos"))?;
        if fontes.len() != 2
            || hashes.len() != 2
            || !hashes.iter().all(hash_valido)
            || !fontes.contains(&serde_json::json!(origem("aarch64-apple-darwin")))
            || !fontes.contains(&serde_json::json!(origem("x86_64-apple-darwin")))
        {
            return Err(erro("Manifesto universal inválido"));
        }
    } else if m["origemZip"].as_str() != Some(origem(triple).as_str())
        || !hash_valido(&m["sha256Zip"])
    {
        return Err(erro("Origem do motor inválida"));
    }
    let mut arquivo = std::fs::File::open(deno).map_err(erro)?;
    let mut hash = Sha256::new();
    let mut bloco = [0u8; 65536];
    loop {
        let n = arquivo.read(&mut bloco).map_err(erro)?;
        if n == 0 {
            break;
        }
        hash.update(&bloco[..n]);
    }
    if format!("{:x}", hash.finalize())
        != m["sha256Executavel"]
            .as_str()
            .unwrap_or("")
            .to_ascii_lowercase()
    {
        return Err(erro("Hash do motor divergente"));
    }
    Ok(())
}
pub async fn verificar_motor(deno: &Path) -> Result<(), ErroClipora> {
    let caminho = deno.to_path_buf();
    tokio::task::spawn_blocking(move || conferir_arquivos(&caminho))
        .await
        .map_err(erro)??;
    let (_tx, rx) = tokio::sync::watch::channel(false);
    let saida = crate::processos::executar_limitado(
        deno,
        vec!["--version".into()],
        rx,
        std::time::Duration::from_secs(10),
        65536,
    )
    .await
    .map_err(erro)?;
    let texto = String::from_utf8_lossy(&saida.stdout);
    if !saida.sucesso || !versao_cli_compativel(&texto) {
        return Err(erro("Versão executada incompatível"));
    }
    Ok(())
}

#[cfg(all(test, unix))]
pub(crate) fn fixture_motor(dir: &Path) -> std::path::PathBuf {
    use sha2::{Digest, Sha256};
    use std::os::unix::fs::PermissionsExt;
    std::fs::create_dir_all(dir).unwrap();
    let exe = dir.join("clipora-deno");
    std::fs::write(
        &exe,
        b"#!/bin/sh\nprintf 'deno 2.7.0\nv8 fixture\ntypescript fixture\n'\n",
    )
    .unwrap();
    std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).unwrap();
    let hash = format!("{:x}", Sha256::digest(std::fs::read(&exe).unwrap()));
    std::fs::write(dir.join("clipora-deno.json"),serde_json::to_vec(&serde_json::json!({"formato":1,"versao":"2.7.0","triple":env!("CLIPORA_TARGET"),"sha256Executavel":hash,"origemZip":format!("https://github.com/denoland/deno/releases/download/v2.7.0/deno-{}.zip",env!("CLIPORA_TARGET")),"sha256Zip":"a".repeat(64)})).unwrap()).unwrap();
    exe
}
#[cfg(all(test, unix))]
mod tests {
    use super::*;
    #[test]
    fn versao_deno_aceita_apenas_base_fixada_e_metadata_build_semver() {
        for linha in [
            "deno 2.7.0",
            "deno 2.7.0+fb4db33 (canary, release, aarch64-apple-darwin)",
            "deno 2.7.0+build.17 (release)",
        ] {
            assert!(versao_cli_compativel(linha), "deveria aceitar: {linha}");
        }
        for linha in [
            "deno 2.7.01",
            "deno 2.7.0-rc.1",
            "deno 2.9.8",
            "deno 2.7.0prefixo",
            "deno 2.7.0+",
            "deno 2.7.0+build..17",
        ] {
            assert!(!versao_cli_compativel(linha), "deveria rejeitar: {linha}");
        }
    }
    #[tokio::test]
    async fn youtube_motor_aceita_linha_real_de_versao_com_hash_valido() {
        use sha2::{Digest, Sha256};
        let d = tempfile::tempdir().unwrap();
        let exe = fixture_motor(d.path());
        std::fs::write(
            &exe,
            b"#!/bin/sh\nprintf 'deno 2.7.0+fb4db33 (canary, release, aarch64-apple-darwin)\\n'\n",
        )
        .unwrap();
        let mut m: serde_json::Value =
            serde_json::from_slice(&std::fs::read(d.path().join("clipora-deno.json")).unwrap())
                .unwrap();
        m["sha256Executavel"] = serde_json::json!(format!(
            "{:x}",
            Sha256::digest(std::fs::read(&exe).unwrap())
        ));
        std::fs::write(
            d.path().join("clipora-deno.json"),
            serde_json::to_vec(&m).unwrap(),
        )
        .unwrap();
        verificar_motor(&exe).await.unwrap();
    }
    #[tokio::test]
    async fn youtube_motor_valida_hash_manifesto_versao_e_arquivo() {
        let d = tempfile::tempdir().unwrap();
        let exe = fixture_motor(d.path());
        verificar_motor(&exe).await.unwrap();
        let manifesto = d.path().join("clipora-deno.json");
        let base: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&manifesto).unwrap()).unwrap();
        for (campo, valor) in [
            ("formato", serde_json::json!(2)),
            ("versao", serde_json::json!("2.9.8")),
            ("triple", serde_json::json!("invalido")),
            ("sha256Executavel", serde_json::json!("0".repeat(64))),
        ] {
            let mut m = base.clone();
            m[campo] = valor;
            std::fs::write(&manifesto, serde_json::to_vec(&m).unwrap()).unwrap();
            assert_eq!(
                verificar_motor(&exe).await.unwrap_err().codigo,
                "MOTOR_YOUTUBE_INDISPONIVEL"
            );
        }
        std::fs::write(&manifesto, serde_json::to_vec(&base).unwrap()).unwrap();
        std::fs::write(&exe, b"#!/bin/sh\necho deno 2.9.8\n").unwrap();
        assert!(verificar_motor(&exe).await.is_err());
        // Mesmo com hash atualizado, versão real diferente da declarada é recusada.
        use sha2::{Digest, Sha256};
        let mut declarado = base.clone();
        declarado["sha256Executavel"] = serde_json::json!(format!(
            "{:x}",
            Sha256::digest(std::fs::read(&exe).unwrap())
        ));
        std::fs::write(&manifesto, serde_json::to_vec(&declarado).unwrap()).unwrap();
        assert!(
            verificar_motor(&exe)
                .await
                .unwrap_err()
                .detalhe
                .unwrap()
                .contains("Versão executada")
        );
        assert!(verificar_motor(Path::new("clipora-deno")).await.is_err());
    }
    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn youtube_motor_aceita_manifesto_universal_e_recusa_symlink() {
        let d = tempfile::tempdir().unwrap();
        let exe = fixture_motor(d.path());
        let manifesto = d.path().join("clipora-deno.json");
        let mut m: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&manifesto).unwrap()).unwrap();
        m["triple"] = serde_json::json!("universal-apple-darwin");
        m["origemZip"] = serde_json::json!([
            "https://github.com/denoland/deno/releases/download/v2.7.0/deno-aarch64-apple-darwin.zip",
            "https://github.com/denoland/deno/releases/download/v2.7.0/deno-x86_64-apple-darwin.zip"
        ]);
        m["sha256Zip"] = serde_json::json!(["a".repeat(64), "b".repeat(64)]);
        std::fs::write(&manifesto, serde_json::to_vec(&m).unwrap()).unwrap();
        verificar_motor(&exe).await.unwrap();
        let link = d.path().join("alias");
        std::os::unix::fs::symlink(&exe, &link).unwrap();
        assert!(verificar_motor(&link).await.is_err());
    }
}
