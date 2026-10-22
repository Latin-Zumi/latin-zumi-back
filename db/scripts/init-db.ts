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
  const sql: string = await readFile(
    new URL('../migrations/001_ledger.sql', import.meta.url),
    'utf8',
  );
  await client.query(sql);
  console.log('Schema creado');
} catch (err: unknown) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.end();
}
