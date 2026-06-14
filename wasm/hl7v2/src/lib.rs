mod mapping;
mod parser;

#[cfg(test)]
mod fuzz;

// The Extism plugin glue links wasm host imports (config/memory) that don't exist on the
// native host, so it is compiled only for the wasm target. Native `cargo test` excludes it
// and unit-tests the pure parser + mapping modules.
#[cfg(target_arch = "wasm32")]
mod plugin {
    use crate::{mapping, parser};
    use extism_pdk::*;
    use openldr_plugin_sdk::to_ndjson;

    fn load_config() -> mapping::Config {
        let mut cfg = mapping::Config::default();
        if let Ok(Some(s)) = config::get("organismIdCodes") {
            if let Ok(extra) = serde_json::from_str::<Vec<String>>(&s) {
                cfg.organism_codes.extend(extra);
            }
        }
        if let Ok(Some(s)) = config::get("astInterpretationCodes") {
            if let Ok(extra) = serde_json::from_str::<Vec<String>>(&s) {
                cfg.ast_interp.extend(extra.into_iter().map(|c| c.to_ascii_uppercase()));
            }
        }
        cfg
    }

    #[plugin_fn]
    pub fn convert(input: Vec<u8>) -> FnResult<String> {
        if input.is_empty() {
            return Ok(String::new());
        }
        let text = String::from_utf8(input).map_err(|e| WithReturnCode::new(Error::msg(format!("utf8: {e}")), 1))?;
        let cfg = load_config();
        let mut resources = Vec::new();
        for (i, segs) in parser::parse_messages(&text).into_iter().enumerate() {
            resources.extend(mapping::map_message(&segs, &cfg, i + 1));
        }
        Ok(to_ndjson(&resources))
    }
}
