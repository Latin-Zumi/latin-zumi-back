import { pool } from '../config/db.js';

export interface NewUser {
  username: string;
  email: string;
  passwordHash: string;
  currency: string;
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
}

interface UserRow {
  id: string;
  username: string;
  email: string;
}

interface AccountRow {
  id: string;
  user_id: string;
  currency: string;
  account_type: string;
  allow_negative: boolean;
}

export async function registerUser(input: NewUser): Promise<RegisteredUser> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userResult = await client.query<UserRow>(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, email`,
      [input.username, input.email, input.passwordHash],
    );
    const user = userResult.rows[0];

    const accountResult = await client.query<AccountRow>(
      `INSERT INTO accounts (user_id, currency, account_type, allow_negative)
       VALUES ($1, $2, 'user', false)
       RETURNING id, user_id, RTRIM(currency) AS currency,
                 account_type, allow_negative`,
      [user.id, input.currency],
    );
    const account = accountResult.rows[0];

    await client.query('COMMIT');
    return {
      user,
      account: { ...account, balance: '0' },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
