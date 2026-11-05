use crate::previa::ErroClipora;
use serde::{Deserialize, Serialize};

const RELEASE: &str = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Verificacao {
    pub versao_atual: String,
    pub versao_disponivel: Option<String>,
    pub atualizacao_disponivel: bool,
    pub origem: &'static str,
    pub erro_verificacao: Option<ErroClipora>,
}
#[derive(Deserialize)]
struct Release {
    tag_name: String,
}
pub(crate) fn partes(versao: &str) -> Option<Vec<u32>> {
    let partes: Vec<_> = versao
        .split('.')
        .map(str::parse::<u32>)
        .collect::<Result<_, _>>()
        .ok()?;
    if !(3..=4).contains(&partes.len()) {
        return None;
    }
    Some(partes)
}
pub(crate) fn comparar_versoes(a: &str, b: &str) -> Option<std::cmp::Ordering> {
    Some(partes(a)?.cmp(&partes(b)?))
}
pub async fn versao_local(bin: &std::path::Path) -> Result<String, ErroClipora> {
    let mut cmd = tokio::process::Command::new(bin);
    cmd.args(["--ignore-config", "--no-update", "--version"])
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    let out = tokio::time::timeout(std::time::Duration::from_secs(60), cmd.output())
        .await
        .map_err(|_| {
            ErroClipora::novo(
                "YTDLP_INDISPONIVEL",
                Some("tempo esgotado ao consultar versão".into()),
            )
        })?
        .map_err(|e| ErroClipora::novo("YTDLP_INDISPONIVEL", Some(e.to_string())))?;
    if !out.status.success() {
        return Err(ErroClipora::novo(
            "YTDLP_INDISPONIVEL",
            Some(String::from_utf8_lossy(&out.stderr).into_owned()),
        ));
    }
    let version = String::from_utf8(out.stdout)
        .map_err(|e| ErroClipora::novo("YTDLP_INDISPONIVEL", Some(e.to_string())))?
        .trim()
        .to_owned();
    if partes(&version).is_none() {
        return Err(ErroClipora::novo(
            "YTDLP_INDISPONIVEL",
            Some("versão inválida".into()),
        ));
    }
    Ok(version)
}
async fn consultar(cliente: &reqwest::Client, url: &str, atual: &str) -> Verificacao {
    let mut resultado = Verificacao {
        versao_atual: atual.into(),
        versao_disponivel: None,
        atualizacao_disponivel: false,
        origem: "empacotada",
        erro_verificacao: None,
    };
    let consulta = async {
        let resposta = cliente
            .get(url)
            .send()
            .await
            .map_err(|e| ("SEM_CONEXAO", e.to_string()))?;
        if resposta.status() == reqwest::StatusCode::TOO_MANY_REQUESTS
            || (resposta.status() == reqwest::StatusCode::FORBIDDEN
                && resposta
                    .headers()
                    .get("x-ratelimit-remaining")
                    .and_then(|h| h.to_str().ok())
                    == Some("0"))
        {
            return Err((
                "LIMITE_DE_ACESSO",
                format!("GitHub retornou {}", resposta.status()),
            ));
        }
        let mut resposta = resposta
            .error_for_status()
            .map_err(|e| ("ATUALIZACAO_FALHOU", e.to_string()))?;
        let mut bytes = Vec::new();
        while let Some(parte) = resposta
            .chunk()
            .await
            .map_err(|e| ("SEM_CONEXAO", e.to_string()))?
        {
            if bytes.len() + parte.len() > 1024 * 1024 {
                return Err(("ATUALIZACAO_FALHOU", "resposta grande".into()));
            }
            bytes.extend_from_slice(&parte);
        }
        let release: Release =
            serde_json::from_slice(&bytes).map_err(|e| ("ATUALIZACAO_FALHOU", e.to_string()))?;
        let remoto = partes(&release.tag_name)
            .ok_or(("ATUALIZACAO_FALHOU", "versão publicada inválida".into()))?;
        let local =
            partes(atual).ok_or(("ATUALIZACAO_FALHOU", "versão instalada inválida".into()))?;
        Ok::<_, (&str, String)>((release.tag_name, remoto > local))
    }
    .await;
    match consulta {
        Ok((versao, disponivel)) => {
            resultado.versao_disponivel = Some(versao);
            resultado.atualizacao_disponivel = disponivel;
        }
        Err((codigo, detalhe)) => {
            resultado.erro_verificacao = Some(ErroClipora::novo(codigo, Some(detalhe)))
        }
    }
    resultado
}
pub async fn verificar(bin: &std::path::Path) -> Result<Verificacao, ErroClipora> {
    let atual = versao_local(bin).await?;
    let cliente = reqwest::Client::builder()
        .user_agent("Clipora")
        .timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| ErroClipora::novo("ERRO_INTERNO", Some(e.to_string())))?;
    Ok(consultar(&cliente, RELEASE, &atual).await)
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    fn servidor(corpo: &'static str) -> String {
        servidor_status("200 OK", "", corpo)
    }
    fn servidor_status(status: &'static str, headers: &'static str, corpo: &'static str) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let endereco = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = [0u8; 4096];
            let _ = stream.read(&mut buf);
            write!(stream, "HTTP/1.1 {status}\r\n{headers}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", corpo.len(), corpo).unwrap();
        });
        format!("http://{endereco}/releases/latest")
    }
    #[tokio::test]
    async fn compara_versoes_e_distingue_offline() {
        let cliente = reqwest::Client::builder()
            .no_proxy()
            .timeout(std::time::Duration::from_secs(2))
            .build()
            .unwrap();
        let atual = consultar(
            &cliente,
            &servidor(r#"{"tag_name":"2026.10.26"}"#),
            "2026.10.26",
        )
        .await;
        assert!(!atual.atualizacao_disponivel && atual.erro_verificacao.is_none());
        let nova = consultar(
            &cliente,
            &servidor(r#"{"tag_name":"2026.11.05"}"#),
            "2026.10.26",
        )
        .await;
        assert!(nova.atualizacao_disponivel && nova.erro_verificacao.is_none());
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        drop(listener);
        let offline = consultar(&cliente, &format!("http://{addr}"), "2026.10.26").await;
        assert!(
            !offline.atualizacao_disponivel
                && offline.erro_verificacao.is_some()
                && offline.versao_disponivel.is_none()
        );
    }
    #[tokio::test]
    async fn rate_limit_do_github_tem_codigo_especifico() {
        let cliente = reqwest::Client::builder().no_proxy().build().unwrap();
        for (status, headers) in [
            ("429 Too Many Requests", ""),
            ("403 Forbidden", "X-RateLimit-Remaining: 0\r\n"),
        ] {
            let r = consultar(
                &cliente,
                &servidor_status(status, headers, "{}"),
                "2026.10.26",
            )
            .await;
            assert_eq!(r.erro_verificacao.unwrap().codigo, "LIMITE_DE_ACESSO");
        }
    }
}
