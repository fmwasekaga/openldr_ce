//! OpenLDR plugin SDK (Apache-2.0). Helpers for authoring WASM ingest plugins.
pub mod fhir;

pub use extism_pdk;
use serde_json::Value;

/// Serialize FHIR resources to NDJSON (one compact JSON object per line) — the
/// output ABI every OpenLDR plugin returns from its `convert` entrypoint.
pub fn to_ndjson(resources: &[Value]) -> String {
    resources.iter().map(|r| r.to_string()).collect::<Vec<_>>().join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ndjson_joins_one_per_line() {
        let out = to_ndjson(&[json!({ "a": 1 }), json!({ "b": 2 })]);
        assert_eq!(out, "{\"a\":1}\n{\"b\":2}");
    }

    #[test]
    fn patient_builds_name_and_gender() {
        let p = fhir::patient("p1", Some("Doe"), Some("Jane"), Some("female"), Some("1990-01-01"));
        assert_eq!(p["resourceType"], "Patient");
        assert_eq!(p["name"][0]["family"], "Doe");
        assert_eq!(p["gender"], "female");
    }

    #[test]
    fn service_request_builds_code_and_status() {
        let s = fhir::service_request("o1", "Patient/p1", Some("CULT"), Some("Culture"), "active");
        assert_eq!(s["resourceType"], "ServiceRequest");
        assert_eq!(s["status"], "active");
        assert_eq!(s["code"]["coding"][0]["code"], "CULT");
        assert_eq!(s["subject"]["reference"], "Patient/p1");
    }

    #[test]
    fn diagnostic_report_builds_specimen_and_conclusion() {
        let r = fhir::diagnostic_report("d1", "Patient/p1", Some("Specimen/s1"), Some("MICRO"), None, Some("2026-01-10"), Some("E. coli"));
        assert_eq!(r["resourceType"], "DiagnosticReport");
        assert_eq!(r["specimen"][0]["reference"], "Specimen/s1");
        assert_eq!(r["conclusion"], "E. coli");
    }
}
