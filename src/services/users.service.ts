import { pool } from '../config/db.js';
import type { PoolClient } from 'pg';
import { AppError } from '../utils/AppError.js';

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
         (username, email, password_hash, nombre, pais, moneda_preferida)
       VALUES ($1, $2, $3, $4, $5, $6)
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
