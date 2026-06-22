# Démarrage rapide

Ce guide décrit l'installation d'OpenLDR CE, l'initialisation de la base de données, et l'exécution de votre premier import.

## Prérequis

- Node.js 20+ et pnpm
- Docker (pour PostgreSQL, MinIO, et les conteneurs optionnels SQL Server / DHIS2 fournis)

## Installation

```
pnpm install
docker compose up -d
pnpm openldr db migrate
```

## Votre premier import

Installez un plugin et importez un fichier d'exemple :

```
pnpm openldr plugin install reference-plugins/whonet-sqlite/plugin.wasm
pnpm openldr ingest samples/whonet-sample.sqlite --plugin whonet-sqlite
```

Ouvrez l'application et accédez au **Tableau de bord** pour voir le rapport de résistance AMR résultant.

![Dashboard](dashboard.png)
