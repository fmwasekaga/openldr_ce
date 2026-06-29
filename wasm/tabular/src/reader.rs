use std::collections::HashMap;
use std::io::Cursor;

pub type Row = HashMap<String, String>;

/// Parse bytes into header-keyed rows. `.xlsx` (ZIP magic) -> calamine; else CSV.
pub fn read_rows(bytes: &[u8], sheet: Option<&str>) -> Result<Vec<Row>, String> {
    if bytes.len() >= 4 && bytes[0..4] == [0x50, 0x4B, 0x03, 0x04] {
        read_xlsx(bytes, sheet)
    } else {
        read_csv(bytes)
    }
}

fn read_csv(bytes: &[u8]) -> Result<Vec<Row>, String> {
    let first = bytes.split(|&b| b == b'\n').next().unwrap_or(&[]);
    let delim = if first.iter().filter(|&&b| b == b'\t').count() > first.iter().filter(|&&b| b == b',').count() { b'\t' } else { b',' };
    let mut rdr = csv::ReaderBuilder::new().delimiter(delim).flexible(true).from_reader(Cursor::new(bytes));
    let headers: Vec<String> = rdr.headers().map_err(|e| format!("csv headers: {e}"))?.iter().map(|s| s.trim().to_string()).collect();
    let mut rows = Vec::new();
    for rec in rdr.records() {
        let rec = rec.map_err(|e| format!("csv row: {e}"))?;
        let mut row = HashMap::new();
        for (i, h) in headers.iter().enumerate() {
            row.insert(h.clone(), rec.get(i).unwrap_or("").trim().to_string());
        }
        rows.push(row);
    }
    Ok(rows)
}

fn read_xlsx(bytes: &[u8], sheet: Option<&str>) -> Result<Vec<Row>, String> {
    use calamine::{Reader, Xlsx};
    let mut wb: Xlsx<_> = Xlsx::new(Cursor::new(bytes.to_vec())).map_err(|e| format!("xlsx: {e}"))?;
    let name = match sheet {
        Some(s) => s.to_string(),
        None => wb.sheet_names().first().cloned().ok_or_else(|| "xlsx has no sheets".to_string())?,
    };
    let range = wb.worksheet_range(&name).map_err(|e| format!("sheet '{name}': {e}"))?;
    let mut iter = range.rows();
    let headers: Vec<String> = match iter.next() {
        Some(r) => r.iter().map(cell_str).collect(),
        None => return Ok(Vec::new()),
    };
    let mut rows = Vec::new();
    for r in iter {
        let mut row = HashMap::new();
        for (i, h) in headers.iter().enumerate() {
            row.insert(h.trim().to_string(), r.get(i).map(cell_str).unwrap_or_default().trim().to_string());
        }
        rows.push(row);
    }
    Ok(rows)
}

fn cell_str(c: &calamine::Data) -> String {
    use calamine::Data;
    match c {
        Data::String(s) => s.clone(),
        Data::Float(f) => { if f.fract() == 0.0 { format!("{}", *f as i64) } else { f.to_string() } }
        Data::Int(i) => i.to_string(),
        Data::Bool(b) => b.to_string(),
        Data::DateTime(d) => d.to_string(),
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_rows_parses_tiny_csv() {
        let rows = read_rows(b"a,b\n1,2\n", None).unwrap();
        assert_eq!(rows.len(), 1);
        let r = &rows[0];
        assert_eq!(r.len(), 2);
        assert_eq!(r.get("a").map(String::as_str), Some("1"));
        assert_eq!(r.get("b").map(String::as_str), Some("2"));
    }

    #[test]
    fn read_rows_multiple_records_and_trim() {
        let rows = read_rows(b"a, b\n 1 ,2\n3, 4 \n", None).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].get("a").map(String::as_str), Some("1")); // trimmed value
        assert_eq!(rows[0].get("b").map(String::as_str), Some("2")); // trimmed header
        assert_eq!(rows[1].get("a").map(String::as_str), Some("3"));
        assert_eq!(rows[1].get("b").map(String::as_str), Some("4"));
    }

    #[test]
    fn read_rows_serializes_to_json_object() {
        // Mirrors the rows-mode wasm path: each Row -> a JSON object.
        let rows = read_rows(b"a,b\n1,2\n", None).unwrap();
        let v = serde_json::to_value(&rows[0]).unwrap();
        assert!(v.is_object());
        assert_eq!(v["a"], "1");
        assert_eq!(v["b"], "2");
    }
}
