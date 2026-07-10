// Single source of truth for which self-hosted SQL Server versions OpenLDR CE validates and
// supports as an external/analytics target. Cloud SQL (Azure SQL Database / Managed Instance,
// AWS RDS, any hosted service) is NEVER supported — a data-sovereignty requirement, not a gap.

export interface MssqlVersion {
  /** Marketing major year, e.g. 2017. */
  readonly major: number;
  /** Official Microsoft Linux container image for the acceptance matrix. */
  readonly image: string;
  /** The single version used for the non-production managed demo container. */
  readonly demoDefault: boolean;
}

/** Supported, self-hosted only. Ordered oldest → newest. */
export const SUPPORTED_MSSQL_VERSIONS: readonly MssqlVersion[] = [
  { major: 2017, image: 'mcr.microsoft.com/mssql/server:2017-latest', demoDefault: false },
  { major: 2019, image: 'mcr.microsoft.com/mssql/server:2019-latest', demoDefault: false },
  { major: 2022, image: 'mcr.microsoft.com/mssql/server:2022-latest', demoDefault: true },
];

/** Lowest supported major. Operators on 2014/2016 upgrade to this. */
export const MIN_SUPPORTED_MSSQL_MAJOR = Math.min(...SUPPORTED_MSSQL_VERSIONS.map((v) => v.major));

export function isSupportedMssqlVersion(major: number): boolean {
  return SUPPORTED_MSSQL_VERSIONS.some((v) => v.major === major);
}

/** Image for the pinned non-production managed demo container. */
export function demoMssqlImage(): string {
  const demos = SUPPORTED_MSSQL_VERSIONS.filter((v) => v.demoDefault);
  if (demos.length !== 1) {
    throw new Error(`expected exactly one demo-default MSSQL version, found ${demos.length}`);
  }
  return demos[0].image;
}
