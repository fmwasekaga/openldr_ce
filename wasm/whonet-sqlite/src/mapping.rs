//! WHONET isolate row → FHIR resources.
use openldr_plugin_sdk::fhir;
use rusqlite::Connection;
use serde_json::{json, Value};

pub fn map_isolates(conn: &Connection) -> rusqlite::Result<Vec<Value>> {
    // Discover ab_* columns + presence of optional base columns from the table schema.
    let mut ab_cols: Vec<String> = Vec::new();
    let mut has_location = false;
    let mut has_laboratory = false;
    {
        let mut stmt = conn.prepare("PRAGMA table_info(isolates)")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(1))?;
        for name in rows {
            let name = name?;
            if name.starts_with("ab_") { ab_cols.push(name); }
            else if name == "location_type" { has_location = true; }
            else if name == "laboratory" { has_laboratory = true; }
        }
    }

    // Fixed base columns, then any present optional columns (tracked by their select index so the
    // index math stays correct whatever combination of optional columns the input DB has), then
    // the ab_* columns starting at `ab_base`.
    let mut base_cols: Vec<&str> = vec![
        "patient_id", "sex", "birth_date", "spec_num", "spec_type", "spec_date", "organism", "organism_code",
    ];
    let loc_idx = if has_location { base_cols.push("location_type"); Some(base_cols.len() - 1) } else { None };
    let lab_idx = if has_laboratory { base_cols.push("laboratory"); Some(base_cols.len() - 1) } else { None };
    let ab_base = base_cols.len();

    // Discovered ab_* names come from the (untrusted) input DB schema; quote them as SQLite
    // identifiers (doubling any embedded quote) so an unusual column name can neither break nor
    // inject into the query. The fixed base columns are trusted literals.
    let quoted_ab = ab_cols.iter().map(|c| format!("\"{}\"", c.replace('"', "\"\"")));
    let select = base_cols.iter().map(|c| c.to_string()).chain(quoted_ab).collect::<Vec<_>>().join(", ");
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
        let location_type: Option<String> = match loc_idx { Some(i) => row.get(i)?, None => None };
        let origin = location_type.as_deref().map(|l| match l.to_ascii_lowercase().as_str() {
            "i" | "in" | "inpatient" => "inpatient",
            "o" | "out" | "outpatient" => "outpatient",
            _ => "unknown",
        });
        let laboratory: Option<String> = match lab_idx { Some(i) => row.get(i)?, None => None };

        let pid = format!("whonet-pat-{patient_id}");
        let sid = format!("whonet-spec-{spec_num}");
        let patient_ref = format!("Patient/{pid}");
        let specimen_ref = format!("Specimen/{sid}");

        let gender = sex.as_deref().map(|s| match s {
            "M" | "m" => "male",
            "F" | "f" => "female",
            _ => "unknown",
        });

        // Facility dimension: WHONET "Laboratory" → Patient.managingOrganization. The flat store
        // projects this reference string into patients.managing_organization, which the AMR
        // by-facility report + the DHIS2 aggregate org-unit mapping key off.
        let mut pat = fhir::patient(&pid, None, None, gender, birth_date.as_deref());
        if let Some(lab) = laboratory.as_deref().map(str::trim).filter(|l| !l.is_empty()) {
            pat["managingOrganization"] = json!({ "reference": format!("Organization/{lab}") });
        }
        out.push(pat);
        out.push(fhir::specimen(&sid, &patient_ref, spec_type.as_deref(), spec_date.as_deref(), origin));

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
            let val: Option<String> = row.get(ab_base + i)?;
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
