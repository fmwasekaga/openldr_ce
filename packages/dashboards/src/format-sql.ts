// Read-only SQL display formatting: inline a compiled query's bound parameters into its
// placeholders so the text is legible for a human (the Builder→SQL eject flow). This is NEVER
// executed — it exists purely to seed the CodeMirror editor with readable SQL text.
function quoteLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return `'${v.toISOString()}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * Substitute a compiled query's `?` / `$n` / `@n` placeholders (Kysely's sqlite/mysql, postgres,
 * and mssql placeholder styles, respectively) with quoted literals from `parameters`, in order.
 */
export function formatSql(sqlText: string, parameters: readonly unknown[]): string {
  if (parameters.length === 0) return sqlText;
  if (sqlText.includes('?')) {
    let i = 0;
    return sqlText.replace(/\?/g, () => quoteLiteral(parameters[i++]));
  }
  return sqlText.replace(/[$@](\d+)/g, (_, n: string) => quoteLiteral(parameters[Number(n) - 1]));
}
