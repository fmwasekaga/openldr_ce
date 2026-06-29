//! DHIS2 aggregate + tracker sink plugin. Pure mapping/parsing modules (host-testable)
//! plus a wasm-only HTTP client + entrypoint module (added in later tasks).
pub mod types;
pub mod value;
pub mod uid;
pub mod mapping;
pub mod tracker;
pub mod summary;

#[cfg(target_arch = "wasm32")]
mod client;

/// Host-testable core of `wf_push`: items envelope -> rows -> build aggregate|tracker
/// payload. Returns `(kind, payload_json, skipped_count)`. No HTTP egress — the
/// network push stays in the wasm-only `wf_push` entrypoint / `client`.
pub fn wf_build(
    env: &types::WfPushInput,
) -> Result<(String, serde_json::Value, usize), String> {
    use types::*;
    // Each item's `.json` must be a JSON object -> a mapping `Row`.
    let mut rows: Vec<Row> = Vec::with_capacity(env.items.len());
    for (i, item) in env.items.iter().enumerate() {
        if let serde_json::Value::Object(m) = &item.json {
            rows.push(m.clone());
        } else {
            // Exhaustive, non-panicking type name for a clear error.
            let ty = match &item.json {
                serde_json::Value::Null => "null",
                serde_json::Value::Bool(_) => "boolean",
                serde_json::Value::Number(_) => "number",
                serde_json::Value::String(_) => "string",
                serde_json::Value::Array(_) => "array",
                serde_json::Value::Object(_) => "object",
            };
            return Err(format!(
                "wf_push item[{i}].json must be a JSON object, got {ty}"
            ));
        }
    }

    let kind = env
        .config
        .mapping
        .get("kind")
        .and_then(|v| v.as_str())
        .unwrap_or("aggregate");

    match kind {
        "tracker" => {
            let mapping: TrackerMapping = serde_json::from_value(env.config.mapping.clone())
                .map_err(|e| format!("invalid tracker mapping: {e}"))?;
            let (events, skipped) =
                tracker::build_events(&rows, &mapping, &env.config.org_unit_map);
            let payload = EventSetPayload { events };
            let value = serde_json::to_value(&payload)
                .map_err(|e| format!("failed to serialize tracker payload: {e}"))?;
            Ok(("tracker".to_string(), value, skipped.len()))
        }
        _ => {
            let mapping: AggregateMapping = serde_json::from_value(env.config.mapping.clone())
                .map_err(|e| format!("invalid aggregate mapping: {e}"))?;
            let (data_values, skipped) = mapping::build_data_value_set(
                &rows,
                &mapping,
                &env.config.org_unit_map,
                &env.config.period,
            );
            let payload = DataValueSetPayload { data_values };
            let value = serde_json::to_value(&payload)
                .map_err(|e| format!("failed to serialize aggregate payload: {e}"))?;
            Ok(("aggregate".to_string(), value, skipped.len()))
        }
    }
}

#[cfg(test)]
mod wf_build_tests {
    use super::types::*;
    use serde_json::json;

    fn item(v: serde_json::Value) -> WfPushItem {
        WfPushItem { json: v, binary: None, extra: serde_json::Map::new() }
    }

    #[test]
    fn wf_build_aggregate_dispatch_and_payload() {
        let env = WfPushInput {
            items: vec![item(json!({ "facility": "fac-1", "tested": 4, "r": 2 }))],
            config: WfPushConfig {
                mapping: json!({
                    "orgUnitColumn": "facility",
                    "columns": [
                        { "column": "tested", "dataElement": "DE_TESTED" },
                        { "column": "r", "dataElement": "DE_RESISTANT", "categoryOptionCombo": "COC_DEFAULT" }
                    ]
                }),
                org_unit_map: std::collections::HashMap::from([
                    ("fac-1".to_string(), "OU_AAA".to_string()),
                ]),
                period: "2026Q1".to_string(),
                dry_run: false,
            },
        };
        let (kind, payload, skipped) = super::wf_build(&env).expect("wf_build ok");
        assert_eq!(kind, "aggregate");
        assert_eq!(skipped, 0);
        let dvs = payload.get("dataValues").and_then(|v| v.as_array()).expect("dataValues array");
        assert_eq!(dvs.len(), 2);
        assert_eq!(dvs[0]["dataElement"], json!("DE_TESTED"));
        assert_eq!(dvs[0]["orgUnit"], json!("OU_AAA"));
        assert_eq!(dvs[0]["period"], json!("2026Q1"));
        assert_eq!(dvs[0]["value"], json!("4"));
        assert_eq!(dvs[1]["categoryOptionCombo"], json!("COC_DEFAULT"));
    }

    #[test]
    fn wf_build_tracker_dispatch_on_kind() {
        let env = WfPushInput {
            items: vec![item(json!({
                "id": "obs-1", "facility": "fac-1", "eventDate": "2026-01-10",
                "antibiotic": "AMP", "result": "R"
            }))],
            config: WfPushConfig {
                mapping: json!({
                    "kind": "tracker",
                    "id": "amr-events", "program": "PR1", "programStage": "PS1",
                    "orgUnitColumn": "facility", "eventDateColumn": "eventDate", "idColumn": "id",
                    "dataValues": [
                        { "column": "antibiotic", "dataElement": "DE_AB" },
                        { "column": "result", "dataElement": "DE_RES" }
                    ]
                }),
                org_unit_map: std::collections::HashMap::from([
                    ("fac-1".to_string(), "OU_AAA".to_string()),
                ]),
                period: String::new(),
                dry_run: true,
            },
        };
        let (kind, payload, skipped) = super::wf_build(&env).expect("wf_build ok");
        assert_eq!(kind, "tracker");
        assert_eq!(skipped, 0);
        let events = payload.get("events").and_then(|v| v.as_array()).expect("events array");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0]["program"], json!("PR1"));
        assert_eq!(events[0]["orgUnit"], json!("OU_AAA"));
    }

    #[test]
    fn wf_build_rejects_non_object_item_json() {
        let env = WfPushInput {
            items: vec![item(json!("not-an-object"))],
            config: WfPushConfig {
                mapping: json!({ "orgUnitColumn": "facility", "columns": [] }),
                org_unit_map: std::collections::HashMap::new(),
                period: String::new(),
                dry_run: true,
            },
        };
        let err = super::wf_build(&env).expect_err("should reject non-object json");
        assert!(err.contains("must be a JSON object"), "got: {err}");
    }

    /// The sink echoes items unchanged: unknown fields an item carries (absorbed into
    /// `extra` via `#[serde(flatten)]`) must survive the serialize round-trip, and an
    /// absent `binary` must be omitted (not emitted as `null`).
    #[test]
    fn item_echo_round_trips_unknown_fields_and_omits_absent_binary() {
        let items: Vec<WfPushItem> = serde_json::from_value(json!([
            { "json": { "a": 1 }, "traceId": "t-123", "tags": ["x"] }
        ])).expect("parse items");
        let echoed = serde_json::to_value(&items).expect("serialize items");
        let it = &echoed.as_array().unwrap()[0];
        assert_eq!(it["json"], json!({ "a": 1 }));
        assert_eq!(it["traceId"], json!("t-123"));
        assert_eq!(it["tags"], json!(["x"]));
        // binary was absent on input -> must not appear as null on output.
        assert!(it.get("binary").is_none(), "absent binary must be omitted, got: {it}");
    }
}

#[cfg(target_arch = "wasm32")]
mod plugin {
    use extism_pdk::*;
    use serde_json::json;
    use crate::types::*;
    use crate::{client, mapping, tracker};

    /// Cheap liveness probe. Never throws — a down server returns { ok:false, error }.
    #[plugin_fn]
    pub fn health_check(_input: Vec<u8>) -> FnResult<String> {
        match client::system_info() {
            Ok(info) => Ok(json!({ "ok": true, "version": info.get("version") }).to_string()),
            Err(e) => Ok(json!({ "ok": false, "error": e.to_string() }).to_string()),
        }
    }

    #[plugin_fn]
    pub fn pull_metadata(_input: Vec<u8>) -> FnResult<String> {
        let m = client::pull_metadata().map_err(|e| WithReturnCode::new(e, 1))?;
        Ok(m.to_string())
    }

    #[plugin_fn]
    pub fn push_aggregate(input: Vec<u8>) -> FnResult<String> {
        let inp: AggregatePushInput = serde_json::from_slice(&input)
            .map_err(|e| WithReturnCode::new(Error::msg(format!("invalid push_aggregate input: {e}")), 1))?;
        let (data_values, skipped) = mapping::build_data_value_set(&inp.rows, &inp.mapping, &inp.org_unit_map, &inp.period);
        let payload = DataValueSetPayload { data_values };
        if inp.dry_run {
            return Ok(serde_json::to_string(&AggregatePushOutput { payload, skipped, result: None })?);
        }
        let body = serde_json::to_value(&payload)?;
        let result = client::push_aggregate(&body).map_err(|e| WithReturnCode::new(e, 1))?;
        Ok(serde_json::to_string(&AggregatePushOutput { payload, skipped, result: Some(result) })?)
    }

    #[plugin_fn]
    pub fn push_tracker(input: Vec<u8>) -> FnResult<String> {
        let inp: TrackerPushInput = serde_json::from_slice(&input)
            .map_err(|e| WithReturnCode::new(Error::msg(format!("invalid push_tracker input: {e}")), 1))?;
        let (events, skipped) = tracker::build_events(&inp.rows, &inp.mapping, &inp.org_unit_map);
        let payload = EventSetPayload { events };
        if inp.dry_run {
            return Ok(serde_json::to_string(&TrackerPushOutput { payload, skipped, result: None })?);
        }
        let body = serde_json::to_value(&payload)?;
        let result = client::push_tracker(&body).map_err(|e| WithReturnCode::new(e, 1))?;
        Ok(serde_json::to_string(&TrackerPushOutput { payload, skipped, result: Some(result) })?)
    }

    /// Workflow-node envelope entrypoint: consumes `{ items, config:{mapping, orgUnitMap,
    /// period, dryRun} }`, builds the aggregate|tracker payload via the host-testable
    /// `wf_build` core, pushes (unless dryRun), and echoes items back through with `meta`.
    #[plugin_fn]
    pub fn wf_push(input: Vec<u8>) -> FnResult<String> {
        let env: WfPushInput = serde_json::from_slice(&input)
            .map_err(|e| WithReturnCode::new(Error::msg(format!("invalid wf_push input: {e}")), 1))?;
        let (kind, payload, skipped) = crate::wf_build(&env)
            .map_err(|e| WithReturnCode::new(Error::msg(e), 1))?;

        // Per-kind count of built rows for `meta`.
        let (count_key, count) = match kind.as_str() {
            "tracker" => ("events", payload.get("events").and_then(|v| v.as_array()).map_or(0, |a| a.len())),
            _ => ("dataValues", payload.get("dataValues").and_then(|v| v.as_array()).map_or(0, |a| a.len())),
        };

        let result = if env.config.dry_run {
            serde_json::Value::Null
        } else {
            let r = match kind.as_str() {
                "tracker" => client::push_tracker(&payload),
                _ => client::push_aggregate(&payload),
            }
            .map_err(|e| WithReturnCode::new(e, 1))?;
            serde_json::to_value(&r)
                .map_err(|e| WithReturnCode::new(Error::msg(format!("failed to serialize push result: {e}")), 1))?
        };

        // A sink passes items through unchanged — serialize the originals so every
        // field (including unknown ones absorbed into `extra`) round-trips faithfully.
        let items_echo = serde_json::to_value(&env.items)
            .map_err(|e| WithReturnCode::new(Error::msg(format!("failed to echo items: {e}")), 1))?;

        Ok(json!({
            "items": items_echo,
            "meta": {
                "kind": kind,
                count_key: count,
                "skipped": skipped,
                "result": result,
            }
        }).to_string())
    }
}
