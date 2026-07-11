import { describe, it, expect } from 'vitest';
import { SUPPORTED_MYSQL_VERSIONS, isSupportedMysqlEngine, demoMysqlImage } from './supported-versions';

describe('supported mysql/mariadb engines', () => {
  it('lists MySQL 8.4 and MariaDB 11.4', () => {
    const keys = SUPPORTED_MYSQL_VERSIONS.map((v) => `${v.engine} ${v.version}`);
    expect(keys).toContain('mysql 8.4');
    expect(keys).toContain('mariadb 11.4');
  });
  it('recognises supported engine/version pairs', () => {
    expect(isSupportedMysqlEngine('mysql', '8.4')).toBe(true);
    expect(isSupportedMysqlEngine('mariadb', '11.4')).toBe(true);
    expect(isSupportedMysqlEngine('mysql', '5.7')).toBe(false);
  });
  it('requires BOTH engine and version to match (no cross-axis mixing)', () => {
    expect(isSupportedMysqlEngine('mariadb', '8.4')).toBe(false);  // right version, wrong engine
    expect(isSupportedMysqlEngine('mysql', '11.4')).toBe(false);   // right engine, wrong version
  });
  it('exposes exactly one demo image (MySQL 8.4)', () => {
    expect(demoMysqlImage()).toBe('mysql:8.4');
  });
});
