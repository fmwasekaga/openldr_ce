import type { QuestionnaireItemEnableWhen } from 'fhir/r4';
import type {
  FormField,
  FormSchema,
  FormSection,
  VisibilityCondition,
  VisibilityRule,
} from './schema/form-schema';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** A value counts as empty for visibility purposes. */
function isEmptyValue(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

// ---------------------------------------------------------------------------
// Runtime evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluate a single condition against the current values snapshot. Reads the
 * controlling field's value directly — independent of whether that controller
 * is itself currently visible.
 */
export function evaluateCondition(
  cond: VisibilityCondition,
  values: Record<string, unknown>,
): boolean {
  const actual = values[cond.fieldId];
  const target = String(cond.value ?? '');

  switch (cond.operator) {
    case 'isEmpty':
      return isEmptyValue(actual);
    case 'isNotEmpty':
      return !isEmptyValue(actual);
    case 'equals':
      return Array.isArray(actual)
        ? actual.map(String).includes(target)
        : String(actual ?? '') === target;
    case 'notEquals':
      return Array.isArray(actual)
        ? !actual.map(String).includes(target)
        : String(actual ?? '') !== target;
    case 'oneOf': {
      const list = target
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      return Array.isArray(actual)
        ? actual.map(String).some((a) => list.includes(a))
        : list.includes(String(actual ?? ''));
    }
    case 'gt':
    case 'lt':
    case 'gte':
    case 'lte': {
      const a = Number(actual);
      const b = Number(cond.value);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      if (cond.operator === 'gt') return a > b;
      if (cond.operator === 'lt') return a < b;
      if (cond.operator === 'gte') return a >= b;
      return a <= b;
    }
    default:
      return true;
  }
}

/** Undefined or empty rule → visible. 'all' → every condition; 'any' → some condition. */
export function isRuleSatisfied(
  rule: VisibilityRule | undefined,
  values: Record<string, unknown>,
): boolean {
  if (!rule || rule.conditions.length === 0) return true;
  return rule.combinator === 'any'
    ? rule.conditions.some((c) => evaluateCondition(c, values))
    : rule.conditions.every((c) => evaluateCondition(c, values));
}

/**
 * Named alias for `isRuleSatisfied`, intended for call sites that work with a
 * single rule (e.g. the web capture runtime at Task 18).
 */
export function evaluateVisibility(
  rule: VisibilityRule | undefined,
  answers: Record<string, unknown>,
): boolean {
  return isRuleSatisfied(rule, answers);
}

/** Whether a section's own visibility rule is satisfied. */
export function isSectionVisible(
  section: FormSection,
  values: Record<string, unknown>,
): boolean {
  return isRuleSatisfied(section.visibility, values);
}

/**
 * The set of field ids that should be visible for the given values. A field is
 * visible iff its own rule is satisfied AND (it has no section OR its section's
 * rule is satisfied). No recursion — each condition just reads a stored value,
 * so reference cycles cannot loop.
 */
export function visibleFieldIds(
  schema: FormSchema,
  values: Record<string, unknown>,
): Set<string> {
  const sectionsById = new Map(schema.sections.map((s) => [s.id, s]));
  const result = new Set<string>();
  for (const f of schema.fields) {
    if (!isRuleSatisfied(f.visibility, values)) continue;
    if (f.section) {
      const sec = sectionsById.get(f.section);
      if (sec && !isRuleSatisfied(sec.visibility, values)) continue;
    }
    result.add(f.id);
  }
  return result;
}

// ---------------------------------------------------------------------------
// FHIR enableWhen mapping (ported from Corlix visibilityMap.ts)
// ---------------------------------------------------------------------------

type EnableWhen = QuestionnaireItemEnableWhen;
type Comparator = '=' | '!=' | '>' | '<' | '>=' | '<=';

const OP_TO_FHIR: Partial<Record<VisibilityCondition['operator'], Comparator>> = {
  equals: '=',
  notEquals: '!=',
  gt: '>',
  lt: '<',
  gte: '>=',
  lte: '<=',
};

const NUMERIC = new Set<VisibilityCondition['operator']>(['gt', 'lt', 'gte', 'lte']);

/**
 * Native (portable) enableWhen entries for a rule. `oneOf` has no structural
 * R4 equivalent and is skipped here — the exact rule should be preserved in a
 * Corlix visibility extension if full round-trip fidelity is needed.
 *
 * The combinator ('all'|'any') maps directly to FHIR `enableBehavior` — callers
 * that emit a `QuestionnaireItem` should set `enableBehavior = rule.combinator`.
 */
export function toEnableWhen(rule: VisibilityRule): EnableWhen[] {
  const out: EnableWhen[] = [];
  for (const condition of rule.conditions) {
    if (condition.operator === 'isEmpty') {
      out.push({ question: condition.fieldId, operator: 'exists', answerBoolean: false });
      continue;
    }
    if (condition.operator === 'isNotEmpty') {
      out.push({ question: condition.fieldId, operator: 'exists', answerBoolean: true });
      continue;
    }
    const op = OP_TO_FHIR[condition.operator];
    if (!op) continue; // oneOf — no structural R4 equivalent
    if (NUMERIC.has(condition.operator)) {
      out.push({ question: condition.fieldId, operator: op, answerDecimal: Number(condition.value) });
    } else {
      out.push({ question: condition.fieldId, operator: op, answerString: condition.value ?? '' });
    }
  }
  return out;
}
