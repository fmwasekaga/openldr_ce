# Terminology

The terminology service resolves coded values (LOINC, RxNorm, SNOMED CT) used across ingested resources.

## Concept lookup

Codes carried on observations and orders are validated and can be expanded against bundled code systems. This keeps AMR data comparable across facilities.

## Imports

Code systems and ConceptMaps are imported idempotently — re-importing the same source is a no-op rather than a duplicate.
