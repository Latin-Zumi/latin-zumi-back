import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { getClientConfig } from '../../src/config/db-connection.js';

const { Client } = pg;

const client = new Client(getClientConfig());
let transactionStarted = false;
let transactionCommitted = false;

try {
  await client.connect();
  const existingSchema = await client.query<{ accounts_table: string | null }>(
    "SELECT to_regclass('accounts')::text AS accounts_table",
  );

  await client.query('BEGIN');
  transactionStarted = true;
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

  const transactionTypeMigration = await readFile(
    new URL('../migrations/009_transaction_type.sql', import.meta.url),
    'utf8',
  );
  await client.query(transactionTypeMigration);

  const passwordResetMigration = await readFile(
    new URL('../migrations/010_password_reset_tokens.sql', import.meta.url),
    'utf8',
  );
  await client.query(passwordResetMigration);

  const exchangeQuotesMigration = await readFile(
    new URL('../migrations/011_exchange_quotes.sql', import.meta.url),
    'utf8',
  );
  await client.query(exchangeQuotesMigration);

  await client.query('COMMIT');
  transactionCommitted = true;
  console.log('Schema y migraciones aplicados');
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
