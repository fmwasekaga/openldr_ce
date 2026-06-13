//! WHONET isolate row → FHIR resources.
use openldr_plugin_sdk::fhir;
use rusqlite::Connection;
use serde_json::Value;

pub fn map_isolates(conn: &Connection) -> rusqlite::Result<Vec<Value>> {
    // Discover ab_* columns from the table schema.
    let ab_cols: Vec<String> = {
        let mut cols = Vec::new();
        let mut stmt = conn.prepare("PRAGMA table_info(isolates)")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(1))?;
        for name in rows {
            let name = name?;
            if name.starts_with("ab_") {
                cols.push(name);
            }
        }
        cols
    };

    let base = "patient_id, sex, birth_date, spec_num, spec_type, spec_date, organism, organism_code";
    let select = if ab_cols.is_empty() { base.to_string() } else { format!("{base}, {}", ab_cols.join(", ")) };
    let sql = format!("SELECT {select} FROM isolates");

    let mut out = Vec::new();
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query([])?;
    let mut idx = 0usize;
    while let Some(row) = rows.next()? {
        idx += 1;
        let patient_id: String = row.get::<_, Option<String>>(0)?.unwrap_or_else(|| format!("isolate-{idx}"));
        let sex: Option<String> = row.get(1)?;
        let birth_date: Option<String> = row.get(2)?;
        let spec_num: String = row.get::<_, Option<String>>(3)?.unwrap_or_else(|| format!("spec-{idx}"));
        let spec_type: Option<String> = row.get(4)?;
        let spec_date: Option<String> = row.get(5)?;
        let organism: Option<String> = row.get(6)?;
        let organism_code: Option<String> = row.get(7)?;

        let pid = format!("whonet-pat-{patient_id}");
        let sid = format!("whonet-spec-{spec_num}");
        let patient_ref = format!("Patient/{pid}");
        let specimen_ref = format!("Specimen/{sid}");

        let gender = sex.as_deref().map(|s| match s {
            "M" | "m" => "male",
            "F" | "f" => "female",
            _ => "unknown",
        });

        out.push(fhir::patient(&pid, None, None, gender, birth_date.as_deref()));
        out.push(fhir::specimen(&sid, &patient_ref, spec_type.as_deref(), spec_date.as_deref()));

        if let Some(org) = organism.as_deref() {
            out.push(fhir::observation_organism(
                &format!("whonet-org-{spec_num}"),
                &patient_ref,
                &specimen_ref,
                organism_code.as_deref().unwrap_or(org),
                org,
            ));
        }

        for (i, col) in ab_cols.iter().enumerate() {
            let val: Option<String> = row.get(8 + i)?;
            if let Some(v) = val {
                let v = v.trim();
                if v == "S" || v == "I" || v == "R" {
                    let ab = col.strip_prefix("ab_").unwrap_or(col);
                    out.push(fhir::observation_ast(
                        &format!("whonet-ast-{spec_num}-{ab}"),
                        &patient_ref,
                        &specimen_ref,
                        ab,
                        v,
                    ));
                }
            }
        }
    }
    Ok(out)
}
