import nodemailer, { type Transporter } from 'nodemailer';

function validatePort(raw: string | undefined, fallback: number): number {
  const port = Number(raw ?? fallback);
  if (!Number.isFinite(port) || port < 1 || port > 65535) throw new Error(`invalid connector port: ${raw}`);
  return port;
}

type MakeTransport = (config: Record<string, unknown>) => Transporter;

/** Build a nodemailer transport for an email connector by type. `make` is injectable for tests. */
export function createEmailTransport(type: string, config: Record<string, string>, make: MakeTransport = nodemailer.createTransport): Transporter {
  if (type === 'smtp') {
    return make({ host: config.host, port: validatePort(config.port, 587), secure: config.secure === 'true', auth: { user: config.user, pass: config.password } });
  }
  if (type === 'gmail') {
    return make({ service: 'gmail', auth: { type: 'OAuth2', user: config.user, clientId: config.clientId, clientSecret: config.clientSecret, refreshToken: config.refreshToken } });
  }
  if (type === 'outlook') {
    return make({
      host: 'smtp.office365.com', port: 587, secure: false,
      auth: { type: 'OAuth2', user: config.user, clientId: config.clientId, clientSecret: config.clientSecret, refreshToken: config.refreshToken, accessUrl: `https://login.microsoftonline.com/${config.tenant || 'common'}/oauth2/v2.0/token` },
    });
  }
  throw new Error(`unsupported email connector type: ${type}`);
}
