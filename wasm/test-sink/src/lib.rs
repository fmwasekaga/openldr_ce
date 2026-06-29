//! Trivial sink plugin: proves the sink ABI (named entrypoints, JSON in/out, dry-run echo).
//! Not a reference plugin — used only to validate the host sink runtime.

#[cfg(target_arch = "wasm32")]
mod plugin {
    use extism_pdk::*;
    use serde_json::{json, Value};

    /// Cheap liveness probe. Input ignored; returns { ok, version }.
    #[plugin_fn]
    pub fn health_check(_input: Vec<u8>) -> FnResult<String> {
        Ok(json!({ "ok": true, "version": "test-sink" }).to_string())
    }

    /// Dry-run echo: empty dataValues payload + the parsed input echoed back. No egress.
    #[plugin_fn]
    pub fn push_aggregate(input: Vec<u8>) -> FnResult<String> {
        let parsed: Value = if input.is_empty() {
            json!({})
        } else {
            serde_json::from_slice(&input)
                .map_err(|e| WithReturnCode::new(Error::msg(format!("invalid input JSON: {e}")), 1))?
        };
        Ok(json!({ "payload": { "dataValues": [] }, "skipped": [], "echo": parsed }).to_string())
    }

    /// Converter ABI: raw bytes in (UTF-8 text) → { items: one per non-empty line }.
    #[plugin_fn]
    pub fn wf_convert(input: Vec<u8>) -> FnResult<String> {
        let text = String::from_utf8_lossy(&input);
        let items: Vec<Value> = text
            .lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty())
            .map(|l| json!({ "json": { "line": l } }))
            .collect();
        Ok(json!({ "items": items }).to_string())
    }

    /// Emit a produced file as inline base64 on an output item (base64 of "hello" = aGVsbG8=).
    #[plugin_fn]
    pub fn wf_emit(_input: Vec<u8>) -> FnResult<String> {
        Ok(json!({ "items": [{
            "json": { "ok": true },
            "binary": { "out": { "contentType": "text/plain", "fileName": "hello.txt", "dataBase64": "aGVsbG8=" } }
        }] }).to_string())
    }

    /// Workflow-node ABI echo: parse { items, config }, return { items, meta:{count,config} }.
    #[plugin_fn]
    pub fn wf_echo(input: Vec<u8>) -> FnResult<String> {
        let parsed: Value = if input.is_empty() {
            json!({})
        } else {
            serde_json::from_slice(&input)
                .map_err(|e| WithReturnCode::new(Error::msg(format!("invalid input JSON: {e}")), 1))?
        };
        let items = parsed.get("items").cloned().unwrap_or_else(|| json!([]));
        let config = parsed.get("config").cloned().unwrap_or_else(|| json!({}));
        let count = items.as_array().map(|a| a.len()).unwrap_or(0);
        Ok(json!({ "items": items, "meta": { "count": count, "config": config } }).to_string())
    }
}

// The host (non-wasm) build needs at least one item so `cargo check`/`clippy` succeed.
#[cfg(not(target_arch = "wasm32"))]
pub fn _host_placeholder() {}
