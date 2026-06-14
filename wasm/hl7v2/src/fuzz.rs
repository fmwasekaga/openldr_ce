//! Property/fuzz tests: the parser and mapper must degrade gracefully (return empty/partial,
//! never panic, never hang) on random and structurally-malformed input. Native `cargo test`.
use crate::mapping::{map_message, Config};
use crate::parser::{parse_messages, unescape, Encoding};

// Deterministic xorshift64* PRNG — reproducible, no external crate.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12; x ^= x << 25; x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545F4914F6CDD1D)
    }
    fn byte(&mut self) -> u8 { (self.next() & 0xff) as u8 }
}

// Bytes biased toward HL7-significant chars so we exercise the structural paths, not just noise.
fn fuzzy_bytes(rng: &mut Rng, len: usize) -> Vec<u8> {
    const SIG: &[u8] = b"|^~\\&\r\nMSHPIDOBXR01ORU0123";
    (0..len).map(|_| if rng.byte() & 1 == 0 { SIG[(rng.byte() as usize) % SIG.len()] } else { rng.byte() }).collect()
}

#[test]
fn parse_messages_never_panics_on_random_input() {
    let mut rng = Rng(0x1234_5678_9abc_def0);
    for _ in 0..2000 {
        let len = (rng.next() % 256) as usize;
        let bytes = fuzzy_bytes(&mut rng, len);
        let s = String::from_utf8_lossy(&bytes);
        let _ = parse_messages(&s); // must return without panicking/hanging
    }
}

#[test]
fn map_message_never_panics_on_fuzzed_messages() {
    let mut rng = Rng(0xdead_beef_cafe_babe);
    let cfg = Config::default();
    for i in 0..2000 {
        let len = (rng.next() % 512) as usize;
        let s = String::from_utf8_lossy(&fuzzy_bytes(&mut rng, len)).into_owned();
        for segs in parse_messages(&s) {
            let _ = map_message(&segs, &cfg, i);
        }
    }
}

#[test]
fn unescape_never_panics_on_truncated_sequences() {
    let enc = Encoding::default();
    let cases = ["\\", "\\F", "\\\\", "\\X41", "a\\F\\", "\\R\\\\T\\", "", "\\&\\S"];
    for c in cases { let _ = unescape(c, &enc); }
}

#[test]
fn handles_degenerate_inputs() {
    for s in ["", "MSH", "MSH|", "M", "\r\r\r", "MSH|^~\\&|", "PID|||"] {
        let _ = parse_messages(s);
    }
}
