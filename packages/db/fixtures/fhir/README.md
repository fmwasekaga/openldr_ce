# Bundled license-safe terminology fixtures

These gzipped artifacts ship with OpenLDR CE and are auto-imported (idempotently) on
first boot so Forms coded-field authoring works out of the box. Only **license-safe,
freely redistributable** terminology is bundled here.

## `R4.valuesets.json.gz`

The HL7 FHIR R4 base **ValueSet** catalog (compact form: `{ version, valueSets[],
codeSystems[] }`). Imported via `admin.valueSets.importFhirCatalog`
(`fhirValueSetCatalogToInputs`). FHIR is published by HL7 and is freely
redistributable. Source: HL7 FHIR R4 specification.

## `ucum.codesystem.json.gz`

The **UCUM** (Unified Code for Units of Measure) code system as a FHIR R4
`CodeSystem` (`url: http://unitsofmeasure.org`, `content: complete`), generated from
the canonical `ucum-essence.xml` by `scripts/make-ucum-codesystem.mjs`. Imported via
the generic `importTerminologyResource` path.

> **Attribution.** UCUM is © Regenstrief Institute, Inc. and the UCUM Organization.
> It is freely redistributable **with attribution** under the UCUM copyright / terms
> of use — see <https://ucum.org>. To regenerate:
>
> ```sh
> node scripts/make-ucum-codesystem.mjs
> ```
>
> The script sources `ucum-essence.xml` from
> <https://raw.githubusercontent.com/ucum-org/ucum/main/ucum-essence.xml>.

## Not bundled (user-provided, license-gated)

LOINC, SNOMED CT and RxNorm are **not** bundled — they carry usage licenses. Import
them yourself once you have accepted the relevant license, e.g.:

```sh
openldr terminology import loinc <dir> --accept-license
openldr terminology import resource <codesystem.json>
```
