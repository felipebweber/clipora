use crate::{links::Plataforma, processos};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tokio::sync::watch;

#[derive(Default)]
pub struct ControlePrevia(Mutex<Option<(u64, watch::Sender<bool>)>>);
impl ControlePrevia {
    pub fn iniciar(&self, id: u64) -> Result<watch::Receiver<bool>, &'static str> {
        let mut atual = self.0.lock().map_err(|_| "ERRO_INTERNO")?;
        let (tx, rx) = watch::channel(false);
        if let Some((_, old)) = atual.replace((id, tx)) {
            let _ = old.send(true);
        }
        Ok(rx)
    }
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErroClipora {
    pub codigo: String,
    pub mensagem: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detalhe: Option<String>,
}
impl ErroClipora {
    pub fn novo(codigo: &str, detalhe: Option<String>) -> Self {
        Self {
            codigo: codigo.into(),
            mensagem: if codigo == "PREVIA_INDISPONIVEL" {
                "Não foi possível obter a prévia. Tente atualizar o yt-dlp."
            } else {
                "Não foi possível concluir a operação."
            }
            .into(),
            detalhe,
        }
    }
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Previa {
    requisicao_id: u64,
    url_original: String,
    url_normalizada: String,
    titulo: Option<String>,
    plataforma: Plataforma,
    duracao_segundos: Option<f64>,
    capa_data_url: Option<String>,
}
#[derive(Deserialize)]
struct Metadados {
    title: Option<String>,
    duration: Option<f64>,
    thumbnail: Option<String>,
}

fn video_unico(dados: &serde_json::Value) -> Result<&serde_json::Value, &'static str> {
    let item = if let Some(entradas) = dados.get("entries") {
        let entradas = entradas.as_array().ok_or("CONTEUDO_NAO_SUPORTADO")?;
        if entradas.len() != 1 {
            return Err("CONTEUDO_NAO_SUPORTADO");
        }
        &entradas[0]
    } else {
        dados
    };
    let video = |v: &serde_json::Value| {
        v.get("vcodec")
            .and_then(|x| x.as_str())
            .is_some_and(|s| !s.is_empty() && s != "none")
    };
    if video(item)
        || item
            .get("formats")
            .and_then(|v| v.as_array())
            .is_some_and(|fs| fs.iter().any(video))
    {
        Ok(item)
    } else {
        Err("CONTEUDO_NAO_SUPORTADO")
    }
}

fn ip_publico(ip: std::net::IpAddr) -> bool {
    use std::net::IpAddr;
    match ip {
        IpAddr::V4(ip) => {
            let o = ip.octets();
            !(ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_unspecified()
                || ip.is_broadcast()
                || ip.is_multicast()
                || o[0] == 0
                || o[0] >= 224
                || (o[0] == 100 && (64..=127).contains(&o[1]))
                || (o[0] == 198 && (o[1] == 18 || o[1] == 19)))
        }
        IpAddr::V6(ip) => {
            if let Some(v4) = ip.to_ipv4_mapped() {
                return ip_publico(IpAddr::V4(v4));
            }
            !(ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_multicast()
                || (ip.segments()[0] & 0xfe00) == 0xfc00
                || (ip.segments()[0] & 0xffc0) == 0xfe80)
        }
    }
}

async fn capa(url: &str) -> Option<String> {
    use base64::Engine;
    use futures_util::StreamExt;
    let u = url::Url::parse(url).ok()?;
    if u.scheme() != "https" || !u.username().is_empty() || u.password().is_some() {
        return None;
    }
    let host = u.host_str()?.to_string();
    if u.port_or_known_default()? != 443 {
        return None;
    }
    let ips: Vec<std::net::SocketAddr> = tokio::net::lookup_host((host.as_str(), 443))
        .await
        .ok()?
        .collect();
    if ips.is_empty() || ips.iter().any(|a| !ip_publico(a.ip())) {
        return None;
    }
    let cliente = reqwest::Client::builder()
        .resolve_to_addrs(&host, &ips)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .ok()?;
    let resposta = cliente.get(u).send().await.ok()?.error_for_status().ok()?;
    let mime = resposta
        .headers()
        .get(reqwest::header::CONTENT_TYPE)?
        .to_str()
        .ok()?
        .split(';')
        .next()?
        .trim()
        .to_ascii_lowercase();
    if !matches!(
        mime.as_str(),
        "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "image/avif"
    ) {
        return None;
    }
    const LIMITE: usize = 2 * 1024 * 1024;
    if resposta.content_length().is_some_and(|n| n > LIMITE as u64) {
        return None;
    }
    let mut fluxo = resposta.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = fluxo.next().await {
        let chunk = chunk.ok()?;
        if bytes.len() + chunk.len() > LIMITE {
            return None;
        }
        bytes.extend_from_slice(&chunk);
    }
    Some(format!(
        "data:{};base64,{}",
        mime,
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

pub async fn obter(
    url: String,
    id: u64,
    mut cancelado: watch::Receiver<bool>,
    bin: &std::path::Path,
    ffmpeg: &std::path::Path,
) -> Result<Previa, ErroClipora> {
    let prazo = tokio::time::Instant::now() + std::time::Duration::from_secs(30);
    let cancelado_processo = cancelado.clone();
    let tarefa = async {
        let (normalizada, plataforma) =
            crate::links::validar(&url).map_err(|c| ErroClipora::novo(c, None))?;
        let saida = processos::executar(bin, ffmpeg, normalizada.as_str(), cancelado_processo)
            .await
            .map_err(|c| ErroClipora::novo(c, None))?;
        if !saida.sucesso {
            let detalhe = String::from_utf8_lossy(&saida.stderr).to_string();
            return Err(ErroClipora::novo(
                processos::classificar_erro(&detalhe),
                Some(detalhe),
            ));
        }
        let valor: serde_json::Value = serde_json::from_slice(&saida.stdout)
            .map_err(|e| ErroClipora::novo("PREVIA_INDISPONIVEL", Some(e.to_string())))?;
        let item = if plataforma == Plataforma::Instagram && normalizada.path().starts_with("/p/") {
            video_unico(&valor).map_err(|c| ErroClipora::novo(c, None))?
        } else {
            &valor
        };
        let dados: Metadados = serde_json::from_value(item.clone())
            .map_err(|e| ErroClipora::novo("PREVIA_INDISPONIVEL", Some(e.to_string())))?;
        let imagem = match dados.thumbnail {
            Some(link) => tokio::time::timeout_at(prazo, capa(&link))
                .await
                .unwrap_or(None),
            None => None,
        };
        Ok(Previa {
            requisicao_id: id,
            url_original: url,
            url_normalizada: normalizada.to_string(),
            titulo: dados
                .title
                .map(|s| s.trim().to_owned())
                .filter(|s| !s.is_empty()),
            plataforma,
            duracao_segundos: dados.duration,
            capa_data_url: imagem,
        })
    };
    tokio::select! { biased; _ = cancelado.changed() => Err(ErroClipora::novo("PREVIA_CANCELADA", None)), r = tarefa => r }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore = "teste manual de rede com sidecar local"]
    async fn reel_com_usuario_real() {
        let url = "https://www.instagram.com/judith_steiner/reel/DVn-vNTCIfX/";
        assert!(crate::links::validar(url).is_ok());
        let bin = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("binaries/clipora-yt-dlp-aarch64-apple-darwin");
        let controle = ControlePrevia::default();
        match obter(
            url.to_string(),
            1,
            controle.iniciar(1).unwrap(),
            &bin,
            std::path::Path::new("/opt/homebrew/bin/ffmpeg"),
        )
        .await
        {
            Ok(p) => println!("{url}: OK título={:?}", p.titulo),
            Err(e) => println!("{url}: {} {:?}", e.codigo, e.detalhe),
        }
    }
    #[tokio::test]
    #[ignore = "teste manual de rede com sidecar local"]
    async fn verificar_links_publicos() {
        let bin = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("binaries/clipora-yt-dlp-aarch64-apple-darwin");
        let ffmpeg = std::path::Path::new("/opt/homebrew/bin/ffmpeg");
        let links = [
            "https://www.instagram.com/reel/DUl354timp1/",
            "https://tiktok.com/@scout2015/video/6718335390845095173",
        ];
        for (i, url) in links.iter().enumerate() {
            let controle = ControlePrevia::default();
            let rx = controle.iniciar(i as u64 + 1).unwrap();
            match obter(url.to_string(), i as u64 + 1, rx, &bin, ffmpeg).await {
                Ok(p) => println!(
                    "{url} OK: titulo={:?}, duracao={:?}, capa={}",
                    p.titulo,
                    p.duracao_segundos,
                    p.capa_data_url.is_some()
                ),
                Err(e) => println!("{url} FALHOU: {} {:?}", e.codigo, e.detalhe),
            }
        }
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn ytdlp_ausente_e_sem_execucao_retornam_codigo_especifico() {
        let script = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/preparar-bin.mjs");
        for flag in ["--sem-ytdlp", "--ytdlp-nao-executavel"] {
            let dir = tempfile::tempdir().unwrap();
            assert!(
                std::process::Command::new("node")
                    .arg(&script)
                    .arg(dir.path())
                    .arg(flag)
                    .status()
                    .unwrap()
                    .success()
            );
            let controle = ControlePrevia::default();
            let erro = obter(
                "https://instagram.com/reel/test/".into(),
                1,
                controle.iniciar(1).unwrap(),
                &dir.path().join("clipora-yt-dlp"),
                &dir.path().join("clipora-ffmpeg"),
            )
            .await
            .unwrap_err();
            assert_eq!(erro.codigo, "YTDLP_INDISPONIVEL", "{flag}");
        }
    }
    #[tokio::test]
    async fn erros_reais_dos_fixtures_e_titulo_vazio() {
        let script = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/preparar-bin.mjs");
        for (cenario, esperado) in [
            ("login", "LOGIN_NECESSARIO"),
            ("privado", "CONTEUDO_PRIVADO_OU_REMOVIDO"),
            ("removido", "CONTEUDO_PRIVADO_OU_REMOVIDO"),
            ("limite", "LIMITE_DE_ACESSO"),
            ("sem-conexao", "SEM_CONEXAO"),
            ("sem-conexao-linux", "SEM_CONEXAO"),
            ("sem-conexao-windows", "SEM_CONEXAO"),
            ("foto", "CONTEUDO_NAO_SUPORTADO"),
            ("extrator-quebrado", "PREVIA_INDISPONIVEL"),
            ("sem-titulo-sem-capa", "OK"),
        ] {
            let dir = tempfile::tempdir().unwrap();
            let status = std::process::Command::new("node")
                .arg(&script)
                .arg(dir.path())
                .args(["--cenario", cenario])
                .output()
                .unwrap();
            assert!(status.status.success(), "{cenario}");
            let estado = ControlePrevia::default();
            let resultado = obter(
                "https://instagram.com/reel/test/".into(),
                1,
                estado.iniciar(1).unwrap(),
                &dir.path().join("clipora-yt-dlp"),
                &dir.path().join("clipora-ffmpeg"),
            )
            .await;
            if esperado == "OK" {
                assert!(resultado.unwrap().titulo.is_none());
            } else {
                assert_eq!(resultado.unwrap_err().codigo, esperado, "{cenario}");
            }
        }
    }
    #[test]
    fn bloqueia_enderecos_de_rede_privada() {
        for ip in [
            "127.0.0.1",
            "10.0.0.1",
            "192.168.0.1",
            "169.254.1.1",
            "100.64.0.1",
            "::1",
            "fe80::1",
            "fc00::1",
            "::ffff:127.0.0.1",
        ] {
            assert!(!ip_publico(ip.parse().unwrap()), "{ip}");
        }
        assert!(ip_publico("8.8.8.8".parse().unwrap()));
    }
    #[test]
    fn post_instagram_aceita_somente_um_video() {
        for (json, aceito) in [
            (r#"{"vcodec":"h264"}"#, true),
            (r#"{"formats":[{"vcodec":"h264"}]}"#, true),
            (
                r#"{"_type":"playlist","entries":[{"vcodec":"h264"}]}"#,
                true,
            ),
            (
                r#"{"_type":"playlist","entries":[{"vcodec":"h264"},{"vcodec":"h264"}]}"#,
                false,
            ),
            (r#"{"vcodec":"none","ext":"jpg"}"#, false),
        ] {
            let dados = serde_json::from_str(json).unwrap();
            assert_eq!(video_unico(&dados).is_ok(), aceito, "{json}");
        }
    }
    #[test]
    fn ultima_requisicao_cancela_anterior_ate_apos_reinicio() {
        let estado = ControlePrevia::default();
        let mut primeira = estado.iniciar(1).unwrap();
        let mut segunda = estado.iniciar(2).unwrap();
        assert!(*primeira.borrow_and_update());
        let terceira = estado.iniciar(1).unwrap();
        assert!(*segunda.borrow_and_update());
        assert!(!*terceira.borrow());
    }
}
