
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
  userId: string,
): Promise<Transaction | null> {
  const transactionResult = await pool.query<
    Omit<Transaction, 'entries'>
  >(
    `SELECT t.id, t.idempotency_key, t.description, t.occurred_at
       FROM transactions t
       WHERE t.id = $1
         AND EXISTS (
           SELECT 1
             FROM entries e
             JOIN accounts a ON a.id = e.account_id
            WHERE e.transaction_id = t.id
              AND a.user_id = $2
         )`,
    [transactionId, userId],
  );

  const transaction = transactionResult.rows[0];
  if (!transaction) return null;

  const entriesResult = await pool.query<TransactionEntry>(
    `SELECT e.id::text AS id,
            e.account_id,
            e.amount::text AS amount,
            e.direction,
            RTRIM(e.currency) AS currency,
            e.created_at
       FROM entries e
       JOIN accounts a ON a.id = e.account_id
      WHERE e.transaction_id = $1
        AND a.user_id = $2
      ORDER BY e.id`,
    [transactionId, userId],
  );

  return { ...transaction, entries: entriesResult.rows };
}
