# CLI Reference

The `openldr` CLI drives database, ingestion, reporting, user, DHIS2, marketplace, and artifact-authoring tasks. Run `pnpm openldr --help` and `pnpm openldr <command> --help` for the exact flags accepted by this build.

## Safe first commands

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr --help
PS D:\Projects\Repositories\openldr_ce> pnpm openldr health --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr target-store test --json
```

## Database

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr db migrate --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr db seed --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr db reset --force --json
```

`db reset` is destructive and should be limited to local/dev databases.

## Plugins and ingestion

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr plugin install reference-plugins/whonet-sqlite/plugin.wasm --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr plugin list --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr ingest samples/whonet-sample.sqlite --plugin whonet-sqlite --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr pipeline status --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr queue status --json
```

## Forms

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr forms list --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr forms extract packages/cli/src/__fixtures__/sample-questionnaire.json packages/cli/src/__fixtures__/sample-response.json --subject Patient/123 --json
```

## Reporting

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr report list --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr report run amr-resistance --param from=2026-01-01 --param to=2026-03-31 --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr report glass-export --from 2026-01-01 --to 2026-03-31 --out glass-ris.csv
```

## Terminology

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr terminology lookup http://loinc.org 94500-6 --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr terminology validate-code --system http://loinc.org --code 94500-6 --valueset <valueSetUrl> --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr terminology publisher list --json
```

## Users and audit

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr user list --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr user create --name "Lab Admin" --email admin@example.org --role lab_admin --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr audit list --json
```

## DHIS2

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 map import mapping.json --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 orgunit import orgunits.json --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 validate <mappingId> --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 push <mappingId> --period 2026Q1 --dry-run --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 tracker push <mappingId> --period 2026Q1 --dry-run --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr dhis2 schedule add <mappingId> --mode aggregate --period-type quarterly --json
```

## Marketplace and artifacts

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr market verify <bundleDir> --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr market install <bundleDir> --approve --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr artifact keygen --out ./publisher-keys --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr artifact new plugin whonet-custom --out ./artifacts --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr artifact publish <bundleDir> --to <registryDir> --json
```

## Portable export

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr export --out openldr-export --json
```

Most commands return exit code `0` on success and `1` when validation, configuration, database, or remote-service work fails. Help commands return `0`.
