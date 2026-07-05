import { describe, it, expect } from 'vitest';
import { AppError, CATALOG, DOMAINS, appError, catalogFor, domainForPrefix, codeForUnknown } from './error-catalog';
import { ZodError } from 'zod';

describe('error catalog', () => {
  it('every code is well-formed and unique', () => {
    const codes = Object.keys(CATALOG);
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z]{2,4}\d{4}$/);
      expect(CATALOG[code].code).toBe(code); // entry self-consistent
      expect(CATALOG[code].httpStatus).toBeGreaterThanOrEqual(400);
    }
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('every code prefix maps to a known domain', () => {
    for (const entry of Object.values(CATALOG)) {
      const prefix = entry.code.replace(/\d+$/, '');
      expect(DOMAINS[prefix], `prefix ${prefix} missing from DOMAINS`).toBeDefined();
      expect(entry.domain).toBe(DOMAINS[prefix]);
    }
  });

  it('appError builds an AppError from the catalog', () => {
    const err = appError('RP0001');
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('RP0001');
    expect(err.httpStatus).toBe(400);
    expect(err.message).toBe(CATALOG.RP0001.message);
  });

  it('appError message override keeps the code', () => {
    const err = appError('FM0003', { message: 'field "patientId" is required' });
    expect(err.code).toBe('FM0003');
    expect(err.message).toBe('field "patientId" is required');
  });

  it('appError carries cause and details through', () => {
    const cause = new Error('io');
    const err = appError('RP0003', { cause, details: { id: 'x' } });
    expect(err.cause).toBe(cause);
    expect(err.details).toEqual({ id: 'x' });
  });

  it('appError throws for an unknown code (programmer error)', () => {
    expect(() => appError('ZZ9999')).toThrow(/unknown error code/i);
  });

  it('catalogFor lists a domain by prefix', () => {
    const reports = catalogFor('RP');
    expect(reports.every((e) => e.code.startsWith('RP'))).toBe(true);
    expect(reports.length).toBeGreaterThanOrEqual(4);
  });

  it('domainForPrefix maps known prefixes', () => {
    expect(domainForPrefix('RP')).toBe('reports');
    expect(domainForPrefix('ZZ')).toBeUndefined();
  });

  it('codeForUnknown classifies raw errors to SY codes', () => {
    expect(codeForUnknown(new ZodError([]))).toBe('SY0400');
    expect(codeForUnknown(new Error('connect ECONNREFUSED 127.0.0.1:5432'))).toBe('SY0503');
    expect(codeForUnknown(new Error('boom'))).toBe('SY0500');
  });

  it('codeForUnknown does not false-positive on connect-substring words', () => {
    expect(codeForUnknown(new Error('reconnect attempt failed'))).toBe('SY0500');
    expect(codeForUnknown(new Error('connection refused'))).toBe('SY0503');
  });

  it('has the RP0005 pdf-only code', () => {
    expect(CATALOG.RP0005.domain).toBe('reports');
    expect(CATALOG.RP0005.httpStatus).toBe(400);
  });
});
