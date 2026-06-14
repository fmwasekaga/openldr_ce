# Ingestion & Plugins

OpenLDR ingests laboratory data through sandboxed WebAssembly plugins. Each plugin converts a source format into FHIR R4 resources.

## Supported formats

- **WHONET SQLite** (`whonet-sqlite`) — AMR isolates from WHONET databases.
- **HL7 v2** (`hl7v2`) — ORU result messages and ORM orders.
- **CSV / Excel** (`tabular`) — configurable column-to-field mapping.

## Running an ingest

```
pnpm openldr plugin install reference-plugins/<plugin>/plugin.wasm
pnpm openldr ingest <file> --plugin <id> [--config config.json]
```

## Plugin configuration

The `tabular` plugin requires a JSON mapping passed with `--config`. The config is persisted on the ingest batch and reused automatically if the batch is retried:

```
pnpm openldr ingest lab.csv --plugin tabular --config samples/lab-mapping.json
```

The mapping declares which spreadsheet columns map to patient, specimen, organism, and antibiotic-result fields.
