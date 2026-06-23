//! DHIS2 HTTP client (wasm-only). Egress via extism_pdk::http; Extism enforces the
//! host-pinned allowed_hosts. Credentials come from the Extism config map.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use extism_pdk::*;
use serde_json::{json, Value};

use crate::summary::{parse_import_summary, parse_tracker_report};
use crate::types::PushResult;

fn cfg(key: &str) -> Result<String, Error> {
    config::get(key)?.ok_or_else(|| Error::msg(format!("missing '{key}' connector config")))
}

fn base_url() -> Result<String, Error> {
    Ok(cfg("baseUrl")?.trim_end_matches('/').to_string())
}

fn auth_header() -> Result<String, Error> {
    let token = STANDARD.encode(format!("{}:{}", cfg("username")?, cfg("password")?));
    Ok(format!("Basic {token}"))
}

fn get_json(path: &str) -> Result<Value, Error> {
    let url = format!("{}{}", base_url()?, path);
    let req = HttpRequest::new(&url)
        .with_method("GET")
        .with_header("Authorization", auth_header()?)
        .with_header("Accept", "application/json");
    let res = http::request::<Vec<u8>>(&req, None)?;
    if !(200..300).contains(&res.status_code()) {
        return Err(Error::msg(format!("DHIS2 GET {path} -> {}", res.status_code())));
    }
    Ok(serde_json::from_slice(&res.body())?)
}

/// GET /api/system/info — used by health_check.
pub fn system_info() -> Result<Value, Error> {
    get_json("/api/system/info.json")
}

/// Pull the metadata the connector "Test"/validation needs.
pub fn pull_metadata() -> Result<Value, Error> {
    let de = get_json("/api/dataElements.json?fields=id,name&paging=false")?;
    let ou = get_json("/api/organisationUnits.json?fields=id,name&paging=false")?;
    let coc = get_json("/api/categoryOptionCombos.json?fields=id,name&paging=false")?;
    let prog = get_json("/api/programs.json?fields=id,name&paging=false")?;
    let ps = get_json("/api/programStages.json?fields=id,name,program&paging=false")?;
    let program_stages: Vec<Value> = ps.get("programStages").and_then(|v| v.as_array()).cloned().unwrap_or_default()
        .iter()
        .map(|s| json!({
            "id": s.get("id").cloned().unwrap_or_else(|| json!("")),
            "name": s.get("name").cloned().unwrap_or_else(|| json!("")),
            "program": s.get("program").and_then(|p| p.get("id")).cloned().unwrap_or_else(|| json!("")),
        }))
        .collect();
    Ok(json!({
        "dataElements": de.get("dataElements").cloned().unwrap_or_else(|| json!([])),
        "orgUnits": ou.get("organisationUnits").cloned().unwrap_or_else(|| json!([])),
        "categoryOptionCombos": coc.get("categoryOptionCombos").cloned().unwrap_or_else(|| json!([])),
        "programs": prog.get("programs").cloned().unwrap_or_else(|| json!([])),
        "programStages": program_stages,
    }))
}

fn post(path: &str, payload: &Value) -> Result<(u16, String), Error> {
    let url = format!("{}{}", base_url()?, path);
    let req = HttpRequest::new(&url)
        .with_method("POST")
        .with_header("Authorization", auth_header()?)
        .with_header("Content-Type", "application/json")
        .with_header("Accept", "application/json");
    let body = serde_json::to_vec(payload)?;
    let res = http::request(&req, Some(body))?;
    Ok((res.status_code(), String::from_utf8_lossy(&res.body()).to_string()))
}

pub fn push_aggregate(payload: &Value) -> Result<PushResult, Error> {
    let (status, text) = post("/api/dataValueSets.json", payload)?;
    parse_import_summary(status, &text).map_err(Error::msg)
}

pub fn push_tracker(payload: &Value) -> Result<PushResult, Error> {
    let (status, text) = post("/api/tracker?async=false&importStrategy=CREATE_AND_UPDATE", payload)?;
    parse_tracker_report(status, &text).map_err(Error::msg)
}
