import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_MSSQL_VERSIONS,
  MIN_SUPPORTED_MSSQL_MAJOR,
  isSupportedMssqlVersion,
  demoMssqlImage,
} from './supported-versions';

describe('supported MSSQL versions', () => {
  it('supports exactly 2017, 2019, 2022 (self-hosted only)', () => {
    expect(SUPPORTED_MSSQL_VERSIONS.map((v) => v.major).sort((a, b) => a - b)).toEqual([2017, 2019, 2022]);
  });

  it('floors at 2017', () => {
    expect(MIN_SUPPORTED_MSSQL_MAJOR).toBe(2017);
  });

  it('rejects 2014 and 2016 (no Linux container / EOL)', () => {
    expect(isSupportedMssqlVersion(2014)).toBe(false);
    expect(isSupportedMssqlVersion(2016)).toBe(false);
  });

  it('accepts each supported major', () => {
    for (const major of [2017, 2019, 2022]) {
      expect(isSupportedMssqlVersion(major)).toBe(true);
    }
  });

  it('has exactly one demo-default version, pinned to 2022', () => {
    const demos = SUPPORTED_MSSQL_VERSIONS.filter((v) => v.demoDefault);
    expect(demos).toHaveLength(1);
    expect(demos[0].major).toBe(2022);
    expect(demoMssqlImage()).toBe('mcr.microsoft.com/mssql/server:2022-latest');
  });

  it('every version has an official mcr Linux image tag', () => {
    for (const v of SUPPORTED_MSSQL_VERSIONS) {
      expect(v.image).toBe(`mcr.microsoft.com/mssql/server:${v.major}-latest`);
    }
  });

  it('rejects a not-yet-supported future major', () => {
    expect(isSupportedMssqlVersion(2025)).toBe(false);
  });

  it('MIN_SUPPORTED_MSSQL_MAJOR is derived from the supported set', () => {
    expect(MIN_SUPPORTED_MSSQL_MAJOR).toBe(Math.min(...SUPPORTED_MSSQL_VERSIONS.map((v) => v.major)));
  });
});
