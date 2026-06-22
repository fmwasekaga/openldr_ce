# Terminologie

Le service de terminologie résout les valeurs codées telles que LOINC, UCUM, SNOMED CT, RxNorm et les codes CIM utilisés dans les ressources ingérées.

## Recherche de concepts

Les codes portés par les observations et les ordonnances sont validés et peuvent être développés en regard des systèmes de codage. Cela permet de maintenir la comparabilité des données AMR et de laboratoire entre les établissements.

## Imports

Les imports de terminologie sont limités au système de codage sélectionné et sont idempotents. Réimporter la même source met à jour les lignes `(system, code)` existantes plutôt que de créer des doublons.

Utilisez **Terminologie -> ligne du système de codage -> Actions -> Importer les termes...** pour les fichiers de terminologie source :

| Système | Fichier à importer |
|---|---|
| LOINC | Fichier officiel `Loinc.csv` issu d'un téléchargement LOINC (gratuit ou sous licence). |
| SNOMED CT | Fichiers RF2 Description tels que `sct2_Description_Snapshot-en_*.txt`. |
| RxNorm | `RXNCONSO.RRF` issu d'un téléchargement RxNorm/UMLS. |
| UCUM, CIM-10, CIM-11, systèmes personnalisés | Bundles JSONL/NDJSON, un terme par ligne. |

OpenLDR CE amorce les unités de laboratoire UCUM courantes et un petit ensemble de démarrage CIM-10 pertinent pour le laboratoire. CIM-11 est enregistré mais intentionnellement vide ; importez votre propre sous-ensemble CIM-11 en JSONL/NDJSON.

Les lignes JSONL/NDJSON génériques utilisent le format suivant :

```jsonl
{"code":"mg/dL","displayName":"milligram per deciliter","class":"mass concentration"}
{"code":"B20","displayName":"Human immunodeficiency virus [HIV] disease","metadata":{"source":"WHO ICD-10"}}
```

`code` et `displayName` sont obligatoires. Les champs optionnels sont `shortName`, `class`, `unit`, `status` et `metadata`. Les lignes vides et les commentaires `//` sont ignorés ; une première ligne de métadonnées telle que `{"type":"meta","codingSystem":"ICD-10","version":"2026"}` est ignorée.

Les ValueSets FHIR sont distincts : utilisez **Actions -> Value set -> Importer...** et choisissez soit un fichier FHIR ValueSet `.json` unique, soit un fichier catalogue Corlix/FHIR tel que `R4.valuesets.json.gz`. Les fichiers ZIP ne sont pas utilisés pour l'import de ValueSet.

## Index ontologiques

Les index ontologiques LOINC, SNOMED CT et RxNorm peuvent être construits à partir de dossiers sources sous licence et consultés depuis la page Terminologie. Les dossiers de distribution d'ontologies sont destinés à la navigation en lecture seule et à l'aide à la correspondance ; ils sont distincts des imports de termes dans la table de terminologie principale.
