use std::{
    fs, io,
    path::{Path, PathBuf},
};

fn nome_base(titulo: &str, id: &str) -> String {
    fn limpar(s: &str, limite: usize) -> String {
        let texto: String = s
            .chars()
            .filter_map(|c| {
                if c.is_control() {
                    None
                } else if "<>:\"/\\|?*".contains(c) {
                    Some('_')
                } else {
                    Some(c)
                }
            })
            .take(120)
            .collect();
        let texto: String = texto
            .chars()
            .scan(0usize, |n, c| {
                *n += c.len_utf8();
                if *n <= limite { Some(c) } else { None }
            })
            .collect();
        let mut texto = texto
            .trim_matches(|c: char| c == '.' || c.is_whitespace())
            .to_string();
        if texto.is_empty() {
            texto = "Vídeo".into();
        }
        let upper = texto.split('.').next().unwrap_or("").to_ascii_uppercase();
        if [
            "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
            "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
        ]
        .contains(&upper.as_str())
        {
            texto.insert(0, '_');
        }
        texto
    }
    format!("{} [{}]", limpar(titulo, 160), limpar(id, 64))
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
    ultimo_parte: f64,
    parte: u8,
    ultimo_global: f64,
}
impl Progresso {
    fn ler(&mut self, linha: &str) -> Option<f64> {
        let valor = linha
            .strip_prefix("download:")?
            .rsplit(':')
            .next()?
            .trim()
            .trim_end_matches('%')
            .parse::<f64>()
            .ok()?;
        if !valor.is_finite() {
            return None;
        }
        let valor = valor.clamp(0.0, 100.0);
        if self.ultimo_parte >= 99.0 && valor < self.ultimo_parte - 20.0 {
            self.parte = 1;
        }
        self.ultimo_parte = valor;
        self.ultimo_global = self
            .ultimo_global
            .max((self.parte as f64 * 45.0 + valor * 0.45).min(90.0));
        Some(self.ultimo_global)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore = "download real, exige rede e yt-dlp local"]
    async fn downloads_reais_tem_audio_e_video() {
        let bin = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries/clipora-yt-dlp-aarch64-apple-darwin");
        let ffmpeg = Path::new("/opt/homebrew/bin/ffmpeg");
        for url in [
            "https://www.instagram.com/reel/DUl354timp1/",
            "https://tiktok.com/@scout2015/video/6718335390845095173",
        ] {
            let pasta = tempfile::tempdir().unwrap();
            let controle = Arc::new(Mutex::new(Dados::default()));
            let canal = Channel::new(|_| Ok(()));
            match executar_interno(&controle, &canal, url, pasta.path(), &bin, ffmpeg, None).await {
                Ok((arquivo, _)) => {
                    let saida = std::process::Command::new("/opt/homebrew/bin/ffprobe")
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
                }
                Err(e) => println!("{url}: ERRO {} {:?}", e.codigo, e.detalhe),
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
            ("rede-cai", Some("DOWNLOAD_FALHOU")),
            ("sem-espaco", Some("ESPACO_INSUFICIENTE")),
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
    #[ignore = "download real, exige rede e sidecars macOS arm64"]
    async fn download_real_sidecars_lgpl() {
        let binarios = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
        let yt = binarios.join("clipora-yt-dlp-aarch64-apple-darwin");
        let ffmpeg = binarios.join("clipora-ffmpeg-aarch64-apple-darwin");
        let ffprobe = binarios.join("clipora-ffprobe-aarch64-apple-darwin");
        let pasta = tempfile::tempdir().unwrap();
        let controle = Arc::new(Mutex::new(Dados::default()));
        let canal = Channel::new(|_| Ok(()));
        let url = "https://tiktok.com/@scout2015/video/6718335390845095173";
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
        assert!(
            nome_base(&"🎬".repeat(150), &"a".repeat(120)).len() + " (100000).mp4".len() <= 255
        );
    }
    #[test]
    fn nome_sanitizado_e_colisao_preserva_originais() {
        let dir = tempfile::tempdir().unwrap();
        let origem = dir.path().join("origem.mp4");
        std::fs::write(&origem, b"novo").unwrap();
        let nome = nome_base("Título: teste", "123");
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
    fn progresso_duas_partes_nunca_recua() {
        let mut progresso = Progresso::default();
        let a = progresso.ler("download:50:100:50.0%").unwrap();
        let b = progresso.ler("download:100:100:100.0%").unwrap();
        let c = progresso.ler("download:1:100:1.0%").unwrap();
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
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Estado {
    pub download: Option<EstadoDownload>,
    pub atualizacao_em_andamento: bool,
}
#[derive(Default)]
pub struct Dados {
    pub ativo: Option<EstadoDownload>,
    pub atualizacao: bool,
    pub arquivos: std::collections::HashMap<String, PathBuf>,
    pub tarefa: Option<tokio::task::AbortHandle>,
}
#[derive(Default)]
pub struct Controle(pub Arc<Mutex<Dados>>);
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

pub async fn executar(
    controle: Arc<Mutex<Dados>>,
    canal: Channel<Evento>,
    id: String,
    url: String,
    pasta: PathBuf,
    bin: PathBuf,
    ffmpeg: PathBuf,
) {
    let resultado = executar_interno(&controle, &canal, &url, &pasta, &bin, &ffmpeg, None).await;
    if let Ok(mut dados) = controle.lock() {
        if let Ok((ref caminho, _)) = resultado {
            dados.arquivos.insert(id, caminho.clone());
        }
        dados.ativo = None;
        dados.tarefa = None;
    }
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
    cenario: Option<&str>,
) -> Result<(PathBuf, bool), ErroClipora> {
    use std::process::Stdio;
    use tokio::process::Command;
    etapa(controle, canal, "preparando", None);
    if !ffmpeg.is_file() {
        return Err(err("FFMPEG_INDISPONIVEL", "FFmpeg ausente"));
    }
    let temp = tempfile::Builder::new()
        .prefix(".clipora-")
        .tempdir_in(destino)
        .map_err(|e| err("PASTA_SEM_PERMISSAO", e.to_string()))?;
    let modelo = temp.path().join("%(id)s.%(ext)s");
    let mut comando = Command::new(bin);
    comando.args(["--ignore-config", "--no-update", "--no-playlist", "--ffmpeg-location"]).arg(ffmpeg)
        .args(["-f", "bv*+ba/b", "--merge-output-format", "mp4", "--remux-video", "mp4", "--newline", "--progress", "--progress-template", "download:download:%(progress.downloaded_bytes)s:%(progress.total_bytes,progress.total_bytes_estimate)s:%(progress._percent_str)s", "--progress-template", "postprocess:postprocess:%(progress.status)s", "--print", "after_move:CLIPORA_RESULT:%(filepath)j\t%(title)j\t%(id)j", "-o"]).arg(modelo).arg("--").arg(url)
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    if let Some(cenario) = cenario {
        comando
            .env("CLIPORA_FALSO_CENARIO", cenario)
            .env("CLIPORA_FALSO_INTERVALO_MS", "40");
    }
    #[cfg(unix)]
    comando.process_group(0);
    #[cfg(windows)]
    comando.creation_flags(0x08000000);
    let mut filho = comando
        .spawn()
        .map_err(|e| err("DOWNLOAD_FALHOU", e.to_string()))?;
    #[cfg(unix)]
    let _grupo = crate::processos::Grupo(
        filho
            .id()
            .ok_or_else(|| err("ERRO_INTERNO", "PID ausente"))?,
    );
    #[cfg(windows)]
    let _grupo = crate::processos::GrupoWindows::novo(&filho).map_err(|e| err(e, "job Windows"))?;
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
    let mut resultado = None;
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
        if linha.to_lowercase().contains("already been downloaded")
            || linha.to_lowercase().contains("already downloaded")
        {
            ja_baixado = true;
        }
        if let Some(resto) = linha.strip_prefix("CLIPORA_RESULT:") {
            let valores: Vec<_> = resto.split('\t').collect();
            if valores.len() == 3 {
                resultado = Some((
                    valores[0].to_string(),
                    valores[1].to_string(),
                    valores[2].to_string(),
                ));
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
            etapa(controle, canal, nome, Some(pct));
            ultimo = std::time::Instant::now();
        }
    }
    let status = filho
        .wait()
        .await
        .map_err(|e| err("DOWNLOAD_FALHOU", e.to_string()))?;
    if !status.success() {
        let codigo = if detalhe.to_lowercase().contains("no space left") {
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
    let (caminho, titulo, id) =
        resultado.ok_or_else(|| err("ARQUIVO_INCOMPLETO", "after_move ausente"))?;
    let caminho: String =
        serde_json::from_str(&caminho).map_err(|e| err("ARQUIVO_INCOMPLETO", e.to_string()))?;
    let titulo: String =
        serde_json::from_str(&titulo).map_err(|e| err("ARQUIVO_INCOMPLETO", e.to_string()))?;
    let id: String =
        serde_json::from_str(&id).map_err(|e| err("ARQUIVO_INCOMPLETO", e.to_string()))?;
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
    finalizar(&caminho, destino, &nome_base(&titulo, &id))
        .map_err(|e| err("DOWNLOAD_FALHOU", e.to_string()))
}
