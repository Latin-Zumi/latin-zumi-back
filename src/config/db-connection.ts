import type { ClientConfig, PoolConfig } from 'pg';
import { env } from './env.js';

function getConnectionString(): string | undefined {
  if (!env.DATABASE_URL) {
    return undefined;
  }

  const connectionUrl = new URL(env.DATABASE_URL);
  const sslModeParameter = connectionUrl.searchParams.get('sslmode');
  const sslParameter = connectionUrl.searchParams.get('ssl');
  const sslValue = sslParameter?.toLowerCase();

  if (connectionUrl.searchParams.get('uselibpqcompat')?.toLowerCase() === 'true') {
    throw new Error('DATABASE_URL no admite uselibpqcompat=true porque puede desactivar la validación TLS');
  }

  if (sslParameter !== null) {
    if (!['true', '1', 'false', '0'].includes(sslValue ?? '')) {
      throw new Error(`DATABASE_URL contiene un parámetro ssl no admitido: ${sslParameter}`);
    }
    connectionUrl.searchParams.set('ssl', sslValue ?? '');
  }

  if (sslModeParameter !== null) {
    const sslMode = sslModeParameter.toLowerCase();
    if (!['disable', 'require', 'verify-full'].includes(sslMode)) {
      throw new Error(`DATABASE_URL contiene un sslmode no admitido: ${sslModeParameter}`);
    }

    const sslEnabled = sslMode !== 'disable';
    const sslExplicitlyEnabled = sslValue === 'true' || sslValue === '1';
    const sslExplicitlyDisabled = sslValue === 'false' || sslValue === '0';
    if ((sslEnabled && sslExplicitlyDisabled) || (!sslEnabled && sslExplicitlyEnabled)) {
      throw new Error('DATABASE_URL contiene parámetros ssl y sslmode contradictorios');
    }

    if (sslMode === 'require') {
      // pg-connection-string 2.x currently treats "require" as "verify-full".
      // Make that verified, certificate-validating behavior explicit.
      connectionUrl.searchParams.set('sslmode', 'verify-full');
    } else {
      connectionUrl.searchParams.set('sslmode', sslMode);
    }
  }

  return connectionUrl.toString();
}

const connectionString = getConnectionString();
const connectionOptions: ClientConfig = connectionString
  ? { connectionString }
  : {
      host: env.DB_HOST,
      port: env.DB_PORT,
      database: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
    };

export function getClientConfig(): ClientConfig {
  return {
    ...connectionOptions,
    connectionTimeoutMillis: env.DB_CONNECTION_TIMEOUT_MILLIS,
  };
}

export function getPoolConfig(): PoolConfig {
  return {
    ...getClientConfig(),
    connectionTimeoutMillis: env.DB_CONNECTION_TIMEOUT_MILLIS,
    max: env.DB_MAX,
    idleTimeoutMillis: env.DB_IDLE_TIMEOUT_MILLIS,
  };
}
