# CLI Reference

The `openldr` CLI drives database, ingestion, reporting, and integration tasks. Run `pnpm openldr --help` for the authoritative list.

## Database

```
pnpm openldr db migrate
pnpm openldr db reset
```

## Plugins & ingestion

```
pnpm openldr plugin install <wasm>
pnpm openldr ingest <file> --plugin <id> [--config <json>]
```

## Reporting

```
pnpm openldr report list
pnpm openldr report run <id> [--param k=v] [--json | --csv | --format pdf --out <file>]
```

## DHIS2

```
pnpm openldr dhis2 map import <file>
pnpm openldr dhis2 validate <mappingId>
pnpm openldr dhis2 push <mappingId> --period <p>
pnpm openldr dhis2 tracker push <mappingId> --period <p>
```
