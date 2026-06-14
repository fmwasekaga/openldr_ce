//! Minimal FHIR R4 resource builders that emit `serde_json::Value`.
use serde_json::{json, Value};

/// A Patient with optional family/given names, gender, and birthDate.
pub fn patient(id: &str, family: Option<&str>, given: Option<&str>, gender: Option<&str>, birth_date: Option<&str>) -> Value {
    let mut p = json!({ "resourceType": "Patient", "id": id });
    if family.is_some() || given.is_some() {
        let mut name = json!({});
        if let Some(f) = family { name["family"] = json!(f); }
        if let Some(g) = given { name["given"] = json!([g]); }
        p["name"] = json!([name]);
    }
    if let Some(g) = gender { p["gender"] = json!(g); }
    if let Some(b) = birth_date { p["birthDate"] = json!(b); }
    p
}

/// A Specimen referencing a subject, with optional type code, collection date, and origin.
pub fn specimen(id: &str, subject_ref: &str, type_code: Option<&str>, collected: Option<&str>, origin: Option<&str>) -> Value {
    let mut s = json!({ "resourceType": "Specimen", "id": id, "subject": { "reference": subject_ref } });
    if let Some(t) = type_code {
        s["type"] = json!({ "coding": [{ "code": t }] });
    }
    if let Some(c) = collected {
        s["collection"] = json!({ "collectedDateTime": c });
    }
    if let Some(o) = origin {
        s["extension"] = json!([{ "url": "https://openldr.org/fhir/StructureDefinition/specimen-origin", "valueCode": o }]);
    }
    s
}

/// An organism-identification Observation (a coded value).
pub fn observation_organism(id: &str, subject_ref: &str, specimen_ref: &str, organism_code: &str, organism_text: &str) -> Value {
    json!({
        "resourceType": "Observation",
        "id": id,
        "status": "final",
        "category": [{ "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/observation-category", "code": "laboratory" }] }],
        "code": { "coding": [{ "system": "http://loinc.org", "code": "634-6", "display": "Bacteria identified" }] },
        "subject": { "reference": subject_ref },
        "specimen": { "reference": specimen_ref },
        "valueCodeableConcept": { "coding": [{ "code": organism_code }], "text": organism_text }
    })
}

/// An antibiotic-susceptibility Observation with an S/I/R interpretation code.
pub fn observation_ast(id: &str, subject_ref: &str, specimen_ref: &str, antibiotic: &str, interpretation: &str) -> Value {
    json!({
        "resourceType": "Observation",
        "id": id,
        "status": "final",
        "category": [{ "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/observation-category", "code": "laboratory" }] }],
        "code": { "text": antibiotic },
        "subject": { "reference": subject_ref },
        "specimen": { "reference": specimen_ref },
        "interpretation": [{ "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", "code": interpretation }] }]
    })
}

/// A laboratory ServiceRequest (an order) referencing a subject.
pub fn service_request(id: &str, subject_ref: &str, code: Option<&str>, code_text: Option<&str>, status: &str) -> Value {
    let mut s = json!({
        "resourceType": "ServiceRequest", "id": id, "status": status, "intent": "order",
        "subject": { "reference": subject_ref }
    });
    let mut coding = json!({});
    if let Some(c) = code { coding["code"] = json!(c); }
    let mut codeable = json!({});
    if code.is_some() { codeable["coding"] = json!([coding]); }
    if let Some(t) = code_text { codeable["text"] = json!(t); }
    if code.is_some() || code_text.is_some() { s["code"] = codeable; }
    s
}

/// A laboratory DiagnosticReport referencing a subject (and optionally a specimen).
pub fn diagnostic_report(id: &str, subject_ref: &str, specimen_ref: Option<&str>, code: Option<&str>, code_text: Option<&str>, issued: Option<&str>, conclusion: Option<&str>) -> Value {
    let mut r = json!({
        "resourceType": "DiagnosticReport", "id": id, "status": "final",
        "category": [{ "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/v2-0074", "code": "LAB" }] }],
        "subject": { "reference": subject_ref }
    });
    let mut coding = json!({});
    if let Some(c) = code { coding["code"] = json!(c); }
    let mut codeable = json!({});
    if code.is_some() { codeable["coding"] = json!([coding]); }
    if let Some(t) = code_text { codeable["text"] = json!(t); }
    if code.is_some() || code_text.is_some() { r["code"] = codeable; }
    if let Some(s) = specimen_ref { r["specimen"] = json!([{ "reference": s }]); }
    if let Some(i) = issued { r["issued"] = json!(i); }
    if let Some(c) = conclusion { r["conclusion"] = json!(c); }
    r
}
