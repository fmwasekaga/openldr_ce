mod mapping;
mod reader;

#[cfg(test)]
mod fuzz;

#[cfg(target_arch = "wasm32")]
mod plugin {
    use crate::{mapping, reader};
    use extism_pdk::*;
    use openldr_plugin_sdk::to_ndjson;

    #[plugin_fn]
    pub fn convert(input: Vec<u8>) -> FnResult<String> {
        if input.is_empty() { return Ok(String::new()); }
        let raw = config::get("mapping").ok().flatten().ok_or_else(|| WithReturnCode::new(Error::msg("missing 'mapping' plugin config"), 1))?;
        let m: mapping::Mapping = serde_json::from_str(&raw).map_err(|e| WithReturnCode::new(Error::msg(format!("invalid mapping config: {e}")), 1))?;
        m.validate().map_err(|e| WithReturnCode::new(Error::msg(e), 1))?;
        let rows = reader::read_rows(&input, m.sheet.as_deref()).map_err(|e| WithReturnCode::new(Error::msg(e), 1))?;
        let resources = mapping::map_rows(&rows, &m);
        Ok(to_ndjson(&resources))
    }

    /// Workflow node entrypoint: consume input file bytes (CSV/Excel) and return
    /// `{ items: [{ json: <value> }, ...] }`. Dispatch on the `output` config:
    /// `"rows"` -> one raw parsed-row record per item (no FHIR map; `mapping` optional);
    /// else (default `"fhir"`) -> one FHIR resource per item via `mapping::map_rows`.
    #[plugin_fn]
    pub fn wf_convert(input: Vec<u8>) -> FnResult<String> {
        if input.is_empty() {
            return Ok(serde_json::json!({ "items": [] }).to_string());
        }
        let output = config::get("output").ok().flatten().unwrap_or_else(|| "fhir".to_string());
        let mapping_raw = config::get("mapping").ok().flatten();
        let m: Option<mapping::Mapping> = match &mapping_raw {
            Some(s) => Some(
                serde_json::from_str(s)
                    .map_err(|e| WithReturnCode::new(Error::msg(format!("invalid mapping: {e}")), 1))?,
            ),
            None => None,
        };
        let sheet = m.as_ref().and_then(|mm| mm.sheet.clone());
        let rows = reader::read_rows(&input, sheet.as_deref())
            .map_err(|e| WithReturnCode::new(Error::msg(e), 1))?;
        let items: Vec<serde_json::Value> = if output == "rows" {
            rows.into_iter()
                .map(|r| serde_json::to_value(r).map(|v| serde_json::json!({ "json": v })))
                .collect::<Result<_, _>>()
                .map_err(|e| WithReturnCode::new(Error::msg(format!("serialize row: {e}")), 1))?
        } else {
            let m = m.ok_or_else(|| {
                WithReturnCode::new(Error::msg("fhir output requires a 'mapping' config"), 1)
            })?;
            m.validate().map_err(|e| WithReturnCode::new(Error::msg(e), 1))?;
            mapping::map_rows(&rows, &m)
                .into_iter()
                .map(|res| serde_json::json!({ "json": res }))
                .collect()
        };
        Ok(serde_json::json!({ "items": items }).to_string())
    }
}
