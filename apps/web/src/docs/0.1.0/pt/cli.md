# Referência da CLI

A CLI `openldr` gerencia tarefas de banco de dados, ingestão, relatórios e integração. Execute `pnpm openldr --help` para a lista completa e atualizada.

## Banco de dados

```
pnpm openldr db migrate
pnpm openldr db reset
```

## Plugins e ingestão

```
pnpm openldr plugin install <wasm>
pnpm openldr ingest <file> --plugin <id> [--config <json>]
```

## Relatórios

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
