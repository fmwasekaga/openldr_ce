// Single source of truth for which self-hosted MySQL/MariaDB engines OpenLDR CE validates and
// supports as an external/analytics target. Cloud/hosted MySQL (RDS/Aurora, Azure Database for
// MySQL, Cloud SQL, PlanetScale) is NEVER supported — a data-sovereignty requirement, not a gap.

export interface MysqlEngineVersion {
  readonly engine: 'mysql' | 'mariadb';
  readonly version: string;
  readonly image: string;
  readonly demoDefault: boolean;
}

export const SUPPORTED_MYSQL_VERSIONS: readonly MysqlEngineVersion[] = [
  { engine: 'mysql', version: '8.4', image: 'mysql:8.4', demoDefault: true },
  { engine: 'mariadb', version: '11.4', image: 'mariadb:11.4', demoDefault: false },
];

export function isSupportedMysqlEngine(engine: string, version: string): boolean {
  return SUPPORTED_MYSQL_VERSIONS.some((v) => v.engine === engine && v.version === version);
}

export function demoMysqlImage(): string {
  const demos = SUPPORTED_MYSQL_VERSIONS.filter((v) => v.demoDefault);
  if (demos.length !== 1) {
    throw new Error(`expected exactly one demo-default MySQL engine, found ${demos.length}`);
  }
  return demos[0].image;
}
