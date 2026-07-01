// In-memory access-token holder. SP1b's login flow will call setAccessToken().
// Until then it stays null and the server's AUTH_DEV_BYPASS provides the actor.
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}
