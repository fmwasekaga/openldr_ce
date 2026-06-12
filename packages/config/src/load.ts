import { config as loadDotenv } from 'dotenv';
import { ConfigError } from '@openldr/core';
import { ConfigSchema, type Config } from './schema';

let dotenvLoaded = false;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (env === process.env && !dotenvLoaded) {
    loadDotenv();
    dotenvLoaded = true;
  }
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new ConfigError(`Invalid configuration: ${issues}`);
  }
  return Object.freeze(parsed.data);
}
