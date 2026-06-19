/**
 * Canonical extension URLs used by the FormModel ⇄ Questionnaire adapters.
 *
 * Pinned implementation guides (see `docs/fhir/questionnaire-mapping.md`):
 *   - Core FHIR R4 base spec — http://hl7.org/fhir/R4/
 *   - SDC (Structured Data Capture) R4 — v3.0.0 / STU 3 — http://hl7.org/fhir/uv/sdc/STU3/
 *
 * Every URL below was verified against the page for the pinned version before
 * being committed (PRD §3.3). Do NOT add a URL here without verifying it; the
 * adapters must never inline a raw extension string.
 */

// ─── Core FHIR R4 (base spec) extensions ─────────────────────────────────────

/** Instance floor for a repeating item. */
export const EXT_QUESTIONNAIRE_MIN_OCCURS =
  'http://hl7.org/fhir/StructureDefinition/questionnaire-minOccurs'

/** Instance ceiling for a repeating item. */
export const EXT_QUESTIONNAIRE_MAX_OCCURS =
  'http://hl7.org/fhir/StructureDefinition/questionnaire-maxOccurs'

/** Allowed unit(s) on a `quantity` item. */
export const EXT_QUESTIONNAIRE_UNIT =
  'http://hl7.org/fhir/StructureDefinition/questionnaire-unit'

/** Inclusive lower bound on an answer value. */
export const EXT_MIN_VALUE = 'http://hl7.org/fhir/StructureDefinition/minValue'

/** Inclusive upper bound on an answer value. */
export const EXT_MAX_VALUE = 'http://hl7.org/fhir/StructureDefinition/maxValue'

/** Per-locale translations of a string element (e.g. `item.text`, option `display`). */
export const EXT_TRANSLATION = 'http://hl7.org/fhir/StructureDefinition/translation'

// ─── SDC R4 v3.0.0 (STU 3) extensions ────────────────────────────────────────

/** FHIRPath-based enableWhen (richer than the structural `enableWhen[]`). */
export const EXT_SDC_ENABLE_WHEN_EXPRESSION =
  'http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-enableWhenExpression'

/** FHIRPath expression computing an item's value. */
export const EXT_SDC_CALCULATED_EXPRESSION =
  'http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-calculatedExpression'

/** Marks an item for Observation-based extraction (Phase 3). */
export const EXT_SDC_OBSERVATION_EXTRACT =
  'http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-observationExtract'

// ─── Corlix vendor extensions ────────────────────────────────────────────────
//
// Carry FormModel authoring metadata that has no portable Questionnaire home, so
// definition round-trips are lossless. Vendor-internal (never published as
// StructureDefinitions); they use the repo's existing `urn:corlix:*` convention.

/** Original `FormFieldType` when `item.type` alone can't recover it (e.g. phone/email/identifier all → `string`). */
export const EXT_CORLIX_FIELD_TYPE = 'urn:corlix:questionnaire:field-type'

/** `FormField.fhirPath` — Corlix binding of an item to a path on its target resource. */
export const EXT_CORLIX_FHIR_PATH = 'urn:corlix:questionnaire:fhir-path'

/**
 * `FormField.order` / `FormSection.order` (valueInteger). Carried explicitly
 * because the flat model's global order does not match the Questionnaire item
 * tree position once sections regroup non-contiguous fields.
 */
export const EXT_CORLIX_ORDER = 'urn:corlix:questionnaire:order'

/** `FormField.cardinality` (JSON valueString) — carried only when not the scalar default `{min:0,max:'1'}`. */
export const EXT_CORLIX_CARDINALITY = 'urn:corlix:questionnaire:cardinality'

/** Marks a `group` item as a Corlix FormSection (not a repeating field-group). valueBoolean true. */
export const EXT_CORLIX_SECTION = 'urn:corlix:questionnaire:section'

/**
 * Exact `VisibilityRule` (JSON valueString). Native `enableWhen` is emitted
 * alongside for portability, but the R4 structural form can't express `oneOf`
 * or mixed combinators, so this carries the rule verbatim for lossless
 * round-trip. fromQuestionnaire prefers this when present.
 */
export const EXT_CORLIX_VISIBILITY = 'urn:corlix:questionnaire:visibility'

/** `FormSection.fhirResourceType` on a section group item. */
export const EXT_CORLIX_SECTION_RESOURCE_TYPE = 'urn:corlix:questionnaire:section-resource-type'

/** `FormField.description` — authoring help text. */
export const EXT_CORLIX_DESCRIPTION = 'urn:corlix:questionnaire:description'

/**
 * `FormField.bindingStrength` for a ValueSet-bound field. R4 Questionnaire has
 * no native strength on `answerValueSet`; carried here as valueString. Maps
 * cleanly to R5 `answerConstraint` if/when that version is targeted.
 */
export const EXT_CORLIX_BINDING_STRENGTH = 'urn:corlix:questionnaire:binding-strength'

/**
 * Corlix-only FormField authoring/binding metadata with no native Questionnaire
 * home (apiProperty, fhirDiscriminator, fhirValueField, placeholder, adminNote,
 * enabled, reference config, constraints, …), carried as JSON so the builder
 * round-trips losslessly. Anything mapped to a native field/extension is NOT
 * duplicated here.
 */
export const EXT_CORLIX_FIELD_EXTRAS = 'urn:corlix:questionnaire:field-extras'

/** `FormSchema.fhirVersion` (Questionnaire root). */
export const EXT_CORLIX_FHIR_VERSION = 'urn:corlix:questionnaire:fhir-version'

/** `FormSchema.fhirResourceType` (Questionnaire root). */
export const EXT_CORLIX_FHIR_RESOURCE_TYPE = 'urn:corlix:questionnaire:fhir-resource-type'

/** `FormSchema.fhirProfileUrl` (Questionnaire root). */
export const EXT_CORLIX_FHIR_PROFILE_URL = 'urn:corlix:questionnaire:fhir-profile-url'

/** `FormSchema.languages` — author-declared content-translation locales (JSON string array valueString). */
export const EXT_CORLIX_LANGUAGES = 'urn:corlix:questionnaire:languages'

// ─── Deliberately NOT exported ───────────────────────────────────────────────
//
// `sdc-questionnaire-constraint` (FHIRPath item-level validation) is referenced
// by PRD §3.3 but is NOT published in the pinned SDC R4 v3.0.0 / STU 3 IG: it is
// absent from that IG's artifact inventory and its StructureDefinition page 404s.
// It is therefore unverified against the pinned version and must not be relied on.
// v1 validation uses the core extensions above plus `item.required` / `item.maxLength`.
// Revisit if/when the pin moves to an SDC version that publishes it.
