import { pool } from '../config/db.js';
import type { PoolClient } from 'pg';
import { AppError } from '../utils/AppError.js';
import { currencyForCountry, type Pais } from '../utils/country.js';

type Queryable = Pick<PoolClient, 'query'>;

export interface NewUser {
  username: string;
  email: string;
  passwordHash: string;
  currency: string;
}

export interface CreateUserWithWalletInput {
  username: string;
  email: string;
  passwordHash: string | null;
  nombre: string;
  pais: string | null;
  monedaPreferida: string;
  googleUid?: string | null;
  fotoUrl?: string | null;
  retryUsernameConflict?: boolean;
}

export interface UserProfileRow {
  id: string;
  username: string;
  email: string;
  nombre: string | null;
  pais: string | null;
  moneda_preferida: string;
  roles: string[];
  estado: string;
  foto_url: string | null;
}

export async function findUserByEmail(email: string): Promise<{ id: string; nombre: string; email: string } | null> {
  const result = await pool.query<{ id: string; nombre: string | null; username: string; email: string }>(
    `SELECT id, nombre, username, email FROM users WHERE lower(email) = $1 LIMIT 1`, [email.trim().toLowerCase()],
  );
  const row = result.rows[0];
  return row ? { id: row.id, nombre: row.nombre?.trim() || row.username, email: row.email } : null;
}

export interface MyProfile {
  nombre: string;
  email: string;
  pais: string | null;
  moneda_preferida: string;
  foto_url: string | null;
}

export async function getMyProfile(
  userId: string,
): Promise<MyProfile | null> {
  const result = await pool.query<MyProfile>(
    `SELECT COALESCE(NULLIF(trim(nombre), ''), username) AS nombre,
            email, pais,
            RTRIM(moneda_preferida) AS moneda_preferida,
            foto_url
       FROM users
      WHERE id = $1`,
    [userId],
  );

  return result.rows[0] ?? null;
}

export interface RegisteredUser {
  user: {
    id: string;
    username: string;
    email: string;
  };
  account: {
    id: string;
    user_id: string;
    currency: string;
    account_type: string;
    allow_negative: boolean;
    balance: string;
  };
  wallet_id: string;
}

interface WalletRow { id: string }

interface CreatedAccountRow {
  id: string;
  user_id: string;
  currency: string;
  account_type: string;
  allow_negative: boolean;
}

export interface UserWithWallet {
  user: UserProfileRow;
  wallet_id: string;
  account: CreatedAccountRow;
}

export async function createUserWithWallet(
  client: Queryable,
  input: CreateUserWithWalletInput,
): Promise<UserWithWallet> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const username = attempt === 0
      ? input.username
      : `${input.username.slice(0, 27)}${attempt}`;
    const userResult = await client.query<UserProfileRow>(
      `INSERT INTO users
         (username, email, password_hash, nombre, pais, moneda_preferida,
          google_uid, foto_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (username) DO NOTHING
       RETURNING id, username, email, nombre, pais,
                 RTRIM(moneda_preferida) AS moneda_preferida,
                 roles, estado, foto_url`,
      [
        username,
        input.email,
        input.passwordHash,
        input.nombre,
        input.pais,
        input.monedaPreferida,
        input.googleUid ?? null,
        input.fotoUrl ?? null,
      ],
    );
    const user = userResult.rows[0];
    if (!user) {
      if (input.retryUsernameConflict === false) {
        throw new AppError('Username o email ya registrado', 409);
      }
      continue;
    }

    const walletResult = await client.query<WalletRow>(
      `INSERT INTO wallets (user_id, primary_currency)
       VALUES ($1, $2) RETURNING id`,
      [user.id, input.monedaPreferida],
    );
    const wallet = walletResult.rows[0];
    const accountResult = await client.query<CreatedAccountRow>(
      `INSERT INTO accounts
         (user_id, wallet_id, currency, account_type, allow_negative)
       VALUES ($1, $2, $3, 'user', false)
       RETURNING id, user_id, RTRIM(currency) AS currency,
                 account_type, allow_negative`,
      [user.id, wallet.id, input.monedaPreferida],
    );

    return {
      user,
      wallet_id: wallet.id,
      account: accountResult.rows[0],
    };
  }

  throw new AppError('No se pudo generar un username único', 500);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === '23505';
}

export async function updateUserProfile(
  userId: string,
  input: { nombre?: string; pais: Pais },
): Promise<UserProfileRow> {
  const requestedCurrency = currencyForCountry(input.pais);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const walletResult = await client.query<{
      id: string;
      primary_currency: string;
    }>(
      `SELECT id, RTRIM(primary_currency) AS primary_currency
         FROM wallets
        WHERE user_id = $1
        FOR UPDATE`,
      [userId],
    );
    const wallet = walletResult.rows[0];
    if (!wallet) {
      throw new AppError('No encontramos tu billetera', 404, 'WALLET_NOT_FOUND');
    }

    let effectiveCurrency = requestedCurrency;
    if (wallet.primary_currency !== requestedCurrency) {
      const movements = await client.query(
        `SELECT 1
           FROM entries e
           JOIN accounts a ON a.id = e.account_id
          WHERE a.wallet_id = $1
          LIMIT 1`,
        [wallet.id],
      );

      if (movements.rows.length > 0) {
        effectiveCurrency = wallet.primary_currency;
      } else {
        const accountsResult = await client.query<{
          id: string;
          currency: string;
        }>(
          `SELECT id, RTRIM(currency) AS currency
             FROM accounts
            WHERE wallet_id = $1
              AND account_type = 'user'
              AND closed_at IS NULL
            ORDER BY (currency = $2) DESC,
                     (currency = $3) DESC,
                     id
            FOR UPDATE`,
          [wallet.id, requestedCurrency, wallet.primary_currency],
        );
        const accounts = accountsResult.rows;
        const accountInRequestedCurrency = accounts.find(
          (account) => account.currency === requestedCurrency,
        );
        const accountToConvert = accountInRequestedCurrency
          ? null
          : accounts.find((account) => account.currency === wallet.primary_currency)
            ?? accounts[0];

        if (!accountInRequestedCurrency && !accountToConvert) {
          throw new AppError(
            'No encontramos la cuenta de tu billetera',
            404,
            'ACCOUNT_NOT_FOUND',
          );
        }

        if (accountToConvert) {
          await client.query(
            `UPDATE accounts
                SET currency = $2
              WHERE id = $1
                AND wallet_id = $3
                AND account_type = 'user'
                AND closed_at IS NULL`,
            [accountToConvert.id, requestedCurrency, wallet.id],
          );
        }
        await client.query(
          'UPDATE wallets SET primary_currency = $2 WHERE id = $1',
          [wallet.id, requestedCurrency],
        );
      }
    }

    const userResult = await client.query<UserProfileRow>(
      `UPDATE users
          SET nombre = COALESCE($2, nombre),
              pais = $3,
              moneda_preferida = $4
        WHERE id = $1
        RETURNING id, username, email, nombre, pais,
                  RTRIM(moneda_preferida) AS moneda_preferida,
                  roles, estado, foto_url`,
      [userId, input.nombre ?? null, input.pais, effectiveCurrency],
    );
    const user = userResult.rows[0];
    if (!user) {
      throw new AppError('Usuario no encontrado', 404, 'USER_NOT_FOUND');
    }

    await client.query('COMMIT');
    return user;
  } catch (error) {
    await client.query('ROLLBACK');
    if (isUniqueViolation(error)) {
      throw new AppError(
        'No pudimos actualizar la moneda de tu billetera',
        409,
        'PROFILE_CURRENCY_CONFLICT',
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function registerUser(input: NewUser): Promise<RegisteredUser> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = await createUserWithWallet(client, {
      username: input.username,
      email: input.email,
      passwordHash: input.passwordHash,
      nombre: input.username,
      pais: null,
      monedaPreferida: input.currency,
      retryUsernameConflict: false,
    });

    await client.query('COMMIT');
    return {
      user: {
        id: created.user.id,
        username: created.user.username,
        email: created.user.email,
      },
      account: { ...created.account, balance: '0' },
      wallet_id: created.wallet_id,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
