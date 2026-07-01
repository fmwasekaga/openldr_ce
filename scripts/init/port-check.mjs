import { createServer } from 'node:net';

/** Resolve true if `port` can be bound on 0.0.0.0, false if in use. */
export function isPortFree(port) {
  return new Promise((resolve) => {
    const s = createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '0.0.0.0');
  });
}
