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
}
