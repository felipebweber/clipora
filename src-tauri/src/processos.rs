use std::{path::Path, process::Stdio};
use tokio::{process::Command, sync::watch};

pub fn classificar_erro(texto: &str) -> &'static str {
    let s = texto.to_lowercase();
    if s.contains("sign in") || s.contains("login required") || s.contains("log in") {
        "LOGIN_NECESSARIO"
    } else if s.contains("private") || s.contains("deleted") || s.contains("removed") {
        "CONTEUDO_PRIVADO_OU_REMOVIDO"
    } else if s.contains("429") || s.contains("too many requests") || s.contains("rate limit") {
        "LIMITE_DE_ACESSO"
    } else if s.contains("resolve host")
        || s.contains("network is unreachable")
        || s.contains("connection refused")
        || s.contains("connection error")
    {
        "SEM_CONEXAO"
    } else if s.contains("unsupported url") || s.contains("not supported") {
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
struct Grupo(u32);
#[cfg(unix)]
impl Drop for Grupo {
    fn drop(&mut self) {
        unsafe {
            libc::kill(-(self.0 as i32), libc::SIGKILL);
        }
    }
}

#[cfg(windows)]
struct GrupoWindows(isize);
#[cfg(windows)]
impl GrupoWindows {
    fn novo(child: &tokio::process::Child) -> Result<Self, &'static str> {
        use windows_sys::Win32::{
            Foundation::CloseHandle,
            System::JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
                SetInformationJobObject,
            },
        };
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return Err("ERRO_INTERNO");
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let handle = match child.raw_handle() {
                Some(h) => h,
                None => {
                    CloseHandle(job);
                    return Err("ERRO_INTERNO");
                }
            };
            if SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of_val(&info) as u32,
            ) == 0
                || AssignProcessToJobObject(job, handle as _) == 0
            {
                CloseHandle(job);
                return Err("ERRO_INTERNO");
            }
            Ok(Self(job as isize))
        }
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
    mut cancelado: watch::Receiver<bool>,
) -> Result<Resultado, &'static str> {
    let mut cmd = Command::new(bin);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    cmd.process_group(0);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    let child = cmd.spawn().map_err(|_| "PREVIA_INDISPONIVEL")?;
    #[cfg(unix)]
    let _grupo = Grupo(child.id().ok_or("ERRO_INTERNO")?);
    #[cfg(windows)]
    let _grupo = GrupoWindows::novo(&child)?;
    let output = tokio::select! {
        biased;
        _ = cancelado.changed() => return Err("PREVIA_CANCELADA"),
        r = tokio::time::timeout(std::time::Duration::from_secs(30), child.wait_with_output()) => r.map_err(|_| "TEMPO_ESGOTADO")?.map_err(|_| "PREVIA_INDISPONIVEL")?,
    };
    Ok(Resultado {
        stdout: output.stdout,
        stderr: output.stderr,
        sucesso: output.status.success(),
    })
}
#[cfg(test)]
mod tests {
    use super::*;
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
