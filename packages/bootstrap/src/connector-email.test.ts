import { describe, it, expect, vi } from 'vitest';
import { createEmailTransport } from './connector-email';

describe('createEmailTransport', () => {
  it('builds an smtp transport with basic auth', () => {
    const make = vi.fn(() => ({}) as never);
    createEmailTransport('smtp', { host: 'mail', port: '587', user: 'u', password: 'p', secure: 'false' }, make);
    expect(make).toHaveBeenCalledWith(expect.objectContaining({ host: 'mail', port: 587, secure: false, auth: { user: 'u', pass: 'p' } }));
  });
  it('builds a gmail OAuth2 transport', () => {
    const make = vi.fn(() => ({}) as never);
    createEmailTransport('gmail', { user: 'u@gmail.com', clientId: 'ci', clientSecret: 'cs', refreshToken: 'rt' }, make);
    expect(make).toHaveBeenCalledWith(expect.objectContaining({ service: 'gmail', auth: expect.objectContaining({ type: 'OAuth2', user: 'u@gmail.com', clientId: 'ci', clientSecret: 'cs', refreshToken: 'rt' }) }));
  });
  it('builds an outlook OAuth2 transport with the tenant access url', () => {
    const make = vi.fn(() => ({}) as never);
    createEmailTransport('outlook', { user: 'u@org.com', clientId: 'ci', clientSecret: 'cs', refreshToken: 'rt', tenant: 't1' }, make);
    const cfg = (make.mock.calls as unknown as Array<[Record<string, unknown>]>)[0][0] as { host: string; auth: { accessUrl: string } };
    expect(cfg.host).toBe('smtp.office365.com');
    expect(cfg.auth.accessUrl).toBe('https://login.microsoftonline.com/t1/oauth2/v2.0/token');
  });
  it('throws on an unsupported type', () => {
    expect(() => createEmailTransport('imap', {})).toThrow(/unsupported email connector type/);
  });
});
