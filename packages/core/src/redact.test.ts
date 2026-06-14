import { describe, it, expect } from 'vitest';
import { redact, makeRedactor } from './redact';

describe('redact', () => {
  it('masks credentials in connection strings', () => {
    expect(redact('postgres://user:s3cret@db:5432/x')).toBe('postgres://user:***@db:5432/x');
  });
  it('leaves plain text untouched', () => {
    expect(redact('connection refused')).toBe('connection refused');
  });
  it('masks passwords that contain a slash', () => {
    expect(redact('postgres://user:pa/ss@db/x')).toBe('postgres://user:***@db/x');
  });
  it('does not mask a bare host:port', () => {
    expect(redact('connect to localhost:5432 failed')).toBe('connect to localhost:5432 failed');
  });
  it('masks a Basic Authorization header value', () => {
    expect(redact('Authorization: Basic dXNlcjpwYXNz')).toBe('Authorization: Basic ***');
  });
  it('masks a Bearer Authorization header value', () => {
    expect(redact('failed with Authorization: Bearer eyJabc.def.ghi here')).toBe('failed with Authorization: Bearer *** here');
  });
  it('masks password= in a connection string', () => {
    expect(redact('Server=db;Database=x;User Id=sa;Password=S3cret!;Encrypt=false')).toBe('Server=db;Database=x;User Id=sa;Password=***;Encrypt=false');
  });
  it('masks pwd= case-insensitively', () => {
    expect(redact('host=db pwd=hunter2 sslmode=require')).toBe('host=db pwd=*** sslmode=require');
  });
  it('masks multiple URLs in one string', () => {
    expect(redact('a postgres://u1:p1@h1/x and mssql://u2:p2@h2/y')).toBe('a postgres://u1:***@h1/x and mssql://u2:***@h2/y');
  });
});

describe('makeRedactor', () => {
  it('masks a literal secret value anywhere in a string', () => {
    const r = makeRedactor(['hunter2']);
    expect(r('tedious: login failed for password hunter2 at host')).toBe('tedious: login failed for password *** at host');
  });
  it('is a no-op when given only empty secrets', () => {
    const r = makeRedactor(['', '   ']);
    expect(r('nothing to mask')).toBe('nothing to mask');
  });
  it('escapes regex metacharacters in secrets', () => {
    const r = makeRedactor(['a.b*c']);
    expect(r('x a.b*c y axbxc')).toBe('x *** y axbxc');
  });
  it('masks the longer secret first when one contains another', () => {
    const r = makeRedactor(['pass', 'password123']);
    expect(r('password123')).toBe('***');
  });
});
