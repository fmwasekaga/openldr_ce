// Mask "user:password@host" credentials so secrets never reach logs/health detail (P1-NFR-2).
export function redact(text: string): string {
  return text.replace(/(\b[\w.-]+:)[^@\s/]+(@)/g, '$1***$2');
}
