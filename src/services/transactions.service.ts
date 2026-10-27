
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

export interface TransactionHistoryFilters {
  page: number;
  limit: number;
  account_id?: string;
  from?: string;
  to?: string;
}

export interface TransactionHistory {
  data: Transaction[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

type TransactionHeader = Omit<Transaction, 'entries'>;
type TransactionEntryWithTransactionId = TransactionEntry & {
  transaction_id: string;
};

export async function getTransactionsByUserId(
  userId: string,
  filters: TransactionHistoryFilters,
): Promise<TransactionHistory | null> {
  if (filters.account_id) {
    const accountResult = await pool.query(
      `SELECT 1
         FROM accounts
        WHERE id = $1
          AND user_id = $2
          AND closed_at IS NULL`,
      [filters.account_id, userId],
    );
    if (accountResult.rows.length === 0) return null;
  }

  const conditions = [
    `EXISTS (
      SELECT 1
        FROM entries visible_entry
        JOIN accounts visible_account ON visible_account.id = visible_entry.account_id
       WHERE visible_entry.transaction_id = t.id
         AND visible_account.user_id = $1
         AND visible_account.closed_at IS NULL
    )`,
  ];
  const values: (string | number)[] = [userId];
  const addParameter = (value: string | number) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (filters.account_id) {
    const accountIdParameter = addParameter(filters.account_id);
    conditions.push(
      `EXISTS (
        SELECT 1
          FROM entries selected_entry
          JOIN accounts selected_account ON selected_account.id = selected_entry.account_id
         WHERE selected_entry.transaction_id = t.id
           AND selected_entry.account_id = ${accountIdParameter}
           AND selected_account.user_id = $1
           AND selected_account.closed_at IS NULL
      )`,
    );
  }
  if (filters.from) {
    conditions.push(`t.occurred_at >= ${addParameter(filters.from)}::timestamptz`);
  }
  if (filters.to) {
    conditions.push(`t.occurred_at <= ${addParameter(filters.to)}::timestamptz`);
  }

  const whereClause = conditions.join('\n AND ');
  const countResult = await pool.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
       FROM transactions t
      WHERE ${whereClause}`,
    values,
  );
  const total = Number(countResult.rows[0]?.total ?? '0');
  const pageValues = [...values];
  pageValues.push(filters.limit, (filters.page - 1) * filters.limit);

  const transactionsResult = await pool.query<TransactionHeader>(
    `SELECT t.id, t.idempotency_key, t.description, t.occurred_at
       FROM transactions t
      WHERE ${whereClause}
      ORDER BY t.occurred_at DESC, t.id DESC
      LIMIT $${pageValues.length - 1}
     OFFSET $${pageValues.length}`,
    pageValues,
  );
  const transactions = transactionsResult.rows;
  if (transactions.length === 0) {
    return {
      data: [],
      meta: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.ceil(total / filters.limit),
      },
    };
  }

  const entriesResult = await pool.query<TransactionEntryWithTransactionId>(
    `SELECT e.transaction_id,
            e.id::text AS id,
            e.account_id,
            e.amount::text AS amount,
            e.direction,
            RTRIM(e.currency) AS currency,
            e.created_at
       FROM entries e
       JOIN accounts a ON a.id = e.account_id
      WHERE e.transaction_id = ANY($1::uuid[])
        AND a.user_id = $2
        AND a.closed_at IS NULL
      ORDER BY e.transaction_id, e.id`,
    [transactions.map(({ id }) => id), userId],
  );
  const entriesByTransaction = new Map<string, TransactionEntry[]>(
    transactions.map(({ id }) => [id, []]),
  );
  for (const { transaction_id: transactionId, ...entry } of entriesResult.rows) {
    const entries = entriesByTransaction.get(transactionId);
    if (!entries) throw new Error('Asiento asociado a una transacción no listada');
    entries.push(entry);
  }

  const data = transactions.map((transaction) => {
    const entries = entriesByTransaction.get(transaction.id);
    if (!entries) throw new Error('No se pudieron agrupar los asientos');
    return { ...transaction, entries };
  });

  return {
    data,
    meta: {
      page: filters.page,
      limit: filters.limit,
      total,
      totalPages: Math.ceil(total / filters.limit),
    },
  };
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
                AND a.closed_at IS NULL
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
        AND a.closed_at IS NULL
      ORDER BY e.id`,
    [transactionId, userId],
  );

  return { ...transaction, entries: entriesResult.rows };
}
