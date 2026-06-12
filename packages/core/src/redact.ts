// Mask the password in URL userinfo (scheme://user:password@host) so secrets
// never reach logs/health detail (P1-NFR-2).
export function redact(text: string): string {
  return text.replace(/(\/\/[^\s:@/]+:)[^\s@]+(@)/g, '$1***$2');
}
