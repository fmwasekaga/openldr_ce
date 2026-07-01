import { networkInterfaces } from 'node:os';

/** Non-internal IPv4 addresses as [{name, address}], from an os.networkInterfaces()-shaped map. */
export function formatIpChoices(ifaces = networkInterfaces()) {
  const out = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
    }
  }
  return out;
}

/** Accept hostnames/FQDNs (labels of a-z0-9-, no scheme/path). */
export function isValidFqdn(s) {
  return /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(s);
}
