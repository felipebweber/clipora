use crate::{links::Plataforma, processos};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tokio::sync::watch;

#[derive(Default)]
pub struct ControlePrevia(Mutex<Option<(u64, watch::Sender<bool>)>>);
impl ControlePrevia {
    pub fn iniciar(&self, id: u64) -> Result<watch::Receiver<bool>, &'static str> {
        let mut atual = self.0.lock().map_err(|_| "ERRO_INTERNO")?;
        if let Some((anterior, _)) = atual.as_ref()
            && id <= *anterior
        {
            return Err("PREVIA_CANCELADA");
        }
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

async fn capa(url: &str) -> Option<String> {
    use base64::Engine;
    use futures_util::StreamExt;
    let u = url::Url::parse(url).ok()?;
    if u.scheme() != "https" || !u.username().is_empty() || u.password().is_some() {
        return None;
    }
    let cliente = reqwest::Client::builder()
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
    if !mime.starts_with("image/")
        || !mime
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"/-+.".contains(&c))
    {
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
            Some(link) => capa(&link).await,
            None => None,
        };
        Ok(Previa {
            requisicao_id: id,
            url_original: url,
            url_normalizada: normalizada.to_string(),
            titulo: dados.title,
            plataforma,
            duracao_segundos: dados.duration,
            capa_data_url: imagem,
        })
    };
    tokio::select! { biased; _ = cancelado.changed() => Err(ErroClipora::novo("PREVIA_CANCELADA", None)), r = tokio::time::timeout(std::time::Duration::from_secs(30), tarefa) => r.unwrap_or_else(|_| Err(ErroClipora::novo("TEMPO_ESGOTADO", None))) }
}
#[cfg(test)]
mod tests {
    use super::*;
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
    fn nova_requisicao_cancela_anterior_e_id_antigo_nao_cancela_atual() {
        let estado = ControlePrevia::default();
        let mut primeira = estado.iniciar(1).unwrap();
        let segunda = estado.iniciar(2).unwrap();
        assert!(*primeira.borrow_and_update());
        assert!(estado.iniciar(1).is_err());
        assert!(!*segunda.borrow());
    }
}
