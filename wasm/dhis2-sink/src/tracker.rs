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
        let facility = row.get(&mapping.org_unit_column).and_then(|v| v.as_str());
        let org_unit = facility.and_then(|f| org_unit_map.get(f)).cloned();
        let org_unit = match org_unit {
            Some(ou) => ou,
            None => {
                // Distinguish a missing org-unit column from a present-but-unmapped facility value.
                let reason = match facility {
                    Some(f) => format!("no orgUnit mapping for facility '{f}'"),
                    None => format!("no value for org-unit column '{}'", mapping.org_unit_column),
                };
                skipped.push(SkipRecord { row: i, reason });
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
        assert!(skipped[0].reason.contains("nope"));
    }

    #[test]
    fn skips_row_missing_orgunit_column_with_a_distinct_message() {
        let rows = vec![row(json!({ "id": "o", "eventDate": "2026-01-10" }))];
        let (events, skipped) = build_events(&rows, &mapping(), &org_map());
        assert!(events.is_empty());
        assert_eq!(skipped[0].reason, "no value for org-unit column 'facility'");
        assert!(!skipped[0].reason.contains("undefined"));
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
