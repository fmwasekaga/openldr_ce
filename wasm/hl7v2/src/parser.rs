//! Minimal HL7 v2 parser: split a message into segments/fields/components.

#[derive(Debug, Clone)]
pub struct Encoding {
    pub field: char,
    pub component: char,
    pub repetition: char,
    pub escape: char,
    pub subcomponent: char,
}

impl Default for Encoding {
    fn default() -> Self {
        Encoding { field: '|', component: '^', repetition: '~', escape: '\\', subcomponent: '&' }
    }
}

/// Unescape the common HL7 escape sequences using the message encoding chars.
pub fn unescape(s: &str, enc: &Encoding) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == enc.escape {
            let mut seq = String::new();
            for d in chars.by_ref() {
                if d == enc.escape { break; }
                seq.push(d);
            }
            match seq.as_str() {
                "F" => out.push(enc.field),
                "S" => out.push(enc.component),
                "R" => out.push(enc.repetition),
                "T" => out.push(enc.subcomponent),
                "E" => out.push(enc.escape),
                _ => {} // unknown escape (e.g. \X..\, \H\, \N\) dropped
            }
        } else {
            out.push(c);
        }
    }
    out
}

#[derive(Debug, Clone)]
pub struct Segment {
    pub name: String,
    fields: Vec<String>, // field 0 = segment name
    enc: Encoding,
}

impl Segment {
    /// HL7 field index is 1-based; MSH is special-cased so MSH-1 = the field separator.
    pub fn field(&self, n: usize) -> &str {
        if self.name == "MSH" {
            if n == 1 { return "|"; }
            self.fields.get(n - 1).map(|s| s.as_str()).unwrap_or("")
        } else {
            self.fields.get(n).map(|s| s.as_str()).unwrap_or("")
        }
    }

    /// First repetition's component `c` (1-based) of field `n`, unescaped.
    pub fn component(&self, n: usize, c: usize) -> String {
        let f = self.field(n);
        let rep = f.split(self.enc.repetition).next().unwrap_or("");
        let comp = rep.split(self.enc.component).nth(c - 1).unwrap_or("");
        unescape(comp, &self.enc)
    }

    /// Field `n` (first repetition) unescaped as a whole string.
    pub fn value(&self, n: usize) -> String {
        let f = self.field(n);
        let rep = f.split(self.enc.repetition).next().unwrap_or("");
        unescape(rep, &self.enc)
    }
}

/// Parse one segment line. `MSH` lines carry the encoding chars in MSH-2.
fn parse_segment(line: &str) -> Option<Segment> {
    let line = line.trim_end_matches(['\r', '\n']);
    if line.len() < 3 { return None; }
    let name: String = line.chars().take(3).collect();
    if name == "MSH" {
        let field_sep = line.chars().nth(3).unwrap_or('|');
        let enc_chars: String = line.chars().skip(4).take_while(|&c| c != field_sep).collect();
        let mut ch = enc_chars.chars();
        let enc = Encoding {
            field: field_sep,
            component: ch.next().unwrap_or('^'),
            repetition: ch.next().unwrap_or('~'),
            escape: ch.next().unwrap_or('\\'),
            subcomponent: ch.next().unwrap_or('&'),
        };
        // fields[0]="MSH", fields[1]=encoding chars, fields[2..]=the rest after the 2nd field sep.
        let mut fields: Vec<String> = vec!["MSH".into(), enc_chars.clone()];
        // Everything after "MSH<sep><encchars><sep>" split on the field separator:
        let prefix_len = 3 + 1 + enc_chars.chars().count() + 1; // MSH + sep + encchars + sep
        let after: String = line.chars().skip(prefix_len).collect();
        for f in after.split(field_sep) { fields.push(f.to_string()); }
        Some(Segment { name, fields, enc })
    } else {
        let enc = Encoding::default();
        let fields: Vec<String> = line.split(enc.field).map(|s| s.to_string()).collect();
        Some(Segment { name, fields, enc })
    }
}

/// Split raw text into messages (each starting at an `MSH` segment) and parse each.
pub fn parse_messages(raw: &str) -> Vec<Vec<Segment>> {
    let normalized = raw.replace('\r', "\n");
    let mut messages: Vec<Vec<Segment>> = Vec::new();
    for line in normalized.split('\n') {
        let line = line.trim();
        if line.is_empty() { continue; }
        if line.starts_with("MSH") {
            messages.push(Vec::new());
        }
        if let Some(seg) = parse_segment(line) {
            if let Some(cur) = messages.last_mut() { cur.push(seg); }
        }
    }
    messages
}

#[cfg(test)]
mod tests {
    use super::*;

    const MSG: &str = "MSH|^~\\&|LIS|LAB|||20260110||ORU^R01|1|P|2.5.1\rPID|1||P001||Doe^Jane||19900101|F\rOBX|1|CWE|634-6^Bacteria identified||eco^Escherichia coli\rOBX|2|ST|AMP^Ampicillin||||R";

    #[test]
    fn splits_segments_and_fields() {
        let msgs = parse_messages(MSG);
        assert_eq!(msgs.len(), 1);
        let segs = &msgs[0];
        assert_eq!(segs[0].name, "MSH");
        assert_eq!(segs[0].component(9, 1), "ORU");
        assert_eq!(segs[0].component(9, 2), "R01");
        assert_eq!(segs[1].name, "PID");
        assert_eq!(segs[1].component(5, 1), "Doe");
        assert_eq!(segs[1].value(8), "F");
    }

    #[test]
    fn unescape_handles_sequences() {
        let enc = Encoding::default();
        assert_eq!(unescape("a\\F\\b\\S\\c", &enc), "a|b^c");
    }

    #[test]
    fn obx_fields_accessible() {
        let msgs = parse_messages(MSG);
        let obx1 = msgs[0].iter().find(|s| s.name == "OBX" && s.value(1) == "1").unwrap();
        assert_eq!(obx1.value(2), "CWE");
        assert_eq!(obx1.component(3, 1), "634-6");
        assert_eq!(obx1.component(5, 1), "eco");
    }
}
