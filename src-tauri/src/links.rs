use serde::Serialize;
use url::Url;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Plataforma {
    Instagram,
    Tiktok,
}

pub fn validar(input: &str) -> Result<(Url, Plataforma), &'static str> {
    let mut url = Url::parse(input).map_err(|_| "LINK_INVALIDO")?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("LINK_INVALIDO");
    }
    // URL normaliza portas padrão; inspecionar também a autoridade original.
    let authority = input
        .split_once("://")
        .map(|(_, s)| s.split(['/', '?', '#']).next().unwrap_or(""))
        .unwrap_or("");
    if authority.contains(':') || authority.contains('@') || url.port().is_some() {
        return Err("LINK_INVALIDO");
    }
    let host = url.host_str().ok_or("LINK_INVALIDO")?;
    let parts: Vec<_> = url
        .path_segments()
        .ok_or("LINK_INVALIDO")?
        .filter(|s| !s.is_empty())
        .collect();
    let result = match host {
        "instagram.com" | "www.instagram.com" | "m.instagram.com" => {
            if !(parts.len() == 2 && matches!(parts[0], "reel" | "reels" | "p")
                || parts.len() == 3 && !parts[0].is_empty() && parts[1] == "reel")
            {
                return Err("LINK_INVALIDO");
            }
            Plataforma::Instagram
        }
        "tiktok.com" | "www.tiktok.com" | "m.tiktok.com" => {
            let video = parts.len() == 3
                && parts[0].starts_with('@')
                && parts[0].len() > 1
                && parts[1] == "video"
                && parts[2].bytes().all(|b| b.is_ascii_digit());
            let short = parts.len() == 2 && parts[0] == "t";
            if !video && !short {
                return Err("LINK_INVALIDO");
            }
            Plataforma::Tiktok
        }
        "vm.tiktok.com" | "vt.tiktok.com" => {
            if parts.len() != 1 {
                return Err("LINK_INVALIDO");
            }
            Plataforma::Tiktok
        }
        _ => return Err("PLATAFORMA_NAO_SUPORTADA"),
    };
    if url.scheme() == "http" {
        url.set_scheme("https").map_err(|_| "LINK_INVALIDO")?;
    }
    Ok((url, result))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn converte_http_para_https() {
        let (url, _) = validar("http://instagram.com/p/abc?foo=bar").unwrap();
        assert_eq!(url.as_str(), "https://instagram.com/p/abc?foo=bar");
    }
    #[test]
    fn aceita_formatos_permitidos() {
        for link in [
            "https://instagram.com/reel/abc/",
            "http://www.instagram.com/reels/abc",
            "https://m.instagram.com/p/abc",
            "https://tiktok.com/@user/video/123",
            "https://www.tiktok.com/@user/video/123",
            "https://m.tiktok.com/@user/video/123",
            "https://www.tiktok.com/t/abc",
            "https://www.instagram.com/judith_steiner/reel/DVn-vNTCIfX/",
            "https://vm.tiktok.com/abc/",
            "https://vt.tiktok.com/abc",
            "https://tiktok.com/t/abc",
        ] {
            assert!(validar(link).is_ok(), "{link}");
        }
    }
    #[test]
    fn rejeita_links_nao_permitidos() {
        for link in [
            "ftp://instagram.com/p/x",
            "https://user@instagram.com/p/x",
            "https://instagram.com:443/p/x",
            "https://instagram.com.evil.test/p/x",
            "https://instagram.com/stories/x",
            "https://instagram.com/p/",
            "https://tiktok.com/@u/video/abc",
            "https://tiktok.com/t/",
            "https://vm.tiktok.com/",
            "não é url",
        ] {
            assert!(validar(link).is_err(), "{link}");
        }
    }
}
