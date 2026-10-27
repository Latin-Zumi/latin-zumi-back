import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const { Client } = pg;

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}`);
  }
  return value;
}

const client = process.env.DATABASE_URL
  ? new Client({ connectionString: process.env.DATABASE_URL })
  : new Client({
      host: getEnv('DB_HOST'),
      port: Number(getEnv('DB_PORT')),
      database: getEnv('DB_NAME'),
      user: getEnv('DB_USER'),
      password: getEnv('DB_PASSWORD'),
    });

try {
  await client.connect();
  const existingSchema = await client.query<{ accounts_table: string | null }>(
    "SELECT to_regclass('accounts')::text AS accounts_table",
  );

  await client.query('BEGIN');
  if (!existingSchema.rows[0]?.accounts_table) {
    const initialSchema = await readFile(
      new URL('../migrations/001_ledger.sql', import.meta.url),
      'utf8',
    );
    await client.query(initialSchema);
  }

  const usersMigration = await readFile(
    new URL('../migrations/002_users.sql', import.meta.url),
    'utf8',
  );
  await client.query(usersMigration);

  const authSessionsMigration = await readFile(
    new URL('../migrations/003_auth_sessions.sql', import.meta.url),
    'utf8',
  );
  await client.query(authSessionsMigration);

  const supportedCurrenciesMigration = await readFile(
    new URL('../migrations/004_supported_currencies.sql', import.meta.url),
    'utf8',
  );
  await client.query(supportedCurrenciesMigration);

  const singleUserAccountMigration = await readFile(
    new URL('../migrations/005_single_user_account.sql', import.meta.url),
    'utf8',
  );
  await client.query(singleUserAccountMigration);

  const walletContainerMigration = await readFile(
    new URL('../migrations/006_wallet_container.sql', import.meta.url),
    'utf8',
  );
  await client.query(walletContainerMigration);

  const currencyConversionsMigration = await readFile(
    new URL('../migrations/007_currency_conversions.sql', import.meta.url),
    'utf8',
  );
  await client.query(currencyConversionsMigration);

  const googleAuthProfileMigration = await readFile(
    new URL('../migrations/008_google_auth_profile.sql', import.meta.url),
    'utf8',
  );
  await client.query(googleAuthProfileMigration);

  await client.query('COMMIT');
  console.log('Schema y migraciones aplicados');
} catch (err: unknown) {
  try {
    await client.query('ROLLBACK');
  } catch {
    // La conexión podría no haberse establecido o estar cerrada.
  }
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.end();
}
