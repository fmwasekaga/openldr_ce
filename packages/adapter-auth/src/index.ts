import { probe } from '@openldr/core';
import type { AuthPort, TokenClaims } from '@openldr/ports';

export interface AuthConfig {
  issuerUrl: string;
}

export interface AuthDeps {
  fetchFn?: typeof fetch;
}

export function createAuth(cfg: AuthConfig, deps: AuthDeps = {}): AuthPort {
  const fetchFn = deps.fetchFn ?? fetch;
  const discoveryUrl = `${cfg.issuerUrl}/.well-known/openid-configuration`;

  return {
    async healthCheck() {
      return probe(async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        try {
          const res = await fetchFn(discoveryUrl, { signal: controller.signal });
          if (!res.ok) throw new Error(`OIDC discovery returned ${res.status}`);
          return 'OIDC issuer reachable';
        } finally {
          clearTimeout(timer);
        }
      });
    },
    async verifyToken(_token: string): Promise<TokenClaims> {
      throw new Error('auth.verifyToken not implemented in the skeleton');
    },
  };
}
