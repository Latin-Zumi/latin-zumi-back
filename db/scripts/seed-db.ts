import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';
import { getClientConfig } from '../../src/config/db-connection.js';

const { Client } = pg;

const client = new Client(getClientConfig());
let transactionStarted = false;
let transactionCommitted = false;

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
  transactionStarted = true;
  for (const file of seedFiles) {
    const sql = await readFile(new URL(file, seedDirectory), 'utf8');
    await client.query(sql);
    console.log(`Seed aplicado: ${file}`);
  }
  await client.query('COMMIT');
  transactionCommitted = true;
} catch (err: unknown) {
  if (transactionStarted && !transactionCommitted) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError: unknown) {
      console.error(
        'No se pudo revertir la transacción:',
        rollbackError instanceof Error ? rollbackError.message : rollbackError,
      );
    }
  }
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  try {
    await client.end();
  } catch (closeError: unknown) {
    console.error(
      'No se pudo cerrar la conexión:',
      closeError instanceof Error ? closeError.message : closeError,
    );
    process.exitCode = 1;
  }
}
