# Base de données externe

Par défaut, OpenLDR stocke les tables de reporting aplaties dans sa base de données PostgreSQL interne. Vous pouvez diriger l'entrepôt de reporting vers un **PostgreSQL** ou un **SQL Server** externe via le paramètre `TARGET_STORE_ADAPTER`.

## Configuration de SQL Server

Définissez l'adaptateur de stockage cible sur `mssql` et la connexion dans votre environnement :

```
TARGET_STORE_ADAPTER=mssql
MSSQL_HOST=localhost
MSSQL_PORT=11433
MSSQL_DATABASE=openldr
MSSQL_USER=sa
MSSQL_PASSWORD=Your_Strong_Password1
```

OpenLDR projette les ressources FHIR dans des tables aplaties compatibles MSSQL et les charge en masse de manière idempotente. Aucune colonne JSON/document n'est requise — les données sont entièrement aplaties.

## Configuration de PostgreSQL externe

L'adaptateur par défaut est `pg` ; pointez-le vers un Postgres externe avec `TARGET_DATABASE_URL` :

```
TARGET_STORE_ADAPTER=pg
TARGET_DATABASE_URL=postgres://user:pass@host:5432/openldr
```

## Migration du schéma

Exécutez les migrations sur la cible externe avant le premier import :

```
pnpm openldr db migrate
```

Vous pouvez d'abord tester la connexion avec `pnpm openldr target-store test`.
