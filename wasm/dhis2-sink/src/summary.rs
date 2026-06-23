//! Port of the @openldr/adapter-dhis2 response parsing: DHIS2 import summary
//! (dataValueSets) and tracker import report. Pure — host-testable.
use serde_json::Value;
use crate::types::{Conflict, PushResult};

fn u64_at(v: Option<&Value>, key: &str) -> u64 {
    v.and_then(|o| o.get(key)).and_then(|n| n.as_u64()).unwrap_or(0)
}

fn map_status(raw: &str, http_ok: bool) -> &'static str {
    match raw.to_uppercase().as_str() {
        "ERROR" => "error",
        "WARNING" => "warning",
        "SUCCESS" | "OK" => "success",
        _ => if http_ok { "success" } else { "error" },
    }
}

fn parse_conflicts(v: Option<&Value>) -> Vec<Conflict> {
    v.and_then(|c| c.as_array())
        .map(|arr| arr.iter().map(|c| Conflict {
            object: c.get("object").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            value: c.get("value").and_then(|x| x.as_str()).unwrap_or("").to_string(),
        }).collect())
        .unwrap_or_default()
}

fn err(endpoint: &str, status: u16, body: &str) -> String {
    let snip: String = body.chars().take(300).collect();
    if snip.is_empty() { format!("DHIS2 {endpoint} -> {status}") }
    else { format!("DHIS2 {endpoint} -> {status}: {snip}") }
}

/// Parse a /api/dataValueSets response. `Err` ⇒ no usable summary (host throws).
pub fn parse_import_summary(status_code: u16, body: &str) -> Result<PushResult, String> {
    let parsed: Option<Value> = if body.is_empty() { None } else { serde_json::from_str(body).ok() };
    let summary = match parsed.as_ref() {
        Some(v @ Value::Object(_)) => v,
        _ => return Err(err("dataValueSets", status_code, body)),
    };
    let response = summary.get("response");
    let has_summary = summary.get("status").is_some() || response.is_some() || summary.get("importCount").is_some();
    if !has_summary {
        return Err(err("dataValueSets", status_code, body));
    }
    // importCount ?? response.importCount ?? {}
    let ic = summary.get("importCount").or_else(|| response.and_then(|r| r.get("importCount")));
    let raw_status = response.and_then(|r| r.get("status")).and_then(|v| v.as_str())
        .or_else(|| summary.get("status").and_then(|v| v.as_str()))
        .unwrap_or("");
    let http_ok = (200..300).contains(&status_code);
    let conflicts = parse_conflicts(summary.get("conflicts").or_else(|| response.and_then(|r| r.get("conflicts"))));
    Ok(PushResult {
        status: map_status(raw_status, http_ok).to_string(),
        imported: u64_at(ic, "imported"),
        updated: u64_at(ic, "updated"),
        ignored: u64_at(ic, "ignored"),
        deleted: u64_at(ic, "deleted"),
        conflicts,
        raw: summary.clone(),
    })
}

/// Parse a /api/tracker response. `Err` ⇒ no usable report (host throws).
pub fn parse_tracker_report(status_code: u16, body: &str) -> Result<PushResult, String> {
    let parsed: Option<Value> = if body.is_empty() { None } else { serde_json::from_str(body).ok() };
    let report = match parsed.as_ref() {
        Some(v @ Value::Object(_)) => v,
        _ => return Err(err("tracker", status_code, body)),
    };
    let has_report = report.get("status").is_some() || report.get("stats").is_some() || report.get("validationReport").is_some();
    if !has_report {
        return Err(err("tracker", status_code, body));
    }
    let stats = report.get("stats");
    let raw_status = report.get("status").and_then(|v| v.as_str()).unwrap_or("");
    let http_ok = (200..300).contains(&status_code);
    let conflicts = report.get("validationReport").and_then(|v| v.get("errorReports")).and_then(|v| v.as_array())
        .map(|arr| arr.iter().map(|e| Conflict {
            object: e.get("uid").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            value: e.get("message").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        }).collect())
        .unwrap_or_default();
    Ok(PushResult {
        status: map_status(raw_status, http_ok).to_string(),
        imported: u64_at(stats, "created"),
        updated: u64_at(stats, "updated"),
        ignored: u64_at(stats, "ignored"),
        deleted: u64_at(stats, "deleted"),
        conflicts,
        raw: report.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn aggregate_success_flat_import_count() {
        let body = json!({ "status": "SUCCESS", "importCount": { "imported": 3, "updated": 1, "ignored": 0, "deleted": 0 }, "conflicts": [] }).to_string();
        let r = parse_import_summary(200, &body).unwrap();
        assert_eq!((r.status.as_str(), r.imported, r.updated), ("success", 3, 1));
    }

    #[test]
    fn aggregate_nested_warning_with_conflicts() {
        let body = json!({ "status": "OK", "response": { "status": "WARNING", "importCount": { "imported": 1, "updated": 0, "ignored": 2, "deleted": 0 }, "conflicts": [{ "object": "dataElement", "value": "bad" }] } }).to_string();
        let r = parse_import_summary(200, &body).unwrap();
        assert_eq!(r.status, "warning");
        assert_eq!((r.imported, r.ignored), (1, 2));
        assert_eq!(r.conflicts, vec![Conflict { object: "dataElement".into(), value: "bad".into() }]);
    }

    #[test]
    fn aggregate_nested_error() {
        let body = json!({ "status": "WARNING", "response": { "status": "ERROR", "importCount": { "imported": 0, "updated": 0, "ignored": 1, "deleted": 0 }, "conflicts": [] } }).to_string();
        assert_eq!(parse_import_summary(200, &body).unwrap().status, "error");
    }

    #[test]
    fn aggregate_non_json_body_is_error() {
        let e = parse_import_summary(401, "Unauthorized").unwrap_err();
        assert!(e.contains("401"));
    }

    #[test]
    fn aggregate_409_with_summary_is_warning() {
        let body = json!({ "status": "WARNING", "response": { "responseType": "ImportSummary", "status": "WARNING", "importCount": { "imported": 1, "updated": 1, "ignored": 6, "deleted": 1 }, "conflicts": [{ "object": "a57FmdPj3Zl", "value": "Data value is not a valid option" }] } }).to_string();
        let r = parse_import_summary(409, &body).unwrap();
        assert_eq!((r.status.as_str(), r.imported, r.updated, r.ignored), ("warning", 1, 1, 6));
        assert_eq!(r.conflicts, vec![Conflict { object: "a57FmdPj3Zl".into(), value: "Data value is not a valid option".into() }]);
    }

    #[test]
    fn tracker_success() {
        let body = json!({ "status": "OK", "stats": { "created": 2, "updated": 1, "deleted": 0, "ignored": 0 }, "validationReport": { "errorReports": [] } }).to_string();
        let r = parse_tracker_report(200, &body).unwrap();
        assert_eq!((r.status.as_str(), r.imported, r.updated), ("success", 2, 1));
    }

    #[test]
    fn tracker_409_validation_error_with_conflicts() {
        let body = json!({ "status": "ERROR", "stats": { "created": 0, "updated": 0, "deleted": 0, "ignored": 1 }, "validationReport": { "errorReports": [{ "message": "bad event", "uid": "E1" }] } }).to_string();
        let r = parse_tracker_report(409, &body).unwrap();
        assert_eq!((r.status.as_str(), r.ignored), ("error", 1));
        assert_eq!(r.conflicts, vec![Conflict { object: "E1".into(), value: "bad event".into() }]);
    }
}
