# Ingestion and Plugins

OpenLDR ingests laboratory data through sandboxed WebAssembly plugins. Each plugin converts a source format into FHIR R4 resources.

## Supported formats

- **WHONET SQLite** (`whonet-sqlite`): AMR isolates from WHONET databases.
- **HL7 v2** (`hl7v2`): ORU result messages and ORM orders.
- **CSV / Excel** (`tabular`): configurable column-to-field mapping.

## Running an ingest

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr plugin install reference-plugins/<plugin>/plugin.wasm
PS D:\Projects\Repositories\openldr_ce> pnpm openldr ingest <file> --plugin <id> --config config.json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr pipeline status --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr queue status --json
```

## Plugin configuration

The `tabular` plugin requires a JSON mapping passed with `--config`. The config is persisted on the ingest batch and reused automatically if the batch is retried:

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr ingest lab.csv --plugin tabular --config samples/lab-mapping.json
```

The mapping declares which spreadsheet columns map to patient, specimen, organism, and antibiotic-result fields.

If an ingest fails, inspect the pipeline batch logs:

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr pipeline logs <batchId> --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr pipeline retry <batchId> --json
```
