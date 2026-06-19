import { describe, expect, it } from 'vitest';
import type { FormField, FormSchema, FormSection, VisibilityRule } from './schema/form-schema';
import {
  evaluateCondition,
  evaluateVisibility,
  isRuleSatisfied,
  isSectionVisible,
  toEnableWhen,
  visibleFieldIds,
} from './visibility';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const field = (over: Partial<FormField> = {}): FormField => ({
  id: 'f',
  fhirPath: null,
  displayLabel: 'F',
  description: null,
  fieldType: 'text',
  required: false,
  enabled: true,
  order: 0,
  cardinality: { min: 0, max: '1' },
  ...over,
});

const section = (over: Partial<FormSection> = {}): FormSection => ({
  id: 'sec',
  label: 'Sec',
  order: 0,
  ...over,
});

const schema = (fields: FormField[], sections: FormSection[] = []): FormSchema => ({
  id: 's',
  name: 'S',
  versionLabel: null,
  fhirVersion: 'R4',
  fhirResourceType: 'Patient',
  fhirProfileUrl: null,
  facilityId: null,
  fields,
  sections,
  targetPages: [],
  version: 1,
  active: true,
  status: 'published',
  createdAt: '',
  updatedAt: '',
});

// ---------------------------------------------------------------------------
// evaluateCondition
// ---------------------------------------------------------------------------

describe('evaluateCondition', () => {
  it('equals / notEquals on a scalar', () => {
    expect(evaluateCondition({ fieldId: 'x', operator: 'equals', value: 'female' }, { x: 'female' })).toBe(true);
    expect(evaluateCondition({ fieldId: 'x', operator: 'equals', value: 'female' }, { x: 'male' })).toBe(false);
    expect(evaluateCondition({ fieldId: 'x', operator: 'notEquals', value: 'female' }, { x: 'male' })).toBe(true);
  });

  it('equals on a multiselect array means "contains"', () => {
    expect(evaluateCondition({ fieldId: 'x', operator: 'equals', value: 'b' }, { x: ['a', 'b'] })).toBe(true);
    expect(evaluateCondition({ fieldId: 'x', operator: 'notEquals', value: 'c' }, { x: ['a', 'b'] })).toBe(true);
  });

  it('oneOf splits a comma list (scalar and array)', () => {
    expect(evaluateCondition({ fieldId: 'x', operator: 'oneOf', value: 'a, b ,c' }, { x: 'b' })).toBe(true);
    expect(evaluateCondition({ fieldId: 'x', operator: 'oneOf', value: 'a,b' }, { x: ['z', 'a'] })).toBe(true);
    expect(evaluateCondition({ fieldId: 'x', operator: 'oneOf', value: 'a,b' }, { x: 'z' })).toBe(false);
  });

  it('isEmpty / isNotEmpty treat undefined, \'\', [] as empty', () => {
    expect(evaluateCondition({ fieldId: 'x', operator: 'isEmpty' }, {})).toBe(true);
    expect(evaluateCondition({ fieldId: 'x', operator: 'isEmpty' }, { x: '' })).toBe(true);
    expect(evaluateCondition({ fieldId: 'x', operator: 'isEmpty' }, { x: [] })).toBe(true);
    expect(evaluateCondition({ fieldId: 'x', operator: 'isNotEmpty' }, { x: 'v' })).toBe(true);
    expect(evaluateCondition({ fieldId: 'x', operator: 'isNotEmpty' }, { x: 0 })).toBe(true);
  });

  it('numeric operators coerce via Number, NaN → false', () => {
    expect(evaluateCondition({ fieldId: 'x', operator: 'gt', value: '5' }, { x: 6 })).toBe(true);
    expect(evaluateCondition({ fieldId: 'x', operator: 'lte', value: '5' }, { x: 5 })).toBe(true);
    expect(evaluateCondition({ fieldId: 'x', operator: 'gte', value: '5' }, { x: '5' })).toBe(true);
    expect(evaluateCondition({ fieldId: 'x', operator: 'gt', value: 'n/a' }, { x: 6 })).toBe(false);
    expect(evaluateCondition({ fieldId: 'x', operator: 'lt', value: '5' }, { x: 'abc' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isRuleSatisfied / evaluateVisibility (alias)
// ---------------------------------------------------------------------------

describe('isRuleSatisfied', () => {
  it('undefined or empty rule → visible', () => {
    expect(isRuleSatisfied(undefined, {})).toBe(true);
    expect(isRuleSatisfied({ combinator: 'all', conditions: [] }, {})).toBe(true);
  });

  it('"all" requires every condition; "any" requires some', () => {
    const all: VisibilityRule = {
      combinator: 'all',
      conditions: [
        { fieldId: 'a', operator: 'equals', value: '1' },
        { fieldId: 'b', operator: 'equals', value: '2' },
      ],
    };
    expect(isRuleSatisfied(all, { a: '1', b: '2' })).toBe(true);
    expect(isRuleSatisfied(all, { a: '1', b: '9' })).toBe(false);
    const any: VisibilityRule = { ...all, combinator: 'any' };
    expect(isRuleSatisfied(any, { a: '1', b: '9' })).toBe(true);
    expect(isRuleSatisfied(any, { a: '9', b: '9' })).toBe(false);
  });
});

describe('evaluateVisibility', () => {
  it('is an alias for isRuleSatisfied', () => {
    const rule: VisibilityRule = { combinator: 'all', conditions: [{ fieldId: 'x', operator: 'equals', value: '1' }] };
    expect(evaluateVisibility(rule, { x: '1' })).toBe(true);
    expect(evaluateVisibility(rule, { x: '2' })).toBe(false);
    expect(evaluateVisibility(undefined, {})).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// visibleFieldIds + isSectionVisible
// ---------------------------------------------------------------------------

describe('visibleFieldIds + isSectionVisible', () => {
  it('hides a field when its own rule fails', () => {
    const s = schema([
      field({ id: 'sex' }),
      field({ id: 'preg', visibility: { combinator: 'all', conditions: [{ fieldId: 'sex', operator: 'equals', value: 'female' }] } }),
    ]);
    expect([...visibleFieldIds(s, { sex: 'male' })]).toEqual(['sex']);
    expect([...visibleFieldIds(s, { sex: 'female' })].sort()).toEqual(['preg', 'sex']);
  });

  it('hides every field in a section whose rule fails', () => {
    const sec = section({ id: 'sec', visibility: { combinator: 'all', conditions: [{ fieldId: 'flag', operator: 'equals', value: 'on' }] } });
    const s = schema([field({ id: 'flag' }), field({ id: 'child', section: 'sec' })], [sec]);
    expect(isSectionVisible(sec, { flag: 'off' })).toBe(false);
    expect(visibleFieldIds(s, { flag: 'off' }).has('child')).toBe(false);
    expect(visibleFieldIds(s, { flag: 'on' }).has('child')).toBe(true);
  });

  it('does not infinite-loop on a self/cyclic reference (reads stored value once)', () => {
    const s = schema([
      field({ id: 'a', visibility: { combinator: 'all', conditions: [{ fieldId: 'b', operator: 'isNotEmpty' }] } }),
      field({ id: 'b', visibility: { combinator: 'all', conditions: [{ fieldId: 'a', operator: 'isNotEmpty' }] } }),
    ]);
    expect(visibleFieldIds(s, {}).size).toBe(0);
    expect(visibleFieldIds(s, { a: 'x', b: 'y' }).size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// toEnableWhen — FHIR enableWhen mapping
// ---------------------------------------------------------------------------

describe('toEnableWhen', () => {
  it('maps an "all" equals rule to enableWhen entries + derivable enableBehavior', () => {
    const rule: VisibilityRule = {
      combinator: 'all',
      conditions: [{ fieldId: 'ctrl', operator: 'equals', value: 'yes' }],
    };
    const items = toEnableWhen(rule);
    expect(items).toEqual([{ question: 'ctrl', operator: '=', answerString: 'yes' }]);
    // combinator 'all' → enableBehavior 'all'
    expect(rule.combinator).toBe('all');
  });

  it('maps isNotEmpty to an exists=true check', () => {
    const rule: VisibilityRule = {
      combinator: 'any',
      conditions: [{ fieldId: 'ctrl', operator: 'isNotEmpty' }],
    };
    expect(toEnableWhen(rule)).toEqual([{ question: 'ctrl', operator: 'exists', answerBoolean: true }]);
  });

  it('maps isEmpty to an exists=false check', () => {
    const rule: VisibilityRule = {
      combinator: 'all',
      conditions: [{ fieldId: 'ctrl', operator: 'isEmpty' }],
    };
    expect(toEnableWhen(rule)).toEqual([{ question: 'ctrl', operator: 'exists', answerBoolean: false }]);
  });

  it('maps numeric gt to a decimal comparison', () => {
    const rule: VisibilityRule = {
      combinator: 'all',
      conditions: [{ fieldId: 'ctrl', operator: 'gt', value: '5' }],
    };
    expect(toEnableWhen(rule)).toEqual([{ question: 'ctrl', operator: '>', answerDecimal: 5 }]);
  });

  it('skips oneOf (no structural R4 equivalent) — omits it from the array', () => {
    const rule: VisibilityRule = {
      combinator: 'any',
      conditions: [
        { fieldId: 'ctrl', operator: 'oneOf', value: 'a,b,c' },
        { fieldId: 'ctrl', operator: 'gt', value: '10' },
      ],
    };
    const items = toEnableWhen(rule);
    // oneOf is skipped; gt maps to >
    expect(items).toEqual([{ question: 'ctrl', operator: '>', answerDecimal: 10 }]);
  });

  it('yields a QuestionnaireItemEnableWhen[] with enableBehavior derived from combinator', () => {
    const rule: VisibilityRule = {
      combinator: 'any',
      conditions: [
        { fieldId: 'a', operator: 'equals', value: 'x' },
        { fieldId: 'b', operator: 'notEquals', value: 'y' },
      ],
    };
    const items = toEnableWhen(rule);
    // Both conditions map to structural R4 entries
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ question: 'a', operator: '=', answerString: 'x' });
    expect(items[1]).toEqual({ question: 'b', operator: '!=', answerString: 'y' });
    // combinator 'any' → enableBehavior should be 'any'
    expect(rule.combinator).toBe('any');
  });
});
