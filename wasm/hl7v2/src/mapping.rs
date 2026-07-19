use crate::parser::Segment;
use openldr_plugin_sdk::fhir;
use serde_json::Value;
use std::collections::HashSet;

const AST_INTERP: [&str; 5] = ["S", "I", "R", "SDD", "NS"];
const ORGANISM_CODES: [&str; 2] = ["634-6", "88040-1"];

pub struct Config {
    pub organism_codes: HashSet<String>,
    pub ast_interp: HashSet<String>,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            organism_codes: ORGANISM_CODES.iter().map(|s| s.to_string()).collect(),
            ast_interp: AST_INTERP.iter().map(|s| s.to_string()).collect(),
        }
    }
}

fn sex(code: &str) -> Option<&'static str> {
    match code.to_ascii_uppercase().as_str() { "M" => Some("male"), "F" => Some("female"), "" => None, _ => Some("unknown") }
}

fn origin_from_pv1(class: &str) -> Option<&'static str> {
    match class.to_ascii_uppercase().as_str() { "I" => Some("inpatient"), "O" => Some("outpatient"), "" => None, _ => Some("unknown") }
}

/// Convert an HL7 v2 datetime (YYYY[MM[DD[HHMMSS]]][+/-ZZZZ]) to a FHIR date (YYYY-MM-DD,
/// or a valid partial date YYYY / YYYY-MM). Returns None when no leading digits are present.
fn hl7_date(s: &str) -> Option<String> {
    let digits: String = s.chars().take_while(|c| c.is_ascii_digit()).collect();
    match digits.len() {
        0 => None,
        1..=4 => Some(digits.chars().take(4).collect()),
        5..=6 => Some(format!("{}-{}", &digits[0..4], &digits[4..6])),
        _ => Some(format!("{}-{}-{}", &digits[0..4], &digits[4..6], &digits[6..8])),
    }
}

/// Map one parsed message (segments) to FHIR resources.
pub fn map_message(segs: &[Segment], cfg: &Config, seq: usize) -> Vec<Value> {
    let mut out = Vec::new();
    let msh = match segs.iter().find(|s| s.name == "MSH") { Some(m) => m, None => return out };
    let msg_type = msh.component(9, 1);
    let ctrl = msh.value(10);
    let key = if ctrl.is_empty() { format!("hl7-{seq}") } else { ctrl };

    let pid = segs.iter().find(|s| s.name == "PID");
    let patient_id = pid
        .map(|p| { let v = p.component(3, 1); if v.is_empty() { format!("pat-{key}") } else { v } })
        .unwrap_or_else(|| format!("pat-{key}"));
    let pid_ref = format!("Patient/hl7-{patient_id}");

    if let Some(p) = pid {
        let family = p.component(5, 1);
        let given = p.component(5, 2);
        let birth = hl7_date(&p.value(7));
        out.push(fhir::patient(
            &format!("hl7-{patient_id}"),
            if family.is_empty() { None } else { Some(family.as_str()) },
            if given.is_empty() { None } else { Some(given.as_str()) },
            sex(&p.value(8)),
            birth.as_deref(),
        ));
    } else {
        out.push(fhir::patient(&format!("hl7-{patient_id}"), None, None, None, None));
    }

    let origin = segs.iter().find(|s| s.name == "PV1").and_then(|pv1| origin_from_pv1(&pv1.value(2)));

    let order_code = segs.iter().find(|s| s.name == "OBR").map(|obr| (obr.component(4, 1), obr.component(4, 2)));
    if let Some((code, text)) = &order_code {
        out.push(fhir::service_request(
            &format!("hl7-sr-{key}"), &pid_ref,
            if code.is_empty() { None } else { Some(code.as_str()) },
            if text.is_empty() { None } else { Some(text.as_str()) },
            "active",
        ));
    }

    if msg_type == "ORM" {
        return out;
    }

    let spm = segs.iter().find(|s| s.name == "SPM");
    let spec_id = format!("hl7-spec-{key}");
    let spec_ref = format!("Specimen/{spec_id}");
    let spec_type = spm.map(|s| s.component(4, 1)).unwrap_or_default();
    let spec_date = hl7_date(&spm.map(|s| s.value(17)).unwrap_or_default());
    out.push(fhir::specimen(
        &spec_id, &pid_ref,
        if spec_type.is_empty() { None } else { Some(spec_type.as_str()) },
        spec_date.as_deref(),
        origin,
    ));
    out.push(fhir::diagnostic_report(
        &format!("hl7-dr-{key}"), &pid_ref, Some(&spec_ref),
        order_code.as_ref().map(|(c, _)| c.as_str()).filter(|c| !c.is_empty()),
        order_code.as_ref().map(|(_, t)| t.as_str()).filter(|t| !t.is_empty()),
        None, None,
    ));

    let mut obx_n = 0usize;
    for obx in segs.iter().filter(|s| s.name == "OBX") {
        obx_n += 1;
        let interp = obx.value(8).to_ascii_uppercase();
        let obs3_code = obx.component(3, 1);
        let obs3_text = obx.component(3, 2);
        if cfg.ast_interp.contains(&interp) {
            let ab = if obs3_code.is_empty() { obs3_text.clone() } else { obs3_code.clone() };
            if ab.is_empty() { continue; }
            out.push(fhir::observation_ast(&format!("hl7-ast-{key}-{obx_n}"), &pid_ref, &spec_ref, &ab, &interp, None));
        } else if cfg.organism_codes.contains(&obs3_code) && matches!(obx.value(2).as_str(), "CE" | "CWE" | "CF") {
            let org_code = obx.component(5, 1);
            let org_text = obx.component(5, 2);
            let code = if org_code.is_empty() { org_text.clone() } else { org_code };
            let text = if org_text.is_empty() { code.clone() } else { org_text };
            if code.is_empty() { continue; }
            out.push(fhir::observation_organism(&format!("hl7-org-{key}-{obx_n}"), &pid_ref, &spec_ref, &code, &text, None));
        }
    }
    out
}

/// Project one flat record per HL7 message: the key fields `map_message` reads (patient id,
/// specimen type/date, organism, AST antibiotic→interpretation, message metadata), as a JSON
/// object. One record per message. Mirrors the same field accessors `map_message` uses so the
/// row projection stays in lockstep with the FHIR mapping. Absent fields are skipped.
pub fn project_row(segs: &[Segment], cfg: &Config, seq: usize) -> serde_json::Map<String, Value> {
    let mut row = serde_json::Map::new();
    let put = |row: &mut serde_json::Map<String, Value>, k: &str, v: String| {
        if !v.is_empty() {
            row.insert(k.to_string(), Value::String(v));
        }
    };

    let msh = match segs.iter().find(|s| s.name == "MSH") {
        Some(m) => m,
        None => return row,
    };
    let msg_type = msh.component(9, 1);
    let ctrl = msh.value(10);
    let key = if ctrl.is_empty() { format!("hl7-{seq}") } else { ctrl.clone() };

    put(&mut row, "message_type", msg_type.clone());
    put(&mut row, "message_control_id", ctrl);
    if let Some(d) = hl7_date(&msh.value(7)) {
        put(&mut row, "message_date", d);
    }

    // Patient (PID-3 id, PID-5 name, PID-7 birth date, PID-8 sex) — same accessors as map_message.
    let pid = segs.iter().find(|s| s.name == "PID");
    let patient_id = pid
        .map(|p| {
            let v = p.component(3, 1);
            if v.is_empty() { format!("pat-{key}") } else { v }
        })
        .unwrap_or_else(|| format!("pat-{key}"));
    put(&mut row, "patient_id", patient_id);
    if let Some(p) = pid {
        put(&mut row, "patient_family", p.component(5, 1));
        put(&mut row, "patient_given", p.component(5, 2));
        if let Some(s) = sex(&p.value(8)) {
            put(&mut row, "patient_sex", s.to_string());
        }
        if let Some(b) = hl7_date(&p.value(7)) {
            put(&mut row, "patient_birth_date", b);
        }
    }

    // Visit origin (PV1-2) — same accessor as map_message.
    if let Some(o) = segs.iter().find(|s| s.name == "PV1").and_then(|pv1| origin_from_pv1(&pv1.value(2))) {
        put(&mut row, "origin", o.to_string());
    }

    // Order (OBR-4 code/text) — same accessor as map_message.
    if let Some(obr) = segs.iter().find(|s| s.name == "OBR") {
        put(&mut row, "order_code", obr.component(4, 1));
        put(&mut row, "order_text", obr.component(4, 2));
    }

    // Specimen (SPM-4 type, SPM-17 collection date) — same accessors as map_message.
    if let Some(spm) = segs.iter().find(|s| s.name == "SPM") {
        put(&mut row, "specimen_type", spm.component(4, 1));
        if let Some(d) = hl7_date(&spm.value(17)) {
            put(&mut row, "specimen_date", d);
        }
    }

    // Organism + AST results from OBX segments — same classification logic as map_message.
    let mut organisms: Vec<Value> = Vec::new();
    let mut ast = serde_json::Map::new();
    for obx in segs.iter().filter(|s| s.name == "OBX") {
        let interp = obx.value(8).to_ascii_uppercase();
        let obs3_code = obx.component(3, 1);
        let obs3_text = obx.component(3, 2);
        if cfg.ast_interp.contains(&interp) {
            let ab = if obs3_code.is_empty() { obs3_text.clone() } else { obs3_code.clone() };
            if ab.is_empty() {
                continue;
            }
            ast.insert(ab, Value::String(interp));
        } else if cfg.organism_codes.contains(&obs3_code)
            && matches!(obx.value(2).as_str(), "CE" | "CWE" | "CF")
        {
            let org_code = obx.component(5, 1);
            let org_text = obx.component(5, 2);
            let code = if org_code.is_empty() { org_text.clone() } else { org_code };
            let text = if org_text.is_empty() { code.clone() } else { org_text };
            if code.is_empty() {
                continue;
            }
            let mut org = serde_json::Map::new();
            org.insert("code".to_string(), Value::String(code));
            org.insert("text".to_string(), Value::String(text));
            organisms.push(Value::Object(org));
        }
    }
    if !organisms.is_empty() {
        row.insert("organisms".to_string(), Value::Array(organisms));
    }
    if !ast.is_empty() {
        row.insert("ast".to_string(), Value::Object(ast));
    }

    row
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser;

    const ORU: &str = "MSH|^~\\&|LIS|LAB|||20260110||ORU^R01|1|P|2.5.1\rPID|1||P001||Doe^Jane||19900101|F\rPV1|1|I\rSPM|1|||BLOOD|||||||||||||20260110\rOBR|1||1|CULT^Culture\rOBX|1|CWE|634-6^Bacteria identified||eco^Escherichia coli\rOBX|2|ST|AMP^Ampicillin|||||R";

    #[test]
    fn oru_maps_patient_specimen_organism_ast() {
        let cfg = Config::default();
        let segs = &parser::parse_messages(ORU)[0];
        let res = map_message(segs, &cfg, 1);
        let types: Vec<&str> = res.iter().map(|r| r["resourceType"].as_str().unwrap()).collect();
        assert!(types.contains(&"Patient"));
        assert!(types.contains(&"Specimen"));
        assert!(types.contains(&"ServiceRequest"));
        assert!(types.contains(&"DiagnosticReport"));
        let obs: Vec<&serde_json::Value> = res.iter().filter(|r| r["resourceType"] == "Observation").collect();
        assert!(obs.iter().any(|o| o["code"]["coding"][0]["code"] == "634-6"));
        assert!(obs.iter().any(|o| o["interpretation"][0]["coding"][0]["code"] == "R"));
        let spec = res.iter().find(|r| r["resourceType"] == "Specimen").unwrap();
        assert_eq!(spec["extension"][0]["valueCode"], "inpatient");
    }

    #[test]
    fn project_row_flattens_key_fields() {
        let cfg = Config::default();
        let segs = &parser::parse_messages(ORU)[0];
        let row = project_row(segs, &cfg, 1);
        assert_eq!(row["patient_id"], "P001");
        assert_eq!(row["patient_family"], "Doe");
        assert_eq!(row["patient_given"], "Jane");
        assert_eq!(row["patient_sex"], "female");
        assert_eq!(row["patient_birth_date"], "1990-01-01");
        assert_eq!(row["origin"], "inpatient");
        assert_eq!(row["specimen_type"], "BLOOD");
        assert_eq!(row["specimen_date"], "2026-01-10");
        assert_eq!(row["message_type"], "ORU");
        assert_eq!(row["order_code"], "CULT");
        // Organism (OBX-1 634-6 -> Escherichia coli).
        let orgs = row["organisms"].as_array().unwrap();
        assert!(orgs.iter().any(|o| o["code"] == "eco" && o["text"] == "Escherichia coli"));
        // AST antibiotic -> interpretation (OBX-2 Ampicillin -> R).
        assert_eq!(row["ast"]["AMP"], "R");
    }

    #[test]
    fn project_row_skips_absent_fields() {
        let cfg = Config::default();
        let orm = "MSH|^~\\&|LIS|LAB|||20260110||ORM^O01|2|P|2.5.1\rPID|1||P002\rORC|NW\rOBR|1||2|CULT^Culture";
        let segs = &parser::parse_messages(orm)[0];
        let row = project_row(segs, &cfg, 1);
        assert_eq!(row["patient_id"], "P002");
        assert_eq!(row["message_type"], "ORM");
        assert_eq!(row["order_code"], "CULT");
        assert!(!row.contains_key("specimen_type"));
        assert!(!row.contains_key("organisms"));
        assert!(!row.contains_key("ast"));
    }

    #[test]
    fn orm_maps_order_only() {
        let cfg = Config::default();
        let orm = "MSH|^~\\&|LIS|LAB|||20260110||ORM^O01|2|P|2.5.1\rPID|1||P002\rORC|NW\rOBR|1||2|CULT^Culture";
        let segs = &parser::parse_messages(orm)[0];
        let res = map_message(segs, &cfg, 1);
        let types: Vec<&str> = res.iter().map(|r| r["resourceType"].as_str().unwrap()).collect();
        assert!(types.contains(&"Patient"));
        assert!(types.contains(&"ServiceRequest"));
        assert!(!types.contains(&"Specimen"));
        assert!(!types.contains(&"Observation"));
    }
}
