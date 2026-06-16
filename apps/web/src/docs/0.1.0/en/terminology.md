# Terminology

The terminology service resolves coded values such as LOINC, UCUM, SNOMED CT, RxNorm, and ICD codes used across ingested resources.

## Concept lookup

Codes carried on observations and orders are validated and can be expanded against code systems. This keeps AMR and lab data comparable across facilities.

## Imports

Term imports are scoped to the selected code system and are idempotent. Re-importing the same source updates existing `(system, code)` rows rather than creating duplicates.

Use **Terminology -> code system row -> Actions -> Import terms...** for source terminology files:

| System | File to import |
|---|---|
| LOINC | Official `Loinc.csv` from a licensed/free LOINC download. |
| SNOMED CT | RF2 Description files such as `sct2_Description_Snapshot-en_*.txt`. |
| RxNorm | `RXNCONSO.RRF` from an RxNorm/UMLS download. |
| UCUM, ICD-10, ICD-11, custom systems | JSONL/NDJSON bundles, one term per line. |

OpenLDR CE seeds common UCUM laboratory units and a small ICD-10 lab-relevant starter set. ICD-11 is registered but intentionally empty; import your own ICD-11 subset as JSONL/NDJSON.

Generic JSONL/NDJSON rows use:

```jsonl
{"code":"mg/dL","displayName":"milligram per deciliter","class":"mass concentration"}
{"code":"B20","displayName":"Human immunodeficiency virus [HIV] disease","metadata":{"source":"WHO ICD-10"}}
```

`code` and `displayName` are required. Optional fields are `shortName`, `class`, `unit`, `status`, and `metadata`. Blank lines and `//` comments are ignored; a first metadata line like `{"type":"meta","codingSystem":"ICD-10","version":"2026"}` is skipped.

FHIR ValueSets are separate: use **Actions -> Value set -> Import...** and choose either a single FHIR ValueSet `.json` file or a Corlix/FHIR catalog file such as `R4.valuesets.json.gz`. ZIP files are not used for ValueSet import.

## Ontology indexes

LOINC, SNOMED CT, and RxNorm ontology indexes can be built from licensed source folders and browsed from the Terminology page. Ontology distribution folders are for read-only browsing and mapping assistance; they are separate from term imports into the main terminology table.
