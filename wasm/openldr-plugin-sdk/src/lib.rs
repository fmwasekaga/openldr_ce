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
}
