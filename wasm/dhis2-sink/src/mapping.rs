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
