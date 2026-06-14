//! Property/fuzz tests: the reader must return Err or empty Ok (never panic/hang) on malformed
//! bytes, and the mapper must not panic on arbitrary rows. Native `cargo test`.
use crate::mapping::{map_rows, Mapping};
use crate::reader::{read_rows, Row};
use std::collections::HashMap;

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 { let mut x=self.0; x^=x>>12; x^=x<<25; x^=x>>27; self.0=x; x.wrapping_mul(0x2545F4914F6CDD1D) }
    fn byte(&mut self) -> u8 { (self.next() & 0xff) as u8 }
}

fn csvish(rng: &mut Rng, len: usize) -> Vec<u8> {
    const SIG: &[u8] = b",\t\r\n\"abc123";
    (0..len).map(|_| if rng.byte() & 1 == 0 { SIG[(rng.byte() as usize) % SIG.len()] } else { rng.byte() }).collect()
}

#[test]
fn read_rows_never_panics_on_csvish_bytes() {
    let mut rng = Rng(0x0bad_f00d_1234_5678);
    for _ in 0..2000 {
        let len = (rng.next() % 256) as usize;
        let _ = read_rows(&csvish(&mut rng, len), None); // Ok or Err, never panic
    }
}

#[test]
fn read_rows_handles_zip_magic_that_is_not_xlsx() {
    // Looks like xlsx (PK\x03\x04) but is garbage -> must be Err, not a panic.
    let mut bytes = vec![0x50, 0x4B, 0x03, 0x04];
    bytes.extend_from_slice(&[0u8; 64]);
    assert!(read_rows(&bytes, None).is_err());
}

#[test]
fn read_rows_handles_degenerate_csv() {
    for raw in ["", "\n", "a,b\n1", "a,b,c\n1,2", "\"unterminated", "h\r\n\r\n\r\n"] {
        let _ = read_rows(raw.as_bytes(), None);
    }
}

#[test]
fn map_rows_never_panics_on_arbitrary_rows() {
    let mut rng = Rng(0xfeed_face_0102_0304);
    let m = Mapping {
        sheet: None, patient_id: "pid".into(), gender: Some("sex".into()), gender_map: None,
        birth_date: None, specimen_id: "sid".into(), specimen_type: None, collected_date: None,
        origin: None, origin_map: None, organism: Some("org".into()), organism_code: None, antibiotics: None,
    };
    for _ in 0..1000 {
        let mut row: Row = HashMap::new();
        let n = (rng.byte() % 6) as usize;
        for _ in 0..n {
            let k = format!("k{}", rng.byte());
            let vlen = (rng.byte() % 16) as usize;
            let v = String::from_utf8_lossy(&csvish(&mut rng, vlen)).into_owned();
            row.insert(k, v);
        }
        let _ = map_rows(&[row], &m);
    }
}
