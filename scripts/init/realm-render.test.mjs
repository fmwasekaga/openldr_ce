import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { renderRealm } from './realm-render.mjs';

describe('renderRealm', () => {
  it('substitutes every ${PUBLIC_ORIGIN} with the given origin', () => {
    const tpl = '{"clients":[{"redirectUris":["${PUBLIC_ORIGIN}/studio/*"],"webOrigins":["${PUBLIC_ORIGIN}"]}]}';
    const out = renderRealm(tpl, 'https://lab.example.org');
    const parsed = JSON.parse(out);
    expect(parsed.clients[0].redirectUris).toEqual(['https://lab.example.org/studio/*']);
    expect(parsed.clients[0].webOrigins).toEqual(['https://lab.example.org']);
    expect(out).not.toContain('${PUBLIC_ORIGIN}');
  });
  it('renders the real realm template to valid JSON with the origin applied', () => {
    const tpl = readFileSync('infra/keycloak/openldr-realm.json.template', 'utf8');
    const out = renderRealm(tpl, 'https://demo.openldr.org');
    const realm = JSON.parse(out);
    expect(out).not.toContain('${PUBLIC_ORIGIN}');
    const web = realm.clients.find((c) => c.clientId === 'openldr-web');
    expect(web.redirectUris).toContain('https://demo.openldr.org/studio/*');
    expect(web.webOrigins).toContain('https://demo.openldr.org');
  });
});
