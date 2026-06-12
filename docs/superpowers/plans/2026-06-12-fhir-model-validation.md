# FHIR R4 Model + Validation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@openldr/fhir` — hand-written zod schemas + inferred types for CE's FHIR R4 datatype and resource subset, a `validateResource` function returning a spec-valid `OperationOutcome`, and an `openldr fhir validate <file> [--json]` CLI command.

**Architecture:** Each datatype/resource is a zod schema (`.passthrough()` to preserve extensions); TS types via `z.infer`. Resource schemas self-register into a `resourceType → schema` registry; `validateResource` dispatches by `resourceType` and maps zod issues to FHIR `OperationOutcome` issues. The CLI reads a JSON file (single resource or Bundle) and validates it. Pure library — no infra, no adapters.

**Tech Stack:** TypeScript (ESM, `moduleResolution: Bundler`), zod, Vitest, commander (CLI), tsup (CLI build). Builds into the existing `@openldr/fhir` placeholder package.

**Reference:** `docs/superpowers/specs/2026-06-12-fhir-model-validation-design.md`

**Conventions:** All commits use `git -c commit.gpgsign=false commit` with **no** `Co-authored-by` trailer (P1-CONV-2). Local imports omit extensions (Bundler resolution). Type-only imports use `import type`. FHIR element definitions transcribed from the R4 spec (hl7.org/fhir/R4); no committed JSON schema file.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/fhir/src/datatypes/primitives.ts` | zod refinements for FHIR primitives (id, code, date, dateTime, instant…) |
| `packages/fhir/src/datatypes/complex.ts` | Identifier, Coding, CodeableConcept, Reference, HumanName, ContactPoint, Address, Period, Quantity, Meta, Annotation |
| `packages/fhir/src/datatypes/index.ts` | datatype barrel |
| `packages/fhir/src/operation-outcome.ts` | `OperationOutcome` type + builders + zod-issue mapping |
| `packages/fhir/src/registry.ts` | `resourceType → schema` map |
| `packages/fhir/src/resources/*.ts` | the nine resource schemas, each self-registering |
| `packages/fhir/src/resources/index.ts` | resource barrel (triggers self-registration) |
| `packages/fhir/src/validate.ts` | `validateResource`, `validateBundleEntries` |
| `packages/fhir/src/index.ts` | public surface |
| `packages/cli/src/fhir.ts` | `runFhirValidate(file)` |
| `packages/cli/src/index.ts` | add the `fhir validate` command (modify) |
| `packages/cli/src/__fixtures__/*.json` | CLI test fixtures |

---

## Task 1: `@openldr/fhir` package + datatypes (primitives + complex)

**Files:**
- Modify: `packages/fhir/package.json`
- Create: `packages/fhir/src/datatypes/primitives.ts`, `packages/fhir/src/datatypes/primitives.test.ts`, `packages/fhir/src/datatypes/complex.ts`, `packages/fhir/src/datatypes/complex.test.ts`, `packages/fhir/src/datatypes/index.ts`

- [ ] **Step 1: Replace `packages/fhir/package.json`** (drop the ports dep, add zod, enable real tests)

```json
{
  "name": "@openldr/fhir",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "echo \"no lint\""
  },
  "dependencies": { "zod": "^3.24.1" },
  "devDependencies": { "typescript": "^5.7.2", "vitest": "^2.1.8" }
}
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: resolves; zod linked into `@openldr/fhir`.

- [ ] **Step 3: Write the failing test `packages/fhir/src/datatypes/primitives.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { fhirId, fhirCode, fhirDate, fhirDateTime } from './primitives';

describe('fhir primitives', () => {
  it('fhirId accepts valid ids and rejects spaces / overlength', () => {
    expect(fhirId.safeParse('abc-123.4').success).toBe(true);
    expect(fhirId.safeParse('has space').success).toBe(false);
    expect(fhirId.safeParse('x'.repeat(65)).success).toBe(false);
  });
  it('fhirCode rejects leading/trailing whitespace', () => {
    expect(fhirCode.safeParse('final').success).toBe(true);
    expect(fhirCode.safeParse(' final').success).toBe(false);
  });
  it('fhirDate accepts partial dates, rejects malformed', () => {
    expect(fhirDate.safeParse('2024').success).toBe(true);
    expect(fhirDate.safeParse('2024-05').success).toBe(true);
    expect(fhirDate.safeParse('2024-05-01').success).toBe(true);
    expect(fhirDate.safeParse('2024-5-1').success).toBe(false);
    expect(fhirDate.safeParse('notadate').success).toBe(false);
  });
  it('fhirDateTime accepts a full timestamp', () => {
    expect(fhirDateTime.safeParse('2024-05-01T10:30:00Z').success).toBe(true);
    expect(fhirDateTime.safeParse('2024-05-01T10:30:00+03:00').success).toBe(true);
    expect(fhirDateTime.safeParse('2024-05-01 10:30').success).toBe(false);
  });
});
```

- [ ] **Step 4: Run it to verify failure**

Run: `pnpm --filter @openldr/fhir test primitives`
Expected: FAIL — cannot find module `./primitives`.

- [ ] **Step 5: Create `packages/fhir/src/datatypes/primitives.ts`**

```ts
import { z } from 'zod';

const ID_RE = /^[A-Za-z0-9.\-]{1,64}$/;
const CODE_RE = /^[^\s]+(\s[^\s]+)*$/;
const DATE_RE = /^\d{4}(-\d{2}(-\d{2})?)?$/;
const DATETIME_RE = /^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2}))?)?)?$/;
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export const fhirId = z.string().regex(ID_RE, 'invalid FHIR id');
export const fhirUri = z.string().min(1);
export const fhirCode = z.string().regex(CODE_RE, 'invalid FHIR code');
export const fhirString = z.string().min(1);
export const fhirBoolean = z.boolean();
export const fhirDecimal = z.number();
export const fhirInteger = z.number().int();
export const fhirDate = z.string().regex(DATE_RE, 'invalid FHIR date');
export const fhirDateTime = z.string().regex(DATETIME_RE, 'invalid FHIR dateTime');
export const fhirInstant = z.string().regex(INSTANT_RE, 'invalid FHIR instant');
export const fhirBase64Binary = z.string();
```

- [ ] **Step 6: Run it to verify pass**

Run: `pnpm --filter @openldr/fhir test primitives`
Expected: PASS (4 tests).

- [ ] **Step 7: Write the failing test `packages/fhir/src/datatypes/complex.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { Identifier, Coding, CodeableConcept, Reference, HumanName, Quantity } from './complex';

describe('fhir complex datatypes', () => {
  it('Coding accepts a typical coding and preserves extensions', () => {
    const r = Coding.safeParse({ system: 'http://loinc.org', code: '2339-0', display: 'Glucose', extension: [{ url: 'x' }] });
    expect(r.success).toBe(true);
    if (r.success) expect((r.data as Record<string, unknown>).extension).toBeDefined();
  });
  it('CodeableConcept nests codings', () => {
    expect(CodeableConcept.safeParse({ coding: [{ code: 'x' }], text: 'glucose' }).success).toBe(true);
  });
  it('Identifier validates use enum', () => {
    expect(Identifier.safeParse({ system: 'urn:x', value: '123', use: 'official' }).success).toBe(true);
    expect(Identifier.safeParse({ use: 'bogus' }).success).toBe(false);
  });
  it('Reference and HumanName parse', () => {
    expect(Reference.safeParse({ reference: 'Patient/1' }).success).toBe(true);
    expect(HumanName.safeParse({ family: 'Doe', given: ['Jane'] }).success).toBe(true);
  });
  it('Quantity rejects a non-numeric value', () => {
    expect(Quantity.safeParse({ value: 'high' }).success).toBe(false);
  });
});
```

- [ ] **Step 8: Run it to verify failure**

Run: `pnpm --filter @openldr/fhir test complex`
Expected: FAIL — cannot find module `./complex`.

- [ ] **Step 9: Create `packages/fhir/src/datatypes/complex.ts`**

```ts
import { z } from 'zod';
import { fhirUri, fhirCode, fhirString, fhirBoolean, fhirDecimal, fhirDateTime, fhirInstant } from './primitives';

export const Coding = z
  .object({
    system: fhirUri.optional(),
    version: z.string().optional(),
    code: fhirCode.optional(),
    display: z.string().optional(),
    userSelected: fhirBoolean.optional(),
  })
  .passthrough();
export type Coding = z.infer<typeof Coding>;

export const CodeableConcept = z
  .object({
    coding: z.array(Coding).optional(),
    text: z.string().optional(),
  })
  .passthrough();
export type CodeableConcept = z.infer<typeof CodeableConcept>;

export const Period = z
  .object({
    start: fhirDateTime.optional(),
    end: fhirDateTime.optional(),
  })
  .passthrough();
export type Period = z.infer<typeof Period>;

export const Identifier = z
  .object({
    use: z.enum(['usual', 'official', 'temp', 'secondary', 'old']).optional(),
    type: CodeableConcept.optional(),
    system: fhirUri.optional(),
    value: z.string().optional(),
    period: Period.optional(),
  })
  .passthrough();
export type Identifier = z.infer<typeof Identifier>;

export const Reference = z
  .object({
    reference: z.string().optional(),
    type: fhirUri.optional(),
    display: z.string().optional(),
  })
  .passthrough();
export type Reference = z.infer<typeof Reference>;

export const HumanName = z
  .object({
    use: z.enum(['usual', 'official', 'temp', 'nickname', 'anonymous', 'old', 'maiden']).optional(),
    text: z.string().optional(),
    family: z.string().optional(),
    given: z.array(z.string()).optional(),
    prefix: z.array(z.string()).optional(),
    suffix: z.array(z.string()).optional(),
    period: Period.optional(),
  })
  .passthrough();
export type HumanName = z.infer<typeof HumanName>;

export const ContactPoint = z
  .object({
    system: z.enum(['phone', 'fax', 'email', 'pager', 'url', 'sms', 'other']).optional(),
    value: z.string().optional(),
    use: z.enum(['home', 'work', 'temp', 'old', 'mobile']).optional(),
    rank: z.number().int().positive().optional(),
    period: Period.optional(),
  })
  .passthrough();
export type ContactPoint = z.infer<typeof ContactPoint>;

export const Address = z
  .object({
    use: z.enum(['home', 'work', 'temp', 'old', 'billing']).optional(),
    type: z.enum(['postal', 'physical', 'both']).optional(),
    text: z.string().optional(),
    line: z.array(z.string()).optional(),
    city: z.string().optional(),
    district: z.string().optional(),
    state: z.string().optional(),
    postalCode: z.string().optional(),
    country: z.string().optional(),
    period: Period.optional(),
  })
  .passthrough();
export type Address = z.infer<typeof Address>;

export const Quantity = z
  .object({
    value: fhirDecimal.optional(),
    comparator: z.enum(['<', '<=', '>=', '>']).optional(),
    unit: z.string().optional(),
    system: fhirUri.optional(),
    code: fhirCode.optional(),
  })
  .passthrough();
export type Quantity = z.infer<typeof Quantity>;

export const Meta = z
  .object({
    versionId: z.string().optional(),
    lastUpdated: fhirInstant.optional(),
    source: fhirUri.optional(),
    profile: z.array(fhirUri).optional(),
    security: z.array(Coding).optional(),
    tag: z.array(Coding).optional(),
  })
  .passthrough();
export type Meta = z.infer<typeof Meta>;

export const Annotation = z
  .object({
    authorString: z.string().optional(),
    authorReference: Reference.optional(),
    time: fhirDateTime.optional(),
    text: fhirString,
  })
  .passthrough();
export type Annotation = z.infer<typeof Annotation>;
```

- [ ] **Step 10: Run it to verify pass**

Run: `pnpm --filter @openldr/fhir test complex`
Expected: PASS (5 tests).

- [ ] **Step 11: Create `packages/fhir/src/datatypes/index.ts`**

```ts
export * from './primitives';
export * from './complex';
```

- [ ] **Step 12: Typecheck**

Run: `pnpm --filter @openldr/fhir typecheck`
Expected: no errors.

- [ ] **Step 13: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(fhir): R4 primitive + complex datatype schemas (P1-FHIR-1)"
```

---

## Task 2: OperationOutcome + registry

**Files:**
- Create: `packages/fhir/src/operation-outcome.ts`, `packages/fhir/src/operation-outcome.test.ts`, `packages/fhir/src/registry.ts`, `packages/fhir/src/registry.test.ts`

- [ ] **Step 1: Write the failing test `packages/fhir/src/operation-outcome.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { singleIssueOutcome, outcomeFromIssues, issuesFromZodError } from './operation-outcome';

describe('operation-outcome', () => {
  it('singleIssueOutcome builds a spec-shaped OperationOutcome', () => {
    const o = singleIssueOutcome('error', 'not-supported', 'nope', ['resourceType']);
    expect(o.resourceType).toBe('OperationOutcome');
    expect(o.issue[0]).toMatchObject({ severity: 'error', code: 'not-supported', diagnostics: 'nope', expression: ['resourceType'] });
  });
  it('issuesFromZodError maps type errors to structure and others to invalid', () => {
    const schema = z.object({ status: z.string(), n: z.number() });
    const res = schema.safeParse({ n: 'x' });
    expect(res.success).toBe(false);
    if (!res.success) {
      const issues = issuesFromZodError(res.error);
      const codes = issues.map((i) => i.code);
      expect(codes).toContain('invalid'); // missing required 'status'
      expect(codes).toContain('structure'); // wrong type 'n'
      expect(issues.every((i) => i.severity === 'error')).toBe(true);
    }
  });
  it('outcomeFromIssues wraps issues', () => {
    expect(outcomeFromIssues([{ severity: 'warning', code: 'invalid' }]).issue.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `pnpm --filter @openldr/fhir test operation-outcome`
Expected: FAIL — cannot find module `./operation-outcome`.

- [ ] **Step 3: Create `packages/fhir/src/operation-outcome.ts`**

```ts
import type { z } from 'zod';

export type IssueSeverity = 'fatal' | 'error' | 'warning' | 'information';

export interface OperationOutcomeIssue {
  severity: IssueSeverity;
  code: string;
  diagnostics?: string;
  expression?: string[];
}

export interface OperationOutcome {
  resourceType: 'OperationOutcome';
  issue: OperationOutcomeIssue[];
}

export function outcomeFromIssues(issues: OperationOutcomeIssue[]): OperationOutcome {
  return { resourceType: 'OperationOutcome', issue: issues };
}

export function singleIssueOutcome(
  severity: IssueSeverity,
  code: string,
  diagnostics: string,
  expression?: string[],
): OperationOutcome {
  return outcomeFromIssues([{ severity, code, diagnostics, ...(expression ? { expression } : {}) }]);
}

export function issuesFromZodError(error: z.ZodError): OperationOutcomeIssue[] {
  return error.issues.map((i) => {
    // A missing required field is a structural issue; a present-but-wrong value is invalid.
    const missing = i.code === 'invalid_type' && (i as { received?: string }).received === 'undefined';
    return {
      severity: 'error' as const,
      code: missing ? 'structure' : 'invalid',
      diagnostics: i.message,
      expression: [i.path.length ? i.path.join('.') : '(root)'],
    };
  });
}
```

- [ ] **Step 4: Run it to verify pass**

Run: `pnpm --filter @openldr/fhir test operation-outcome`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing test `packages/fhir/src/registry.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { registerResource, getResourceSchema, listResourceTypes } from './registry';

describe('registry', () => {
  it('registers and retrieves a schema by resourceType', () => {
    const schema = z.object({ resourceType: z.literal('Demo') });
    registerResource('Demo', schema);
    expect(getResourceSchema('Demo')).toBe(schema);
    expect(getResourceSchema('Missing')).toBeUndefined();
    expect(listResourceTypes()).toContain('Demo');
  });
});
```

- [ ] **Step 6: Run it to verify failure**

Run: `pnpm --filter @openldr/fhir test registry`
Expected: FAIL — cannot find module `./registry`.

- [ ] **Step 7: Create `packages/fhir/src/registry.ts`**

```ts
import type { ZodTypeAny } from 'zod';

const schemas = new Map<string, ZodTypeAny>();

export function registerResource(type: string, schema: ZodTypeAny): void {
  schemas.set(type, schema);
}

export function getResourceSchema(type: string): ZodTypeAny | undefined {
  return schemas.get(type);
}

export function listResourceTypes(): string[] {
  return [...schemas.keys()].sort();
}
```

- [ ] **Step 8: Run it to verify pass**

Run: `pnpm --filter @openldr/fhir test registry`
Expected: PASS (1 test).

- [ ] **Step 9: Typecheck**

Run: `pnpm --filter @openldr/fhir typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(fhir): OperationOutcome builders + resource registry"
```

---

## Task 3: Resources batch A — Patient, Organization, Location

**Files:**
- Create: `packages/fhir/src/resources/patient.ts`, `packages/fhir/src/resources/organization.ts`, `packages/fhir/src/resources/location.ts`, `packages/fhir/src/resources/batch-a.test.ts`

- [ ] **Step 1: Write the failing test `packages/fhir/src/resources/batch-a.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { Patient } from './patient';
import { Organization } from './organization';
import { Location } from './location';

describe('Patient', () => {
  it('parses a valid Patient and preserves an extension', () => {
    const r = Patient.safeParse({
      resourceType: 'Patient',
      id: 'p1',
      gender: 'female',
      birthDate: '1990-05-01',
      name: [{ family: 'Doe', given: ['Jane'] }],
      extension: [{ url: 'urn:x', valueString: 'keep' }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect((r.data as Record<string, unknown>).extension).toBeDefined();
  });
  it('rejects a bad gender code', () => {
    expect(Patient.safeParse({ resourceType: 'Patient', gender: 'X' }).success).toBe(false);
  });
  it('rejects a wrong resourceType', () => {
    expect(Patient.safeParse({ resourceType: 'Observation' }).success).toBe(false);
  });
});

describe('Organization & Location', () => {
  it('Organization parses', () => {
    expect(Organization.safeParse({ resourceType: 'Organization', name: 'Central Lab' }).success).toBe(true);
  });
  it('Location validates its status enum', () => {
    expect(Location.safeParse({ resourceType: 'Location', status: 'active', name: 'Bench 1' }).success).toBe(true);
    expect(Location.safeParse({ resourceType: 'Location', status: 'bogus' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `pnpm --filter @openldr/fhir test batch-a`
Expected: FAIL — cannot find module `./patient`.

- [ ] **Step 3: Create `packages/fhir/src/resources/patient.ts`**

```ts
import { z } from 'zod';
import { fhirId, fhirBoolean, fhirDate, fhirDateTime } from '../datatypes/primitives';
import { Identifier, HumanName, ContactPoint, Address, Meta, Reference } from '../datatypes/complex';
import { registerResource } from '../registry';

export const Patient = z
  .object({
    resourceType: z.literal('Patient'),
    id: fhirId.optional(),
    meta: Meta.optional(),
    identifier: z.array(Identifier).optional(),
    active: fhirBoolean.optional(),
    name: z.array(HumanName).optional(),
    telecom: z.array(ContactPoint).optional(),
    gender: z.enum(['male', 'female', 'other', 'unknown']).optional(),
    birthDate: fhirDate.optional(),
    deceasedBoolean: fhirBoolean.optional(),
    deceasedDateTime: fhirDateTime.optional(),
    address: z.array(Address).optional(),
    managingOrganization: Reference.optional(),
  })
  .passthrough();
export type Patient = z.infer<typeof Patient>;

registerResource('Patient', Patient);
```

- [ ] **Step 4: Create `packages/fhir/src/resources/organization.ts`**

```ts
import { z } from 'zod';
import { fhirId, fhirBoolean } from '../datatypes/primitives';
import { Identifier, CodeableConcept, ContactPoint, Address, Meta, Reference } from '../datatypes/complex';
import { registerResource } from '../registry';

export const Organization = z
  .object({
    resourceType: z.literal('Organization'),
    id: fhirId.optional(),
    meta: Meta.optional(),
    identifier: z.array(Identifier).optional(),
    active: fhirBoolean.optional(),
    type: z.array(CodeableConcept).optional(),
    name: z.string().optional(),
    telecom: z.array(ContactPoint).optional(),
    address: z.array(Address).optional(),
    partOf: Reference.optional(),
  })
  .passthrough();
export type Organization = z.infer<typeof Organization>;

registerResource('Organization', Organization);
```

- [ ] **Step 5: Create `packages/fhir/src/resources/location.ts`**

```ts
import { z } from 'zod';
import { fhirId } from '../datatypes/primitives';
import { Identifier, CodeableConcept, ContactPoint, Address, Meta, Reference } from '../datatypes/complex';
import { registerResource } from '../registry';

export const Location = z
  .object({
    resourceType: z.literal('Location'),
    id: fhirId.optional(),
    meta: Meta.optional(),
    identifier: z.array(Identifier).optional(),
    status: z.enum(['active', 'suspended', 'inactive']).optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    mode: z.enum(['instance', 'kind']).optional(),
    type: z.array(CodeableConcept).optional(),
    telecom: z.array(ContactPoint).optional(),
    address: Address.optional(),
    physicalType: CodeableConcept.optional(),
    managingOrganization: Reference.optional(),
    partOf: Reference.optional(),
  })
  .passthrough();
export type Location = z.infer<typeof Location>;

registerResource('Location', Location);
```

- [ ] **Step 6: Run it to verify pass**

Run: `pnpm --filter @openldr/fhir test batch-a`
Expected: PASS (5 tests).

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @openldr/fhir typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(fhir): Patient, Organization, Location resources (P1-FHIR-2)"
```

---

## Task 4: Resources batch B — Specimen, ServiceRequest, DiagnosticReport, Observation, Bundle

**Files:**
- Create: `packages/fhir/src/resources/specimen.ts`, `packages/fhir/src/resources/service-request.ts`, `packages/fhir/src/resources/diagnostic-report.ts`, `packages/fhir/src/resources/observation.ts`, `packages/fhir/src/resources/bundle.ts`, `packages/fhir/src/resources/batch-b.test.ts`

- [ ] **Step 1: Write the failing test `packages/fhir/src/resources/batch-b.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { Specimen } from './specimen';
import { ServiceRequest } from './service-request';
import { DiagnosticReport } from './diagnostic-report';
import { Observation } from './observation';
import { Bundle } from './bundle';

describe('Specimen (isolate = derived Specimen)', () => {
  it('parses an isolate Specimen with parent', () => {
    expect(
      Specimen.safeParse({
        resourceType: 'Specimen',
        status: 'available',
        type: { text: 'isolate' },
        parent: [{ reference: 'Specimen/parent-1' }],
        subject: { reference: 'Patient/1' },
      }).success,
    ).toBe(true);
  });
  it('rejects a bad status', () => {
    expect(Specimen.safeParse({ resourceType: 'Specimen', status: 'bogus' }).success).toBe(false);
  });
});

describe('ServiceRequest required elements', () => {
  it('requires status, intent, subject', () => {
    expect(ServiceRequest.safeParse({ resourceType: 'ServiceRequest' }).success).toBe(false);
    expect(
      ServiceRequest.safeParse({ resourceType: 'ServiceRequest', status: 'active', intent: 'order', subject: { reference: 'Patient/1' } }).success,
    ).toBe(true);
  });
});

describe('DiagnosticReport required elements', () => {
  it('requires status and code', () => {
    expect(DiagnosticReport.safeParse({ resourceType: 'DiagnosticReport', status: 'final' }).success).toBe(false);
    expect(DiagnosticReport.safeParse({ resourceType: 'DiagnosticReport', status: 'final', code: { text: 'Culture' } }).success).toBe(true);
  });
});

describe('Observation (organism + AST)', () => {
  it('parses an AST observation with components referencing a specimen', () => {
    expect(
      Observation.safeParse({
        resourceType: 'Observation',
        status: 'final',
        code: { text: 'Ciprofloxacin susceptibility' },
        specimen: { reference: 'Specimen/isolate-1' },
        valueCodeableConcept: { text: 'Resistant' },
        interpretation: [{ coding: [{ code: 'R' }] }],
      }).success,
    ).toBe(true);
  });
  it('requires status and code', () => {
    expect(Observation.safeParse({ resourceType: 'Observation', code: { text: 'x' } }).success).toBe(false);
  });
});

describe('Bundle', () => {
  it('requires type and accepts entries', () => {
    expect(Bundle.safeParse({ resourceType: 'Bundle' }).success).toBe(false);
    expect(Bundle.safeParse({ resourceType: 'Bundle', type: 'collection', entry: [{ resource: { resourceType: 'Patient' } }] }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `pnpm --filter @openldr/fhir test batch-b`
Expected: FAIL — cannot find module `./specimen`.

- [ ] **Step 3: Create `packages/fhir/src/resources/specimen.ts`**

```ts
import { z } from 'zod';
import { fhirId, fhirDateTime } from '../datatypes/primitives';
import { Identifier, CodeableConcept, Reference, Meta } from '../datatypes/complex';
import { registerResource } from '../registry';

export const Specimen = z
  .object({
    resourceType: z.literal('Specimen'),
    id: fhirId.optional(),
    meta: Meta.optional(),
    identifier: z.array(Identifier).optional(),
    accessionIdentifier: Identifier.optional(),
    status: z.enum(['available', 'unavailable', 'unsatisfactory', 'entered-in-error']).optional(),
    type: CodeableConcept.optional(),
    subject: Reference.optional(),
    receivedTime: fhirDateTime.optional(),
    parent: z.array(Reference).optional(),
    request: z.array(Reference).optional(),
    collection: z
      .object({
        collectedDateTime: fhirDateTime.optional(),
        bodySite: CodeableConcept.optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type Specimen = z.infer<typeof Specimen>;

registerResource('Specimen', Specimen);
```

- [ ] **Step 4: Create `packages/fhir/src/resources/service-request.ts`**

```ts
import { z } from 'zod';
import { fhirId, fhirDateTime } from '../datatypes/primitives';
import { Identifier, CodeableConcept, Reference, Meta } from '../datatypes/complex';
import { registerResource } from '../registry';

export const ServiceRequest = z
  .object({
    resourceType: z.literal('ServiceRequest'),
    id: fhirId.optional(),
    meta: Meta.optional(),
    identifier: z.array(Identifier).optional(),
    status: z.enum(['draft', 'active', 'on-hold', 'revoked', 'completed', 'entered-in-error', 'unknown']),
    intent: z.enum(['proposal', 'plan', 'directive', 'order', 'original-order', 'reflex-order', 'filler-order', 'instance-order', 'option']),
    category: z.array(CodeableConcept).optional(),
    priority: z.enum(['routine', 'urgent', 'asap', 'stat']).optional(),
    code: CodeableConcept.optional(),
    subject: Reference,
    encounter: Reference.optional(),
    authoredOn: fhirDateTime.optional(),
    requester: Reference.optional(),
    specimen: z.array(Reference).optional(),
  })
  .passthrough();
export type ServiceRequest = z.infer<typeof ServiceRequest>;

registerResource('ServiceRequest', ServiceRequest);
```

- [ ] **Step 5: Create `packages/fhir/src/resources/diagnostic-report.ts`**

```ts
import { z } from 'zod';
import { fhirId, fhirDateTime, fhirInstant } from '../datatypes/primitives';
import { Identifier, CodeableConcept, Reference, Meta } from '../datatypes/complex';
import { registerResource } from '../registry';

export const DiagnosticReport = z
  .object({
    resourceType: z.literal('DiagnosticReport'),
    id: fhirId.optional(),
    meta: Meta.optional(),
    identifier: z.array(Identifier).optional(),
    basedOn: z.array(Reference).optional(),
    status: z.enum([
      'registered', 'partial', 'preliminary', 'final', 'amended', 'corrected', 'appended', 'cancelled', 'entered-in-error', 'unknown',
    ]),
    category: z.array(CodeableConcept).optional(),
    code: CodeableConcept,
    subject: Reference.optional(),
    effectiveDateTime: fhirDateTime.optional(),
    issued: fhirInstant.optional(),
    specimen: z.array(Reference).optional(),
    result: z.array(Reference).optional(),
    conclusion: z.string().optional(),
    conclusionCode: z.array(CodeableConcept).optional(),
  })
  .passthrough();
export type DiagnosticReport = z.infer<typeof DiagnosticReport>;

registerResource('DiagnosticReport', DiagnosticReport);
```

- [ ] **Step 6: Create `packages/fhir/src/resources/observation.ts`**

```ts
import { z } from 'zod';
import { fhirId, fhirDateTime, fhirInstant, fhirString } from '../datatypes/primitives';
import { Identifier, CodeableConcept, Reference, Quantity, Meta } from '../datatypes/complex';
import { registerResource } from '../registry';

const ObservationComponent = z
  .object({
    code: CodeableConcept,
    valueQuantity: Quantity.optional(),
    valueCodeableConcept: CodeableConcept.optional(),
    valueString: fhirString.optional(),
    interpretation: z.array(CodeableConcept).optional(),
  })
  .passthrough();

export const Observation = z
  .object({
    resourceType: z.literal('Observation'),
    id: fhirId.optional(),
    meta: Meta.optional(),
    identifier: z.array(Identifier).optional(),
    basedOn: z.array(Reference).optional(),
    status: z.enum(['registered', 'preliminary', 'final', 'amended', 'corrected', 'cancelled', 'entered-in-error', 'unknown']),
    category: z.array(CodeableConcept).optional(),
    code: CodeableConcept,
    subject: Reference.optional(),
    effectiveDateTime: fhirDateTime.optional(),
    issued: fhirInstant.optional(),
    valueQuantity: Quantity.optional(),
    valueCodeableConcept: CodeableConcept.optional(),
    valueString: fhirString.optional(),
    interpretation: z.array(CodeableConcept).optional(),
    method: CodeableConcept.optional(),
    specimen: Reference.optional(),
    component: z.array(ObservationComponent).optional(),
  })
  .passthrough();
export type Observation = z.infer<typeof Observation>;

registerResource('Observation', Observation);
```

- [ ] **Step 7: Create `packages/fhir/src/resources/bundle.ts`**

```ts
import { z } from 'zod';
import { fhirId } from '../datatypes/primitives';
import { Meta } from '../datatypes/complex';
import { registerResource } from '../registry';

const BundleEntry = z
  .object({
    fullUrl: z.string().optional(),
    resource: z.record(z.unknown()).optional(),
  })
  .passthrough();

export const Bundle = z
  .object({
    resourceType: z.literal('Bundle'),
    id: fhirId.optional(),
    meta: Meta.optional(),
    type: z.enum([
      'document', 'message', 'transaction', 'transaction-response', 'batch', 'batch-response', 'history', 'searchset', 'collection',
    ]),
    total: z.number().int().nonnegative().optional(),
    entry: z.array(BundleEntry).optional(),
  })
  .passthrough();
export type Bundle = z.infer<typeof Bundle>;

registerResource('Bundle', Bundle);
```

- [ ] **Step 8: Run it to verify pass**

Run: `pnpm --filter @openldr/fhir test batch-b`
Expected: PASS (7 tests).

- [ ] **Step 9: Typecheck**

Run: `pnpm --filter @openldr/fhir typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(fhir): Specimen, ServiceRequest, DiagnosticReport, Observation, Bundle (P1-FHIR-2)"
```

---

## Task 5: validate.ts + public surface

**Files:**
- Create: `packages/fhir/src/resources/index.ts`, `packages/fhir/src/validate.ts`, `packages/fhir/src/validate.test.ts`
- Modify: `packages/fhir/src/index.ts` (replace the placeholder stub)

- [ ] **Step 1: Create `packages/fhir/src/resources/index.ts`** (importing each module triggers self-registration)

```ts
export * from './patient';
export * from './organization';
export * from './location';
export * from './specimen';
export * from './service-request';
export * from './diagnostic-report';
export * from './observation';
export * from './bundle';
```

- [ ] **Step 2: Write the failing test `packages/fhir/src/validate.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { validateResource, validateBundleEntries } from './validate';

describe('validateResource', () => {
  it('returns ok for a valid resource', () => {
    const r = validateResource({ resourceType: 'Patient', gender: 'male' });
    expect(r.ok).toBe(true);
  });
  it('returns a not-supported outcome for an unknown resourceType', () => {
    const r = validateResource({ resourceType: 'Practitioner' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.outcome.issue[0].code).toBe('not-supported');
  });
  it('returns a structure outcome when resourceType is missing', () => {
    const r = validateResource({ gender: 'male' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.outcome.issue[0].code).toBe('structure');
  });
  it('returns invalid issues naming the bad field', () => {
    const r = validateResource({ resourceType: 'Observation', code: { text: 'x' } }); // missing status
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.outcome.issue.some((i) => i.expression?.includes('status'))).toBe(true);
  });
});

describe('validateBundleEntries', () => {
  it('validates each entry and flags the bad one by index', () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        { resource: { resourceType: 'Patient', id: 'ok' } },
        { resource: { resourceType: 'Observation', code: { text: 'x' } } }, // missing status
      ],
    };
    const results = validateBundleEntries(bundle);
    expect(results).toHaveLength(2);
    expect(results[0].result.ok).toBe(true);
    expect(results[1].result.ok).toBe(false);
    expect(results[1].entry).toBe(1);
  });
});
```

- [ ] **Step 3: Run it to verify failure**

Run: `pnpm --filter @openldr/fhir test validate`
Expected: FAIL — cannot find module `./validate`.

- [ ] **Step 4: Create `packages/fhir/src/validate.ts`**

```ts
import './resources'; // populate the registry via self-registration side effects
import { getResourceSchema } from './registry';
import {
  type OperationOutcome,
  outcomeFromIssues,
  singleIssueOutcome,
  issuesFromZodError,
} from './operation-outcome';

export interface FhirResource {
  resourceType: string;
  [key: string]: unknown;
}

export type ValidationResult =
  | { ok: true; resource: FhirResource }
  | { ok: false; outcome: OperationOutcome };

export function validateResource(data: unknown): ValidationResult {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, outcome: singleIssueOutcome('error', 'structure', 'resource must be a JSON object') };
  }
  const resourceType = (data as Record<string, unknown>)['resourceType'];
  if (typeof resourceType !== 'string') {
    return { ok: false, outcome: singleIssueOutcome('error', 'structure', 'missing resourceType', ['resourceType']) };
  }
  const schema = getResourceSchema(resourceType);
  if (!schema) {
    return {
      ok: false,
      outcome: singleIssueOutcome('error', 'not-supported', `unsupported resourceType: ${resourceType}`, ['resourceType']),
    };
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, outcome: outcomeFromIssues(issuesFromZodError(parsed.error)) };
  }
  return { ok: true, resource: parsed.data as FhirResource };
}

export function validateBundleEntries(bundle: unknown): { entry: number; result: ValidationResult }[] {
  const entries = (bundle as { entry?: { resource?: unknown }[] } | null)?.entry ?? [];
  return entries.map((e, index) => ({ entry: index, result: validateResource(e?.resource) }));
}
```

- [ ] **Step 5: Run it to verify pass**

Run: `pnpm --filter @openldr/fhir test validate`
Expected: PASS (6 tests).

- [ ] **Step 6: Replace `packages/fhir/src/index.ts`** (was the placeholder MODULE_NAME stub)

```ts
export * from './datatypes';
export * from './resources';
export * from './operation-outcome';
export * from './registry';
export * from './validate';
```

- [ ] **Step 7: Full package test + typecheck**

Run: `pnpm --filter @openldr/fhir test && pnpm --filter @openldr/fhir typecheck`
Expected: all fhir tests pass (datatypes, operation-outcome, registry, batch-a, batch-b, validate); typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(fhir): validateResource + validateBundleEntries + public surface (P1-FHIR-1)"
```

---

## Task 6: CLI `openldr fhir validate <file>`

**Files:**
- Modify: `packages/cli/package.json` (add `@openldr/fhir` dep)
- Create: `packages/cli/src/fhir.ts`, `packages/cli/src/fhir.test.ts`, `packages/cli/src/__fixtures__/valid-patient.json`, `packages/cli/src/__fixtures__/invalid-observation.json`, `packages/cli/src/__fixtures__/bundle-mixed.json`
- Modify: `packages/cli/src/index.ts` (register the `fhir validate` command)

- [ ] **Step 1: Add the dependency in `packages/cli/package.json`** — inside `"dependencies"`, add the `@openldr/fhir` line so the block reads:

```json
  "dependencies": {
    "@openldr/bootstrap": "workspace:*",
    "@openldr/config": "workspace:*",
    "@openldr/core": "workspace:*",
    "@openldr/fhir": "workspace:*",
    "commander": "^12.1.0"
  },
```
Then run: `pnpm install`
Expected: `@openldr/fhir` linked into `@openldr/cli`.

- [ ] **Step 2: Create the fixtures**

`packages/cli/src/__fixtures__/valid-patient.json`:
```json
{ "resourceType": "Patient", "id": "p1", "gender": "female", "birthDate": "1990-05-01", "name": [{ "family": "Doe", "given": ["Jane"] }] }
```

`packages/cli/src/__fixtures__/invalid-observation.json`:
```json
{ "resourceType": "Observation", "code": { "text": "Glucose" } }
```

`packages/cli/src/__fixtures__/bundle-mixed.json`:
```json
{ "resourceType": "Bundle", "type": "collection", "entry": [
  { "resource": { "resourceType": "Patient", "id": "ok" } },
  { "resource": { "resourceType": "Observation", "code": { "text": "x" } } }
] }
```

- [ ] **Step 3: Write the failing test `packages/cli/src/fhir.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { runFhirValidate } from './fhir';

const fixture = (name: string) => fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url));

describe('runFhirValidate', () => {
  it('passes a valid Patient file', () => {
    const out = runFhirValidate(fixture('valid-patient.json'));
    expect(out.allValid).toBe(true);
    expect(out.results[0].valid).toBe(true);
  });
  it('fails an Observation missing status', () => {
    const out = runFhirValidate(fixture('invalid-observation.json'));
    expect(out.allValid).toBe(false);
    expect(out.results[0].valid).toBe(false);
    expect(out.results[0].outcome).toBeDefined();
  });
  it('validates the Bundle envelope and each entry, flagging the bad one', () => {
    const out = runFhirValidate(fixture('bundle-mixed.json'));
    expect(out.allValid).toBe(false);
    const labels = out.results.map((r) => r.label);
    expect(labels).toContain('Bundle'); // envelope row
    expect(labels).toContain('entry[1]');
    const bad = out.results.filter((r) => !r.valid);
    expect(bad).toHaveLength(1);
    expect(bad[0].label).toBe('entry[1]');
  });
});
```

- [ ] **Step 4: Run it to verify failure**

Run: `pnpm --filter @openldr/cli test fhir`
Expected: FAIL — cannot find module `./fhir`.

- [ ] **Step 5: Create `packages/cli/src/fhir.ts`**

```ts
import { readFileSync } from 'node:fs';
import { validateResource, validateBundleEntries, type ValidationResult } from '@openldr/fhir';

export interface FhirValidateRow {
  label: string;
  valid: boolean;
  outcome?: unknown;
}

export interface FhirValidateOutput {
  file: string;
  results: FhirValidateRow[];
  allValid: boolean;
}

function toRow(label: string, result: ValidationResult): FhirValidateRow {
  return result.ok ? { label, valid: true } : { label, valid: false, outcome: result.outcome };
}

export function runFhirValidate(file: string): FhirValidateOutput {
  const data: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const isBundle =
    typeof data === 'object' && data !== null && (data as Record<string, unknown>)['resourceType'] === 'Bundle';

  let results: FhirValidateRow[];
  if (isBundle) {
    // Validate the Bundle envelope itself (e.g. required `type`) then each entry.
    const envelope = toRow('Bundle', validateResource(data));
    const entries = validateBundleEntries(data).map(({ entry, result }) => toRow(`entry[${entry}]`, result));
    results = [envelope, ...entries];
  } else {
    results = [toRow(String((data as Record<string, unknown>)?.['resourceType'] ?? 'resource'), validateResource(data))];
  }

  return { file, results, allValid: results.every((r) => r.valid) };
}

export function formatFhirValidate(out: FhirValidateOutput): string {
  const lines = out.results.map((r) => {
    if (r.valid) return `  ${r.label.padEnd(20)} valid`;
    const issues = (r.outcome as { issue?: { expression?: string[]; diagnostics?: string }[] }).issue ?? [];
    const detail = issues.map((i) => `${(i.expression ?? []).join('.')}: ${i.diagnostics}`).join('; ');
    return `  ${r.label.padEnd(20)} INVALID  ${detail}`;
  });
  return [`${out.file}: ${out.allValid ? 'all valid' : 'invalid'}`, ...lines].join('\n');
}
```

- [ ] **Step 6: Run it to verify pass**

Run: `pnpm --filter @openldr/cli test fhir`
Expected: PASS (3 tests).

- [ ] **Step 7: Replace `packages/cli/src/index.ts`** (adds the `fhir validate` command; keeps the existing `health` command)

```ts
import { Command } from 'commander';
import { loadConfig } from '@openldr/config';
import { createAppContext } from '@openldr/bootstrap';
import { errorMessage } from '@openldr/core';
import { exitCodeFor, formatHealthTable } from './format';
import { runFhirValidate, formatFhirValidate } from './fhir';

const program = new Command();
program.name('openldr').description('OpenLDR CE operator CLI');

program
  .command('health')
  .description('Probe every adapter (auth, blob, eventing, target-store)')
  .option('--json', 'emit machine-readable JSON', false)
  .action(async (opts: { json: boolean }) => {
    let ctx;
    try {
      const cfg = loadConfig();
      ctx = await createAppContext(cfg);
      const result = await ctx.health.runAll();
      if (opts.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        process.stdout.write(formatHealthTable(result) + '\n');
      }
      process.exitCode = exitCodeFor(result);
    } catch (err) {
      if (opts.json) {
        process.stdout.write(JSON.stringify({ status: 'down', error: errorMessage(err) }) + '\n');
      } else {
        process.stderr.write(`health failed: ${errorMessage(err)}\n`);
      }
      process.exitCode = 1;
    } finally {
      await ctx?.close();
    }
  });

const fhir = program.command('fhir').description('FHIR R4 utilities');
fhir
  .command('validate <file>')
  .description('Validate a FHIR R4 resource or Bundle against the CE schemas')
  .option('--json', 'emit OperationOutcome JSON', false)
  .action((file: string, opts: { json: boolean }) => {
    try {
      const out = runFhirValidate(file);
      if (opts.json) {
        process.stdout.write(JSON.stringify(out, null, 2) + '\n');
      } else {
        process.stdout.write(formatFhirValidate(out) + '\n');
      }
      process.exitCode = out.allValid ? 0 : 1;
    } catch (err) {
      if (opts.json) {
        process.stdout.write(JSON.stringify({ error: errorMessage(err) }) + '\n');
      } else {
        process.stderr.write(`fhir validate failed: ${errorMessage(err)}\n`);
      }
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
```

- [ ] **Step 8: Run the CLI test + typecheck + build**

Run: `pnpm --filter @openldr/cli test && pnpm --filter @openldr/cli typecheck && pnpm --filter @openldr/cli build`
Expected: tests pass (format + fhir); typecheck clean; `dist/index.js` produced.

- [ ] **Step 9: Manual acceptance against the fixtures**

Run: `pnpm openldr fhir validate packages/cli/src/__fixtures__/valid-patient.json --json`
Expected: JSON with `"allValid": true`; exit code 0 (`echo $LASTEXITCODE` → 0 in PowerShell).

Run: `pnpm openldr fhir validate packages/cli/src/__fixtures__/bundle-mixed.json`
Expected: human output showing `entry[1]` INVALID naming `status`; exit code 1.

- [ ] **Step 10: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(cli): openldr fhir validate (P1-CLI-1, P1-CLI-2, DP-4)"
```

---

## Task 7: Final gate

- [ ] **Step 1: Full workspace gate**

Run: `pnpm install && pnpm -r typecheck && pnpm -r test && pnpm depcruise && pnpm -r build`
Expected: typecheck clean across all packages; all tests pass; `depcruise` reports no violations (confirms `@openldr/fhir` imports no adapter/app, and `cli → fhir` is allowed); builds succeed.

- [ ] **Step 2: Confirm working tree clean**

Run: `git status --short`
Expected: clean (Task 5 already replaced `packages/fhir/src/index.ts`; the old `MODULE_NAME` export is gone). If anything is uncommitted, investigate and commit it.

---

## Done criteria (maps to spec §9)

- [ ] `@openldr/fhir` exports zod schemas + inferred types for the nine resources and the datatype subset (P1-FHIR-1 model).
- [ ] Resources `.passthrough()` (extensions preserved); required cardinality + bound code sets enforced (verified by batch-a/batch-b tests).
- [ ] Canonical CE resource set present incl. `Specimen.parent` and Observation AST shape (P1-FHIR-2).
- [ ] `validateResource` returns typed resource or spec-valid `OperationOutcome`; registry dispatch; unknown type → `not-supported`.
- [ ] `openldr fhir validate <file> [--json]` validates single resources and Bundles with correct exit codes (P1-CLI-1/2, DP-4).
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm depcruise && pnpm -r build` all green.
