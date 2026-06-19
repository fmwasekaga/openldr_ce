import { describe, expect, it } from 'vitest';
import { lintFormSchema } from './lint';
import { makeField, makeSchema } from './__fixtures__/forms';

describe('lintFormSchema', () => {
  it('reports duplicate field id', () => {
    const form = makeSchema({
      id: 'f',
      name: 'F',
      fields: [
        makeField({ id: 'dup', displayLabel: 'Dup 1', fieldType: 'text', order: 0 }),
        makeField({ id: 'dup', displayLabel: 'Dup 2', fieldType: 'text', order: 1 }),
      ],
    });

    const issues = lintFormSchema(form);
    expect(issues.some((i) => i.code === 'duplicate-id' && i.fieldId === 'dup')).toBe(true);
  });

  it('reports dangling visibility — condition references a fieldId that does not exist', () => {
    const form = makeSchema({
      id: 'f',
      name: 'F',
      fields: [
        makeField({
          id: 'q1',
          displayLabel: 'Q1',
          fieldType: 'text',
          order: 0,
          visibility: { combinator: 'all', conditions: [{ fieldId: 'ghost', operator: 'equals', value: 'x' }] },
        }),
      ],
    });

    const issues = lintFormSchema(form);
    const issue = issues.find((i) => i.code === 'visibility-missing-field');
    expect(issue).toBeDefined();
    expect(issue?.fieldId).toBe('q1');
  });

  it('reports select/multiselect with neither valueSetOptions nor valueSetUrl', () => {
    const form = makeSchema({
      id: 'f',
      name: 'F',
      fields: [
        makeField({ id: 's1', displayLabel: 'Pick one', fieldType: 'select', order: 0 }),
        makeField({ id: 's2', displayLabel: 'Pick many', fieldType: 'multiselect', order: 1 }),
      ],
    });

    const issues = lintFormSchema(form);
    const codes = issues.map((i) => i.code);
    expect(codes.filter((c) => c === 'choice-missing-options').length).toBe(2);
  });

  it('does NOT report select backed by valueSetOptions', () => {
    const form = makeSchema({
      id: 'f',
      name: 'F',
      fields: [
        makeField({
          id: 's1',
          displayLabel: 'Pick one',
          fieldType: 'select',
          order: 0,
          valueSetOptions: [{ code: 'a', display: 'A' }],
        }),
      ],
    });

    expect(lintFormSchema(form).some((i) => i.code === 'choice-missing-options')).toBe(false);
  });

  it('does NOT report select backed by valueSetUrl', () => {
    const form = makeSchema({
      id: 'f',
      name: 'F',
      fields: [
        makeField({
          id: 's1',
          displayLabel: 'Pick one',
          fieldType: 'select',
          order: 0,
          valueSetUrl: 'urn:test:organisms',
        }),
      ],
    });

    expect(lintFormSchema(form).some((i) => i.code === 'choice-missing-options')).toBe(false);
  });

  it('reports groupId referencing a non-existent group-type field', () => {
    const form = makeSchema({
      id: 'f',
      name: 'F',
      fields: [
        makeField({ id: 'q1', displayLabel: 'Q1', fieldType: 'text', order: 0, groupId: 'missing-group' }),
      ],
    });

    const issues = lintFormSchema(form);
    expect(issues.some((i) => i.code === 'dangling-group-id' && i.fieldId === 'q1')).toBe(true);
  });

  it('does NOT report groupId when the group field exists', () => {
    const form = makeSchema({
      id: 'f',
      name: 'F',
      fields: [
        makeField({ id: 'grp', displayLabel: 'Group', fieldType: 'group', order: 0 }),
        makeField({ id: 'q1', displayLabel: 'Q1', fieldType: 'text', order: 1, groupId: 'grp' }),
      ],
    });

    expect(lintFormSchema(form).some((i) => i.code === 'dangling-group-id')).toBe(false);
  });

  it('surfaces target-contract violations as issues', () => {
    // users page requires firstName, lastName, email, roles
    const form = makeSchema({
      id: 'f',
      name: 'F',
      targetPages: ['users'],
      fields: [
        // only supply email — firstName, lastName, roles are missing
        makeField({ id: 'q1', displayLabel: 'Email', fieldType: 'email', order: 0, apiProperty: 'email' }),
      ],
    });

    const issues = lintFormSchema(form);
    const contractIssue = issues.find((i) => i.code === 'target-contract-violation');
    expect(contractIssue).toBeDefined();
    expect(contractIssue?.severity).toBe('error');
  });

  it('returns empty array for a clean form', () => {
    const form = makeSchema({
      id: 'f',
      name: 'F',
      fields: [
        makeField({ id: 'q1', displayLabel: 'Q1', fieldType: 'text', order: 0 }),
      ],
    });

    expect(lintFormSchema(form)).toEqual([]);
  });
});
