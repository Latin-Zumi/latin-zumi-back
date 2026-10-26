import { pool } from '../config/db.js';

export interface TransactionEntry {
  id: string;
  account_id: string;
  amount: string;
  direction: 'debit' | 'credit';
  currency: string;
  created_at: Date;
}

export interface Transaction {
  id: string;
  idempotency_key: string;
  description: string | null;
  occurred_at: Date;
  entries: TransactionEntry[];
}

export async function getTransactionById(
  transactionId: string,
): Promise<Transaction | null> {
  const transactionResult = await pool.query<Omit<Transaction, 'entries'>>(
    `SELECT id, idempotency_key, description, occurred_at
       FROM transactions
      WHERE id = $1`,
    [transactionId],
  );
  const transaction = transactionResult.rows[0];
  if (!transaction) return null;

  const entriesResult = await pool.query<TransactionEntry>(
    `SELECT id::text AS id,
            account_id,
            amount::text AS amount,
            direction,
            RTRIM(currency) AS currency,
            created_at
       FROM entries
      WHERE transaction_id = $1
      ORDER BY id`,
    [transactionId],
  );

  return { ...transaction, entries: entriesResult.rows };
}
