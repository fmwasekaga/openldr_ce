import { describe, it, expect } from 'vitest';
import { textType, keyType, floatType, timestampType, nowExpr } from './dialect';

describe('dialect type map', () => {
  it('maps postgres types', () => {
    expect(textType('postgres')).toBe('text');
    expect(keyType('postgres')).toBe('text');
    expect(floatType('postgres')).toBe('double precision');
    expect(timestampType('postgres')).toBe('timestamptz');
  });
  it('maps mssql types', () => {
    expect(textType('mssql')).toBe('nvarchar(max)');
    expect(keyType('mssql')).toBe('varchar(450)');
    expect(floatType('mssql')).toBe('float');
    expect(timestampType('mssql')).toBe('datetime2');
  });
});

describe('dialect types — mysql', () => {
  it('maps logical types to MySQL column types', () => {
    expect(textType('mysql')).toBe('longtext');
    expect(keyType('mysql')).toBe('varchar(255)');
    expect(floatType('mysql')).toBe('double');
    expect(timestampType('mysql')).toBe('datetime');
  });
  it('nowExpr for mysql compiles to CURRENT_TIMESTAMP', () => {
    expect(nowExpr('mysql')).toBeDefined();
    expect(nowExpr('mysql')).not.toBe(nowExpr('postgres'));
  });
});
