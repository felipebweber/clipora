//! Verificação de releases. Sequoia fornece política OpenPGP e verificação de
//! assinaturas; backend RustCrypto evita dependência de GPG/sistema. Esse
//! backend é marcado experimental/tempo variável pelo projeto, mas aqui apenas
//! verificamos assinaturas públicas, sem operar com chaves secretas.
use anyhow::{Context, Result, bail};
use sequoia_openpgp::{
    self as openpgp, Cert, KeyHandle,
    parse::{
        Parse,
        stream::{DetachedVerifierBuilder, MessageLayer, MessageStructure, VerificationHelper},
    },
    policy::StandardPolicy,
};
use sha2::{Digest, Sha256};

pub const CHAVE: &str = include_str!("../../scripts/chaves/yt-dlp.asc");
pub const FINGERPRINT: &str = "AC0CBBE6848D6A873464AF4E57CF65933B5A7581";
struct Verificador(Cert);
impl VerificationHelper for Verificador {
    fn get_certs(&mut self, _: &[KeyHandle]) -> openpgp::Result<Vec<Cert>> {
        Ok(vec![self.0.clone()])
    }
    fn check(&mut self, estrutura: MessageStructure) -> openpgp::Result<()> {
        let mut valido = false;
        for camada in estrutura {
            if let MessageLayer::SignatureGroup { results } = camada {
                for resultado in results {
                    if resultado.is_ok() {
                        valido = true;
                    }
                }
            }
        }
        if !valido {
            bail!("assinatura OpenPGP inválida ou ausente");
        }
        Ok(())
    }
}
pub fn verificar_assinatura(
    somas: &[u8],
    assinatura: &[u8],
    chave: &str,
    fingerprint: &str,
) -> Result<()> {
    let cert = Cert::from_bytes(chave.as_bytes()).context("chave OpenPGP inválida")?;
    if !cert
        .fingerprint()
        .to_hex()
        .eq_ignore_ascii_case(fingerprint)
    {
        bail!("impressão digital inesperada");
    }
    let politica = StandardPolicy::new();
    let helper = Verificador(cert);
    let mut verificador = DetachedVerifierBuilder::from_bytes(assinatura)
        .context("assinatura ausente ou inválida")?
        .with_policy(&politica, None, helper)?;
    verificador
        .verify_bytes(somas)
        .context("assinatura das somas inválida")?;
    Ok(())
}
pub fn verificar_hash(asset: &[u8], somas: &[u8], nome: &str) -> Result<()> {
    let texto = std::str::from_utf8(somas)?;
    let mut hashes = texto
        .lines()
        .filter_map(|l| l.split_once("  "))
        .filter(|(_, arquivo)| *arquivo == nome)
        .map(|(hash, _)| hash);
    let hash = hashes.next().context("asset ausente nas somas")?;
    if hashes.next().is_some() || hash.len() != 64 || !hash.bytes().all(|c| c.is_ascii_hexdigit()) {
        bail!("soma inválida ou duplicada");
    }
    let real = format!("{:x}", Sha256::digest(asset));
    if !real.eq_ignore_ascii_case(hash) {
        bail!("SHA-256 divergente");
    }
    Ok(())
}
/// Verifica a assinatura da lista com a chave fixada antes do hash do asset.
pub fn verificar_asset(asset: &[u8], somas: &[u8], assinatura: &[u8], nome: &str) -> Result<()> {
    verificar_assinatura(somas, assinatura, CHAVE, FINGERPRINT)?;
    verificar_hash(asset, somas, nome)
}
#[cfg(test)]
mod tests {
    use super::*;
    const SOMAS: &[u8] = include_bytes!("../tests/fixtures/SHA2-256SUMS");
    const ASSINATURA: &[u8] = include_bytes!("../tests/fixtures/SHA2-256SUMS.sig");
    #[test]
    fn assinatura_oficial_valida_e_adulteracoes_rejeitadas() {
        assert!(verificar_assinatura(SOMAS, ASSINATURA, CHAVE, FINGERPRINT).is_ok());
        assert!(verificar_assinatura(b"adulterado", ASSINATURA, CHAVE, FINGERPRINT).is_err());
        assert!(verificar_assinatura(SOMAS, b"", CHAVE, FINGERPRINT).is_err());
        assert!(
            verificar_assinatura(
                SOMAS,
                ASSINATURA,
                CHAVE,
                "0000000000000000000000000000000000000000"
            )
            .is_err()
        );
    }
    #[test]
    fn valida_hash_de_asset_e_rejeita_hash_invalido() {
        let somas = b"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  arquivo\n";
        assert!(verificar_hash(b"abc", somas, "arquivo").is_ok());
        assert!(verificar_hash(b"alterado", somas, "arquivo").is_err());
        assert!(verificar_hash(b"abc", somas, "outro").is_err());
    }
}
