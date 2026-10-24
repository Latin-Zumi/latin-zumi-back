import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
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
  const seedDirectory = new URL('../seeds/', import.meta.url);
  const seedFiles = (await readdir(seedDirectory))
    .filter((file) => file.endsWith('.sql'))
    .sort();

  if (seedFiles.length === 0) {
    console.log('No hay archivos seed para ejecutar');
  }

  await client.query('BEGIN');
  for (const file of seedFiles) {
    const sql = await readFile(new URL(file, seedDirectory), 'utf8');
    await client.query(sql);
    console.log(`Seed aplicado: ${file}`);
  }
  await client.query('COMMIT');
} catch (err: unknown) {
  try {
    await client.query('ROLLBACK');
  } catch {
    // La conexi├│n podr├¡a no haberse establecido o estar cerrada.
  }
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.end();
}
