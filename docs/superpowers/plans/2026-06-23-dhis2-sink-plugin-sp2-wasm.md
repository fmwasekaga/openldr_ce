# DHIS2 Sink Plugin — SP-2: `wasm/dhis2-sink` Rust Plugin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the DHIS2 aggregate + tracker mapping (`buildDataValueSet`/`buildEvents`/`dhis2Uid`) and the HTTP egress + import-summary parsing (from `@openldr/adapter-dhis2`) into a new Rust → wasm **sink plugin** `wasm/dhis2-sink`, exporting the four sink entrypoints `health_check` / `pull_metadata` / `push_aggregate` / `push_tracker` defined by the SP-1 ABI.

**Architecture:** The plugin is split into **pure, host-testable** modules (`value`, `uid`, `mapping`, `tracker`, `summary`, `types`) that carry all the mapping + response-parsing logic — exercised by Rust `#[cfg(test)]` unit tests ported one-to-one from the existing TS tests — and a **wasm-only** layer (`client` + the `plugin` entrypoint module) that does HTTP via `extism_pdk::http` with credentials from the Extism config map. Dry-run returns the mapped payload preview with no egress; a real push POSTs to DHIS2 and parses the import summary. Proven by Rust unit tests + skip-guarded host integration tests (dry-run mapping through real Extism, and a real POST against a local mock DHIS2 with `allowedHosts` pinned).

**Tech Stack:** Rust → `wasm32-wasip1` (Extism PDK 1.4.1), `sha2` (UID), `base64` (Basic auth), `serde`/`serde_json`; TypeScript host (`createWasmSink`/`createExtismRunner` from SP-1, vitest). Pure Rust — no C deps, so the build needs only the `wasm32-wasip1` target (no clang/WASI sysroot).

---

## Context for the implementer (read first)

This is **SP-2 of 6** in the DHIS2-sink-plugin workstream. Design: `docs/superpowers/specs/2026-06-23-dhis2-sink-plugin-connectors-design.md`. **SP-1 is already merged** (sink ABI + host runtime): the flat manifest supports `kind:"sink"` + `entrypoints[]`, `createWasmSink`/`loadSink` exist, and `wasm/test-sink` + `scripts/build-test-sink.mjs` are the patterns to mirror.

**SP-2 builds the real DHIS2 plugin.** It ports — does NOT delete — the existing TS source (deleting `@openldr/adapter-dhis2` + shrinking `@openldr/dhis2` is **SP-4**, the host rewiring). So both the TS packages and the new wasm crate coexist after SP-2.

**Source of truth being ported (read these for exact behavior):**
- `packages/dhis2/src/mapping.ts` — `buildDataValueSet` (aggregate) + `dispatchReportSource` (host-only, NOT ported — it picks a report id, which the host does).
- `packages/dhis2/src/tracker.ts` — `buildEvents` (port) + `validateTrackerMapping` (host-only, needs metadata — NOT ported, stays in `@openldr/dhis2`).
- `packages/dhis2/src/uid.ts` — `dhis2Uid` (port byte-for-byte).
- `packages/dhis2/src/types.ts` — the mapping/payload shapes to mirror as Rust structs.
- `packages/adapter-dhis2/src/index.ts` — HTTP egress + import-summary / tracker-report parsing (port to `client.rs` + `summary.rs`).
- Tests to port: `packages/dhis2/src/{mapping,tracker,uid}.test.ts`, `packages/adapter-dhis2/src/index.test.ts` (the push/summary cases).

**The four sink entrypoints (SP-1 ABI — input/output JSON):**
- `health_check`: input `{}` (ignored) → `{ ok: bool, version?, error? }`. Does NOT throw on a down server — returns `{ ok:false, error }`.
- `pull_metadata`: input `{}` → `{ dataElements, orgUnits, categoryOptionCombos, programs, programStages }`.
- `push_aggregate`: input `{ rows, mapping:{orgUnitColumn,periodColumn?,columns[]}, orgUnitMap, period, dryRun }`, config (secrets) `{ baseUrl, username, password }` → `{ payload:{dataValues}, skipped, result? }`. `result` present only when `dryRun=false`.
- `push_tracker`: input `{ rows, mapping:{id,program,programStage,orgUnitColumn,eventDateColumn,idColumn,dataValues[]}, orgUnitMap, dryRun }` → `{ payload:{events}, skipped, result? }`.

**Egress model (from SP-1, locked):** the connector pins the concrete host at runtime (host passes `allowedHosts:[connectorHost]`); the plugin declares `net-egress` intent in its manifest (empty `allowedHosts` list = "host decides"). Credentials arrive via the Extism config map, never persisted by the plugin. `createWasmSink` fail-closes egress if a host is pinned but the plugin lacks `net-egress`.

**`extism-pdk` 1.4.1 HTTP API (verified against the installed crate):**
```rust
use extism_pdk::*;
let req = HttpRequest::new(&url).with_method("POST")
    .with_header("Authorization", auth).with_header("Content-Type", "application/json");
let res = http::request(&req, Some(body_bytes))?;   // body: Option<T: ToMemory>; Vec<u8>/String impl it
let res = http::request::<Vec<u8>>(&req, None)?;     // no body: annotate T
let code: u16 = res.status_code();
let bytes: Vec<u8> = res.body();
// config map (the secrets):
let v: Option<String> = config::get("baseUrl")?;
```
`HttpRequest`, `http`, `config`, `plugin_fn` are all re-exported by `extism_pdk` (use `extism_pdk::*`).

**Testing posture (matches SP-1):** Rust unit tests are the primary gate (pure modules, no wasm). The TS host integration tests are **skip-guarded** on `reference-plugins/dhis2-sink/plugin.wasm` being present (run `pnpm build:dhis2-sink` first), so the turbo gate stays green without the wasm toolchain. The Rust toolchain + `wasm32-wasip1` target ARE present in this environment (confirmed in SP-1).

---

## File Structure

**Created (Rust crate `wasm/dhis2-sink/`):**
- `Cargo.toml` — crate manifest (deps: openldr-plugin-sdk, serde, serde_json, sha2; wasm-only: extism-pdk, base64).
- `src/lib.rs` — module declarations + the `#[cfg(target_arch="wasm32")] mod plugin` entrypoints.
- `src/types.rs` — serde structs: mappings (Deserialize), payload/result (Serialize), entrypoint I/O.
- `src/value.rs` — `is_empty` + `value_to_string` (JS `String()`/empty semantics). Pure + tested.
- `src/uid.rs` — `dhis2_uid` (sha256 → 11-char). Pure + tested.
- `src/mapping.rs` — `build_data_value_set`. Pure + tested.
- `src/tracker.rs` — `build_events`. Pure + tested.
- `src/summary.rs` — `parse_import_summary` + `parse_tracker_report`. Pure + tested.
- `src/client.rs` — wasm-only HTTP client (`system_info`/`pull_metadata`/`push_aggregate`/`push_tracker`).

**Created (host/tooling):**
- `scripts/build-dhis2-sink.mjs` — build + stage `reference-plugins/dhis2-sink/{plugin.wasm,manifest.json}`.
- `packages/plugins/src/dhis2-sink.integration.test.ts` — skip-guarded real-Extism tests (dry-run mapping + mock-DHIS2 push).

**Modified:**
- `wasm/Cargo.toml` — add `dhis2-sink` to `members`.
- `package.json` (root) — add `build:dhis2-sink` script.

---

## Task 1: Crate skeleton + `value` + `uid` (pure foundation)

**Files:**
- Create: `wasm/dhis2-sink/Cargo.toml`, `wasm/dhis2-sink/src/lib.rs`, `wasm/dhis2-sink/src/value.rs`, `wasm/dhis2-sink/src/uid.rs`
- Modify: `wasm/Cargo.toml`

- [ ] **Step 1: Create the crate manifest**

`wasm/dhis2-sink/Cargo.toml`:

```toml
[package]
name = "dhis2-sink"
edition.workspace = true
version.workspace = true
license.workspace = true
description = "DHIS2 aggregate + tracker sink plugin (mapping, metadata, push)"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
openldr-plugin-sdk = { path = "../openldr-plugin-sdk" }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
sha2 = "0.10"

[target.'cfg(target_arch = "wasm32")'.dependencies]
extism-pdk = "1"
base64 = "0.22"
```

- [ ] **Step 2: Register the crate in the workspace**

In `wasm/Cargo.toml`, add `dhis2-sink` to `members` (currently `["openldr-plugin-sdk", "whonet-sqlite", "hl7v2", "tabular", "test-sink"]`):

```toml
members = ["openldr-plugin-sdk", "whonet-sqlite", "hl7v2", "tabular", "test-sink", "dhis2-sink"]
```

- [ ] **Step 3: Create `lib.rs` with module declarations only (plugin module added in Task 6)**

`wasm/dhis2-sink/src/lib.rs`:

```rust
//! DHIS2 aggregate + tracker sink plugin. Pure mapping/parsing modules (host-testable)
//! plus a wasm-only HTTP client + entrypoint module. Ports @openldr/dhis2 +
//! @openldr/adapter-dhis2 into the SP-1 sink ABI.
pub mod types;
pub mod value;
pub mod uid;
pub mod mapping;
pub mod tracker;
pub mod summary;

#[cfg(target_arch = "wasm32")]
mod client;
```

Note: `mapping`/`tracker`/`summary`/`types` are referenced here but created in later tasks — this file will not compile until Task 4 adds `summary.rs` and `types.rs`. That is expected; Task 1's verification builds only `value` + `uid` via a temporary lib. To keep Task 1 independently testable, **for Task 1 only**, use this reduced `lib.rs` and expand it in later tasks:

```rust
//! DHIS2 sink plugin (WIP — modules added incrementally).
pub mod value;
pub mod uid;
```

(Each later task adds its `pub mod` line. Task 6 adds the `#[cfg(target_arch="wasm32")] mod client;` + `mod plugin`.)

- [ ] **Step 4: Write `value.rs` with failing tests**

`wasm/dhis2-sink/src/value.rs`:

```rust
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
```

- [ ] **Step 5: Write `uid.rs` with failing tests** (port of `uid.test.ts`)

`wasm/dhis2-sink/src/uid.rs`:

```rust
//! Deterministic DHIS2 UID — byte-for-byte port of @openldr/dhis2 `dhis2Uid`.
use sha2::{Digest, Sha256};

const ALPHA: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const ALNUM: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/// 11-char UID with a leading letter, derived from a stable seed
/// (sha256 → ALPHA[h0 % 52] then ALNUM[hi % 62] for i in 1..11).
pub fn dhis2_uid(seed: &str) -> String {
    let h = Sha256::digest(seed.as_bytes());
    let mut out = String::with_capacity(11);
    out.push(ALPHA[(h[0] as usize) % ALPHA.len()] as char);
    for i in 1..11 {
        out.push(ALNUM[(h[i] as usize) % ALNUM.len()] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn is_uid(s: &str) -> bool {
        let b = s.as_bytes();
        b.len() == 11 && b[0].is_ascii_alphabetic() && b.iter().all(|c| c.is_ascii_alphanumeric())
    }

    #[test]
    fn shape_is_11_chars_leading_letter_alnum() {
        assert!(is_uid(&dhis2_uid("amr-to-dhis2-demo:obs-1")));
    }

    #[test]
    fn deterministic() {
        assert_eq!(dhis2_uid("x:y"), dhis2_uid("x:y"));
    }

    #[test]
    fn differs_by_seed() {
        assert_ne!(dhis2_uid("a"), dhis2_uid("b"));
    }
}
```

- [ ] **Step 6: Run the Rust tests (fail → pass within this step)**

Run: `cargo test -p dhis2-sink --manifest-path wasm/Cargo.toml`
Expected: compiles and PASSES (5 tests across value + uid). If `sha2`/`serde_json` need fetching and the registry mirror is reachable, cargo downloads them. If a crate genuinely cannot be fetched offline, report BLOCKED with the exact error.

- [ ] **Step 7: Commit**

```bash
git add wasm/dhis2-sink/Cargo.toml wasm/dhis2-sink/src/lib.rs wasm/dhis2-sink/src/value.rs wasm/dhis2-sink/src/uid.rs wasm/Cargo.toml wasm/Cargo.lock
git commit -m "$(cat <<'EOF'
feat(dhis2-sink): crate skeleton + value/uid helpers (ported, host-tested)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `types.rs` — serde structs

**Files:**
- Create: `wasm/dhis2-sink/src/types.rs`
- Modify: `wasm/dhis2-sink/src/lib.rs` (add `pub mod types;`)

- [ ] **Step 1: Create `types.rs`**

`wasm/dhis2-sink/src/types.rs`:

```rust
//! Serde mirrors of the @openldr/dhis2 mapping/payload shapes + the sink entrypoint I/O.
use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// One report/source row: a JSON object of arbitrary scalar values.
pub type Row = Map<String, Value>;

// ── Aggregate mapping (input subset the plugin needs) ────────────────────────
#[derive(Debug, Clone, Deserialize)]
pub struct ColumnMapping {
    pub column: String,
    #[serde(rename = "dataElement")]
    pub data_element: String,
    #[serde(rename = "categoryOptionCombo", default)]
    pub category_option_combo: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AggregateMapping {
    #[serde(rename = "orgUnitColumn")]
    pub org_unit_column: String,
    #[serde(rename = "periodColumn", default)]
    pub period_column: Option<String>,
    pub columns: Vec<ColumnMapping>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DataValue {
    #[serde(rename = "dataElement")]
    pub data_element: String,
    #[serde(rename = "categoryOptionCombo", skip_serializing_if = "Option::is_none")]
    pub category_option_combo: Option<String>,
    #[serde(rename = "orgUnit")]
    pub org_unit: String,
    pub period: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SkipRecord {
    pub row: usize,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DataValueSetPayload {
    #[serde(rename = "dataValues")]
    pub data_values: Vec<DataValue>,
}

// ── Tracker mapping ──────────────────────────────────────────────────────────
#[derive(Debug, Clone, Deserialize)]
pub struct TrackerColumnMapping {
    pub column: String,
    #[serde(rename = "dataElement")]
    pub data_element: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TrackerMapping {
    pub id: String,
    pub program: String,
    #[serde(rename = "programStage")]
    pub program_stage: String,
    #[serde(rename = "orgUnitColumn")]
    pub org_unit_column: String,
    #[serde(rename = "eventDateColumn")]
    pub event_date_column: String,
    #[serde(rename = "idColumn")]
    pub id_column: String,
    #[serde(rename = "dataValues")]
    pub data_values: Vec<TrackerColumnMapping>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct EventDataValue {
    #[serde(rename = "dataElement")]
    pub data_element: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct TrackerEvent {
    pub event: String,
    pub program: String,
    #[serde(rename = "programStage")]
    pub program_stage: String,
    #[serde(rename = "orgUnit")]
    pub org_unit: String,
    #[serde(rename = "occurredAt")]
    pub occurred_at: String,
    #[serde(rename = "dataValues")]
    pub data_values: Vec<EventDataValue>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EventSetPayload {
    pub events: Vec<TrackerEvent>,
}

// ── Push result (mirrors @openldr/ports PushResult) ──────────────────────────
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Conflict {
    pub object: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PushResult {
    pub status: String, // "success" | "warning" | "error"
    pub imported: u64,
    pub updated: u64,
    pub ignored: u64,
    pub deleted: u64,
    pub conflicts: Vec<Conflict>,
    pub raw: Value,
}

// ── Entrypoint I/O ───────────────────────────────────────────────────────────
#[derive(Debug, Deserialize)]
pub struct AggregatePushInput {
    #[serde(default)]
    pub rows: Vec<Row>,
    pub mapping: AggregateMapping,
    #[serde(rename = "orgUnitMap", default)]
    pub org_unit_map: HashMap<String, String>,
    #[serde(default)]
    pub period: String,
    #[serde(rename = "dryRun", default)]
    pub dry_run: bool,
}

#[derive(Debug, Serialize)]
pub struct AggregatePushOutput {
    pub payload: DataValueSetPayload,
    pub skipped: Vec<SkipRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<PushResult>,
}

#[derive(Debug, Deserialize)]
pub struct TrackerPushInput {
    #[serde(default)]
    pub rows: Vec<Row>,
    pub mapping: TrackerMapping,
    #[serde(rename = "orgUnitMap", default)]
    pub org_unit_map: HashMap<String, String>,
    #[serde(rename = "dryRun", default)]
    pub dry_run: bool,
}

#[derive(Debug, Serialize)]
pub struct TrackerPushOutput {
    pub payload: EventSetPayload,
    pub skipped: Vec<SkipRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<PushResult>,
}
```

- [ ] **Step 2: Add `pub mod types;` to lib.rs** (place it first, before `value`):

```rust
pub mod types;
pub mod value;
pub mod uid;
```

- [ ] **Step 3: Verify it compiles**

Run: `cargo test -p dhis2-sink --manifest-path wasm/Cargo.toml`
Expected: compiles; the 5 value/uid tests still pass. (No new tests — types are exercised by later tasks. `cargo` may warn about unused structs; that's fine — they're used in Tasks 3-6.)

- [ ] **Step 4: Commit**

```bash
git add wasm/dhis2-sink/src/types.rs wasm/dhis2-sink/src/lib.rs
git commit -m "$(cat <<'EOF'
feat(dhis2-sink): serde types for mappings, payloads, results, entrypoint I/O

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `mapping.rs` + `tracker.rs` (pure mapping, ported tests)

**Files:**
- Create: `wasm/dhis2-sink/src/mapping.rs`, `wasm/dhis2-sink/src/tracker.rs`
- Modify: `wasm/dhis2-sink/src/lib.rs` (add the two `pub mod` lines)

- [ ] **Step 1: Create `mapping.rs`** (port of `buildDataValueSet`, with tests ported from `mapping.test.ts`)

`wasm/dhis2-sink/src/mapping.rs`:

```rust
//! Aggregate mapping — port of @openldr/dhis2 `buildDataValueSet`.
use std::collections::HashMap;
use crate::types::{AggregateMapping, DataValue, Row, SkipRecord};
use crate::value::{is_empty, value_to_string};

pub fn build_data_value_set(
    rows: &[Row],
    mapping: &AggregateMapping,
    org_unit_map: &HashMap<String, String>,
    period: &str,
) -> (Vec<DataValue>, Vec<SkipRecord>) {
    let mut data_values = Vec::new();
    let mut skipped = Vec::new();
    for (i, row) in rows.iter().enumerate() {
        let facility = row.get(&mapping.org_unit_column);
        // Only a string facility maps (mirrors `typeof facility === 'string'`).
        let org_unit = facility
            .and_then(|v| v.as_str())
            .and_then(|f| org_unit_map.get(f))
            .cloned();
        let org_unit = match org_unit {
            Some(ou) => ou,
            None => {
                let f = facility.map(value_to_string).unwrap_or_else(|| "undefined".to_string());
                skipped.push(SkipRecord { row: i, reason: format!("no orgUnit mapping for facility '{f}'") });
                continue;
            }
        };
        let row_period = match &mapping.period_column {
            Some(pc) if !is_empty(row.get(pc)) => value_to_string(row.get(pc).unwrap()),
            _ => period.to_string(),
        };
        for col in &mapping.columns {
            let v = row.get(&col.column);
            if is_empty(v) {
                continue;
            }
            data_values.push(DataValue {
                data_element: col.data_element.clone(),
                category_option_combo: col.category_option_combo.clone(),
                org_unit: org_unit.clone(),
                period: row_period.clone(),
                value: value_to_string(v.unwrap()),
            });
        }
    }
    (data_values, skipped)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Map, Value};

    fn row(v: Value) -> Row {
        match v { Value::Object(m) => m, _ => Map::new() }
    }
    fn mapping() -> AggregateMapping {
        serde_json::from_value(json!({
            "orgUnitColumn": "facility",
            "columns": [
                { "column": "tested", "dataElement": "DE_TESTED" },
                { "column": "r", "dataElement": "DE_RESISTANT", "categoryOptionCombo": "COC_DEFAULT" }
            ]
        })).unwrap()
    }
    fn org_map() -> HashMap<String, String> {
        HashMap::from([("fac-1".to_string(), "OU_AAA".to_string())])
    }

    #[test]
    fn maps_rows_resolving_orgunit_and_period() {
        let rows = vec![row(json!({ "facility": "fac-1", "tested": 4, "r": 2 }))];
        let (dv, skipped) = build_data_value_set(&rows, &mapping(), &org_map(), "2026Q1");
        assert!(skipped.is_empty());
        assert_eq!(dv.len(), 2);
        assert_eq!(dv[0], DataValue { data_element: "DE_TESTED".into(), category_option_combo: None, org_unit: "OU_AAA".into(), period: "2026Q1".into(), value: "4".into() });
        assert_eq!(dv[1], DataValue { data_element: "DE_RESISTANT".into(), category_option_combo: Some("COC_DEFAULT".into()), org_unit: "OU_AAA".into(), period: "2026Q1".into(), value: "2".into() });
    }

    #[test]
    fn skips_unmapped_facility() {
        let rows = vec![row(json!({ "facility": "unmapped", "tested": 1, "r": 0 }))];
        let (dv, skipped) = build_data_value_set(&rows, &mapping(), &org_map(), "2026Q1");
        assert!(dv.is_empty());
        assert!(skipped[0].reason.to_lowercase().contains("orgunit"));
    }

    #[test]
    fn skips_empty_values_keeps_others() {
        let rows = vec![row(json!({ "facility": "fac-1", "tested": 4, "r": null }))];
        let (dv, _) = build_data_value_set(&rows, &mapping(), &org_map(), "2026Q1");
        assert_eq!(dv.iter().map(|d| d.data_element.as_str()).collect::<Vec<_>>(), vec!["DE_TESTED"]);
    }

    #[test]
    fn uses_period_column_when_present() {
        let mut m = mapping();
        m.period_column = Some("month".to_string());
        let rows = vec![row(json!({ "facility": "fac-1", "tested": 1, "r": 0, "month": "202601" }))];
        let (dv, _) = build_data_value_set(&rows, &m, &org_map(), "IGNORED");
        assert_eq!(dv[0].period, "202601");
    }
}
```

- [ ] **Step 2: Create `tracker.rs`** (port of `buildEvents`, tests from `tracker.test.ts` — note `validateTrackerMapping` is NOT ported, it stays host-side)

`wasm/dhis2-sink/src/tracker.rs`:

```rust
//! Tracker mapping — port of @openldr/dhis2 `buildEvents`.
use std::collections::HashMap;
use crate::types::{EventDataValue, Row, SkipRecord, TrackerEvent, TrackerMapping};
use crate::uid::dhis2_uid;
use crate::value::{is_empty, value_to_string};

pub fn build_events(
    rows: &[Row],
    mapping: &TrackerMapping,
    org_unit_map: &HashMap<String, String>,
) -> (Vec<TrackerEvent>, Vec<SkipRecord>) {
    let mut events = Vec::new();
    let mut skipped = Vec::new();
    for (i, row) in rows.iter().enumerate() {
        let facility = row.get(&mapping.org_unit_column);
        let org_unit = facility.and_then(|v| v.as_str()).and_then(|f| org_unit_map.get(f)).cloned();
        let org_unit = match org_unit {
            Some(ou) => ou,
            None => {
                let f = facility.map(value_to_string).unwrap_or_else(|| "undefined".to_string());
                skipped.push(SkipRecord { row: i, reason: format!("no orgUnit mapping for facility '{f}'") });
                continue;
            }
        };
        let occurred_at = row.get(&mapping.event_date_column);
        if is_empty(occurred_at) {
            skipped.push(SkipRecord { row: i, reason: format!("missing eventDate column '{}'", mapping.event_date_column) });
            continue;
        }
        let record_key = row.get(&mapping.id_column);
        if is_empty(record_key) {
            skipped.push(SkipRecord { row: i, reason: format!("missing idColumn '{}'", mapping.id_column) });
            continue;
        }
        let data_values = mapping.data_values.iter()
            .filter(|c| !is_empty(row.get(&c.column)))
            .map(|c| EventDataValue { data_element: c.data_element.clone(), value: value_to_string(row.get(&c.column).unwrap()) })
            .collect();
        events.push(TrackerEvent {
            event: dhis2_uid(&format!("{}:{}", mapping.id, value_to_string(record_key.unwrap()))),
            program: mapping.program.clone(),
            program_stage: mapping.program_stage.clone(),
            org_unit,
            occurred_at: value_to_string(occurred_at.unwrap()),
            data_values,
        });
    }
    (events, skipped)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Map, Value};

    fn row(v: Value) -> Row { match v { Value::Object(m) => m, _ => Map::new() } }
    fn mapping() -> TrackerMapping {
        serde_json::from_value(json!({
            "id": "amr-events", "program": "PR1", "programStage": "PS1",
            "orgUnitColumn": "facility", "eventDateColumn": "eventDate", "idColumn": "id",
            "dataValues": [{ "column": "antibiotic", "dataElement": "DE_AB" }, { "column": "result", "dataElement": "DE_RES" }]
        })).unwrap()
    }
    fn org_map() -> HashMap<String, String> { HashMap::from([("fac-1".to_string(), "OU_AAA".to_string())]) }

    #[test]
    fn builds_one_event_per_row_with_uid() {
        let rows = vec![row(json!({ "id": "obs-1", "facility": "fac-1", "eventDate": "2026-01-10", "antibiotic": "AMP", "result": "R" }))];
        let (events, skipped) = build_events(&rows, &mapping(), &org_map());
        assert!(skipped.is_empty());
        assert_eq!(events.len(), 1);
        let e = &events[0];
        assert_eq!((e.program.as_str(), e.program_stage.as_str(), e.org_unit.as_str(), e.occurred_at.as_str()), ("PR1", "PS1", "OU_AAA", "2026-01-10"));
        assert!(e.event.as_bytes()[0].is_ascii_alphabetic() && e.event.len() == 11);
        assert_eq!(e.data_values, vec![
            EventDataValue { data_element: "DE_AB".into(), value: "AMP".into() },
            EventDataValue { data_element: "DE_RES".into(), value: "R".into() },
        ]);
    }

    #[test]
    fn skips_unmapped_facility() {
        let rows = vec![row(json!({ "id": "o", "facility": "nope", "eventDate": "2026-01-10" }))];
        let (events, skipped) = build_events(&rows, &mapping(), &org_map());
        assert!(events.is_empty());
        assert!(skipped[0].reason.to_lowercase().contains("orgunit"));
    }

    #[test]
    fn skips_missing_eventdate_or_id() {
        let (_, s1) = build_events(&[row(json!({ "id": "o", "facility": "fac-1" }))], &mapping(), &org_map());
        assert!(s1[0].reason.to_lowercase().contains("eventdate"));
        let (_, s2) = build_events(&[row(json!({ "facility": "fac-1", "eventDate": "2026-01-10" }))], &mapping(), &org_map());
        assert!(s2[0].reason.to_lowercase().contains("idcolumn"));
    }

    #[test]
    fn omits_empty_datavalues_keeps_event() {
        let rows = vec![row(json!({ "id": "obs-2", "facility": "fac-1", "eventDate": "2026-01-10", "antibiotic": "CIP", "result": null }))];
        let (events, _) = build_events(&rows, &mapping(), &org_map());
        assert_eq!(events[0].data_values, vec![EventDataValue { data_element: "DE_AB".into(), value: "CIP".into() }]);
    }
}
```

- [ ] **Step 3: Add the modules to lib.rs**

```rust
pub mod types;
pub mod value;
pub mod uid;
pub mod mapping;
pub mod tracker;
```

- [ ] **Step 4: Run the Rust tests**

Run: `cargo test -p dhis2-sink --manifest-path wasm/Cargo.toml`
Expected: PASS — value(2) + uid(3) + mapping(4) + tracker(4) = 13 tests.

- [ ] **Step 5: Commit**

```bash
git add wasm/dhis2-sink/src/mapping.rs wasm/dhis2-sink/src/tracker.rs wasm/dhis2-sink/src/lib.rs
git commit -m "$(cat <<'EOF'
feat(dhis2-sink): port buildDataValueSet + buildEvents with unit tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `summary.rs` — import-summary + tracker-report parsing

**Files:**
- Create: `wasm/dhis2-sink/src/summary.rs`
- Modify: `wasm/dhis2-sink/src/lib.rs` (add `pub mod summary;`)

Ports the response-parsing half of `@openldr/adapter-dhis2` `pushAggregate`/`pushEvents`. Returns `Err` only when the body carries no usable summary (the host then surfaces a hard error); otherwise `Ok(PushResult)` even for status `error`/`warning` (mirrors the TS, which throws only when `!hasSummary`).

- [ ] **Step 1: Create `summary.rs` with ported tests** (cases from `adapter-dhis2/src/index.test.ts`)

`wasm/dhis2-sink/src/summary.rs`:

```rust
//! Port of the @openldr/adapter-dhis2 response parsing: DHIS2 import summary
//! (dataValueSets) and tracker import report. Pure — host-testable.
use serde_json::Value;
use crate::types::{Conflict, PushResult};

fn u64_at(v: Option<&Value>, key: &str) -> u64 {
    v.and_then(|o| o.get(key)).and_then(|n| n.as_u64()).unwrap_or(0)
}

fn map_status(raw: &str, http_ok: bool) -> &'static str {
    match raw.to_uppercase().as_str() {
        "ERROR" => "error",
        "WARNING" => "warning",
        "SUCCESS" | "OK" => "success",
        _ => if http_ok { "success" } else { "error" },
    }
}

fn parse_conflicts(v: Option<&Value>) -> Vec<Conflict> {
    v.and_then(|c| c.as_array())
        .map(|arr| arr.iter().map(|c| Conflict {
            object: c.get("object").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            value: c.get("value").and_then(|x| x.as_str()).unwrap_or("").to_string(),
        }).collect())
        .unwrap_or_default()
}

fn err(endpoint: &str, status: u16, body: &str) -> String {
    let snip: String = body.chars().take(300).collect();
    if snip.is_empty() { format!("DHIS2 {endpoint} -> {status}") }
    else { format!("DHIS2 {endpoint} -> {status}: {snip}") }
}

/// Parse a /api/dataValueSets response. `Err` ⇒ no usable summary (host throws).
pub fn parse_import_summary(status_code: u16, body: &str) -> Result<PushResult, String> {
    let parsed: Option<Value> = if body.is_empty() { None } else { serde_json::from_str(body).ok() };
    let summary = match parsed.as_ref() {
        Some(v @ Value::Object(_)) => v,
        _ => return Err(err("dataValueSets", status_code, body)),
    };
    let response = summary.get("response");
    let has_summary = summary.get("status").is_some() || response.is_some() || summary.get("importCount").is_some();
    if !has_summary {
        return Err(err("dataValueSets", status_code, body));
    }
    // importCount ?? response.importCount ?? {}
    let ic = summary.get("importCount").or_else(|| response.and_then(|r| r.get("importCount")));
    let raw_status = response.and_then(|r| r.get("status")).and_then(|v| v.as_str())
        .or_else(|| summary.get("status").and_then(|v| v.as_str()))
        .unwrap_or("");
    let http_ok = (200..300).contains(&status_code);
    let conflicts = parse_conflicts(summary.get("conflicts").or_else(|| response.and_then(|r| r.get("conflicts"))));
    Ok(PushResult {
        status: map_status(raw_status, http_ok).to_string(),
        imported: u64_at(ic, "imported"),
        updated: u64_at(ic, "updated"),
        ignored: u64_at(ic, "ignored"),
        deleted: u64_at(ic, "deleted"),
        conflicts,
        raw: summary.clone(),
    })
}

/// Parse a /api/tracker response. `Err` ⇒ no usable report (host throws).
pub fn parse_tracker_report(status_code: u16, body: &str) -> Result<PushResult, String> {
    let parsed: Option<Value> = if body.is_empty() { None } else { serde_json::from_str(body).ok() };
    let report = match parsed.as_ref() {
        Some(v @ Value::Object(_)) => v,
        _ => return Err(err("tracker", status_code, body)),
    };
    let has_report = report.get("status").is_some() || report.get("stats").is_some() || report.get("validationReport").is_some();
    if !has_report {
        return Err(err("tracker", status_code, body));
    }
    let stats = report.get("stats");
    let raw_status = report.get("status").and_then(|v| v.as_str()).unwrap_or("");
    let http_ok = (200..300).contains(&status_code);
    let conflicts = report.get("validationReport").and_then(|v| v.get("errorReports")).and_then(|v| v.as_array())
        .map(|arr| arr.iter().map(|e| Conflict {
            object: e.get("uid").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            value: e.get("message").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        }).collect())
        .unwrap_or_default();
    Ok(PushResult {
        status: map_status(raw_status, http_ok).to_string(),
        imported: u64_at(stats, "created"),
        updated: u64_at(stats, "updated"),
        ignored: u64_at(stats, "ignored"),
        deleted: u64_at(stats, "deleted"),
        conflicts,
        raw: report.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn aggregate_success_flat_import_count() {
        let body = json!({ "status": "SUCCESS", "importCount": { "imported": 3, "updated": 1, "ignored": 0, "deleted": 0 }, "conflicts": [] }).to_string();
        let r = parse_import_summary(200, &body).unwrap();
        assert_eq!((r.status.as_str(), r.imported, r.updated), ("success", 3, 1));
    }

    #[test]
    fn aggregate_nested_warning_with_conflicts() {
        let body = json!({ "status": "OK", "response": { "status": "WARNING", "importCount": { "imported": 1, "updated": 0, "ignored": 2, "deleted": 0 }, "conflicts": [{ "object": "dataElement", "value": "bad" }] } }).to_string();
        let r = parse_import_summary(200, &body).unwrap();
        assert_eq!(r.status, "warning");
        assert_eq!((r.imported, r.ignored), (1, 2));
        assert_eq!(r.conflicts, vec![Conflict { object: "dataElement".into(), value: "bad".into() }]);
    }

    #[test]
    fn aggregate_nested_error() {
        let body = json!({ "status": "WARNING", "response": { "status": "ERROR", "importCount": { "imported": 0, "updated": 0, "ignored": 1, "deleted": 0 }, "conflicts": [] } }).to_string();
        assert_eq!(parse_import_summary(200, &body).unwrap().status, "error");
    }

    #[test]
    fn aggregate_non_json_body_is_error() {
        let e = parse_import_summary(401, "Unauthorized").unwrap_err();
        assert!(e.contains("401"));
    }

    #[test]
    fn aggregate_409_with_summary_is_warning() {
        let body = json!({ "status": "WARNING", "response": { "responseType": "ImportSummary", "status": "WARNING", "importCount": { "imported": 1, "updated": 1, "ignored": 6, "deleted": 1 }, "conflicts": [{ "object": "a57FmdPj3Zl", "value": "Data value is not a valid option" }] } }).to_string();
        let r = parse_import_summary(409, &body).unwrap();
        assert_eq!((r.status.as_str(), r.imported, r.updated, r.ignored), ("warning", 1, 1, 6));
        assert_eq!(r.conflicts, vec![Conflict { object: "a57FmdPj3Zl".into(), value: "Data value is not a valid option".into() }]);
    }

    #[test]
    fn tracker_success() {
        let body = json!({ "status": "OK", "stats": { "created": 2, "updated": 1, "deleted": 0, "ignored": 0 }, "validationReport": { "errorReports": [] } }).to_string();
        let r = parse_tracker_report(200, &body).unwrap();
        assert_eq!((r.status.as_str(), r.imported, r.updated), ("success", 2, 1));
    }

    #[test]
    fn tracker_409_validation_error_with_conflicts() {
        let body = json!({ "status": "ERROR", "stats": { "created": 0, "updated": 0, "deleted": 0, "ignored": 1 }, "validationReport": { "errorReports": [{ "message": "bad event", "uid": "E1" }] } }).to_string();
        let r = parse_tracker_report(409, &body).unwrap();
        assert_eq!((r.status.as_str(), r.ignored), ("error", 1));
        assert_eq!(r.conflicts, vec![Conflict { object: "E1".into(), value: "bad event".into() }]);
    }
}
```

- [ ] **Step 2: Add `pub mod summary;` to lib.rs**

```rust
pub mod types;
pub mod value;
pub mod uid;
pub mod mapping;
pub mod tracker;
pub mod summary;
```

- [ ] **Step 3: Run the Rust tests**

Run: `cargo test -p dhis2-sink --manifest-path wasm/Cargo.toml`
Expected: PASS — now 13 + 7 = 20 tests.

- [ ] **Step 4: Commit**

```bash
git add wasm/dhis2-sink/src/summary.rs wasm/dhis2-sink/src/lib.rs
git commit -m "$(cat <<'EOF'
feat(dhis2-sink): port import-summary + tracker-report parsing with unit tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `client.rs` + `plugin` entrypoints (wasm-only)

**Files:**
- Create: `wasm/dhis2-sink/src/client.rs`
- Modify: `wasm/dhis2-sink/src/lib.rs` (add the wasm-only `client` + `plugin` modules)

This layer is wasm-only (`#[cfg(target_arch="wasm32")]`), so it is validated by the build (Task 6) + the host integration tests (Task 7), not by `cargo test` on the host.

- [ ] **Step 1: Create `client.rs`**

`wasm/dhis2-sink/src/client.rs`:

```rust
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
```

- [ ] **Step 2: Add the wasm-only `client` + `plugin` modules to lib.rs**

Append to `wasm/dhis2-sink/src/lib.rs` (after the pure `pub mod` lines):

```rust
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
```

- [ ] **Step 3: Verify the host build still compiles + tests pass** (the wasm-only modules are cfg-gated out on host)

Run: `cargo test -p dhis2-sink --manifest-path wasm/Cargo.toml`
Expected: PASS — 20 tests (the `client`/`plugin` modules are excluded on the host target, so no new tests, but the crate must still compile cleanly).

- [ ] **Step 4: Commit**

```bash
git add wasm/dhis2-sink/src/client.rs wasm/dhis2-sink/src/lib.rs
git commit -m "$(cat <<'EOF'
feat(dhis2-sink): wasm HTTP client + the four sink entrypoints

health_check / pull_metadata / push_aggregate / push_tracker. Dry-run returns the
mapped payload preview with no egress; a real push POSTs to DHIS2 and parses the
import summary. Credentials come from the Extism config map; egress goes through
extism_pdk::http (host pins allowed_hosts).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Build script + manifest + workspace wiring (build the wasm)

**Files:**
- Create: `scripts/build-dhis2-sink.mjs`
- Modify: `package.json` (root) — add `build:dhis2-sink`

- [ ] **Step 1: Create the build script** (mirrors `scripts/build-test-sink.mjs`)

`scripts/build-dhis2-sink.mjs`:

```js
// Builds the dhis2-sink plugin to wasm and stages plugin.wasm + manifest.json under
// reference-plugins/dhis2-sink/. Pure Rust (no C deps) so it needs only the
// wasm32-wasip1 target — no clang/WASI sysroot.
import { execSync } from 'node:child_process';
import { mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const root = process.cwd();
const wasmDir = join(root, 'wasm');

execSync('cargo build -p dhis2-sink --release --target wasm32-wasip1', { cwd: wasmDir, stdio: 'inherit', env: process.env });

const built = join(wasmDir, 'target', 'wasm32-wasip1', 'release', 'dhis2_sink.wasm');
const dir = join(root, 'reference-plugins', 'dhis2-sink');
mkdirSync(dir, { recursive: true });
const staged = join(dir, 'plugin.wasm');
copyFileSync(built, staged);

const sha = createHash('sha256').update(readFileSync(staged)).digest('hex');
const workspaceToml = readFileSync(join(wasmDir, 'Cargo.toml'), 'utf8');
const ver = (workspaceToml.match(/version\s*=\s*"([^"]+)"/) || [])[1] || '0.1.0';

const manifest = {
  id: 'dhis2-sink',
  version: ver,
  kind: 'sink',
  entrypoints: ['health_check', 'pull_metadata', 'push_aggregate', 'push_tracker'],
  wasmSha256: sha,
  description: 'DHIS2 aggregate + tracker sink (mapping, metadata, push)',
  license: 'Apache-2.0',
  // wasm32-wasip1's std imports wasi_snapshot_preview1 even for HTTP-only plugins.
  wasi: true,
  limits: { memoryMb: 256, timeoutMs: 30000 },
  // Declares net-egress intent. The empty allowedHosts list means "the host pins the
  // concrete DHIS2 host at runtime" (the connector's baseUrl) — see the SP-1 egress model.
  capabilities: [{ kind: 'net-egress', allowedHosts: [] }],
};
writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
process.stdout.write(`staged ${staged} (sha256 ${sha}) + manifest.json\n`);
```

- [ ] **Step 2: Add the root build script**

In root `package.json`, add to `scripts` immediately after `"build:test-sink"`:

```json
    "build:dhis2-sink": "node scripts/build-dhis2-sink.mjs",
```

- [ ] **Step 3: Build the wasm**

Run: `pnpm build:dhis2-sink`
Expected: `cargo build` for `wasm32-wasip1` succeeds; prints `staged .../reference-plugins/dhis2-sink/plugin.wasm (sha256 …) + manifest.json`. This is the first compile of the wasm-only `client`/`plugin` modules — if the `extism_pdk::http` calls or `base64` usage don't match the 1.4.1 API, fix them now (the API is documented in the Context section; adjust `http::request` body/turbofish forms as the compiler directs). If `base64`/`extism-pdk` cannot be fetched offline, report BLOCKED with the exact error.

- [ ] **Step 4: Confirm gitignored artifacts are not staged**

Run: `git status --short` — `reference-plugins/dhis2-sink/{plugin.wasm,manifest.json}` should NOT appear (covered by `reference-plugins/.gitignore`). Only `scripts/build-dhis2-sink.mjs` + `package.json` are new/modified.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-dhis2-sink.mjs package.json
git commit -m "$(cat <<'EOF'
build(dhis2-sink): build:dhis2-sink script + sink manifest (4 entrypoints, net-egress)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Host integration tests (real Extism — dry-run + mock DHIS2)

**Files:**
- Create: `packages/plugins/src/dhis2-sink.integration.test.ts`

Skip-guarded on the built wasm (like `wasm-sink.integration.test.ts`). Two proofs: (a) `push_aggregate` dry-run maps rows in real wasm with no network; (b) a real push POSTs to a local mock DHIS2 with `allowedHosts` pinned, exercising the full egress + import-summary path through Extism.

- [ ] **Step 1: Create the integration test**

`packages/plugins/src/dhis2-sink.integration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { createExtismRunner } from './extism-runner';
import { createWasmSink } from './wasm-sink';
import { parseManifest } from './manifest';
import { sha256Hex } from './hash';

// reference-plugins/dhis2-sink/plugin.wasm is a gitignored build artifact
// (run `pnpm build:dhis2-sink` first). Absent ⇒ the whole suite skips.
const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(here, '..', '..', '..', 'reference-plugins', 'dhis2-sink', 'plugin.wasm');
const present = existsSync(wasmPath);
const logger = { info() {}, error() {}, warn() {}, debug() {} } as never;

function sink() {
  const wasm = new Uint8Array(readFileSync(wasmPath));
  const manifest = parseManifest({
    id: 'dhis2-sink', version: '0.1.0', kind: 'sink',
    entrypoints: ['health_check', 'pull_metadata', 'push_aggregate', 'push_tracker'],
    wasmSha256: sha256Hex(wasm), wasi: true,
  });
  // Pass a net-egress grant so the push path is allowed once a host is pinned.
  return createWasmSink(manifest, wasm, createExtismRunner(), logger, [{ kind: 'net-egress', allowedHosts: [] }]);
}

const aggInput = (dryRun: boolean) => ({
  rows: [{ facility: 'fac-1', tested: 4, r: 2 }],
  mapping: {
    orgUnitColumn: 'facility',
    columns: [
      { column: 'tested', dataElement: 'DE_TESTED' },
      { column: 'r', dataElement: 'DE_RESISTANT', categoryOptionCombo: 'COC_DEFAULT' },
    ],
  },
  orgUnitMap: { 'fac-1': 'OU_AAA' },
  period: '2026Q1',
  dryRun,
});

describe.skipIf(!present)('dhis2-sink through the real Extism runner', () => {
  it('push_aggregate dry-run maps rows to dataValues with no egress', async () => {
    const out = (await sink().invoke('push_aggregate', aggInput(true))) as {
      payload: { dataValues: unknown[] }; skipped: unknown[]; result?: unknown;
    };
    expect(out.payload.dataValues).toEqual([
      { dataElement: 'DE_TESTED', orgUnit: 'OU_AAA', period: '2026Q1', value: '4' },
      { dataElement: 'DE_RESISTANT', categoryOptionCombo: 'COC_DEFAULT', orgUnit: 'OU_AAA', period: '2026Q1', value: '2' },
    ]);
    expect(out.skipped).toEqual([]);
    expect(out.result).toBeUndefined();
  });

  it('push_aggregate real push POSTs to a mock DHIS2 and parses the import summary', async () => {
    let postedTo = '';
    const server: Server = createServer((req, res) => {
      postedTo = req.url ?? '';
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ status: 'SUCCESS', importCount: { imported: 2, updated: 0, ignored: 0, deleted: 0 }, conflicts: [] }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    try {
      const port = (server.address() as { port: number }).port;
      // Extism allowed_hosts matches the URL host. Pin the loopback host; if the
      // matcher needs host:port, adjust to `127.0.0.1:${port}` (report which worked).
      const out = (await sink().invoke('push_aggregate', aggInput(false), {
        config: { baseUrl: `http://127.0.0.1:${port}`, username: 'admin', password: 'district' },
        allowedHosts: ['127.0.0.1'],
      })) as { result?: { status: string; imported: number } };
      expect(postedTo).toContain('/api/dataValueSets');
      expect(out.result).toMatchObject({ status: 'success', imported: 2 });
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
```

- [ ] **Step 2: Build the wasm (if not already staged) and run the test**

Run:
```bash
pnpm build:dhis2-sink
pnpm -C packages/plugins test dhis2-sink.integration
```
Expected: the suite RUNS (not skipped). The dry-run test must PASS. The mock-push test should PASS — it proves real egress through Extism's `allowed_hosts`. If the mock-push test fails specifically on egress being blocked, try `allowedHosts: ['127.0.0.1:${port}']` or `['*']` to learn the matcher format, record the finding in the commit message, and keep whichever form works. If real loopback egress through the JS Extism SDK proves environment-blocked, mark that one test `it.skip` with a comment and report DONE_WITH_CONCERNS (the dry-run proof + Rust unit tests still stand; live push lands in SP-6) — do NOT block SP-2 on it.

- [ ] **Step 3: Run the full plugins suite + typecheck**

Run: `pnpm -C packages/plugins typecheck && pnpm -C packages/plugins test`
Expected: typecheck exit 0; all green (existing 56 + the new dhis2-sink integration tests).

- [ ] **Step 4: Commit**

```bash
git add packages/plugins/src/dhis2-sink.integration.test.ts
git commit -m "$(cat <<'EOF'
test(dhis2-sink): real-Extism dry-run mapping + mock-DHIS2 push integration

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Full gate

**Files:** none (verification only)

- [ ] **Step 1: Rust tests**

Run: `cargo test -p dhis2-sink --manifest-path wasm/Cargo.toml`
Expected: PASS — 20 unit tests (value 2, uid 3, mapping 4, tracker 4, summary 7).

- [ ] **Step 2: Turbo gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS. If `@openldr/web#test` flakes under turbo concurrency, re-run it in isolation (`pnpm -C apps/web test`) and trust the isolated result. Never pipe turbo through `tail`.

- [ ] **Step 3: depcruise**

Run: `pnpm depcruise`
Expected: clean. SP-2 adds no new cross-package TS edges (the only new TS file is a test in `@openldr/plugins`, which already depends on nothing new).

- [ ] **Step 4: Final commit (only if anything was adjusted to get green)**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(dhis2-sink): SP-2 wasm plugin — gate green

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage (SP-2 scope = `wasm/dhis2-sink`: mapping aggregate+tracker, metadata, push; ported from TS; Rust unit tests + host WasmSink test dry-run + mock DHIS2):**
- Aggregate mapping `buildDataValueSet` → `mapping.rs` (Task 3), unit tests ported from `mapping.test.ts`. ✓
- Tracker mapping `buildEvents` + `dhis2Uid` → `tracker.rs` + `uid.rs` (Tasks 1, 3), ported tests. ✓
- Metadata pull + HTTP egress + import-summary/tracker-report parsing → `client.rs` + `summary.rs` (Tasks 4, 5), parsing unit-tested from `adapter-dhis2/src/index.test.ts`. ✓
- The four entrypoints `health_check`/`pull_metadata`/`push_aggregate`/`push_tracker` with the SP-1 ABI shapes, dry-run preview vs real push → `plugin` module (Task 5). ✓
- Credentials via Extism config map; egress via `extism_pdk::http` with host-pinned `allowed_hosts`; net-egress capability declared in the manifest. ✓
- Host-side `WasmSink` test: dry-run (no network) + against a local mock DHIS2 with `allowedHosts` pinned → Task 7. ✓
- Build script + workspace member + manifest → Task 6, mirroring SP-1's test-sink. ✓

**Correctly NOT in SP-2 (deferred):** deleting `@openldr/adapter-dhis2` / shrinking `@openldr/dhis2` / per-connector target resolution = **SP-4**. `dispatchReportSource` + `validateTrackerMapping` stay host-side (they need report execution / metadata host-side) — not ported. Live Docker-DHIS2 verification = **SP-6**. Connector store/crypto = **SP-3**.

**Placeholder scan:** every Rust/JS/TOML block is complete. The one acknowledged unknown — the exact Extism `allowed_hosts` matcher format for loopback in the mock-push test — has an explicit fallback procedure in Task 7 Step 2 (try host, then host:port, then `*`; skip-with-concern if environment-blocked), and does not block the deliverable (Rust units + dry-run prove the mapping; live push is SP-6's bar).

**Type consistency:** Rust field renames (`#[serde(rename=…)]`) match the TS JSON keys (`dataElement`, `categoryOptionCombo`, `orgUnit`, `orgUnitColumn`, `periodColumn`, `programStage`, `eventDateColumn`, `idColumn`, `occurredAt`, `dataValues`, `orgUnitMap`, `dryRun`). `PushResult`/`DataValue`/`TrackerEvent` serialize to the same shapes the SP-1 `WasmSink` returns and the host expects. `build_data_value_set`/`build_events`/`parse_import_summary`/`parse_tracker_report`/`dhis2_uid` names are referenced consistently across `client.rs`, the `plugin` module, and the tests.

---

## Notes for execution

- Work on an isolated branch `feat/dhis2-sink-sp2` (per the workstream's merge-to-local-main discipline; not pushed).
- After SP-2 is green and merged, update the `dhis2-sink-plugin-workstream` memory: SP-2 done; the wasm plugin exists and is proven; next is SP-3 (connector store + crypto) then SP-4 (host rewiring that finally installs `dhis2-sink` as a connector-backed target and deletes `@openldr/adapter-dhis2`).
- SP-3 (connector store + AES-GCM crypto) is independent of SP-2 and can be done in either order; SP-4 needs both.
