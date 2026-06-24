# Rapports DHIS2 agrégés

OpenLDR peut transmettre des données de surveillance AMR à une instance DHIS2 sous forme de **dataValueSets** agrégés et d'**événements tracker**.

## Connexion

Les informations de connexion DHIS2 (URL de base, nom d'utilisateur, mot de passe) sont stockées dans un **Connecteur** chiffré, pas dans des variables d'environnement. Créez-en un dans **Paramètres ▸ Connecteurs** : choisissez l'extension `dhis2-sink`, saisissez l'URL de base et les identifiants, puis cliquez sur **Tester la connexion** pour vérifier l'accès et récupérer un résumé des métadonnées. Les secrets sont chiffrés au repos et ne sont plus jamais affichés.

Deux variables d'environnement restent nécessaires :

```text
REPORTING_TARGET_ADAPTER=dhis2     # active le câblage de la cible de rapport DHIS2
SECRETS_ENCRYPTION_KEY=<base64>    # clé de 32 octets (openssl rand -base64 32) — requise pour stocker/lire les secrets du connecteur
DHIS2_SYNC_ENABLED=true            # facultatif, active la synchronisation planifiée/événementielle
```

Chaque correspondance DHIS2 sélectionne le connecteur qui reçoit son envoi (voir **Correspondance** ci-dessous).

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
