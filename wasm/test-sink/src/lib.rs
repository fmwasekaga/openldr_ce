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
}

// The host (non-wasm) build needs at least one item so `cargo check`/`clippy` succeed.
#[cfg(not(target_arch = "wasm32"))]
pub fn _host_placeholder() {}
