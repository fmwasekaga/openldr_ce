/** Merge `updates` (key→value) into an existing .env text. Existing keys are replaced in
 *  place; unknown keys/comments/blank lines are preserved; new keys are appended. */
export function mergeEnv(existingText, updates) {
  const remaining = new Map(Object.entries(updates));
  const lines = (existingText ? existingText.split('\n') : []).map((line) => {
    const m = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (m && remaining.has(m[2])) {
      const v = remaining.get(m[2]); remaining.delete(m[2]);
      return `${m[1]}${m[2]}=${v}`;
    }
    return line;
  });
  const appended = [...remaining.entries()].map(([k, v]) => `${k}=${v}`);
  const body = lines.join('\n').replace(/\n*$/, '');
  return (appended.length ? `${body}\n${appended.join('\n')}` : body) + '\n';
}
