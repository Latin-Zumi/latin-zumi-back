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

const client = new Client({
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
