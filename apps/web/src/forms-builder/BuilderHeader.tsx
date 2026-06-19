import { ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PAGE_TARGETS } from '@openldr/forms/pure';
import type { FormLintIssue, FormSchema } from '@openldr/forms/pure';
import { LintSummary } from './LintSummary';

// ─── FHIR Version options — copied from Corlix data/fhir-versions.json ───────

export const FHIR_VERSIONS: readonly { value: string; label: string }[] = [
  { value: 'R4',  label: 'R4 (most common)' },
  { value: 'R4B', label: 'R4B' },
  { value: 'R5',  label: 'R5' },
  { value: 'R6',  label: 'R6 (CI build)' },
];

// ─── Resource Type options — common FHIR R4 resource types ───────────────────
// Sourced from the Corlix schemaInfo.resourceTypes list that ships with R4.
// Listed in the same alphabetical order Corlix presents them.

export const FHIR_RESOURCE_TYPES: readonly string[] = [
  'Account', 'ActivityDefinition', 'AdverseEvent', 'AllergyIntolerance',
  'Appointment', 'AppointmentResponse', 'AuditEvent', 'Basic', 'Binary',
  'BiologicallyDerivedProduct', 'BodyStructure', 'Bundle', 'CapabilityStatement',
  'CarePlan', 'CareTeam', 'CatalogEntry', 'ChargeItem', 'ChargeItemDefinition',
  'Claim', 'ClaimResponse', 'ClinicalImpression', 'CodeSystem', 'Communication',
  'CommunicationRequest', 'CompartmentDefinition', 'Composition', 'ConceptMap',
  'Condition', 'Consent', 'Contract', 'Coverage', 'CoverageEligibilityRequest',
  'CoverageEligibilityResponse', 'DetectedIssue', 'Device', 'DeviceDefinition',
  'DeviceMetric', 'DeviceRequest', 'DeviceUseStatement', 'DiagnosticReport',
  'DocumentManifest', 'DocumentReference', 'EffectEvidenceSynthesis', 'Encounter',
  'Endpoint', 'EnrollmentRequest', 'EnrollmentResponse', 'EpisodeOfCare',
  'EventDefinition', 'Evidence', 'EvidenceVariable', 'ExampleScenario',
  'ExplanationOfBenefit', 'FamilyMemberHistory', 'Flag', 'Goal',
  'GraphDefinition', 'Group', 'GuidanceResponse', 'HealthcareService',
  'ImagingStudy', 'Immunization', 'ImmunizationEvaluation',
  'ImmunizationRecommendation', 'ImplementationGuide', 'InsurancePlan', 'Invoice',
  'Library', 'Linkage', 'List', 'Location', 'Measure', 'MeasureReport', 'Media',
  'Medication', 'MedicationAdministration', 'MedicationDispense',
  'MedicationKnowledge', 'MedicationRequest', 'MedicationStatement',
  'MedicinalProduct', 'MedicinalProductAuthorization', 'MedicinalProductContraindication',
  'MedicinalProductIndication', 'MedicinalProductIngredient',
  'MedicinalProductInteraction', 'MedicinalProductManufactured',
  'MedicinalProductPackaged', 'MedicinalProductPharmaceutical',
  'MedicinalProductUndesirableEffect', 'MessageDefinition', 'MessageHeader',
  'MolecularSequence', 'NamingSystem', 'NutritionOrder', 'Observation',
  'ObservationDefinition', 'OperationDefinition', 'OperationOutcome',
  'Organization', 'OrganizationAffiliation', 'Patient', 'PaymentNotice',
  'PaymentReconciliation', 'Person', 'PlanDefinition', 'Practitioner',
  'PractitionerRole', 'Procedure', 'Provenance', 'Questionnaire',
  'QuestionnaireResponse', 'RelatedPerson', 'RequestGroup', 'ResearchDefinition',
  'ResearchElementDefinition', 'ResearchStudy', 'ResearchSubject', 'RiskAssessment',
  'RiskEvidenceSynthesis', 'Schedule', 'SearchParameter', 'ServiceRequest', 'Slot',
  'Specimen', 'SpecimenDefinition', 'StructureDefinition', 'StructureMap',
  'Subscription', 'Substance', 'SubstanceNucleicAcid', 'SubstancePolymer',
  'SubstanceProtein', 'SubstanceReferenceInformation', 'SubstanceSourceMaterial',
  'SubstanceSpecification', 'SupplyDelivery', 'SupplyRequest', 'Task',
  'TerminologyCapabilities', 'TestReport', 'TestScript', 'ValueSet',
  'VerificationResult', 'VisionPrescription',
];

// ─── Props ────────────────────────────────────────────────────────────────────

export interface BuilderHeaderProps {
  schema: FormSchema;
  issues: FormLintIssue[];
  canPublish: boolean;
  onChange: (patch: Partial<FormSchema>) => void;
  onSave: () => void;
  onPublish: () => void;
  onCompare: () => void;
  onAddField: () => void;
  /** Globe / language selector mounted by the parent page. */
  languageSlot?: React.ReactNode;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BuilderHeader({
  schema,
  issues,
  canPublish,
  onChange,
  onSave,
  onPublish,
  onCompare,
  onAddField,
  languageSlot,
}: BuilderHeaderProps): JSX.Element {
  const targetPages = schema.targetPages ?? [];

  const toggleTargetPage = (pageId: string, checked: boolean) => {
    if (checked) {
      onChange({ targetPages: [...targetPages, pageId] });
    } else {
      onChange({ targetPages: targetPages.filter((p) => p !== pageId) });
    }
  };

  const targetLabel =
    targetPages.length === 0
      ? 'Target pages…'
      : targetPages.length === 1
        ? (PAGE_TARGETS.find((p) => p.id === targetPages[0])?.label ?? targetPages[0])
        : `${targetPages.length} pages selected`;

  return (
    <div>
      {/* Header bar */}
      <div className="flex items-end gap-3 flex-wrap rounded-md border border-border bg-card p-3">
        {/* Form name */}
        <div className="flex-1 min-w-40 space-y-1">
          <Label className="text-xs" htmlFor="builder-name">Form name</Label>
          <Input
            id="builder-name"
            aria-label="Form name"
            value={schema.name}
            placeholder="e.g. Patient Registration"
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </div>

        {/* Version label */}
        <div className="w-24 space-y-1">
          <Label className="text-xs" htmlFor="builder-version">Version</Label>
          <Input
            id="builder-version"
            aria-label="Version label"
            value={schema.versionLabel ?? ''}
            placeholder="e.g. v1"
            onChange={(e) => onChange({ versionLabel: e.target.value })}
          />
        </div>

        {/* FHIR Version */}
        <div className="space-y-1">
          <Label className="text-xs">FHIR Version</Label>
          <Select
            value={schema.fhirVersion ?? '__none'}
            onValueChange={(v) => onChange({ fhirVersion: v === '__none' ? null : v })}
          >
            <SelectTrigger className="w-36 text-xs" aria-label="FHIR Version">
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">None</SelectItem>
              {FHIR_VERSIONS.map((v) => (
                <SelectItem key={v.value} value={v.value}>
                  {v.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Target pages */}
        <div className="space-y-1">
          <Label className="text-xs">Target pages</Label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Target pages"
                className="flex h-9 min-w-40 items-center justify-between gap-2 whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <span className={targetPages.length === 0 ? 'text-muted-foreground' : ''}>
                  {targetLabel}
                </span>
                <ChevronDown className="h-4 w-4 opacity-50" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              {PAGE_TARGETS.map((p) => {
                const checked = targetPages.includes(p.id);
                return (
                  <DropdownMenuCheckboxItem
                    key={p.id}
                    checked={checked}
                    onCheckedChange={(v) => toggleTargetPage(p.id, v)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {p.label}
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Resource Type */}
        <div className="space-y-1">
          <Label className="text-xs">Resource Type</Label>
          <Select
            value={schema.fhirResourceType ?? '__none'}
            onValueChange={(v) => onChange({ fhirResourceType: v === '__none' ? null : v })}
          >
            <SelectTrigger className="w-44 text-xs" aria-label="Resource Type">
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="__none">None</SelectItem>
              {FHIR_RESOURCE_TYPES.map((rt) => (
                <SelectItem key={rt} value={rt}>
                  {rt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Language slot (globe control — mounted by parent) */}
        {languageSlot}

        {/* ⋯ actions menu */}
        <div className="flex items-end shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                aria-label="Builder actions"
                className="h-9 w-9"
              >
                <span aria-hidden className="flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />
                  </svg>
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onAddField()}>
                Add field
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onSave()}>
                Save draft
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canPublish}
                onSelect={() => onPublish()}
              >
                Publish
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onCompare()}>
                Compare
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {/* TODO SP-F: wire Archive */}
              <DropdownMenuItem disabled onSelect={() => { /* TODO SP-F */ }}>
                Archive
              </DropdownMenuItem>
              {/* TODO SP-F: wire Export */}
              <DropdownMenuItem disabled onSelect={() => { /* TODO SP-F */ }}>
                Export
              </DropdownMenuItem>
              {/* TODO SP-F: wire Close */}
              <DropdownMenuItem disabled onSelect={() => { /* TODO SP-F */ }}>
                Close
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {/* TODO SP-F: wire Disable */}
              <DropdownMenuItem disabled onSelect={() => { /* TODO SP-F */ }}>
                Disable
              </DropdownMenuItem>
              {/* TODO SP-F: wire Delete */}
              <DropdownMenuItem disabled onSelect={() => { /* TODO SP-F */ }}>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Lint banner */}
      <LintSummary issues={issues} />
    </div>
  );
}
