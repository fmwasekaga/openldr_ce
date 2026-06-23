//! Deterministic DHIS2 UID — byte-for-byte port of @openldr/dhis2 `dhis2Uid`.
use sha2::{Digest, Sha256};

const ALPHA: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const ALNUM: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/// 11-char UID with a leading letter, derived from a stable seed
/// (sha256 → ALPHA[h0 % 52] then ALNUM[hi % 62] for i in 1..11).
pub fn dhis2_uid(seed: &str) -> String {
    let h = Sha256::digest(seed.as_bytes());
    let mut out = String::with_capacity(11);
    out.push(ALPHA[(h[0] as usize) % ALPHA.len()] as char);
    for i in 1..11 {
        out.push(ALNUM[(h[i] as usize) % ALNUM.len()] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn is_uid(s: &str) -> bool {
        let b = s.as_bytes();
        b.len() == 11 && b[0].is_ascii_alphabetic() && b.iter().all(|c| c.is_ascii_alphanumeric())
    }

    #[test]
    fn shape_is_11_chars_leading_letter_alnum() {
        assert!(is_uid(&dhis2_uid("amr-to-dhis2-demo:obs-1")));
    }

    #[test]
    fn deterministic() {
        assert_eq!(dhis2_uid("x:y"), dhis2_uid("x:y"));
    }

    #[test]
    fn differs_by_seed() {
        assert_ne!(dhis2_uid("a"), dhis2_uid("b"));
    }
}
