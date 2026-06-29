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

// ── Workflow-node envelope I/O (wf_push) ─────────────────────────────────────
/// One workflow item: a `.json` payload plus optional binary handle. A sink
/// passes items through unchanged; only `.json` feeds the push. Any other fields
/// an item carries are absorbed into `extra` (flatten) so they survive the
/// echo round-trip unchanged.
#[derive(Debug, Deserialize, Serialize)]
pub struct WfPushItem {
    pub json: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub binary: Option<Value>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// The workflow-node `config` block. `mapping` stays an opaque `Value` so the
/// envelope can dispatch on `mapping.kind` before deserializing to the concrete
/// `AggregateMapping`/`TrackerMapping`.
#[derive(Debug, Deserialize)]
pub struct WfPushConfig {
    pub mapping: Value,
    #[serde(rename = "orgUnitMap", default)]
    pub org_unit_map: HashMap<String, String>,
    #[serde(default)]
    pub period: String,
    #[serde(rename = "dryRun", default)]
    pub dry_run: bool,
}

/// The generic workflow-node items envelope consumed by `wf_push`.
#[derive(Debug, Deserialize)]
pub struct WfPushInput {
    #[serde(default)]
    pub items: Vec<WfPushItem>,
    pub config: WfPushConfig,
}
