use crate::reader::Row;
use openldr_plugin_sdk::fhir;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
pub struct AntibioticCol { pub column: String, pub code: String }

#[derive(Debug, Deserialize)]
pub struct Mapping {
    pub sheet: Option<String>,
    #[serde(rename = "patientId")] pub patient_id: String,
    pub gender: Option<String>,
    #[serde(rename = "genderMap")] pub gender_map: Option<HashMap<String, String>>,
    #[serde(rename = "birthDate")] pub birth_date: Option<String>,
    #[serde(rename = "specimenId")] pub specimen_id: String,
    #[serde(rename = "specimenType")] pub specimen_type: Option<String>,
    #[serde(rename = "collectedDate")] pub collected_date: Option<String>,
    pub origin: Option<String>,
    #[serde(rename = "originMap")] pub origin_map: Option<HashMap<String, String>>,
    pub organism: Option<String>,
    #[serde(rename = "organismCode")] pub organism_code: Option<String>,
    pub antibiotics: Option<Vec<AntibioticCol>>,
}

impl Mapping {
    pub fn validate(&self) -> Result<(), String> {
        if self.patient_id.is_empty() || self.specimen_id.is_empty() {
            return Err("mapping requires patientId + specimenId".into());
        }
        if self.organism.is_none() && self.antibiotics.as_ref().map(|a| a.is_empty()).unwrap_or(true) {
            return Err("mapping requires organism or antibiotics".into());
        }
        Ok(())
    }
}

fn get<'a>(row: &'a Row, col: &Option<String>) -> Option<&'a str> {
    col.as_ref().and_then(|c| row.get(c)).map(|s| s.as_str()).filter(|s| !s.is_empty())
}

fn mapped<'a>(v: &'a str, m: &'a Option<HashMap<String, String>>) -> &'a str {
    m.as_ref().and_then(|map| map.get(v)).map(|s| s.as_str()).unwrap_or(v)
}

pub fn map_rows(rows: &[Row], m: &Mapping) -> Vec<Value> {
    let mut out = Vec::new();
    for (i, row) in rows.iter().enumerate() {
        let pid = row.get(&m.patient_id).filter(|s| !s.is_empty()).cloned().unwrap_or_else(|| format!("row-{i}"));
        let sid = row.get(&m.specimen_id).filter(|s| !s.is_empty()).cloned().unwrap_or_else(|| format!("spec-{i}"));
        let pref = format!("Patient/tab-{pid}");
        let sref = format!("Specimen/tab-{sid}");

        let gender = get(row, &m.gender).map(|g| mapped(g, &m.gender_map).to_string());
        out.push(fhir::patient(&format!("tab-{pid}"), None, None, gender.as_deref(), get(row, &m.birth_date)));

        let origin = get(row, &m.origin).map(|o| mapped(o, &m.origin_map).to_string());
        out.push(fhir::specimen(&format!("tab-{sid}"), &pref, get(row, &m.specimen_type), get(row, &m.collected_date), origin.as_deref()));

        if let Some(org) = get(row, &m.organism) {
            let code = get(row, &m.organism_code).unwrap_or(org);
            out.push(fhir::observation_organism(&format!("tab-org-{sid}"), &pref, &sref, code, org, None));
        }
        if let Some(abs) = &m.antibiotics {
            for ab in abs {
                if let Some(cell) = row.get(&ab.column) {
                    let v = cell.trim().to_ascii_uppercase();
                    if v == "S" || v == "I" || v == "R" {
                        out.push(fhir::observation_ast(&format!("tab-ast-{sid}-{}", ab.code), &pref, &sref, &ab.code, &v, None));
                    }
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(pairs: &[(&str, &str)]) -> Row { pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect() }

    #[test]
    fn maps_a_row_to_patient_specimen_organism_ast() {
        let m: Mapping = serde_json::from_str(r#"{
            "patientId":"PID","gender":"Sex","genderMap":{"F":"female"},"specimenId":"SID",
            "specimenType":"Spec","origin":"Loc","originMap":{"I":"inpatient"},
            "organism":"Org","organismCode":"OrgCode",
            "antibiotics":[{"column":"AMP","code":"AMP"},{"column":"CIP","code":"CIP"}]
        }"#).unwrap();
        m.validate().unwrap();
        let rows = vec![row(&[("PID","P1"),("Sex","F"),("SID","S1"),("Spec","BLOOD"),("Loc","I"),("Org","Escherichia coli"),("OrgCode","eco"),("AMP","R"),("CIP","")])];
        let res = map_rows(&rows, &m);
        assert_eq!(res.iter().filter(|r| r["resourceType"] == "Observation").count(), 2); // organism + 1 AST (blank CIP skipped)
        let pat = res.iter().find(|r| r["resourceType"] == "Patient").unwrap();
        assert_eq!(pat["gender"], "female");
        let spec = res.iter().find(|r| r["resourceType"] == "Specimen").unwrap();
        assert_eq!(spec["extension"][0]["valueCode"], "inpatient");
        let ast = res.iter().find(|r| r["resourceType"] == "Observation" && r["interpretation"][0]["coding"][0]["code"] == "R").unwrap();
        assert_eq!(ast["code"]["text"], "AMP");
    }

    #[test]
    fn validate_rejects_missing_keys() {
        let m: Mapping = serde_json::from_str(r#"{"patientId":"","specimenId":"S"}"#).unwrap();
        assert!(m.validate().is_err());
    }
}
