# Rapports DHIS2 agrégés

OpenLDR peut transmettre des données de surveillance AMR à une instance DHIS2 sous forme de **dataValueSets** agrégés et d'**événements tracker**.

## Connexion

Configurez la connexion DHIS2 dans votre environnement :

```
REPORTING_TARGET_ADAPTER=dhis2
DHIS2_BASE_URL=http://localhost:8085
DHIS2_USERNAME=admin
DHIS2_PASSWORD=district
```

## Correspondance

Une correspondance relie les unités organisationnelles et les éléments de données d'OpenLDR aux UIDs de DHIS2. Elle couvre la correspondance des unités organisationnelles, la correspondance des éléments de données et des combinaisons de catégories, ainsi que le fenêtrage de période (la période de reporting est dérivée de la plage de dates du rapport). Importez les correspondances, puis validez avant de soumettre :

```
pnpm openldr dhis2 orgunit import orgunits.json
pnpm openldr dhis2 map import mapping.json
pnpm openldr dhis2 validate <mappingId>
```

## Soumission

Soumettez une correspondance pour une période DHIS2. Ajoutez `--dry-run` pour prévisualiser le contenu sans l'envoyer. Les événements tracker utilisent une sous-commande distincte et ciblent uniquement les programmes d'événements.

```
pnpm openldr dhis2 push <mappingId> --period 2026Q1
pnpm openldr dhis2 tracker push <mappingId> --period 2026Q1
```

## Synchronisation planifiée et déclenchée par événement

Enregistrez une planification pour republier selon une cadence de période. Passez `--event-driven` (tracker) pour soumettre également après chaque lot d'ingestion complété :

```
pnpm openldr dhis2 schedule add <mappingId> --mode aggregate --period-type quarterly
pnpm openldr dhis2 schedule add <mappingId> --mode tracker --period-type monthly --event-driven
```

![DHIS2 setup](doc-dhis2.png)
