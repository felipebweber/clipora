//! Catálogo puro: nenhum estado global, processo, rede ou URL de mídia.
use crate::previa::ErroClipora;
use serde_json::Value;

#[derive(Debug)]
pub struct AnaliseYoutube {
    /// ID do item já validado, nunca uma URL de execução.
    pub id: String,
    videos: Vec<Video>,
}
#[derive(Debug)]
struct Video {
    id: String,
    altura: u32,
    fps: f64,
    codec: u8,
    preferencia: usize,
    audio: Option<String>,
}
#[derive(Debug)]
pub struct EscolhaYoutube {
    pub altura: u32,
    pub seletor: String,
}
fn nao_suportado() -> ErroClipora {
    ErroClipora::novo("CONTEUDO_NAO_SUPORTADO", None)
}
fn qualidade_indisponivel() -> ErroClipora {
    ErroClipora {
        codigo: "QUALIDADE_INDISPONIVEL".into(),
        mensagem: "Essa qualidade não está mais disponível. Atualize a prévia e escolha outra."
            .into(),
        detalhe: None,
    }
}
fn id_formato(f: &Value) -> Option<&str> {
    f.get("format_id")?.as_str().filter(|id| {
        !id.is_empty()
            && id.len() <= 64
            && id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
    })
}
fn dimensao(v: &Value) -> Option<u32> {
    let n = v.as_f64()?;
    (n.is_finite() && n > 0.0 && n <= u32::MAX as f64 && n.fract() == 0.0).then_some(n as u32)
}
fn aac(codec: &str) -> bool {
    codec == "aac" || codec == "mp4a" || codec.starts_with("mp4a.40.")
}
/// Codec reproduzido nativamente por QuickTime/macOS e players do Windows.
const CODEC_COMPATIVEL: u8 = 3;
fn codec_video(codec: &str) -> Option<u8> {
    if matches!(codec, "h264" | "avc" | "avc1" | "avc3")
        || codec.starts_with("avc1.")
        || codec.starts_with("avc3.")
    {
        Some(CODEC_COMPATIVEL)
    } else if matches!(codec, "vp9" | "vp09")
        || codec.starts_with("vp09.")
        || codec.starts_with("vp9.")
    {
        Some(2)
    } else if matches!(codec, "av1" | "av01") || codec.starts_with("av01.") {
        Some(1)
    } else {
        None
    }
}
fn sem_drm(f: &Value) -> bool {
    matches!(
        f.get("has_drm"),
        None | Some(Value::Null) | Some(Value::Bool(false))
    )
}
fn midia(f: &Value) -> bool {
    sem_drm(f)
        && !matches!(
            f.get("ext").and_then(Value::as_str),
            Some("mhtml" | "jpg" | "jpeg" | "png" | "webp")
        )
        && f.get("protocol").and_then(Value::as_str) != Some("mhtml")
}

pub fn analisar(dados: &Value, id_esperado: &str) -> Result<AnaliseYoutube, ErroClipora> {
    if !crate::links::id_youtube_valido(id_esperado)
        || dados.get("id").and_then(Value::as_str) != Some(id_esperado)
        || dados.get("media_type").and_then(Value::as_str) != Some("video")
        || dados.get("live_status").and_then(Value::as_str) != Some("not_live")
        || dados
            .get("duration")
            .and_then(Value::as_f64)
            .is_none_or(|d| !d.is_finite() || d <= 0.0)
        || dados.get("entries").is_some()
        || dados
            .get("_type")
            .is_some_and(|t| t.as_str() != Some("video"))
        || !sem_drm(dados)
    {
        return Err(nao_suportado());
    }
    let formatos = dados
        .get("formats")
        .and_then(Value::as_array)
        .ok_or_else(nao_suportado)?;
    // Um ID ambíguo não pode identificar deterministicamente a resolução do download.
    let mut contagens = std::collections::HashMap::new();
    for id in formatos.iter().filter_map(id_formato) {
        *contagens.entry(id).or_insert(0usize) += 1;
    }
    let elegiveis: Vec<_> = formatos
        .iter()
        .enumerate()
        .filter(|(_, f)| midia(f))
        .filter_map(|(ordem, f)| {
            id_formato(f)
                .filter(|id| contagens.get(id) == Some(&1))
                .map(|id| (ordem, id, f))
        })
        .collect();
    // O yt-dlp entrega formats do pior para o melhor. No empate restante,
    // a última entrada mantém essa preferência, inclusive para áudio AAC.
    let audio = elegiveis
        .iter()
        .rev()
        .find(|(_, _, f)| {
            f.get("vcodec").and_then(Value::as_str) == Some("none")
                && f.get("acodec").and_then(Value::as_str).is_some_and(aac)
        })
        .map(|(_, id, _)| (*id).to_owned());
    let mut videos = Vec::new();
    for (preferencia, id, f) in elegiveis {
        let Some(codec) = f
            .get("vcodec")
            .and_then(Value::as_str)
            .and_then(codec_video)
        else {
            continue;
        };
        let Some(altura) = f.get("height").and_then(dimensao) else {
            continue;
        };
        if f.get("width").and_then(dimensao).is_none() {
            continue;
        }
        let audio = match f.get("acodec").and_then(Value::as_str) {
            Some(c) if aac(c) => None,
            Some("none") if audio.is_some() => audio.clone(),
            _ => continue,
        };
        let fps = f
            .get("fps")
            .and_then(Value::as_f64)
            .filter(|n| n.is_finite() && *n > 0.0)
            .unwrap_or(0.0);
        videos.push(Video {
            id: id.into(),
            altura,
            fps,
            codec,
            preferencia,
            audio,
        });
    }
    if videos.is_empty() {
        return Err(nao_suportado());
    }
    Ok(AnaliseYoutube {
        id: id_esperado.into(),
        videos,
    })
}
pub fn alturas(analise: &AnaliseYoutube) -> Vec<u32> {
    let mut alturas: Vec<_> = analise.videos.iter().map(|v| v.altura).collect();
    alturas.sort_unstable_by(|a, b| b.cmp(a));
    alturas.dedup();
    alturas
}
/// Alturas com vídeo H.264; as demais podem não abrir no QuickTime.
pub fn alturas_compativeis(analise: &AnaliseYoutube) -> Vec<u32> {
    let mut alturas: Vec<_> = analise
        .videos
        .iter()
        .filter(|v| v.codec == CODEC_COMPATIVEL)
        .map(|v| v.altura)
        .collect();
    alturas.sort_unstable_by(|a, b| b.cmp(a));
    alturas.dedup();
    alturas
}
pub fn escolher(
    analise: &AnaliseYoutube,
    altura: Option<u32>,
) -> Result<EscolhaYoutube, ErroClipora> {
    // Compatibilidade vem antes de FPS: VP9/AV1 em MP4 não abrem no QuickTime.
    // Sem altura explícita, um H.264 de qualquer altura vence VP9/AV1 maiores;
    // acima de 1080p o YouTube só oferece VP9/AV1, que seguem escolhíveis.
    let compativel = |v: &Video| v.codec == CODEC_COMPATIVEL;
    let video = analise
        .videos
        .iter()
        .filter(|v| altura.is_none_or(|a| v.altura == a))
        .max_by(|a, b| {
            let chave_altura = |v: &Video| (altura.is_none() && compativel(v), v.altura);
            chave_altura(a)
                .cmp(&chave_altura(b))
                .then_with(|| compativel(a).cmp(&compativel(b)))
                .then_with(|| a.fps.total_cmp(&b.fps))
                .then_with(|| a.codec.cmp(&b.codec))
                .then_with(|| a.preferencia.cmp(&b.preferencia))
        })
        .ok_or_else(qualidade_indisponivel)?;
    // Usar filtros de ID, nunca o ID como uma expressão -f: até IDs ASCII
    // como "all", "best" ou "mp4" têm significado especial para o yt-dlp.
    // A altura também vai no filtro para recusar mudanças antes da transferência.
    let seletor = match &video.audio {
        Some(audio) => format!(
            "bestvideo[format_id=\"{}\"][height={}]+bestaudio[format_id=\"{}\"]",
            video.id, video.altura, audio
        ),
        None => format!("best[format_id=\"{}\"][height={}]", video.id, video.altura),
    };
    Ok(EscolhaYoutube {
        altura: video.altura,
        seletor,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    const ID: &str = "YE7VzlLtp-4";
    fn fixture(nome: &str) -> Value {
        let texto = match nome {
            "normal" => include_str!("../../tests/fixtures/youtube/normal.json"),
            "short" => include_str!("../../tests/fixtures/youtube/short.json"),
            "live" => include_str!("../../tests/fixtures/youtube/live.json"),
            "sem-audio" => include_str!("../../tests/fixtures/youtube/sem-audio.json"),
            "formatos" => include_str!("../../tests/fixtures/youtube/formatos.json"),
            _ => panic!("fixture desconhecida"),
        };
        serde_json::from_str(texto).unwrap()
    }
    fn recusado(d: &Value) {
        assert_eq!(
            analisar(d, ID).unwrap_err().codigo,
            "CONTEUDO_NAO_SUPORTADO"
        );
    }
    #[test]
    fn youtube_short_por_alias_e_live_sao_recusados() {
        for nome in ["short", "live"] {
            recusado(&fixture(nome));
        }
        for url in [
            "https://youtube.com/watch?v=YE7VzlLtp-4",
            "https://youtu.be/YE7VzlLtp-4",
        ] {
            // Não se infere vídeo normal por formato da URL, duração ou proporção.
            assert!(crate::links::validar(url).is_ok());
            recusado(&fixture("short"));
        }
        for campo in ["media_type", "live_status", "duration", "id"] {
            let mut d = fixture("normal");
            d.as_object_mut().unwrap().remove(campo);
            recusado(&d);
        }
        for status in ["is_live", "was_live", "post_live", "is_upcoming", ""] {
            let mut d = fixture("normal");
            d["live_status"] = json!(status);
            recusado(&d);
        }
        for duracao in [json!(0), json!(-1), json!("10"), Value::Null] {
            let mut d = fixture("normal");
            d["duration"] = duracao;
            recusado(&d);
        }
        let mut d = fixture("normal");
        d["id"] = json!("jNQXAC9IVRw");
        recusado(&d);
        let mut d = fixture("normal");
        d["entries"] = json!([fixture("normal")]);
        recusado(&d);
        let mut d = fixture("normal");
        d["_type"] = json!("playlist");
        recusado(&d);
        assert!(analisar(&fixture("normal"), "invalido").is_err());
    }
    #[test]
    fn youtube_catalogo_exige_audio_e_dimensoes() {
        recusado(&fixture("sem-audio"));
        let normal = fixture("normal");
        let mut d = normal.clone();
        d["formats"] = json!([normal["formats"][2].clone()]);
        recusado(&d);
        for campo in ["height", "width"] {
            for valor in [
                Value::Null,
                json!(0),
                json!(-2),
                json!(720.5),
                json!(4294967296_u64),
            ] {
                let mut d = normal.clone();
                d["formats"][0][campo] = valor.clone();
                d["formats"][1][campo] = valor;
                recusado(&d);
            }
        }
        let mut d = normal.clone();
        d["formats"][2]["acodec"] = json!("opus");
        recusado(&d);
        let mut d = normal.clone();
        for f in d["formats"].as_array_mut().unwrap() {
            f["has_drm"] = json!(true);
        }
        recusado(&d);
        let mut d = normal.clone();
        d["formats"][2]["has_drm"] = json!(true);
        recusado(&d);
        let mut d = normal.clone();
        for f in &mut d["formats"].as_array_mut().unwrap()[..2] {
            f["vcodec"] = json!("none");
            f["ext"] = json!("mhtml");
        }
        recusado(&d);
        let mut d = normal.clone();
        for f in &mut d["formats"].as_array_mut().unwrap()[..2] {
            f["vcodec"] = json!("h265");
        }
        recusado(&d);
        // AAC incluído no mesmo formato dispensa faixa separada.
        let mut d = normal;
        d["formats"] = json!([d["formats"][0].clone()]);
        d["formats"][0]["acodec"] = json!("aac");
        let e = escolher(&analisar(&d, ID).unwrap(), None).unwrap();
        assert_eq!(e.altura, 720);
        assert!(!e.seletor.contains('+'));
    }
    #[test]
    fn youtube_alturas_unicas_sem_teto() {
        let d = fixture("formatos");
        let a = analisar(&d, ID).unwrap();
        assert_eq!(alturas(&a), [2160, 1080, 720]);
        assert_eq!(alturas_compativeis(&a), [1080, 720]);
        let mut d = d;
        let mut f = d["formats"][0].clone();
        f["height"] = json!(8640);
        f["format_id"] = json!("8k");
        d["formats"].as_array_mut().unwrap().push(f);
        let mut f = d["formats"][0].clone();
        f["height"] = json!(854);
        f["format_id"] = json!("incomum");
        d["formats"].as_array_mut().unwrap().push(f);
        assert_eq!(
            alturas(&analisar(&d, ID).unwrap()),
            [8640, 2160, 1080, 854, 720]
        );
    }
    #[test]
    fn youtube_escolha_exata_sem_fallback() {
        let a = analisar(&fixture("formatos"), ID).unwrap();
        let e = escolher(&a, Some(720)).unwrap();
        assert_eq!(e.altura, 720);
        // H.264 vence VP9 de FPS maior na mesma altura: abre no QuickTime.
        assert_eq!(
            e.seletor,
            "bestvideo[format_id=\"136\"][height=720]+bestaudio[format_id=\"140\"]"
        );
        assert!(!e.seletor.contains("302"));
        assert!(!e.seletor.contains('/'));
        // Altura sem H.264 continua disponível quando escolhida explicitamente.
        assert!(escolher(&a, Some(2160)).unwrap().seletor.contains("401"));
        // "Melhor disponível" prefere o melhor H.264, não a maior altura.
        let melhor = escolher(&a, None).unwrap();
        assert_eq!(melhor.altura, 1080);
        assert!(melhor.seletor.contains("137"));
        for h in [0, 480, u32::MAX] {
            assert_eq!(
                escolher(&a, Some(h)).unwrap_err().codigo,
                "QUALIDADE_INDISPONIVEL"
            );
        }
    }
    #[test]
    fn youtube_desempate_fps_codec_preferencia_e_audio() {
        let mut d = fixture("normal");
        let video = d["formats"][0].clone();
        let audio = d["formats"][2].clone();
        d["formats"] = json!([]);
        for (id, codec, fps) in [
            ("avc30", "avc1.64001f", 30),
            ("av160", "av01.0.08M.08", 60),
            ("vp960", "vp9", 60),
            ("avc60a", "avc1.64001f", 60),
            ("avc60b", "avc1.64001f", 60),
        ] {
            let mut f = video.clone();
            f["format_id"] = json!(id);
            f["vcodec"] = json!(codec);
            f["fps"] = json!(fps);
            d["formats"].as_array_mut().unwrap().push(f);
        }
        let mut segundo_audio = audio.clone();
        segundo_audio["format_id"] = json!("audioPreferido");
        d["formats"]
            .as_array_mut()
            .unwrap()
            .extend([audio, segundo_audio]);
        let a = analisar(&d, ID).unwrap();
        let e = escolher(&a, Some(720)).unwrap();
        assert!(e.seletor.contains("avc60b"));
        assert!(e.seletor.contains("audioPreferido"));
        d["formats"]
            .as_array_mut()
            .unwrap()
            .retain(|f| !f["format_id"].as_str().unwrap().starts_with("avc60"));
        // Sem H.264 de 60 FPS, o H.264 de 30 FPS vence VP9/AV1 de 60 FPS.
        assert!(
            escolher(&analisar(&d, ID).unwrap(), None)
                .unwrap()
                .seletor
                .contains("avc30")
        );
        // Sem nenhum H.264, mantém o desempate por FPS e depois VP9 antes de AV1.
        d["formats"]
            .as_array_mut()
            .unwrap()
            .retain(|f| f["format_id"] != "avc30");
        let a = analisar(&d, ID).unwrap();
        assert!(alturas_compativeis(&a).is_empty());
        assert!(escolher(&a, None).unwrap().seletor.contains("vp960"));
    }
    #[test]
    fn youtube_formato_id_nao_injeta_expressao() {
        for id in [
            "137/18",
            "137+140",
            "x]",
            "x[height>0]",
            "x;sh",
            "a b",
            "á",
            "",
            &"x".repeat(65),
        ] {
            let mut d = fixture("normal");
            d["formats"] = json!([d["formats"][0].clone(), d["formats"][2].clone()]);
            d["formats"][0]["format_id"] = json!(id);
            recusado(&d);
        }
        let mut d = fixture("normal");
        d["formats"][2]["format_id"] = json!("140/evil");
        recusado(&d);
        // Palavras reservadas seguras em ASCII não podem virar seletor genérico.
        let mut d = fixture("normal");
        d["formats"][1]["format_id"] = json!("all");
        let e = escolher(&analisar(&d, ID).unwrap(), None).unwrap();
        assert!(e.seletor.contains("[format_id=\"all\"]"));
        assert_ne!(e.seletor, "all");
        let mut d = fixture("normal");
        d["formats"][1]["format_id"] = d["formats"][0]["format_id"].clone();
        recusado(&d);
    }
}
