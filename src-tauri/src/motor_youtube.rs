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

const LIMITE_SAIDA_COMPATIBILIDADE: usize = 1024 * 1024;
const LIMITE_ENTRADA_DENO: usize = 1024 * 1024;

pub(crate) fn erro_atualizacao_nao_suportada(detalhe: impl ToString) -> ErroClipora {
    ErroClipora {
        codigo: "ATUALIZACAO_NAO_SUPORTADA".into(),
        mensagem: "Não foi possível confirmar a compatibilidade desta atualização com o Clipora. A versão atual do yt-dlp continua em uso. Atualize ou reinstale o Clipora para tentar novamente.".into(),
        detalhe: Some(detalhe.to_string()),
    }
}

fn erro_atualizacao_integridade(detalhe: impl ToString) -> ErroClipora {
    ErroClipora {
        codigo: "ATUALIZACAO_INTEGRIDADE".into(),
        mensagem: "O arquivo de atualização não passou na verificação de integridade.".into(),
        detalhe: Some(detalhe.to_string()),
    }
}

fn hash_arquivo(path: &Path) -> Result<String, ErroClipora> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut arquivo = std::fs::File::open(path).map_err(erro_atualizacao_integridade)?;
    let mut h = Sha256::new();
    let mut bloco = [0u8; 65536];
    loop {
        let n = arquivo
            .read(&mut bloco)
            .map_err(erro_atualizacao_integridade)?;
        if n == 0 {
            break;
        }
        h.update(&bloco[..n]);
    }
    Ok(format!("{:x}", h.finalize()))
}

fn arquivo_regular(path: &Path) -> Result<std::fs::Metadata, ErroClipora> {
    let meta = std::fs::symlink_metadata(path).map_err(erro_atualizacao_nao_suportada)?;
    if !meta.is_file() || meta.file_type().is_symlink() {
        return Err(erro_atualizacao_nao_suportada(format!(
            "arquivo regular esperado: {}",
            path.display()
        )));
    }
    Ok(meta)
}

fn diretorio_regular(path: &Path) -> Result<(), ErroClipora> {
    let meta = std::fs::symlink_metadata(path).map_err(erro_atualizacao_nao_suportada)?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err(erro_atualizacao_nao_suportada(format!(
            "diretório do solver inválido: {}",
            path.display()
        )));
    }
    Ok(())
}

fn ler_solver_candidato(executavel: &Path) -> Result<(Vec<u8>, Vec<u8>), ErroClipora> {
    let nome_esperado = if cfg!(windows) {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    };
    if !executavel.is_absolute()
        || executavel.file_name().and_then(|n| n.to_str()) != Some(nome_esperado)
    {
        return Err(erro_atualizacao_nao_suportada(
            "caminho do executável candidato inválido",
        ));
    }
    let raiz = executavel
        .parent()
        .ok_or_else(|| erro_atualizacao_nao_suportada("diretório do candidato ausente"))?
        .canonicalize()
        .map_err(erro_atualizacao_nao_suportada)?;
    let executavel = raiz.join(nome_esperado);
    arquivo_regular(&executavel)?;

    let manifesto_path = raiz.join("clipora-yt-dlp.json");
    let manifesto_meta = arquivo_regular(&manifesto_path)?;
    if manifesto_meta.len() > LIMITE_SAIDA_COMPATIBILIDADE as u64 {
        return Err(erro_atualizacao_nao_suportada(
            "manifesto do candidato excede o limite",
        ));
    }
    let manifesto: serde_json::Value = serde_json::from_slice(
        &std::fs::read(&manifesto_path).map_err(erro_atualizacao_nao_suportada)?,
    )
    .map_err(erro_atualizacao_nao_suportada)?;
    let arquivos = manifesto
        .get("arquivos")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| erro_atualizacao_nao_suportada("mapa de arquivos ausente no manifesto"))?;

    let relativo = "_internal/yt_dlp_ejs/yt/solver";
    let mut pasta = raiz.clone();
    for componente in ["_internal", "yt_dlp_ejs", "yt", "solver"] {
        pasta.push(componente);
        diretorio_regular(&pasta)?;
    }
    let ler = |nome: &str| -> Result<Vec<u8>, ErroClipora> {
        let path = pasta.join(nome);
        let meta = arquivo_regular(&path)?;
        if meta.len() > 512 * 1024 {
            return Err(erro_atualizacao_nao_suportada(format!(
                "solver excede o limite: {nome}"
            )));
        }
        let caminho_manifesto = format!("{relativo}/{nome}");
        let hash_esperado = arquivos
            .get(&caminho_manifesto)
            .and_then(serde_json::Value::as_str)
            .filter(|h| h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit()))
            .ok_or_else(|| {
                erro_atualizacao_nao_suportada(format!(
                    "solver não coberto pelo manifesto: {caminho_manifesto}"
                ))
            })?;
        let hash_real = hash_arquivo(&path)?;
        if !hash_real.eq_ignore_ascii_case(hash_esperado) {
            return Err(erro_atualizacao_integridade(format!(
                "hash divergente: {caminho_manifesto}"
            )));
        }
        std::fs::read(&path).map_err(erro_atualizacao_integridade)
    };
    let lib = ler("lib.min.js")?;
    let core = ler("core.min.js")?;
    // A atualização valida assinatura/hash do ZIP antes da extração. O
    // executável empacotado pode receber assinatura de código depois de o
    // manifesto de distribuição ser gerado; aqui os hashes exigidos são dos
    // scripts EJS que serão efetivamente enviados ao runtime.
    Ok((lib, core))
}

fn runtime_deno_compativel(token: &str) -> bool {
    token
        .strip_prefix("deno-")
        .is_some_and(|versao| versao_cli_compativel(&format!("deno {versao}")))
}

fn diagnostico_candidato_compativel(texto: &str) -> Result<(), ErroClipora> {
    let linhas: Vec<_> = texto.lines().collect();
    let runtimes: Vec<_> = linhas
        .iter()
        .filter_map(|linha| linha.trim().strip_prefix("[debug] JS runtimes:"))
        .flat_map(|lista| lista.split(',').map(str::trim).filter(|t| !t.is_empty()))
        .collect();
    // --no-js-runtimes seguido por deno:<absoluto> deve deixar exatamente
    // um runtime ativo; qualquer linha/lista diferente é prova ambígua.
    let runtime = runtimes.len() == 1 && runtime_deno_compativel(runtimes[0]);
    let bibliotecas: Vec<_> = linhas
        .iter()
        .filter_map(|linha| linha.trim().strip_prefix("[debug] Optional libraries:"))
        .collect();
    let ejs = bibliotecas.len() == 1
        && bibliotecas[0]
            .split(',')
            .map(str::trim)
            .any(|lib| lib.starts_with("yt_dlp_ejs-"));
    let aviso_incompativel = linhas.iter().any(|linha| {
        let linha = linha.trim().to_ascii_lowercase();
        (linha.starts_with("warning:") || linha.starts_with("[warning]"))
            && ["deno", "ejs", "solver", "javascript", "js runtime"]
                .iter()
                .any(|marca| linha.contains(marca))
    });
    if runtime && ejs && !aviso_incompativel {
        Ok(())
    } else {
        Err(erro_atualizacao_nao_suportada(format!(
            "prova local incompleta: runtime={runtime}, ejs={ejs}, aviso_incompativel={aviso_incompativel}"
        )))
    }
}

async fn smoke_deno_solver(
    deno: &Path,
    lib: &[u8],
    core: &[u8],
    prazo: std::time::Duration,
) -> Result<(), ErroClipora> {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../../tests/fixtures/youtube/ejs-smoke.json"))
            .map_err(erro_atualizacao_nao_suportada)?;
    let json_input = serde_json::to_string(&fixture).map_err(erro_atualizacao_nao_suportada)?;
    let script = format!(
        "{}\nObject.assign(globalThis, lib);\n{}\nconst input = {{type: fixture.type, preprocessed_player: fixture.preprocessed_player, requests: fixture.requests}};\nconst solver = jsc(input);\nconst ast = lib.meriyah.parse(fixture.parserProgram);\nconst parser = lib.astring.generate(ast).trim();\nconsole.log(JSON.stringify({{solver, parser}}));\n",
        String::from_utf8_lossy(lib),
        String::from_utf8_lossy(core)
    );
    // O objeto fixture é criado no harness usando JSON seguro, sem interpolação de conteúdo JS.
    let script = format!("const fixture = {json_input};\n{script}");
    if script.len() > LIMITE_ENTRADA_DENO {
        return Err(erro_atualizacao_nao_suportada(
            "entrada do smoke Deno excede 1 MiB",
        ));
    }
    let args: Vec<std::ffi::OsString> = [
        "run",
        "--ext=js",
        "--no-code-cache",
        "--no-prompt",
        "--no-remote",
        "--no-lock",
        "--node-modules-dir=none",
        "--no-config",
        "--no-npm",
        "--cached-only",
        "-",
    ]
    .into_iter()
    .map(Into::into)
    .collect();
    let (_tx, rx) = tokio::sync::watch::channel(false);
    let saida = crate::processos::executar_com_entrada_limitado(
        deno,
        args,
        script.into_bytes(),
        rx,
        prazo,
        LIMITE_SAIDA_COMPATIBILIDADE,
    )
    .await
    .map_err(|e| erro_atualizacao_nao_suportada(format!("smoke Deno: {e}")))?;
    if !saida.sucesso {
        return Err(erro_atualizacao_nao_suportada(format!(
            "smoke Deno recusado: {}",
            String::from_utf8_lossy(&saida.stderr)
        )));
    }
    let resultado: serde_json::Value = serde_json::from_slice(&saida.stdout)
        .map_err(|e| erro_atualizacao_nao_suportada(format!("saída inválida do solver: {e}")))?;
    let respostas = resultado["solver"]["responses"].as_array();
    if resultado["solver"]["type"] != "result"
        || respostas != fixture["expected"].as_array()
        || resultado["parser"].as_str() != fixture["parserExpected"].as_str()
    {
        return Err(erro_atualizacao_nao_suportada(
            "respostas N/SIG ou parse/generate divergentes",
        ));
    }
    Ok(())
}

async fn smoke_ytdlp_local(
    executavel: &Path,
    deno: &Path,
    prazo: std::time::Duration,
) -> Result<(), ErroClipora> {
    let dir = tempfile::tempdir().map_err(erro_atualizacao_nao_suportada)?;
    let info = dir.path().join("info-local.json");
    std::fs::write(
        &info,
        include_bytes!("../../tests/fixtures/youtube/info-local.json"),
    )
    .map_err(erro_atualizacao_nao_suportada)?;
    let mut args: Vec<std::ffi::OsString> = [
        "--ignore-config",
        "--no-update",
        "--no-playlist",
        "--no-plugin-dirs",
        "--no-cache-dir",
        "--no-cookies",
        "--no-cookies-from-browser",
        "--no-remote-components",
        "--no-js-runtimes",
        "--js-runtimes",
    ]
    .into_iter()
    .map(Into::into)
    .collect();
    args.push(format!("deno:{}", deno.display()).into());
    args.extend(
        ["--verbose", "--simulate", "--load-info-json"]
            .into_iter()
            .map(Into::into),
    );
    args.push(info.into_os_string());
    args.extend(["--skip-download".into(), "--".into()]);
    let (_tx, rx) = tokio::sync::watch::channel(false);
    let saida = crate::processos::executar_limitado(
        executavel,
        args,
        rx,
        prazo,
        LIMITE_SAIDA_COMPATIBILIDADE,
    )
    .await
    .map_err(|e| erro_atualizacao_nao_suportada(format!("smoke yt-dlp local: {e}")))?;
    let texto = format!(
        "{}\n{}",
        String::from_utf8_lossy(&saida.stdout),
        String::from_utf8_lossy(&saida.stderr)
    );
    if !saida.sucesso {
        return Err(erro_atualizacao_nao_suportada(format!(
            "simulação local recusada: {}",
            texto.chars().take(512).collect::<String>()
        )));
    }
    diagnostico_candidato_compativel(&texto)
}

async fn conferir_candidato_interno(yt_dlp: &Path, deno: &Path) -> Result<(), ErroClipora> {
    verificar_motor(deno)
        .await
        .map_err(|e| erro_atualizacao_nao_suportada(e.detalhe.unwrap_or(e.mensagem)))?;
    let (lib, core) = ler_solver_candidato(yt_dlp)?;
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(20);
    let restante = || deadline.saturating_duration_since(tokio::time::Instant::now());
    smoke_deno_solver(deno, &lib, &core, restante()).await?;
    smoke_ytdlp_local(yt_dlp, deno, restante()).await?;
    Ok(())
}

pub async fn conferir_candidato(yt_dlp: &Path, deno: &Path) -> Result<(), ErroClipora> {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(20);
    tokio::time::timeout_at(deadline, conferir_candidato_interno(yt_dlp, deno))
        .await
        .map_err(|_| erro_atualizacao_nao_suportada("tempo total excedido (20 s)"))??;
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
    fn diagnostico_requer_runtime_base_com_metadata_ejs_e_sem_aviso_incompativel() {
        let compativel = "[debug] Optional libraries: brotli, yt_dlp_ejs-0.8.0\n[debug] JS runtimes: deno-2.7.0+fb4db33\n";
        diagnostico_candidato_compativel(compativel).unwrap();
        for invalido in [
            "[debug] Optional libraries: yt_dlp_ejs-0.8.0\n[debug] JS runtimes: deno-2.7.01\n",
            "[debug] Optional libraries: yt_dlp_ejs-0.8.0\n[debug] JS runtimes: deno-2.7.0-rc.1\n",
            "[debug] Optional libraries: yt_dlp_ejs-0.8.0\n[debug] JS runtimes: deno-2.7.0+fb4db33, node-20.0.0\n",
            "[debug] JS runtimes: deno-2.7.0+fb4db33\n",
            "[debug] Optional libraries: yt_dlp_ejs-0.8.0\n[debug] JS runtimes: deno-2.7.0+fb4db33\nWARNING: Deno runtime is incompatible\n",
        ] {
            assert!(
                diagnostico_candidato_compativel(invalido).is_err(),
                "diagnóstico deveria ser recusado: {invalido}"
            );
        }
    }

    #[test]
    fn solver_do_candidato_precisa_ser_regular_e_coberto_pelo_manifesto() {
        use sha2::{Digest, Sha256};
        let d = tempfile::tempdir().unwrap();
        let exe = d.path().join(if cfg!(windows) {
            "yt-dlp.exe"
        } else {
            "yt-dlp"
        });
        std::fs::write(&exe, b"yt-dlp fixture").unwrap();
        let solver = d.path().join("_internal/yt_dlp_ejs/yt/solver");
        std::fs::create_dir_all(&solver).unwrap();
        std::fs::write(solver.join("lib.min.js"), b"lib fixture").unwrap();
        std::fs::write(solver.join("core.min.js"), b"core fixture").unwrap();
        let digest = |bytes: &[u8]| format!("{:x}", Sha256::digest(bytes));
        let arquivos = serde_json::json!({
            if cfg!(windows) { "yt-dlp.exe" } else { "yt-dlp" }: digest(b"yt-dlp fixture"),
            "_internal/yt_dlp_ejs/yt/solver/lib.min.js": digest(b"lib fixture"),
            "_internal/yt_dlp_ejs/yt/solver/core.min.js": digest(b"core fixture")
        });
        std::fs::write(
            d.path().join("clipora-yt-dlp.json"),
            serde_json::to_vec(&serde_json::json!({"arquivos": arquivos})).unwrap(),
        )
        .unwrap();
        assert!(ler_solver_candidato(&exe).is_ok());
        std::fs::write(solver.join("lib.min.js"), b"tampered").unwrap();
        assert_eq!(
            ler_solver_candidato(&exe).unwrap_err().codigo,
            "ATUALIZACAO_INTEGRIDADE"
        );
        std::fs::write(solver.join("lib.min.js"), b"lib fixture").unwrap();
        #[cfg(unix)]
        {
            let externo = d.path().join("lib-externo.js");
            std::fs::write(&externo, b"lib fixture").unwrap();
            std::fs::remove_file(solver.join("lib.min.js")).unwrap();
            std::os::unix::fs::symlink(&externo, solver.join("lib.min.js")).unwrap();
            assert_eq!(
                ler_solver_candidato(&exe).unwrap_err().codigo,
                "ATUALIZACAO_NAO_SUPORTADA"
            );
        }
        #[cfg(unix)]
        std::fs::remove_file(solver.join("lib.min.js")).unwrap();
        #[cfg(unix)]
        std::fs::remove_dir_all(solver).unwrap();
        #[cfg(unix)]
        assert_eq!(
            ler_solver_candidato(&exe).unwrap_err().codigo,
            "ATUALIZACAO_NAO_SUPORTADA"
        );
    }

    #[test]
    #[ignore = "smoke real local do candidato yt-dlp e Deno, sem rede nem mídia"]
    fn conferir_candidato_real_offline() {
        let raiz = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries");
        let yt_dlp = raiz.join("yt-dlp").join(if cfg!(windows) {
            "yt-dlp.exe"
        } else {
            "yt-dlp"
        });
        let deno = raiz.join("deno").join(if cfg!(windows) {
            "clipora-deno.exe"
        } else {
            "clipora-deno"
        });
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime
            .block_on(conferir_candidato(&yt_dlp, &deno))
            .unwrap();
        println!("compatibilidade local confirmada: {}", yt_dlp.display());
    }

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
