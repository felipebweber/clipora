use std::{path::Path, process::Stdio};
use tokio::{process::Command, sync::watch};

pub fn classificar_erro(texto: &str) -> &'static str {
    let s = texto
        .lines()
        .filter_map(|l| l.trim_start().strip_prefix("ERROR:"))
        .collect::<Vec<_>>()
        .join("\n")
        .to_lowercase();
    if ["sign in", "login required", "log in"]
        .iter()
        .any(|v| s.contains(v))
    {
        "LOGIN_NECESSARIO"
    } else if ["429", "too many requests", "rate limit", "rate-limit"]
        .iter()
        .any(|v| s.contains(v))
    {
        "LIMITE_DE_ACESSO"
    } else if [
        "private",
        "deleted",
        "removed",
        "video not available",
        "no longer available",
    ]
    .iter()
    .any(|v| s.contains(v))
    {
        "CONTEUDO_PRIVADO_OU_REMOVIDO"
    } else if [
        "resolve host",
        "failed to resolve",
        "name resolution",
        "getaddrinfo",
        "nodename nor servname",
        "connection broken",
        "connection reset",
        "incompleteread",
        "timed out",
        "network is unreachable",
        "connection refused",
        "connection error",
    ]
    .iter()
    .any(|v| s.contains(v))
    {
        "SEM_CONEXAO"
    } else if ["unsupported url", "not supported", "there is no video"]
        .iter()
        .any(|v| s.contains(v))
    {
        "CONTEUDO_NAO_SUPORTADO"
    } else {
        "PREVIA_INDISPONIVEL"
    }
}

pub struct Resultado {
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub sucesso: bool,
}

// O grupo é encerrado também ao abandonar a future ou sair do aplicativo.
#[cfg(unix)]
pub(crate) struct Grupo(pub(crate) u32);
#[cfg(unix)]
impl Grupo {
    pub(crate) fn terminar(&self) {
        unsafe {
            libc::kill(-(self.0 as i32), libc::SIGKILL);
        }
    }
}
#[cfg(unix)]
impl Drop for Grupo {
    fn drop(&mut self) {
        unsafe {
            libc::kill(-(self.0 as i32), libc::SIGKILL);
        }
    }
}

#[cfg(windows)]
pub(crate) struct GrupoWindows(isize);
#[cfg(windows)]
impl GrupoWindows {
    pub(crate) fn terminar(&self) {
        unsafe {
            windows_sys::Win32::System::JobObjects::TerminateJobObject(self.0 as _, 1);
        }
    }
    /// Atribui ao Job um filho criado com [`FLAGS_FILHO_WINDOWS`] (suspenso) e só então
    /// retoma sua thread principal, para que nenhum descendente nasça fora do Job.
    /// Em qualquer falha o filho suspenso é encerrado antes de retornar o erro.
    pub(crate) fn novo(child: &tokio::process::Child) -> Result<Self, &'static str> {
        use windows_sys::Win32::{
            Foundation::CloseHandle,
            System::{
                JobObjects::{
                    AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
                    SetInformationJobObject,
                },
                Threading::TerminateProcess,
            },
        };
        let (handle, pid) = match (child.raw_handle(), child.id()) {
            (Some(h), Some(pid)) => (h, pid),
            _ => return Err("ERRO_INTERNO"),
        };
        unsafe {
            let falhar = |job: windows_sys::Win32::Foundation::HANDLE| {
                if !job.is_null() {
                    CloseHandle(job);
                }
                TerminateProcess(handle as _, 1);
                Err("ERRO_INTERNO")
            };
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return falhar(job);
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of_val(&info) as u32,
            ) == 0
                || AssignProcessToJobObject(job, handle as _) == 0
                || !retomar_threads(pid)
            {
                return falhar(job);
            }
            Ok(Self(job as isize))
        }
    }
}

/// `CREATE_NO_WINDOW | CREATE_SUSPENDED`: todo filho acompanhado por [`GrupoWindows`]
/// nasce suspenso e só é retomado depois de atribuído ao Job (R03).
#[cfg(windows)]
pub(crate) const FLAGS_FILHO_WINDOWS: u32 = 0x0800_0000 | 0x0000_0004;

/// A biblioteca padrão descarta o handle da thread principal; localiza as threads do
/// processo recém-criado (ainda suspenso, portanto só a principal) e as retoma.
#[cfg(windows)]
fn retomar_threads(pid: u32) -> bool {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, INVALID_HANDLE_VALUE},
        System::{
            Diagnostics::ToolHelp::{
                CreateToolhelp32Snapshot, TH32CS_SNAPTHREAD, THREADENTRY32, Thread32First,
                Thread32Next,
            },
            Threading::{OpenThread, ResumeThread, THREAD_SUSPEND_RESUME},
        },
    };
    unsafe {
        let foto = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
        if foto == INVALID_HANDLE_VALUE {
            return false;
        }
        let mut entrada: THREADENTRY32 = std::mem::zeroed();
        entrada.dwSize = std::mem::size_of::<THREADENTRY32>() as u32;
        let mut retomadas = 0usize;
        let mut falhou = false;
        let mut ha = Thread32First(foto, &mut entrada) != 0;
        while ha {
            if entrada.th32OwnerProcessID == pid {
                let thread = OpenThread(THREAD_SUSPEND_RESUME, 0, entrada.th32ThreadID);
                if thread.is_null() || ResumeThread(thread) == u32::MAX {
                    falhou = true;
                } else {
                    retomadas += 1;
                }
                if !thread.is_null() {
                    CloseHandle(thread);
                }
            }
            ha = Thread32Next(foto, &mut entrada) != 0;
        }
        CloseHandle(foto);
        retomadas > 0 && !falhou
    }
}
#[cfg(windows)]
impl Drop for GrupoWindows {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0 as _);
        }
    }
}

pub async fn executar(
    bin: &Path,
    ffmpeg: &Path,
    url: &str,
    cancelado: watch::Receiver<bool>,
) -> Result<Resultado, &'static str> {
    let args: Vec<std::ffi::OsString> = vec![
        "--ignore-config".into(),
        "--no-update".into(),
        "--no-playlist".into(),
        "--ffmpeg-location".into(),
        ffmpeg.as_os_str().into(),
        "--dump-single-json".into(),
        "--skip-download".into(),
        "--".into(),
        url.into(),
    ];
    executar_args(bin, args, cancelado).await
}

async fn executar_args(
    bin: &Path,
    args: Vec<std::ffi::OsString>,
    cancelado: watch::Receiver<bool>,
) -> Result<Resultado, &'static str> {
    executar_limitado(
        bin,
        args,
        cancelado,
        std::time::Duration::from_secs(30),
        8 * 1024 * 1024,
    )
    .await
}

pub(crate) async fn executar_limitado(
    bin: &Path,
    args: Vec<std::ffi::OsString>,
    cancelado: watch::Receiver<bool>,
    prazo: std::time::Duration,
    limite: usize,
) -> Result<Resultado, &'static str> {
    executar_limitado_com_entrada(bin, args, None, cancelado, prazo, limite).await
}

pub(crate) async fn executar_com_entrada_limitado(
    bin: &Path,
    args: Vec<std::ffi::OsString>,
    entrada: Vec<u8>,
    cancelado: watch::Receiver<bool>,
    prazo: std::time::Duration,
    limite: usize,
) -> Result<Resultado, &'static str> {
    executar_limitado_com_entrada(bin, args, Some(entrada), cancelado, prazo, limite).await
}

async fn executar_limitado_com_entrada(
    bin: &Path,
    args: Vec<std::ffi::OsString>,
    entrada: Option<Vec<u8>>,
    mut cancelado: watch::Receiver<bool>,
    prazo: std::time::Duration,
    limite: usize,
) -> Result<Resultado, &'static str> {
    use tokio::io::AsyncReadExt;
    if *cancelado.borrow() {
        return Err("PREVIA_CANCELADA");
    }
    let mut cmd = Command::new(bin);
    cmd.args(args)
        .stdin(if entrada.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    cmd.process_group(0);
    #[cfg(windows)]
    cmd.creation_flags(FLAGS_FILHO_WINDOWS);
    let mut filho = cmd.spawn().map_err(|e| {
        if matches!(
            e.kind(),
            std::io::ErrorKind::NotFound | std::io::ErrorKind::PermissionDenied
        ) {
            "YTDLP_INDISPONIVEL"
        } else {
            "PREVIA_INDISPONIVEL"
        }
    })?;
    #[cfg(unix)]
    let _grupo = Grupo(filho.id().ok_or("ERRO_INTERNO")?);
    #[cfg(windows)]
    let _grupo = GrupoWindows::novo(&filho)?;
    async fn ler(
        r: impl tokio::io::AsyncRead + Unpin,
        limite: usize,
    ) -> Result<Vec<u8>, &'static str> {
        let mut bytes = Vec::new();
        r.take(limite as u64 + 1)
            .read_to_end(&mut bytes)
            .await
            .map_err(|_| "PREVIA_INDISPONIVEL")?;
        if bytes.len() > limite {
            return Err("PREVIA_INDISPONIVEL");
        }
        Ok(bytes)
    }
    let stdout = filho.stdout.take().ok_or("ERRO_INTERNO")?;
    let stderr = filho.stderr.take().ok_or("ERRO_INTERNO")?;
    let stdin = entrada
        .as_ref()
        .map(|_| filho.stdin.take().ok_or("ERRO_INTERNO"))
        .transpose()?;
    let trabalho = async {
        use tokio::io::AsyncWriteExt;
        let enviar_entrada = async {
            if let (Some(mut stdin), Some(bytes)) = (stdin, entrada) {
                stdin
                    .write_all(&bytes)
                    .await
                    .map_err(|_| "PREVIA_INDISPONIVEL")?;
                stdin.shutdown().await.map_err(|_| "PREVIA_INDISPONIVEL")?;
            }
            Ok::<(), &'static str>(())
        };
        let (stdout, stderr, status, ()) = tokio::try_join!(
            ler(stdout, limite),
            ler(stderr, limite),
            async { filho.wait().await.map_err(|_| "PREVIA_INDISPONIVEL") },
            enviar_entrada
        )?;
        Ok(Resultado {
            stdout,
            stderr,
            sucesso: status.success(),
        })
    };
    tokio::select! {biased; _=cancelado.changed()=>Err("PREVIA_CANCELADA"),r=tokio::time::timeout(prazo,trabalho)=>r.map_err(|_|"TEMPO_ESGOTADO")?}
}

pub(crate) fn isolamento_youtube(deno: &Path) -> Vec<std::ffi::OsString> {
    [
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
    .chain([std::ffi::OsString::from(format!("deno:{}", deno.display()))])
    .collect()
}

pub(crate) async fn metadados_youtube(
    bin: &Path,
    ffmpeg: &Path,
    url: &str,
    deno: &Path,
    cancelado: watch::Receiver<bool>,
) -> Result<Resultado, &'static str> {
    let mut args: Vec<std::ffi::OsString> = [
        "--ignore-config",
        "--no-update",
        "--no-playlist",
        "--ffmpeg-location",
    ]
    .into_iter()
    .map(Into::into)
    .collect();
    args.push(ffmpeg.as_os_str().into());
    args.extend(isolamento_youtube(deno));
    args.extend([
        "--dump-single-json".into(),
        "--skip-download".into(),
        "--".into(),
        url.into(),
    ]);
    executar_limitado(
        bin,
        args,
        cancelado,
        std::time::Duration::from_secs(30),
        8 * 1024 * 1024,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    #[tokio::test]
    async fn executar_com_entrada_encaminha_stdin_e_limita_saidas() {
        let (_tx, rx) = watch::channel(false);
        let resultado = executar_com_entrada_limitado(
            Path::new("/bin/cat"),
            vec![],
            b"smoke local\n".to_vec(),
            rx,
            std::time::Duration::from_secs(2),
            128,
        )
        .await
        .unwrap();
        assert!(resultado.sucesso);
        assert_eq!(resultado.stdout, b"smoke local\n");
        assert!(resultado.stderr.is_empty());
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn limite_de_saida_recusa_processo_acima_do_teto() {
        let (_tx, rx) = watch::channel(false);
        let resultado = executar_limitado(
            Path::new("/bin/sh"),
            vec!["-c".into(), "yes x".into()],
            rx,
            std::time::Duration::from_secs(2),
            64,
        )
        .await;
        assert!(matches!(resultado, Err("PREVIA_INDISPONIVEL")));
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn timeout_do_runner_retorna_codigo_especifico() {
        let (_tx, rx) = watch::channel(false);
        let resultado = executar_limitado(
            Path::new("/bin/sleep"),
            vec!["20".into()],
            rx,
            std::time::Duration::from_millis(50),
            64,
        )
        .await;
        assert!(matches!(resultado, Err("TEMPO_ESGOTADO")));
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn cancelamento_interrompe_processo_em_execucao() {
        let (tx, rx) = watch::channel(false);
        let processo = tokio::spawn(async move {
            executar_args(Path::new("/bin/sleep"), vec!["20".into()], rx).await
        });
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        tx.send(true).unwrap();
        let resultado = tokio::time::timeout(std::time::Duration::from_secs(2), processo)
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(resultado, Err("PREVIA_CANCELADA")));
    }
    #[test]
    fn classifica_somente_linhas_de_erro_e_falhas_de_rede() {
        assert_eq!(
            classificar_erro("WARNING: login required\nERROR: Failed to resolve hostname"),
            "SEM_CONEXAO"
        );
        assert_eq!(
            classificar_erro("ERROR: video not available"),
            "CONTEUDO_PRIVADO_OU_REMOVIDO"
        );
        assert_eq!(
            classificar_erro("ERROR: There is no video in this post"),
            "CONTEUDO_NAO_SUPORTADO"
        );
        assert_eq!(
            classificar_erro("ERROR: Connection broken: IncompleteRead"),
            "SEM_CONEXAO"
        );
        assert_eq!(
            classificar_erro("ERROR: rate-limit reached or login required"),
            "LOGIN_NECESSARIO"
        );
    }
    #[test]
    fn classifica_falhas_especificas_antes_da_generica() {
        for (saida, esperado) in [
            ("ERROR: Sign in to confirm your age", "LOGIN_NECESSARIO"),
            (
                "ERROR: This video is private or deleted",
                "CONTEUDO_PRIVADO_OU_REMOVIDO",
            ),
            (
                "ERROR: HTTP Error 429: Too Many Requests",
                "LIMITE_DE_ACESSO",
            ),
            ("ERROR: Unable to resolve host", "SEM_CONEXAO"),
            ("ERROR: Unsupported URL", "CONTEUDO_NAO_SUPORTADO"),
            ("ERROR: extractor failed", "PREVIA_INDISPONIVEL"),
        ] {
            assert_eq!(classificar_erro(saida), esperado);
        }
    }
}
