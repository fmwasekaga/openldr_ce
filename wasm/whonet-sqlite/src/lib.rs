mod mapping;

// The wasm entrypoints (`convert`, `wf_convert`) and the `extism_pdk` host bindings are wasm-only:
// `#[plugin_fn]`/`#[host_fn]` and `sqlite3_deserialize` only make sense inside the Extism sandbox.
// Gating them behind `target_arch = "wasm32"` lets `cargo test` build the crate as an rlib on the
// host so the `mapping` helpers (`map_isolates`, `project_rows`) stay unit-testable natively.
#[cfg(target_arch = "wasm32")]
mod plugin {
    use crate::mapping;
    use extism_pdk::*;
    use openldr_plugin_sdk::to_ndjson;
    use rusqlite::serialize::OwnedData;
    use rusqlite::{ffi, Connection, DatabaseName};
    use std::ptr::NonNull;

    #[host_fn]
    extern "ExtismHost" {
        fn log(level: String, msg: String);
        fn progress(done: u64, total: u64);
    }

    /// Load a SQLite database image from raw bytes into an in-memory connection via
    /// sqlite3_deserialize — no filesystem access, keeping the plugin sandbox pure.
    fn load_db(input: &[u8]) -> Result<Connection, String> {
        let mut conn = Connection::open_in_memory().map_err(|e| format!("open: {e}"))?;
        let len = input.len();
        // SQLite takes ownership of this buffer (SQLITE_DESERIALIZE_FREEONCLOSE), so it
        // must be allocated by SQLite's own allocator.
        let buf = unsafe { ffi::sqlite3_malloc64(len as u64) } as *mut u8;
        let ptr = NonNull::new(buf).ok_or_else(|| "sqlite3_malloc64 returned null".to_string())?;
        unsafe { std::ptr::copy_nonoverlapping(input.as_ptr(), buf, len) };
        let owned = unsafe { OwnedData::from_raw_nonnull(ptr, len) };
        conn.deserialize(DatabaseName::Main, owned, true)
            .map_err(|e| format!("deserialize: {e}"))?;
        Ok(conn)
    }

    #[plugin_fn]
    pub fn convert(input: Vec<u8>) -> FnResult<String> {
        // Empty input carries no database — emit zero resources (used by `plugin test`).
        if input.is_empty() {
            return Ok(String::new());
        }
        let conn = load_db(&input).map_err(|e| WithReturnCode::new(Error::msg(e), 1))?;
        let resources =
            mapping::map_isolates(&conn).map_err(|e| WithReturnCode::new(Error::msg(format!("map: {e}")), 1))?;
        unsafe {
            let _ = log("info".into(), format!("whonet-sqlite produced {} resources", resources.len()));
        }
        Ok(to_ndjson(&resources))
    }

    /// Workflow-node entrypoint: consumes the input file bytes (a WHONET SQLite DB) and returns the
    /// workflow items envelope `{ items: [{ json: <value> }, ...] }`. The `output` Extism-config
    /// value selects the projection: `"rows"` emits one raw isolate-row record per item; otherwise
    /// (default `"fhir"`) emits one FHIR resource per item. Reuses the same parser/mapping core as
    /// `convert` (`load_db` + `mapping::{map_isolates, project_rows}`).
    #[plugin_fn]
    pub fn wf_convert(input: Vec<u8>) -> FnResult<String> {
        if input.is_empty() {
            return Ok(serde_json::json!({ "items": [] }).to_string());
        }
        let output = config::get("output").ok().flatten().unwrap_or_else(|| "fhir".to_string());
        let conn = load_db(&input).map_err(|e| WithReturnCode::new(Error::msg(e), 1))?;
        let items: Vec<serde_json::Value> = if output == "rows" {
            mapping::project_rows(&conn)
                .map_err(|e| WithReturnCode::new(Error::msg(format!("rows: {e}")), 1))?
                .into_iter()
                .map(|r| serde_json::json!({ "json": r }))
                .collect()
        } else {
            mapping::map_isolates(&conn)
                .map_err(|e| WithReturnCode::new(Error::msg(format!("map: {e}")), 1))?
                .into_iter()
                .map(|res| serde_json::json!({ "json": res }))
                .collect()
        };
        Ok(serde_json::json!({ "items": items }).to_string())
    }
}
