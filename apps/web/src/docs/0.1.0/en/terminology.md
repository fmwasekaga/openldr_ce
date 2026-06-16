# Terminology

The terminology service resolves coded values (LOINC, RxNorm, SNOMED CT) used across ingested resources.

## Concept lookup

Codes carried on observations and orders are validated and can be expanded against bundled code systems. This keeps AMR data comparable across facilities.

## Imports

Code systems and ConceptMaps are imported idempotently — re-importing the same source is a no-op rather than a duplicate.

## Ontology indexes

LOINC, SNOMED CT, and RxNorm ontology indexes can be built from licensed source files and browsed from the Terminology page. When source files change, stale indexes are shown in the distribution dialog; background stale-index notifications are deferred until OpenLDR CE has a user notification primitive.
