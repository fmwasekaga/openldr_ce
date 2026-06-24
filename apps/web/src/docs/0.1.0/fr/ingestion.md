# Ingestion & Plugins

OpenLDR ingère des données de laboratoire via des plugins WebAssembly exécutés en bac à sable. Chaque plugin convertit un format source en ressources FHIR R4.

## Formats pris en charge

- **WHONET SQLite** (`whonet-sqlite`) — isolats AMR provenant de bases de données WHONET.
- **HL7 v2** (`hl7v2`) — messages de résultats ORU et ordonnances ORM.
- **CSV / Excel** (`tabular`) — correspondance configurable entre colonnes et champs.

## Lancer une ingestion

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr plugin install reference-plugins/<plugin>/plugin.wasm
PS D:\Projects\Repositories\openldr_ce> pnpm openldr ingest <file> --plugin <id> --config config.json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr pipeline status --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr queue status --json
```

## Configuration du plugin

Le plugin `tabular` nécessite un fichier de correspondance JSON passé avec `--config`. La configuration est persistée sur le lot d'ingestion et réutilisée automatiquement si le lot est relancé :

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr ingest lab.csv --plugin tabular --config samples/lab-mapping.json
```

Le fichier de correspondance déclare quelles colonnes du tableur correspondent aux champs patient, spécimen, micro-organisme et résultat antibiotique.

En cas d'échec d'une ingestion, inspectez les journaux du lot de pipeline :

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr pipeline logs <batchId> --json
PS D:\Projects\Repositories\openldr_ce> pnpm openldr pipeline retry <batchId> --json
```
