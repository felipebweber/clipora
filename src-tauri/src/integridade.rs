//! Verificação de releases com rPGP, biblioteca OpenPGP permissiva MIT/Apache-2.0.
use anyhow::{Context, Result, bail};
use pgp::{
    composed::{Deserializable, DetachedSignature, SignedPublicKey},
    types::KeyDetails,
};
use sha2::{Digest, Sha256};

pub const CHAVE: &str = include_str!("../../scripts/chaves/yt-dlp.asc");
pub const FINGERPRINT: &str = "AC0CBBE6848D6A873464AF4E57CF65933B5A7581";
pub fn verificar_assinatura(
    somas: &[u8],
    assinatura: &[u8],
    chave: &str,
    fingerprint: &str,
) -> Result<()> {
    let (chave, _) =
        SignedPublicKey::from_armor_single(chave.as_bytes()).context("chave OpenPGP inválida")?;
    let real = chave.fingerprint().to_string().replace(' ', "");
    if !real.eq_ignore_ascii_case(fingerprint) {
        bail!("impressão digital inesperada");
    }
    chave
        .verify_bindings()
        .context("vínculos da chave inválidos")?;
    let assinatura = if assinatura.starts_with(b"-----BEGIN PGP SIGNATURE-----") {
        DetachedSignature::from_armor_single(assinatura)
            .map(|(sig, _)| sig)
            .context("assinatura ausente ou inválida")?
    } else {
        DetachedSignature::from_bytes(std::io::Cursor::new(assinatura))
            .context("assinatura ausente ou inválida")?
    };
    assinatura
        .verify(&chave.primary_key, somas)
        .context("assinatura das somas inválida")
}
pub fn verificar_hash(asset: &[u8], somas: &[u8], nome: &str) -> Result<()> {
    let real = format!("{:x}", Sha256::digest(asset));
    verificar_hash_digest(&real, somas, nome)
}
pub fn verificar_hash_digest(real: &str, somas: &[u8], nome: &str) -> Result<()> {
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
    if !real.eq_ignore_ascii_case(hash) {
        bail!("SHA-256 divergente");
    }
    Ok(())
}
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
    #[test]
    fn assinatura_valida_de_outra_chave_nao_e_aceita() {
        use pgp::{
            composed::{ArmorOptions, DetachedSignature, KeyType, SecretKeyParamsBuilder},
            crypto::hash::HashAlgorithm,
            types::{KeyDetails, Password},
        };
        let mut params = SecretKeyParamsBuilder::default();
        params
            .key_type(KeyType::Rsa(2048))
            .can_certify(false)
            .can_sign(true)
            .primary_user_id("Outra chave <other@example.invalid>".into());
        let secret = params
            .build()
            .unwrap()
            .generate(rand::thread_rng())
            .unwrap();
        let public = secret.to_public_key();
        let fingerprint = public.fingerprint().to_string().replace(' ', "");
        let key = public.to_armored_string(ArmorOptions::default()).unwrap();
        let signature = DetachedSignature::sign_binary_data(
            rand::thread_rng(),
            &secret.primary_key,
            &Password::empty(),
            HashAlgorithm::Sha256,
            SOMAS,
        )
        .unwrap()
        .to_armored_bytes(ArmorOptions::default())
        .unwrap();
        assert!(verificar_assinatura(SOMAS, &signature, &key, &fingerprint).is_ok());
        assert!(verificar_assinatura(SOMAS, &signature, CHAVE, FINGERPRINT).is_err());
    }
}
