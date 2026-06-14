mod mapping;
mod reader;

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
}
