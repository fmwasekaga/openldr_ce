//! WHONET isolate row → FHIR resources.
use openldr_plugin_sdk::fhir;
use rusqlite::Connection;
use serde_json::{json, Value};

/// The isolate SELECT shared by `map_isolates` and `project_rows`: the discovered ab_* column
/// names, the optional-column select indices, where the ab_* columns start, and the assembled
/// `SELECT ... FROM isolates` SQL — so both the FHIR mapping and the raw-row projection read the
/// exact same table/columns.
struct IsolateSelect {
    ab_cols: Vec<String>,
    loc_idx: Option<usize>,
    lab_idx: Option<usize>,
    ab_base: usize,
    sql: String,
}

fn isolate_select(conn: &Connection) -> rusqlite::Result<IsolateSelect> {
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

    Ok(IsolateSelect { ab_cols, loc_idx, lab_idx, ab_base, sql })
}

pub fn map_isolates(conn: &Connection) -> rusqlite::Result<Vec<Value>> {
    let IsolateSelect { ab_cols, loc_idx, lab_idx, ab_base, sql } = isolate_select(conn)?;

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

        // One order per isolate, so every lab result below can link back via `basedOn` — the
        // validation gate rejects laboratory Observations with no linked ServiceRequest.
        let sr_id = format!("whonet-sr-{patient_id}-{idx}");
        let sr_ref = format!("ServiceRequest/{sr_id}");
        out.push(fhir::service_request(&sr_id, &patient_ref, None, Some("AST panel"), "active"));

        if let Some(org) = organism.as_deref() {
            out.push(fhir::observation_organism(
                &format!("whonet-org-{spec_num}"),
                &patient_ref,
                &specimen_ref,
                organism_code.as_deref().unwrap_or(org),
                org,
                Some(sr_ref.as_str()),
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
                        Some(sr_ref.as_str()),
                    ));
                }
            }
        }
    }
    Ok(out)
}

/// Project the isolate rows as flat JSON records (raw columns), reusing the SAME table/columns
/// `map_isolates` reads (via `isolate_select`). Each row becomes a `{ column_name: value }` object
/// with TEXT/INTEGER/REAL mapped to JSON string/number and NULL to JSON null — used by the
/// `wf_convert` `output == "rows"` mode to emit raw isolate rows instead of FHIR resources.
pub fn project_rows(conn: &Connection) -> rusqlite::Result<Vec<serde_json::Map<String, Value>>> {
    let IsolateSelect { sql, .. } = isolate_select(conn)?;

    let mut stmt = conn.prepare(&sql)?;
    // Column names come straight from the SELECT list (base literals + quoted ab_* identifiers),
    // matching exactly what map_isolates queried.
    let col_names: Vec<String> = stmt.column_names().into_iter().map(String::from).collect();

    let mut out = Vec::new();
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let mut rec = serde_json::Map::with_capacity(col_names.len());
        for (i, name) in col_names.iter().enumerate() {
            use rusqlite::types::ValueRef;
            let v = match row.get_ref(i)? {
                ValueRef::Null => Value::Null,
                ValueRef::Integer(n) => Value::from(n),
                ValueRef::Real(f) => serde_json::Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null),
                ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
                ValueRef::Blob(b) => Value::String(format!("blob:{} bytes", b.len())),
            };
            rec.insert(name.clone(), v);
        }
        out.push(rec);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Seed an in-memory isolates table with the columns map_isolates reads, plus 2 rows.
    fn seed() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory");
        conn.execute_batch(
            "CREATE TABLE isolates (
                patient_id TEXT, sex TEXT, birth_date TEXT, spec_num TEXT, spec_type TEXT,
                spec_date TEXT, organism TEXT, organism_code TEXT, location_type TEXT,
                laboratory TEXT, ab_cip TEXT, ab_amp TEXT
            );
            INSERT INTO isolates VALUES
                ('P1','M','1990-01-01','S1','blood','2024-01-02','E. coli','eco','in','LabA','R','S'),
                ('P2','F','1985-05-05','S2','urine','2024-02-03','S. aureus','sau','out','LabB','S','I');",
        )
        .expect("seed isolates");
        conn
    }

    #[test]
    fn project_rows_returns_raw_columns() {
        let conn = seed();
        let rows = project_rows(&conn).expect("project_rows ok");
        assert_eq!(rows.len(), 2, "expected one record per isolate row");

        let r0 = &rows[0];
        // Raw columns are passed through verbatim (no FHIR shaping).
        assert_eq!(r0.get("patient_id"), Some(&Value::String("P1".into())));
        assert_eq!(r0.get("organism"), Some(&Value::String("E. coli".into())));
        assert_eq!(r0.get("ab_cip"), Some(&Value::String("R".into())));
        assert_eq!(r0.get("laboratory"), Some(&Value::String("LabA".into())));
        // ab_* columns are projected raw under their full column name.
        assert!(r0.contains_key("ab_amp"), "ab_amp column must be present");

        assert_eq!(rows[1].get("sex"), Some(&Value::String("F".into())));
    }

    #[test]
    fn project_rows_handles_null_and_numeric() {
        let conn = Connection::open_in_memory().expect("open");
        conn.execute_batch(
            "CREATE TABLE isolates (
                patient_id TEXT, sex TEXT, birth_date TEXT, spec_num TEXT, spec_type TEXT,
                spec_date TEXT, organism TEXT, organism_code INTEGER
            );
            INSERT INTO isolates VALUES ('P9',NULL,NULL,'S9',NULL,NULL,'E. coli',42);",
        )
        .expect("seed");
        let rows = project_rows(&conn).expect("project_rows ok");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].get("sex"), Some(&Value::Null));
        assert_eq!(rows[0].get("organism_code"), Some(&Value::from(42_i64)));
    }

    #[test]
    fn map_isolates_returns_fhir_resources() {
        let conn = seed();
        let res = map_isolates(&conn).expect("map_isolates ok");
        assert!(!res.is_empty(), "expected FHIR resources");
        // Every emitted resource is a FHIR object with a resourceType.
        assert!(res.iter().all(|r| r.get("resourceType").and_then(Value::as_str).is_some()));
        // A Patient resource should be present.
        assert!(res.iter().any(|r| r.get("resourceType") == Some(&Value::String("Patient".into()))));

        // Each isolate gets its own order, so the validation gate (which rejects a laboratory
        // Observation with no linked ServiceRequest) accepts the emitted results.
        assert!(
            res.iter().any(|r| r.get("resourceType") == Some(&Value::String("ServiceRequest".into()))),
            "expected at least one ServiceRequest"
        );

        // Every Observation must link back to the order it fulfills.
        let observations: Vec<&Value> = res
            .iter()
            .filter(|r| r.get("resourceType") == Some(&Value::String("Observation".into())))
            .collect();
        assert!(!observations.is_empty(), "expected at least one Observation");
        for obs in observations {
            let reference = obs
                .get("basedOn")
                .and_then(|b| b.get(0))
                .and_then(|b| b.get("reference"))
                .and_then(Value::as_str)
                .unwrap_or_else(|| panic!("Observation missing basedOn[0].reference: {obs}"));
            assert!(
                reference.starts_with("ServiceRequest/"),
                "expected basedOn reference to start with 'ServiceRequest/', got {reference}"
            );
        }
    }
}
