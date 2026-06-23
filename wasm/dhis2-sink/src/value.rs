//! Row-value helpers mirroring the TS mapping's JS semantics.
use serde_json::Value;

/// Mirrors the TS `isEmpty`: a missing key, JSON null, or empty string is "empty".
/// (JS `undefined` maps to a missing key here.)
pub fn is_empty(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => true,
        Some(Value::String(s)) => s.is_empty(),
        _ => false,
    }
}

/// Mirrors JS `String(value)` for the scalar values a DHIS2 mapping row carries.
pub fn value_to_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Null => "null".to_string(),
        // Arrays/objects are not expected in report rows; fall back to JSON text.
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn is_empty_covers_missing_null_and_blank() {
        assert!(is_empty(None));
        assert!(is_empty(Some(&Value::Null)));
        assert!(is_empty(Some(&json!(""))));
        assert!(!is_empty(Some(&json!("x"))));
        assert!(!is_empty(Some(&json!(0))));
        assert!(!is_empty(Some(&json!(false))));
    }

    #[test]
    fn value_to_string_matches_js_string() {
        assert_eq!(value_to_string(&json!("abc")), "abc");
        assert_eq!(value_to_string(&json!(4)), "4");
        assert_eq!(value_to_string(&json!(2.5)), "2.5");
        assert_eq!(value_to_string(&json!(true)), "true");
    }
}
