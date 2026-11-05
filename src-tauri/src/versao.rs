#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    fn servidor(corpo: &'static str) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let endereco = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = [0u8; 4096]; let _ = stream.read(&mut buf);
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", corpo.len(), corpo).unwrap();
        });
        format!("http://{endereco}/releases/latest")
    }
    #[tokio::test]
    async fn compara_versoes_e_distingue_offline() {
        let cliente = reqwest::Client::builder().no_proxy().timeout(std::time::Duration::from_secs(2)).build().unwrap();
        let atual = consultar(&cliente, &servidor(r#"{"tag_name":"2026.10.26"}"#), "2026.10.26").await;
        assert!(!atual.atualizacao_disponivel && atual.erro_verificacao.is_none());
        let nova = consultar(&cliente, &servidor(r#"{"tag_name":"2026.11.05"}"#), "2026.10.26").await;
        assert!(nova.atualizacao_disponivel && nova.erro_verificacao.is_none());
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap(); let addr = listener.local_addr().unwrap(); drop(listener);
        let offline = consultar(&cliente, &format!("http://{addr}"), "2026.10.26").await;
        assert!(!offline.atualizacao_disponivel && offline.erro_verificacao.is_some() && offline.versao_disponivel.is_none());
    }
}
