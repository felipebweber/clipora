use std::{
    fs, io,
    path::{Path, PathBuf},
};

const NOME_MAX_BYTES: usize = 255 - " (100000).mp4".len();
const DESCRICAO_MAX_PALAVRAS: usize = 8;

#[derive(Default)]
struct MetadadosNome {
    titulo: Option<String>,
    descricao: Option<String>,
    uploader_id: Option<String>,
    uploader: Option<String>,
    channel: Option<String>,
}

fn texto_nome(valor: Option<&str>) -> Option<String> {
    let valor = valor?.trim();
    if valor.is_empty() || matches!(valor.to_ascii_lowercase().as_str(), "na" | "n/a" | "null") {
        return None;
    }
    let texto: String = valor
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                ' '
            } else {
                c
            }
        })
        .collect();
    let texto = texto.split_whitespace().collect::<Vec<_>>().join(" ");
    let texto = texto.trim_matches(|c: char| c == '.').trim().to_string();
    (!texto.is_empty()).then_some(texto)
}

fn campo_json_texto(valor: &str) -> Option<String> {
    texto_nome(campo_json_string(valor).as_deref())
}

fn campo_json_string(valor: &str) -> Option<String> {
    if valor == "NA" || valor.is_empty() {
        return None;
    }
    let valor: serde_json::Value = serde_json::from_str(valor).ok()?;
    match valor {
        serde_json::Value::String(s) => Some(s),
        serde_json::Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn limitar_bytes(texto: &str, limite: usize) -> &str {
    if texto.len() <= limite {
        return texto;
    }
    let mut fim = limite;
    while !texto.is_char_boundary(fim) {
        fim -= 1;
    }
    &texto[..fim]
}

fn perfil_nome(metadados: &MetadadosNome, plataforma: crate::links::Plataforma) -> Option<String> {
    let candidatos = match plataforma {
        crate::links::Plataforma::Instagram => [
            metadados.channel.as_deref(),
            metadados.uploader_id.as_deref(),
            metadados.uploader.as_deref(),
        ],
        crate::links::Plataforma::Tiktok => [
            metadados.uploader.as_deref(),
            metadados.channel.as_deref(),
            metadados.uploader_id.as_deref(),
        ],
    };
    let mut fallback = None;
    for candidato in candidatos.into_iter().flatten() {
        let Some(limpo) = texto_nome(Some(candidato)) else {
            continue;
        };
        let nome = limpo.trim_start_matches('@').trim().to_string();
        if nome.is_empty() {
            continue;
        }
        if nome.chars().any(|c| !c.is_ascii_digit()) {
            return Some(nome);
        }
        fallback.get_or_insert(nome);
    }
    fallback
}

fn nome_generico(titulo: &str) -> bool {
    let titulo = titulo.to_lowercase();
    ["video by ", "vídeo por ", "vídeo de ", "video de "]
        .iter()
        .any(|prefixo| titulo.starts_with(prefixo))
}

fn nome_base(metadados: &MetadadosNome, id: &str, plataforma: crate::links::Plataforma) -> String {
    let id = texto_nome(Some(id)).unwrap_or_else(|| "sem-id".into());
    let id = limitar_bytes(&id, 64).to_string();
    let max_prefixo = NOME_MAX_BYTES.saturating_sub(id.len() + 3);
    let perfil = perfil_nome(metadados, plataforma);
    let descricao = metadados
        .descricao
        .as_deref()
        .and_then(|s| texto_nome(Some(s)))
        .map(|s| {
            s.split_whitespace()
                .take(DESCRICAO_MAX_PALAVRAS)
                .collect::<Vec<_>>()
                .join(" ")
        });
    let titulo = metadados
        .titulo
        .as_deref()
        .and_then(|s| texto_nome(Some(s)))
        .filter(|s| !nome_generico(s));
    let rotulo = descricao.or(titulo);

    let prefixo = match (perfil, rotulo) {
        (Some(perfil), Some(rotulo)) => {
            let perfil = format!("@{}", perfil.trim_start_matches('@'));
            let perfil = limitar_bytes(&perfil, 80.min(max_prefixo.saturating_sub(3)));
            let restante = max_prefixo.saturating_sub(perfil.len() + 3);
            let rotulo = limitar_bytes(&rotulo, restante).trim_end();
            if rotulo.is_empty() {
                perfil.to_string()
            } else {
                format!("{perfil} - {rotulo}")
            }
        }
        (Some(perfil), None) => {
            let perfil = format!("@{}", perfil.trim_start_matches('@'));
            limitar_bytes(&perfil, max_prefixo).to_string()
        }
        (None, Some(rotulo)) => limitar_bytes(&rotulo, max_prefixo).trim_end().to_string(),
        (None, None) => limitar_bytes("Vídeo", max_prefixo).to_string(),
    };
    format!("{prefixo} [{id}]")
}
fn finalizar(origem: &Path, destino: &Path, nome: &str) -> io::Result<(PathBuf, bool)> {
    finalizar_com(origem, destino, nome, |a, b| fs::hard_link(a, b))
}

fn finalizar_com<F>(
    origem: &Path,
    destino: &Path,
    nome: &str,
    link: F,
) -> io::Result<(PathBuf, bool)>
where
    F: Fn(&Path, &Path) -> io::Result<()>,
{
    for n in 1u32..=100_000 {
        let nome = if n == 1 {
            format!("{nome}.mp4")
        } else {
            format!("{nome} ({n}).mp4")
        };
        let finalizado = destino.join(nome);
        match link(origem, &finalizado) {
            Ok(()) => {
                fs::remove_file(origem)?;
                return Ok((finalizado, n > 1));
            }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(_) => match mover_exclusivo(origem, &finalizado) {
                Ok(()) => return Ok((finalizado, n > 1)),
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(e),
            },
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "limite de colisões",
    ))
}

#[cfg(unix)]
fn caminho_c(path: &Path) -> io::Result<std::ffi::CString> {
    use std::os::unix::ffi::OsStrExt;
    std::ffi::CString::new(path.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "caminho contém NUL"))
}

#[cfg(target_os = "macos")]
fn mover_exclusivo(origem: &Path, destino: &Path) -> io::Result<()> {
    let origem_c = caminho_c(origem)?;
    let destino_c = caminho_c(destino)?;
    // SAFETY: os ponteiros são strings C válidas até o retorno da chamada.
    if unsafe { libc::renamex_np(origem_c.as_ptr(), destino_c.as_ptr(), libc::RENAME_EXCL) } == 0 {
        return Ok(());
    }
    let erro = io::Error::last_os_error();
    if matches!(
        erro.raw_os_error(),
        Some(libc::ENOTSUP | libc::ENOSYS | libc::EINVAL | libc::EXDEV)
    ) {
        return copiar_exclusivo(origem, destino);
    }
    Err(erro)
}

#[cfg(target_os = "linux")]
fn mover_exclusivo(origem: &Path, destino: &Path) -> io::Result<()> {
    let origem_c = caminho_c(origem)?;
    let destino_c = caminho_c(destino)?;
    // SAFETY: strings C válidas; syscall mantém RENAME_NOREPLACE mesmo em libc antiga.
    if unsafe {
        libc::syscall(
            libc::SYS_renameat2,
            libc::AT_FDCWD,
            origem_c.as_ptr(),
            libc::AT_FDCWD,
            destino_c.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    } == 0
    {
        return Ok(());
    }
    let erro = io::Error::last_os_error();
    if matches!(
        erro.raw_os_error(),
        Some(libc::ENOSYS | libc::EINVAL | libc::EOPNOTSUPP | libc::EXDEV)
    ) {
        return copiar_exclusivo(origem, destino);
    }
    Err(erro)
}

#[cfg(windows)]
fn mover_exclusivo(origem: &Path, destino: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::MoveFileExW;
    let a: Vec<u16> = origem.as_os_str().encode_wide().chain(Some(0)).collect();
    let b: Vec<u16> = destino.as_os_str().encode_wide().chain(Some(0)).collect();
    // SAFETY: strings UTF-16 terminadas em NUL; flags 0 não permitem substituição.
    if unsafe { MoveFileExW(a.as_ptr(), b.as_ptr(), 0) } != 0 {
        return Ok(());
    }
    let erro = io::Error::last_os_error();
    if erro.raw_os_error() == Some(17) {
        return copiar_exclusivo(origem, destino);
    } // ERROR_NOT_SAME_DEVICE
    Err(erro)
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
fn mover_exclusivo(origem: &Path, destino: &Path) -> io::Result<()> {
    copiar_exclusivo(origem, destino)
}

// Último recurso para sistemas sem rename exclusivo ou entre volumes: create_new
// impede sobrescrita, mas o arquivo fica visível durante a cópia e uma interrupção
// abrupta pode deixá-lo incompleto. Erros de cópia normais removem a reserva.
fn copiar_exclusivo(origem: &Path, destino: &Path) -> io::Result<()> {
    let mut fonte = fs::File::open(origem)?;
    let mut alvo = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destino)?;
    if let Err(e) = io::copy(&mut fonte, &mut alvo).and_then(|_| alvo.sync_all()) {
        drop(alvo);
        let _ = fs::remove_file(destino);
        return Err(e);
    }
    drop(alvo);
    fs::remove_file(origem)
}
#[derive(Default)]
struct Progresso {
    parte: u8,
    ultimo_global: f64,
}
impl Progresso {
    fn ler(&mut self, linha: &str) -> Option<Option<f64>> {
        let resto = linha.strip_prefix("download:")?;
        let campos: Vec<_> = resto.split(':').collect();
        if campos.len() != 5 {
            return Some(None);
        }
        let vcodec = campos[3];
        let acodec = campos[4];
        let audio = vcodec == "none" && acodec != "none" && acodec != "NA";
        if audio {
            self.parte = 1;
        }
        let percentual = campos[2]
            .trim()
            .trim_end_matches('%')
            .parse::<f64>()
            .ok()
            .filter(|v| v.is_finite())
            .map(|v| v.clamp(0.0, 100.0));
        let Some(valor) = percentual else {
            return Some(None);
        };
        let combinado = vcodec != "none" && vcodec != "NA" && acodec != "none" && acodec != "NA";
        let global = if combinado {
            valor * 0.9
        } else if audio {
            45.0 + valor * 0.45
        } else {
            valor * 0.45
        };
        self.ultimo_global = self.ultimo_global.max(global.min(90.0));
        Some(Some(self.ultimo_global))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    fn preparar_fixture_metadados(dir: &Path, metadados: serde_json::Value) -> PathBuf {
        let script =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/preparar-bin.mjs");
        let saida = std::process::Command::new("node")
            .arg(script)
            .arg(dir)
            .output()
            .expect("Node deve estar disponível para o fixture");
        assert!(
            saida.status.success(),
            "preparar-bin: {}",
            String::from_utf8_lossy(&saida.stderr)
        );
        let cenario = dir.join("metadados-download.json");
        fs::write(
            &cenario,
            serde_json::to_vec(&serde_json::json!({
                "base": "sucesso",
                "metadados": metadados,
            }))
            .unwrap(),
        )
        .unwrap();
        fs::write(
            dir.join("clipora-falso.json"),
            serde_json::to_vec(&serde_json::json!({
                "CLIPORA_FALSO_CENARIO_ARQUIVO": cenario,
            }))
            .unwrap(),
        )
        .unwrap();
        dir.to_path_buf()
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn download_normaliza_url_do_processo_e_preserva_original_no_historico() {
        let dir = tempfile::tempdir().unwrap();
        let raiz = dir.path().canonicalize().unwrap();
        let bin = raiz.join("bin");
        let registro = raiz.join("processos.jsonl");
        let saida = std::process::Command::new("node")
            .arg(
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("../tests/fixtures/preparar-bin.mjs"),
            )
            .arg(&bin)
            .args(["--cenario", "sucesso", "--registro"])
            .arg(&registro)
            .output()
            .unwrap();
        assert!(saida.status.success());
        let destino = raiz.join("videos");
        fs::create_dir(&destino).unwrap();
        let controle = Arc::new(Mutex::new(Dados::default()));
        let historico = Arc::new(crate::historico::Repositorio::novo(
            raiz.join("historico.json"),
        ));
        let original = "http://www.instagram.com/reel/AbC/?igsh=original";
        let normalizada = "https://www.instagram.com/reel/AbC/?igsh=original";
        executar(
            controle.clone(),
            historico.clone(),
            Channel::new(|_| Ok(())),
            "http-regressao".into(),
            original.into(),
            destino,
            (bin.join("clipora-yt-dlp"), bin.join("clipora-ffmpeg")),
        )
        .await;
        assert!(matches!(
            controle.lock().unwrap().ultimo_resultado,
            Some(ResultadoTerminal::Concluido { .. })
        ));
        let texto = fs::read_to_string(registro).unwrap();
        let inicio = texto
            .lines()
            .map(|linha| serde_json::from_str::<serde_json::Value>(linha).unwrap())
            .find(|v| v["programa"] == "yt-dlp" && v["evento"] == "inicio")
            .unwrap();
        assert_eq!(inicio["urls"][0], normalizada);
        let itens = historico.listar().unwrap();
        assert_eq!(itens[0].url_original, original);
        assert_eq!(itens[0].url_normalizada, normalizada);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn nome_de_download_usa_descricao_e_perfil_legivel_por_plataforma() {
        let casos = [
            (
                "https://instagram.com/reel/DfS6bDVMRQ8/",
                serde_json::json!({
                    "title": "Video by yogue.prem",
                    "description": "🔥🔥🔥",
                    "uploader": "PREM RAS KAUR",
                    "uploader_id": "4848895582",
                    "channel": "yogue.prem",
                }),
                "@yogue.prem - 🔥🔥🔥 [DfS6bDVMRQ8].mp4",
            ),
            (
                "https://www.tiktok.com/@barudakhb_/video/6718335390845095173",
                serde_json::json!({
                    "title": "Video by barudakhb_",
                    "description": "🔥🔥🔥",
                    "uploader": "barudakhb_",
                    "uploader_id": "6974687867511718913",
                    "channel": "Baruda Khb",
                }),
                "@barudakhb_ - 🔥🔥🔥 [6718335390845095173].mp4",
            ),
            (
                "https://instagram.com/reel/naomipq/",
                serde_json::json!({
                    "title": "Video by naomipq",
                    "description": "Olá",
                    "uploader": "B E A U T Y  F O R  A S H E S",
                    "uploader_id": "naomipq",
                    "channel": null,
                }),
                "@naomipq - Olá [naomipq].mp4",
            ),
        ];
        for (url, metadados, esperado) in casos {
            let bin_dir = tempfile::tempdir().unwrap();
            let bin_dir = preparar_fixture_metadados(bin_dir.path(), metadados);
            let destino = tempfile::tempdir().unwrap();
            let controle = Arc::new(Mutex::new(Dados::default()));
            let canal = Channel::new(|_| Ok(()));
            let (arquivo, _) = executar_interno(
                &controle,
                &canal,
                url,
                destino.path(),
                &bin_dir.join("clipora-yt-dlp"),
                &bin_dir.join("clipora-ffmpeg"),
                Some("sucesso"),
            )
            .await
            .unwrap();
            assert_eq!(arquivo.file_name().unwrap(), esperado, "{url}");
            if url.contains("instagram.com") {
                let original = fs::read(&arquivo).unwrap();
                let (colisao, renomeado) = executar_interno(
                    &controle,
                    &canal,
                    url,
                    destino.path(),
                    &bin_dir.join("clipora-yt-dlp"),
                    &bin_dir.join("clipora-ffmpeg"),
                    Some("sucesso"),
                )
                .await
                .unwrap();
                assert!(renomeado);
                assert_eq!(
                    colisao.file_name().unwrap().to_string_lossy(),
                    esperado.replace(".mp4", " (2).mp4")
                );
                assert_eq!(fs::read(&arquivo).unwrap(), original);
            }
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn nome_de_download_cobre_fallbacks_e_texto_sanitizado() {
        let casos = [
            (
                "https://instagram.com/reel/titleonly/",
                serde_json::json!({
                    "title": " Café   da manhã ", "description": null,
                    "uploader_id": null, "uploader": null, "channel": null,
                }),
                Some("Café da manhã [titleonly].mp4"),
            ),
            (
                "https://instagram.com/reel/perfilonly/",
                serde_json::json!({
                    "title": "Video by @perfil", "description": " \n ",
                    "uploader_id": "123456", "uploader": "@@perfil", "channel": null,
                }),
                Some("@perfil [perfilonly].mp4"),
            ),
            (
                "https://instagram.com/reel/semmeta/",
                serde_json::json!({
                    "title": null, "description": "NA", "uploader_id": "NA",
                    "uploader": null, "channel": null,
                }),
                Some("Vídeo [semmeta].mp4"),
            ),
            (
                "https://instagram.com/reel/unicode/",
                serde_json::json!({
                    "title": "Video by yogue.prem",
                    "description": " Café\tgelado\ncom: canela | leite ",
                    "uploader_id": "4848895582", "uploader": "PREM RAS KAUR",
                    "channel": "@@yogue.prem",
                }),
                Some("@yogue.prem - Café gelado com canela leite [unicode].mp4"),
            ),
            (
                "https://instagram.com/reel/longo/",
                serde_json::json!({
                    "title": "Video by cozinha", "description": (0..8).map(|_| "🎬".repeat(80)).collect::<Vec<_>>().join(" "),
                    "uploader_id": "123456", "uploader": null, "channel": "cozinha",
                }),
                None,
            ),
        ];
        for (url, metadados, esperado) in casos {
            let bin_temp = tempfile::tempdir().unwrap();
            let bin_dir = preparar_fixture_metadados(bin_temp.path(), metadados);
            let destino = tempfile::tempdir().unwrap();
            let controle = Arc::new(Mutex::new(Dados::default()));
            let canal = Channel::new(|_| Ok(()));
            let (arquivo, _) = executar_interno(
                &controle,
                &canal,
                url,
                destino.path(),
                &bin_dir.join("clipora-yt-dlp"),
                &bin_dir.join("clipora-ffmpeg"),
                Some("sucesso"),
            )
            .await
            .unwrap();
            if let Some(esperado) = esperado {
                assert_eq!(arquivo.file_name().unwrap(), esperado, "{url}");
            }
            assert!(
                arquivo.file_name().unwrap().to_string_lossy().len() <= 255,
                "nome excede limite de bytes: {}",
                arquivo.file_name().unwrap().to_string_lossy().len()
            );
        }
    }

    #[test]
    fn estado_de_download_expõe_previa_ou_null_para_reidratar_a_tela() {
        let estado = EstadoDownload {
            download_id: "d-1".into(),
            percentual: Some(12.0),
            etapa: "baixando_video".into(),
            previa: None,
        };
        let valor = serde_json::to_value(estado).unwrap();
        assert_eq!(valor["downloadId"], "d-1");
        assert_eq!(valor["previa"], serde_json::Value::Null);
        assert_eq!(valor["etapa"], "baixando_video");
    }
    #[test]
    fn resultado_terminal_tem_discriminante_e_id_para_a_ui_reidratada() {
        let concluido = ResultadoTerminal::Concluido {
            download_id: "d-7".into(),
            caminho: "/tmp/v.mp4".into(),
            nome_arquivo: "v.mp4".into(),
            renomeado: false,
        };
        let valor = serde_json::to_value(concluido).unwrap();
        assert_eq!(valor["downloadId"], "d-7");
        assert_eq!(valor["tipo"], "concluido");
        assert_eq!(valor["nomeArquivo"], "v.mp4");
        let erro = ResultadoTerminal::Erro {
            download_id: "d-8".into(),
            erro: ErroClipora::novo("DOWNLOAD_FALHOU", None),
        };
        let valor = serde_json::to_value(erro).unwrap();
        assert_eq!(valor["downloadId"], "d-8");
        assert_eq!(valor["tipo"], "erro");
        assert_eq!(valor["erro"]["codigo"], "DOWNLOAD_FALHOU");
    }
    #[tokio::test]
    #[cfg(any(target_os = "macos", target_os = "linux", target_os = "windows"))]
    #[ignore = "download real, exige rede e sidecars empacotados para o alvo atual"]
    async fn downloads_reais_tem_audio_e_video() {
        let bin = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries/yt-dlp")
            .join(format!("yt-dlp{}", std::env::consts::EXE_SUFFIX));
        let binarios = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
        let ffmpeg = binarios.join(format!("clipora-ffmpeg-{}", env!("CLIPORA_TARGET")));
        let ffprobe = binarios.join(format!("clipora-ffprobe-{}", env!("CLIPORA_TARGET")));
        for url in [
            "https://www.instagram.com/reel/DUl354timp1/",
            "https://tiktok.com/@scout2015/video/6718335390845095173",
        ] {
            let pasta = tempfile::tempdir().unwrap();
            let raiz = pasta.path().canonicalize().unwrap();
            let historico_arquivo = raiz.join("historico.json");
            let historico = Arc::new(crate::historico::Repositorio::novo(
                historico_arquivo.clone(),
            ));
            let controle = Arc::new(Mutex::new(Dados::default()));
            let canal = Channel::new(|_| Ok(()));
            executar(
                controle.clone(),
                historico,
                canal,
                "aceitacao-real".into(),
                url.into(),
                raiz,
                (bin.clone(), ffmpeg.clone()),
            )
            .await;
            let resultado = match controle.lock().unwrap().ultimo_resultado.clone() {
                Some(ResultadoTerminal::Concluido {
                    caminho, renomeado, ..
                }) => Ok((PathBuf::from(caminho), renomeado)),
                Some(ResultadoTerminal::Erro { erro, .. }) => Err(erro),
                None => panic!("Download real sem resultado terminal"),
            };
            match resultado {
                Ok((arquivo, _)) => {
                    let saida = std::process::Command::new(&ffprobe)
                        .args([
                            "-v",
                            "error",
                            "-show_entries",
                            "stream=codec_type",
                            "-of",
                            "csv=p=0",
                        ])
                        .arg(&arquivo)
                        .output()
                        .unwrap();
                    let tipos = String::from_utf8_lossy(&saida.stdout);
                    println!(
                        "{url}: arquivo={} bytes={} ffprobe exit={:?} tipos={:?}",
                        arquivo.display(),
                        fs::metadata(&arquivo).unwrap().len(),
                        saida.status.code(),
                        tipos.trim()
                    );
                    assert!(
                        saida.status.success()
                            && tipos.lines().any(|t| t == "video")
                            && tipos.lines().any(|t| t == "audio"),
                        "ffprobe: {}",
                        String::from_utf8_lossy(&saida.stderr)
                    );
                    let reaberto = crate::historico::Repositorio::novo(historico_arquivo);
                    let itens = reaberto.listar().unwrap();
                    assert_eq!(itens.len(), 1);
                    assert!(
                        itens[0].disponivel,
                        "MP4 real deve passar na validação de abertura"
                    );
                    assert_eq!(itens[0].url_original, url);
                    assert_eq!(
                        crate::caminho_download(&Controle::default(), &reaberto, "aceitacao-real")
                            .unwrap(),
                        arquivo
                    );
                    assert!(
                        reaberto
                            .consultar(&format!("{url}?utm_source=clipora-qa"))
                            .unwrap()
                            .is_some()
                    );
                    let movido = arquivo.with_extension("movido.mp4");
                    fs::rename(&arquivo, &movido).unwrap();
                    assert!(!reaberto.listar().unwrap()[0].disponivel);
                    assert_eq!(
                        crate::caminho_download(&Controle::default(), &reaberto, "aceitacao-real")
                            .unwrap_err()
                            .codigo,
                        "ARQUIVO_AUSENTE"
                    );
                    fs::rename(&movido, &arquivo).unwrap();
                    reaberto.limpar().unwrap();
                    assert!(reaberto.listar().unwrap().is_empty());
                    assert!(
                        arquivo.is_file(),
                        "Limpar histórico deve preservar vídeo real"
                    );
                    println!(
                        "{url}: histórico reaberto, consulta equivalente, ID persistido, arquivo movido e limpeza sem apagar: aprovados"
                    );
                }
                Err(e) => panic!("{url}: ERRO {} {:?}", e.codigo, e.detalhe),
            }
        }
    }
    #[tokio::test]
    async fn fixture_tres_downloads_nao_sobrescrevem() {
        let fixtures = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/bin");
        let dir = tempfile::tempdir().unwrap();
        let controle = Arc::new(Mutex::new(Dados::default()));
        let canal = Channel::new(|_| Ok(()));
        let mut caminhos = Vec::new();
        for indice in 0..3 {
            let (caminho, renomeado) = executar_interno(
                &controle,
                &canal,
                "https://instagram.com/reel/test/",
                dir.path(),
                &fixtures.join("clipora-yt-dlp"),
                &fixtures.join("clipora-ffmpeg"),
                Some("sucesso"),
            )
            .await
            .unwrap();
            assert_eq!(renomeado, indice > 0);
            caminhos.push(caminho);
        }
        assert!(caminhos[1].to_string_lossy().ends_with(" (2).mp4"));
        assert!(caminhos[2].to_string_lossy().ends_with(" (3).mp4"));
        assert!(caminhos.iter().all(|p| fs::metadata(p).unwrap().len() > 0));
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn encerrar_mata_processo_e_remove_temporario() {
        let fixtures = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/bin");
        let dir = tempfile::tempdir().unwrap();
        let controle = Controle::default();
        let estado = controle.0.clone();
        let destino = dir.path().to_path_buf();
        let canal = Channel::new(|_| Ok(()));
        let processo = tokio::spawn(async move {
            executar_interno(
                &estado,
                &canal,
                "https://instagram.com/reel/test/",
                &destino,
                &fixtures.join("clipora-yt-dlp"),
                &fixtures.join("clipora-ffmpeg"),
                Some("com-filho"),
            )
            .await
        });
        let (pid, pasta) = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                let achado = {
                    let d = controle.0.lock().unwrap();
                    d.grupo
                        .as_ref()
                        .zip(d.temporario.as_ref())
                        .map(|(g, p)| (g.0, p.clone()))
                };
                if let Some(x) = achado {
                    break x;
                }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        controle.encerrar();
        let _ = tokio::time::timeout(std::time::Duration::from_secs(5), processo)
            .await
            .unwrap();
        assert!(!pasta.exists());
        assert_eq!(unsafe { libc::kill(pid as i32, 0) }, -1);
    }
    #[tokio::test]
    async fn atualizacao_exclui_previa_e_download() {
        let controle = Controle::default();
        let previa = crate::previa::ControlePrevia::default();
        let ativa = controle.entrar_previa().unwrap();
        let rx = previa.iniciar(1).unwrap();
        let compartilhado = controle.0.clone();
        let tarefa = tokio::spawn(async move {
            let c = Controle(compartilhado);
            let p = previa;
            let g = c.entrar_atualizacao(&p).await.unwrap();
            (c, g)
        });
        let mut rx = rx;
        tokio::time::timeout(std::time::Duration::from_secs(1), rx.changed())
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(
            controle.entrar_previa(),
            Err("ATUALIZACAO_EM_ANDAMENTO")
        ));
        drop(ativa);
        let (c, guarda) = tarefa.await.unwrap();
        assert!(c.0.lock().unwrap().atualizacao);
        drop(guarda);
        assert!(!c.0.lock().unwrap().atualizacao);
        c.0.lock().unwrap().ativo = Some(EstadoDownload {
            download_id: "id".into(),
            percentual: None,
            etapa: "baixando_video".into(),
            previa: None,
        });
        assert!(matches!(
            c.entrar_atualizacao(&crate::previa::ControlePrevia::default())
                .await,
            Err("DOWNLOAD_EM_ANDAMENTO")
        ));
    }
    #[tokio::test]
    async fn fixture_rejeita_ffmpeg_quebrado() {
        let script =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/preparar-bin.mjs");
        let dir = tempfile::tempdir().unwrap();
        let destino = tempfile::tempdir().unwrap();
        assert!(
            std::process::Command::new("node")
                .arg(script)
                .arg(dir.path())
                .args(["--ffmpeg", "quebrado"])
                .output()
                .unwrap()
                .status
                .success()
        );
        let controle = Arc::new(Mutex::new(Dados::default()));
        let canal = Channel::new(|_| Ok(()));
        let erro = executar_interno(
            &controle,
            &canal,
            "https://instagram.com/reel/test/",
            destino.path(),
            &dir.path().join("clipora-yt-dlp"),
            &dir.path().join("clipora-ffmpeg"),
            None,
        )
        .await
        .err()
        .unwrap();
        assert_eq!(erro.codigo, "FFMPEG_INDISPONIVEL");
    }
    #[tokio::test]
    async fn fixture_rejeita_ffmpeg_ausente() {
        let fixtures = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/bin");
        let dir = tempfile::tempdir().unwrap();
        let controle = Arc::new(Mutex::new(Dados::default()));
        let canal = Channel::new(|_| Ok(()));
        let erro = executar_interno(
            &controle,
            &canal,
            "https://instagram.com/reel/test/",
            dir.path(),
            &fixtures.join("clipora-yt-dlp"),
            &dir.path().join("ausente"),
            Some("sucesso"),
        )
        .await
        .err()
        .unwrap();
        assert_eq!(erro.codigo, "FFMPEG_INDISPONIVEL");
    }
    #[tokio::test]
    async fn fixture_envia_progresso_de_video_e_audio_sem_recuar() {
        let fixtures = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/bin");
        let dir = tempfile::tempdir().unwrap();
        let controle = Arc::new(Mutex::new(Dados::default()));
        let mensagens = Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
        let recebidas = mensagens.clone();
        let canal = Channel::new(move |mensagem| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = mensagem {
                recebidas
                    .lock()
                    .unwrap()
                    .push(serde_json::from_str(&json).unwrap());
            }
            Ok(())
        });
        executar_interno(
            &controle,
            &canal,
            "https://instagram.com/reel/test/",
            dir.path(),
            &fixtures.join("clipora-yt-dlp"),
            &fixtures.join("clipora-ffmpeg"),
            Some("sucesso"),
        )
        .await
        .unwrap();
        let mensagens = mensagens.lock().unwrap();
        assert!(mensagens.iter().any(|v| v["etapa"] == "baixando_video"));
        assert!(mensagens.iter().any(|v| v["etapa"] == "baixando_audio"));
        let valores: Vec<f64> = mensagens
            .iter()
            .filter_map(|v| v["percentual"].as_f64())
            .collect();
        assert!(valores.windows(2).all(|w| w[0] <= w[1]));
    }
    #[tokio::test]
    async fn fixtures_testam_sucesso_e_falhas() {
        let fixtures = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/bin");
        assert!(fixtures.join("clipora-yt-dlp").is_file(), "fixture ausente");
        for (cenario, esperado) in [
            ("sucesso", None),
            ("ja-baixado", Some("ARQUIVO_INCOMPLETO")),
            ("sem-arquivo", Some("ARQUIVO_INCOMPLETO")),
            ("arquivo-vazio", Some("ARQUIVO_INCOMPLETO")),
            ("so-part", Some("ARQUIVO_INCOMPLETO")),
            ("caminho-fora", Some("ARQUIVO_INCOMPLETO")),
            ("rede-cai", Some("SEM_CONEXAO")),
            ("sem-espaco", Some("ESPACO_INSUFICIENTE")),
            ("download-varios-itens", Some("CONTEUDO_NAO_SUPORTADO")),
        ] {
            let dir = tempfile::tempdir().unwrap();
            let controle = Arc::new(Mutex::new(Dados::default()));
            let canal = Channel::new(|_| Ok(()));
            let resultado = executar_interno(
                &controle,
                &canal,
                "https://instagram.com/reel/test/",
                dir.path(),
                &fixtures.join("clipora-yt-dlp"),
                &fixtures.join("clipora-ffmpeg"),
                Some(cenario),
            )
            .await;
            match esperado {
                Some(codigo) => assert_eq!(
                    resultado.err().map(|e| e.codigo),
                    Some(codigo.to_string()),
                    "{cenario}"
                ),
                None => assert!(resultado.is_ok(), "{cenario}: {:?}", resultado.err()),
            }
            if cenario == "download-varios-itens" {
                assert_eq!(
                    fs::read_dir(dir.path()).unwrap().count(),
                    0,
                    "nenhum arquivo ou temporário pode restar"
                );
            }
        }
    }
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "exige CLIPORA_TEST_VOLUME apontando para volume exFAT ou FAT32 montado"]
    fn finalizar_em_volume_sem_hardlink() {
        let raiz = PathBuf::from(
            std::env::var_os("CLIPORA_TEST_VOLUME").expect("defina CLIPORA_TEST_VOLUME"),
        );
        let dir = tempfile::Builder::new()
            .prefix("clipora-teste-")
            .tempdir_in(&raiz)
            .unwrap();
        let origem = dir.path().join("origem.mp4");
        fs::write(&origem, b"novo arquivo").unwrap();
        fs::write(dir.path().join("video.mp4"), b"original").unwrap();
        let tentativa = fs::hard_link(&origem, dir.path().join("teste-link"));
        println!("volume={} hard_link={:?}", raiz.display(), tentativa);
        assert!(tentativa.is_err(), "o teste exige sistema sem hard links");
        let (caminho, renomeado) = finalizar(&origem, dir.path(), "video").unwrap();
        println!("finalizado={} renomeado={renomeado}", caminho.display());
        assert!(renomeado);
        assert_eq!(caminho.file_name().unwrap(), "video (2).mp4");
        assert_eq!(fs::read(dir.path().join("video.mp4")).unwrap(), b"original");
        assert_eq!(fs::read(caminho).unwrap(), b"novo arquivo");
        assert!(!origem.exists());
    }
    #[tokio::test]
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    #[ignore = "download real, exige rede e sidecars LGPL macOS arm64"]
    async fn download_real_sidecars_lgpl() {
        let binarios = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
        let yt = binarios
            .join("yt-dlp")
            .join(format!("yt-dlp{}", std::env::consts::EXE_SUFFIX));
        let ffmpeg = binarios.join("clipora-ffmpeg-aarch64-apple-darwin");
        let ffprobe = binarios.join("clipora-ffprobe-aarch64-apple-darwin");
        let pasta = tempfile::tempdir().unwrap();
        let controle = Arc::new(Mutex::new(Dados::default()));
        let canal = Channel::new(|_| Ok(()));
        let url = "https://www.instagram.com/reel/DUl354timp1/";
        let (arquivo, _) =
            executar_interno(&controle, &canal, url, pasta.path(), &yt, &ffmpeg, None)
                .await
                .expect("download real falhou");
        let saida = std::process::Command::new(&ffprobe)
            .args([
                "-v",
                "error",
                "-show_entries",
                "stream=codec_type",
                "-of",
                "csv=p=0",
            ])
            .arg(&arquivo)
            .output()
            .unwrap();
        let tipos = String::from_utf8_lossy(&saida.stdout);
        println!(
            "{url}: bytes={} ffprobe={:?} tipos={:?}",
            fs::metadata(&arquivo).unwrap().len(),
            saida.status.code(),
            tipos.trim()
        );
        assert!(
            saida.status.success()
                && tipos.lines().any(|t| t == "video")
                && tipos.lines().any(|t| t == "audio"),
            "{}",
            String::from_utf8_lossy(&saida.stderr)
        );
    }
    #[test]
    fn copia_de_ultimo_recurso_nao_sobrescreve() {
        let dir = tempfile::tempdir().unwrap();
        let origem = dir.path().join("origem");
        let destino = dir.path().join("destino");
        fs::write(&origem, b"novo").unwrap();
        fs::write(&destino, b"antigo").unwrap();
        assert_eq!(
            copiar_exclusivo(&origem, &destino).unwrap_err().kind(),
            io::ErrorKind::AlreadyExists
        );
        assert_eq!(fs::read(&destino).unwrap(), b"antigo");
        assert_eq!(fs::read(&origem).unwrap(), b"novo");
        let outro = dir.path().join("outro");
        copiar_exclusivo(&origem, &outro).unwrap();
        assert_eq!(fs::read(outro).unwrap(), b"novo");
        assert!(!origem.exists());
    }
    #[test]
    fn fallback_exclusivo_preserva_colisoes_quando_link_nao_funciona() {
        let dir = tempfile::tempdir().unwrap();
        let origem = dir.path().join("origem");
        fs::write(&origem, b"novo").unwrap();
        fs::write(dir.path().join("video.mp4"), b"original").unwrap();
        let (caminho, renomeado) = finalizar_com(&origem, dir.path(), "video", |_, _| {
            Err(io::Error::from_raw_os_error(libc::ENOTSUP))
        })
        .unwrap();
        assert!(renomeado);
        assert_eq!(caminho.file_name().unwrap(), "video (2).mp4");
        assert_eq!(fs::read(dir.path().join("video.mp4")).unwrap(), b"original");
        assert_eq!(fs::read(caminho).unwrap(), b"novo");
        assert!(!origem.exists());
    }
    #[test]
    fn nome_unicode_longo_cabe_em_um_componente() {
        let metadados = MetadadosNome {
            descricao: Some("🎬 ".repeat(500)),
            ..Default::default()
        };
        let nome = nome_base(
            &metadados,
            &"a".repeat(120),
            crate::links::Plataforma::Instagram,
        );
        assert!(nome.len() + " (100000).mp4".len() <= 255);
    }
    #[test]
    fn nome_sanitizado_e_colisao_preserva_originais() {
        let dir = tempfile::tempdir().unwrap();
        let origem = dir.path().join("origem.mp4");
        std::fs::write(&origem, b"novo").unwrap();
        let metadados = MetadadosNome {
            titulo: Some("Título: teste".into()),
            ..Default::default()
        };
        let nome = nome_base(&metadados, "123", crate::links::Plataforma::Instagram);
        std::fs::write(dir.path().join(format!("{nome}.mp4")), b"original").unwrap();
        std::fs::write(dir.path().join(format!("{nome} (2).mp4")), b"segundo").unwrap();
        let (finalizado, renomeado) = finalizar(&origem, dir.path(), &nome).unwrap();
        assert!(renomeado);
        assert_eq!(
            finalizado.file_name().unwrap(),
            format!("{nome} (3).mp4").as_str()
        );
        assert_eq!(
            std::fs::read(dir.path().join(format!("{nome}.mp4"))).unwrap(),
            b"original"
        );
        assert_eq!(std::fs::read(finalizado).unwrap(), b"novo");
        assert!(!nome.contains(':'));
    }
    #[test]
    fn progresso_combinado_e_indeterminado() {
        let mut p = Progresso::default();
        assert_eq!(p.ler("download:100:100:100%:h264:aac"), Some(Some(90.0)));
        assert_eq!(p.ler("download:10:NA:NA:h264:aac"), Some(None));
    }
    #[test]
    fn progresso_duas_partes_nunca_recua() {
        let mut progresso = Progresso::default();
        let a = progresso
            .ler("download:50:100:50.0%:h264:none")
            .unwrap()
            .unwrap();
        let b = progresso
            .ler("download:100:100:100.0%:h264:none")
            .unwrap()
            .unwrap();
        let c = progresso
            .ler("download:1:100:1.0%:none:aac")
            .unwrap()
            .unwrap();
        assert!(a <= b && b <= c);
    }
}

use crate::previa::ErroClipora;
use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, BufReader};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EstadoDownload {
    pub download_id: String,
    pub percentual: Option<f64>,
    pub etapa: String,
    pub previa: Option<crate::previa::Previa>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Estado {
    pub download: Option<EstadoDownload>,
    pub atualizacao_em_andamento: bool,
    pub ultimo_resultado: Option<ResultadoTerminal>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(
    tag = "tipo",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum ResultadoTerminal {
    Concluido {
        download_id: String,
        caminho: String,
        nome_arquivo: String,
        renomeado: bool,
    },
    Erro {
        download_id: String,
        erro: ErroClipora,
    },
}
#[derive(Default)]
pub struct Dados {
    pub ativo: Option<EstadoDownload>,
    pub previa: Option<crate::previa::Previa>,
    pub ultimo_resultado: Option<ResultadoTerminal>,
    pub atualizacao: bool,
    pub previas_ativas: usize,
    pub arquivos: std::collections::HashMap<String, PathBuf>,
    pub tarefa: Option<tokio::task::AbortHandle>,
    pub encerrando: bool,
    pub temporario: Option<PathBuf>,
    #[cfg(unix)]
    pub grupo: Option<Arc<crate::processos::Grupo>>,
    #[cfg(windows)]
    pub grupo: Option<Arc<crate::processos::GrupoWindows>>,
}
#[derive(Default)]
pub struct Controle(pub Arc<Mutex<Dados>>);
impl Controle {
    pub fn encerrar(&self) {
        if let Ok(mut dados) = self.0.lock() {
            dados.encerrando = true;
            if let Some(grupo) = dados.grupo.take() {
                grupo.terminar();
            }
            if let Some(tarefa) = dados.tarefa.take() {
                tarefa.abort();
            }
            if let Some(pasta) = dados.temporario.take() {
                let _ = fs::remove_dir_all(pasta);
            }
        }
    }
}
pub struct GuardaPrevia(Arc<Mutex<Dados>>);
impl Drop for GuardaPrevia {
    fn drop(&mut self) {
        if let Ok(mut d) = self.0.lock() {
            d.previas_ativas = d.previas_ativas.saturating_sub(1);
        }
    }
}
pub struct GuardaAtualizacao(Arc<Mutex<Dados>>);
impl Drop for GuardaAtualizacao {
    fn drop(&mut self) {
        let mut d = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        d.atualizacao = false;
    }
}
impl Controle {
    pub fn entrar_previa(&self) -> Result<GuardaPrevia, &'static str> {
        let mut d = self.0.lock().map_err(|_| "ERRO_INTERNO")?;
        if d.atualizacao {
            return Err("ATUALIZACAO_EM_ANDAMENTO");
        }
        d.previas_ativas += 1;
        Ok(GuardaPrevia(self.0.clone()))
    }
    pub async fn entrar_atualizacao(
        &self,
        previa: &crate::previa::ControlePrevia,
    ) -> Result<GuardaAtualizacao, &'static str> {
        {
            let mut d = self.0.lock().map_err(|_| "ERRO_INTERNO")?;
            if d.atualizacao {
                return Err("ATUALIZACAO_EM_ANDAMENTO");
            }
            if d.ativo.is_some() {
                return Err("DOWNLOAD_EM_ANDAMENTO");
            }
            d.atualizacao = true;
        }
        let guarda = GuardaAtualizacao(self.0.clone());
        previa.cancelar();
        loop {
            let count = self.0.lock().map_err(|_| "ERRO_INTERNO")?.previas_ativas;
            if count == 0 {
                return Ok(guarda);
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    }
}
struct RegistroGrupo {
    controle: Arc<Mutex<Dados>>,
    #[cfg(unix)]
    grupo: Arc<crate::processos::Grupo>,
    #[cfg(windows)]
    grupo: Arc<crate::processos::GrupoWindows>,
}
impl Drop for RegistroGrupo {
    fn drop(&mut self) {
        if let Ok(mut dados) = self.controle.lock() {
            if dados
                .grupo
                .as_ref()
                .is_some_and(|g| Arc::ptr_eq(g, &self.grupo))
            {
                dados.grupo = None;
            }
            dados.temporario = None;
        }
    }
}
// Somente diretórios antigos com prefixo próprio; não segue links simbólicos.
pub fn limpar_antigos(pasta: &Path) {
    if let Ok(entradas) = fs::read_dir(pasta) {
        for entrada in entradas.flatten() {
            if !entrada
                .file_name()
                .to_string_lossy()
                .starts_with(".clipora-")
            {
                continue;
            }
            let Ok(meta) = entrada.metadata() else {
                continue;
            };
            if !entrada
                .file_type()
                .is_ok_and(|t| t.is_dir() && !t.is_symlink())
            {
                continue;
            }
            if meta
                .modified()
                .ok()
                .and_then(|m| m.elapsed().ok())
                .is_some_and(|idade| idade >= std::time::Duration::from_secs(24 * 60 * 60))
            {
                let _ = fs::remove_dir_all(entrada.path());
            }
        }
    }
}
#[derive(Clone, Serialize)]
#[serde(
    tag = "tipo",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum Evento {
    Progresso {
        etapa: String,
        percentual: Option<f64>,
    },
    Concluido {
        caminho: String,
        nome_arquivo: String,
        renomeado: bool,
    },
    Erro {
        erro: ErroClipora,
    },
}
fn err(c: &str, detalhe: impl Into<String>) -> ErroClipora {
    ErroClipora::novo(c, Some(detalhe.into()))
}
fn etapa(controle: &Arc<Mutex<Dados>>, canal: &Channel<Evento>, nome: &str, pct: Option<f64>) {
    if let Ok(mut dados) = controle.lock()
        && let Some(ref mut ativo) = dados.ativo
    {
        ativo.etapa = nome.into();
        ativo.percentual = pct;
    }
    let _ = canal.send(Evento::Progresso {
        etapa: nome.into(),
        percentual: pct,
    });
}

fn concluir(
    controle: &Arc<Mutex<Dados>>,
    historico: &crate::historico::Repositorio,
    id: &str,
    url: &str,
    resultado: &Result<(PathBuf, bool), ErroClipora>,
) -> ResultadoTerminal {
    // Canonicaliza somente o pai: aceita aliases legítimos sem seguir substituição
    // do arquivo final por symlink. A validação na abertura rejeita esse arquivo.
    let canonico = resultado
        .as_ref()
        .map(|(p, renomeado)| {
            let caminho = p
                .parent()
                .and_then(|pai| pai.canonicalize().ok())
                .zip(p.file_name())
                .map(|(pai, nome)| pai.join(nome))
                .unwrap_or_else(|| p.clone());
            (caminho, *renomeado)
        })
        .map_err(Clone::clone);
    let resultado = &canonico;
    let terminal = match resultado {
        Ok((caminho, renomeado)) => ResultadoTerminal::Concluido {
            download_id: id.into(),
            caminho: caminho.to_string_lossy().into_owned(),
            nome_arquivo: caminho
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            renomeado: *renomeado,
        },
        Err(erro) => ResultadoTerminal::Erro {
            download_id: id.into(),
            erro: erro.clone(),
        },
    };
    if let Ok((caminho, _)) = resultado {
        let previa = controle
            .lock()
            .ok()
            .and_then(|d| d.ativo.as_ref().and_then(|a| a.previa.clone()));
        if let Ok((normalizada, plataforma)) = crate::links::validar(url) {
            let item = crate::historico::ItemHistorico {
                download_id: id.into(),
                url_original: previa
                    .as_ref()
                    .map(|p| p.url_original.clone())
                    .unwrap_or_else(|| url.into()),
                url_normalizada: previa
                    .as_ref()
                    .map(|p| p.url_normalizada.clone())
                    .unwrap_or_else(|| normalizada.to_string()),
                titulo: previa.and_then(|p| p.titulo),
                plataforma,
                caminho: caminho.to_string_lossy().into_owned(),
                nome_arquivo: caminho
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
                concluido_em: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64,
                disponivel: false,
            };
            // O repositório retém pendentes e comunica falha nas consultas, sem alterar o sucesso.
            let _ = historico.registrar(item);
        }
    }
    if let Ok(mut dados) = controle.lock() {
        if let Ok((caminho, _)) = resultado {
            dados.arquivos.insert(id.into(), caminho.clone());
        }
        dados.ativo = None;
        dados.ultimo_resultado = Some(terminal.clone());
        dados.tarefa = None;
        dados.grupo = None;
        dados.temporario = None;
    }
    terminal
}

#[cfg(test)]
mod historico_tests {
    use super::*;
    #[test]
    fn conclusao_preserva_original_da_previa_associada() {
        let dir = tempfile::tempdir().unwrap();
        let raiz = dir.path().canonicalize().unwrap();
        let arquivo = raiz.join("Vídeo [abc].mp4");
        fs::write(&arquivo, b"\x00\x00\x00\x18ftypisom").unwrap();
        let original = "http://instagram.com/reel/abc/?igsh=colado";
        let normalizada = "https://instagram.com/reel/abc/?igsh=colado";
        let controle = Arc::new(Mutex::new(Dados::default()));
        controle.lock().unwrap().ativo = Some(EstadoDownload {
            download_id: "previa-original".into(),
            percentual: None,
            etapa: "finalizando".into(),
            previa: Some(crate::previa::Previa {
                requisicao_id: 1,
                url_original: original.into(),
                url_normalizada: normalizada.into(),
                titulo: Some("Vídeo".into()),
                plataforma: crate::links::Plataforma::Instagram,
                duracao_segundos: None,
                capa_data_url: None,
            }),
        });
        let historico = crate::historico::Repositorio::novo(raiz.join("historico.json"));
        concluir(
            &controle,
            &historico,
            "previa-original",
            normalizada,
            &Ok((arquivo, false)),
        );
        let itens = historico.listar().unwrap();
        assert_eq!(itens[0].url_original, original);
        assert_eq!(itens[0].url_normalizada, normalizada);
    }
    #[cfg(unix)]
    #[test]
    fn conclusao_com_destino_alias_guarda_caminho_canonico() {
        let dir = tempfile::tempdir().unwrap();
        let raiz = dir.path().canonicalize().unwrap();
        let destino = raiz.join("real");
        fs::create_dir(&destino).unwrap();
        let alias = raiz.join("alias");
        std::os::unix::fs::symlink(&destino, &alias).unwrap();
        let arquivo = destino.join("Vídeo [abc].mp4");
        fs::write(
            &arquivo,
            b"\x00\x00\x00\x18ftypisom\x00\x00\x00\x00isommp42",
        )
        .unwrap();
        let controle = Arc::new(Mutex::new(Dados::default()));
        let h = crate::historico::Repositorio::novo(raiz.join("historico.json"));
        concluir(
            &controle,
            &h,
            "alias",
            "https://instagram.com/reel/abc/",
            &Ok((alias.join("Vídeo [abc].mp4"), false)),
        );
        assert_eq!(
            controle.lock().unwrap().arquivos.get("alias"),
            Some(&arquivo)
        );
        assert_eq!(h.caminho("alias").unwrap(), arquivo);
        assert!(h.listar().unwrap()[0].disponivel);
        fs::remove_file(&arquivo).unwrap();
        std::os::unix::fs::symlink(raiz.join("historico.json"), &arquivo).unwrap();
        assert!(h.caminho("alias").is_err());
    }
    #[test]
    fn so_sucesso_alimenta_historico_e_falha_de_persistencia_preserva_abertura() {
        let dir = tempfile::tempdir().unwrap();
        let raiz = dir.path().canonicalize().unwrap();
        let arquivo = raiz.join("Vídeo [abc].mp4");
        fs::write(
            &arquivo,
            b"\x00\x00\x00\x18ftypisom\x00\x00\x00\x00isommp42",
        )
        .unwrap();
        let controle = Arc::new(Mutex::new(Dados::default()));
        let h = crate::historico::Repositorio::novo(raiz.join("historico.json"));
        let url = "https://instagram.com/reel/abc/";
        assert!(matches!(
            concluir(
                &controle,
                &h,
                "falha",
                url,
                &Err(err("DOWNLOAD_FALHOU", "rede"))
            ),
            ResultadoTerminal::Erro { .. }
        ));
        assert!(h.listar().unwrap().is_empty());
        assert!(controle.lock().unwrap().arquivos.is_empty());
        fs::write(raiz.join("historico.json"), b"corrompido").unwrap();
        assert!(matches!(
            concluir(&controle, &h, "sucesso", url, &Ok((arquivo.clone(), false))),
            ResultadoTerminal::Concluido { .. }
        ));
        assert!(h.listar().is_err());
        assert_eq!(
            controle.lock().unwrap().arquivos.get("sucesso"),
            Some(&arquivo)
        );
        assert!(crate::historico::validar_arquivo(&arquivo).is_ok());
        fs::write(raiz.join("historico.json"), br#"{"versao":1,"itens":[]}"#).unwrap();
        let itens = h.listar().unwrap();
        assert_eq!(itens.len(), 1);
        assert_eq!(itens[0].download_id, "sucesso");
    }
}

pub async fn executar(
    controle: Arc<Mutex<Dados>>,
    historico: Arc<crate::historico::Repositorio>,
    canal: Channel<Evento>,
    id: String,
    url: String,
    pasta: PathBuf,
    ferramentas: (PathBuf, PathBuf),
) {
    let (bin, ffmpeg) = ferramentas;
    let resultado = executar_interno(
        &controle,
        &canal,
        &url,
        &pasta,
        &bin,
        &ffmpeg,
        #[cfg(test)]
        None,
    )
    .await;
    concluir(&controle, &historico, &id, &url, &resultado);
    match resultado {
        Ok((caminho, renomeado)) => {
            let nome_arquivo = caminho
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            let _ = canal.send(Evento::Concluido {
                caminho: caminho.to_string_lossy().into_owned(),
                nome_arquivo,
                renomeado,
            });
        }
        Err(erro) => {
            let _ = canal.send(Evento::Erro { erro });
        }
    }
}
async fn executar_interno(
    controle: &Arc<Mutex<Dados>>,
    canal: &Channel<Evento>,
    url: &str,
    destino: &Path,
    bin: &Path,
    ffmpeg: &Path,
    #[cfg(test)] cenario: Option<&str>,
) -> Result<(PathBuf, bool), ErroClipora> {
    use std::process::Stdio;
    use tokio::process::Command;
    // O endereço colado fica disponível para o histórico; processos externos
    // recebem exclusivamente a forma validada, incluindo o upgrade para HTTPS.
    let (normalizada, _) =
        crate::links::validar(url).map_err(|codigo| ErroClipora::novo(codigo, None))?;
    let url = normalizada.as_str();
    etapa(controle, canal, "preparando", None);
    if !ffmpeg.is_file() {
        return Err(err("FFMPEG_INDISPONIVEL", "FFmpeg ausente"));
    }
    let mut versao = Command::new(ffmpeg);
    versao
        .arg("-version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    versao.creation_flags(0x08000000);
    let status = tokio::time::timeout(std::time::Duration::from_secs(5), versao.status()).await;
    if !matches!(status, Ok(Ok(s)) if s.success()) {
        return Err(err(
            "FFMPEG_INDISPONIVEL",
            "FFmpeg não executável ou tempo esgotado",
        ));
    }
    let temp = tempfile::Builder::new()
        .prefix(".clipora-")
        .tempdir_in(destino)
        .map_err(|e| err("PASTA_SEM_PERMISSAO", e.to_string()))?;
    {
        let mut dados = controle
            .lock()
            .map_err(|_| err("ERRO_INTERNO", "estado indisponível"))?;
        if dados.encerrando {
            return Err(err("DOWNLOAD_FALHOU", "aplicativo encerrando"));
        }
        dados.temporario = Some(temp.path().to_path_buf());
    }
    let modelo = temp.path().join("%(id)s.%(ext)s");
    let mut comando = Command::new(bin);
    comando.args(["--ignore-config", "--no-update", "--no-playlist", "--ffmpeg-location"]).arg(ffmpeg)
        .args(["-f", "bv*+ba/b", "--merge-output-format", "mp4", "--remux-video", "mp4", "--newline", "--progress", "--progress-template", "download:download:%(progress.downloaded_bytes)s:%(progress.total_bytes,progress.total_bytes_estimate)s:%(progress._percent_str)s:%(info.vcodec)s:%(info.acodec)s", "--progress-template", "postprocess:postprocess:%(progress.status)s", "--print", "after_move:CLIPORA_RESULT:%(filepath)j\t%(title)j\t%(id)j\t%(description)j\t%(uploader_id)j\t%(uploader)j\t%(channel)j", "-o"]).arg(modelo).arg("--").arg(url)
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    #[cfg(test)]
    if let Some(cenario) = cenario {
        comando
            .env("CLIPORA_FALSO_CENARIO", cenario)
            .env("CLIPORA_FALSO_INTERVALO_MS", "40")
            .env("CLIPORA_FALSO_PASTA_FORA", destino);
    }
    #[cfg(unix)]
    comando.process_group(0);
    #[cfg(windows)]
    comando.creation_flags(0x08000000);
    let mut filho = comando.spawn().map_err(|e| {
        err(
            if matches!(
                e.kind(),
                io::ErrorKind::NotFound | io::ErrorKind::PermissionDenied
            ) {
                "YTDLP_INDISPONIVEL"
            } else {
                "DOWNLOAD_FALHOU"
            },
            e.to_string(),
        )
    })?;
    #[cfg(unix)]
    let grupo = Arc::new(crate::processos::Grupo(
        filho
            .id()
            .ok_or_else(|| err("ERRO_INTERNO", "PID ausente"))?,
    ));
    #[cfg(windows)]
    let grupo =
        Arc::new(crate::processos::GrupoWindows::novo(&filho).map_err(|e| err(e, "job Windows"))?);
    {
        let mut dados = controle
            .lock()
            .map_err(|_| err("ERRO_INTERNO", "estado indisponível"))?;
        if dados.encerrando {
            grupo.terminar();
            return Err(err("DOWNLOAD_FALHOU", "aplicativo encerrando"));
        }
        dados.grupo = Some(grupo.clone());
    }
    let _registro = RegistroGrupo {
        controle: controle.clone(),
        grupo: grupo.clone(),
    };
    let stdout = filho
        .stdout
        .take()
        .ok_or_else(|| err("ERRO_INTERNO", "stdout ausente"))?;
    let stderr = filho
        .stderr
        .take()
        .ok_or_else(|| err("ERRO_INTERNO", "stderr ausente"))?;
    let mut stdout = BufReader::new(stdout).lines();
    let mut stderr = BufReader::new(stderr).lines();
    let mut stdout_aberto = true;
    let mut stderr_aberto = true;
    let mut detalhe = String::new();
    let mut resultado: Option<Vec<String>> = None;
    let mut ja_baixado = false;
    let mut progresso = Progresso::default();
    let mut ultimo = std::time::Instant::now() - std::time::Duration::from_secs(1);
    while stdout_aberto || stderr_aberto {
        let (linha, eh_stderr) = tokio::select! {
            linha = stdout.next_line(), if stdout_aberto => (linha, false),
            linha = stderr.next_line(), if stderr_aberto => (linha, true),
        };
        let Some(linha) = linha.map_err(|e| err("DOWNLOAD_FALHOU", e.to_string()))? else {
            if eh_stderr {
                stderr_aberto = false;
            } else {
                stdout_aberto = false;
            }
            continue;
        };
        if eh_stderr && detalhe.len() < 1024 * 1024 {
            detalhe.push_str(&linha);
            detalhe.push('\n');
        }
        if linha.starts_with("[download]")
            && (linha.to_lowercase().contains("already been downloaded")
                || linha.to_lowercase().contains("already downloaded"))
        {
            ja_baixado = true;
        }
        if !eh_stderr && let Some(resto) = linha.strip_prefix("CLIPORA_RESULT:") {
            let valores: Vec<_> = resto.split('\t').map(str::to_owned).collect();
            if valores.len() == 7 {
                if resultado.is_some() {
                    return Err(err("CONTEUDO_NAO_SUPORTADO", "múltiplos arquivos"));
                }
                resultado = Some(valores);
            }
        }
        if linha.starts_with("postprocess:")
            && ultimo.elapsed() >= std::time::Duration::from_millis(100)
        {
            etapa(controle, canal, "unindo", Some(progresso.ultimo_global));
            ultimo = std::time::Instant::now();
        }
        if let Some(pct) = progresso.ler(&linha)
            && ultimo.elapsed() >= std::time::Duration::from_millis(100)
        {
            let nome = if progresso.parte == 0 {
                "baixando_video"
            } else {
                "baixando_audio"
            };
            etapa(controle, canal, nome, pct);
            ultimo = std::time::Instant::now();
        }
    }
    let status = filho
        .wait()
        .await
        .map_err(|e| err("DOWNLOAD_FALHOU", e.to_string()))?;
    if !status.success() {
        let codigo = if detalhe.to_lowercase().contains("ffmpeg not found")
            || detalhe.to_lowercase().contains("won't be merged")
        {
            "FFMPEG_INDISPONIVEL"
        } else if detalhe.to_lowercase().contains("no space left") {
            "ESPACO_INSUFICIENTE"
        } else {
            let c = crate::processos::classificar_erro(&detalhe);
            if c == "PREVIA_INDISPONIVEL" {
                "DOWNLOAD_FALHOU"
            } else {
                c
            }
        };
        return Err(err(codigo, detalhe));
    }
    if ja_baixado {
        return Err(err("ARQUIVO_INCOMPLETO", "already downloaded"));
    }
    let valores = resultado.ok_or_else(|| err("ARQUIVO_INCOMPLETO", "after_move ausente"))?;
    let caminho: String =
        serde_json::from_str(&valores[0]).map_err(|e| err("ARQUIVO_INCOMPLETO", e.to_string()))?;
    let metadados = MetadadosNome {
        titulo: campo_json_texto(&valores[1]),
        descricao: campo_json_texto(&valores[3]),
        uploader_id: campo_json_texto(&valores[4]),
        uploader: campo_json_texto(&valores[5]),
        channel: campo_json_texto(&valores[6]),
    };
    let id = campo_json_string(&valores[2])
        .and_then(|s| texto_nome(Some(&s)))
        .ok_or_else(|| err("ARQUIVO_INCOMPLETO", "id ausente no after_move"))?;
    let caminho = PathBuf::from(caminho)
        .canonicalize()
        .map_err(|e| err("ARQUIVO_INCOMPLETO", e.to_string()))?;
    let raiz = temp
        .path()
        .canonicalize()
        .map_err(|e| err("ARQUIVO_INCOMPLETO", e.to_string()))?;
    if !caminho.starts_with(&raiz)
        || caminho.extension().is_none_or(|e| e != "mp4")
        || !caminho.is_file()
        || fs::metadata(&caminho).map(|m| m.len()).unwrap_or(0) == 0
        || fs::read_dir(&raiz)
            .map_err(|e| err("ARQUIVO_INCOMPLETO", e.to_string()))?
            .any(|e| e.is_ok_and(|e| e.path().extension().is_some_and(|x| x == "part")))
    {
        return Err(err("ARQUIVO_INCOMPLETO", "arquivo inválido ou parcial"));
    }
    etapa(controle, canal, "finalizando", Some(95.0));
    let (_, plataforma) = crate::links::validar(url)
        .map_err(|codigo| err(codigo, "URL inválida ao formar o nome"))?;
    finalizar(&caminho, destino, &nome_base(&metadados, &id, plataforma))
        .map_err(|e| err("DOWNLOAD_FALHOU", e.to_string()))
}
