import { pool } from '../config/db.js';
import { normalizeDecimal } from '../utils/decimal.js';

export interface WalletTransactionFilters { userId: string; type?: string; currency?: string; from?: string; to?: string; page: number; limit: number }
interface Row { id: string; type: string; description: string | null; occurred_at: Date; amount: string; direction: string; currency: string; total: number; counterparty_nombre: string | null; counterparty_email: string | null }

export async function listWalletTransactions(filters: WalletTransactionFilters) {
  const offset = (filters.page - 1) * filters.limit;
  const result = await pool.query<Row>(
    `WITH me AS (
       SELECT t.id,t.type,t.description,t.occurred_at,e.amount::text AS amount,e.direction,RTRIM(e.currency) AS currency
         FROM transactions t JOIN LATERAL (
           SELECT e.amount,e.direction,e.currency FROM entries e JOIN accounts a ON a.id=e.account_id
            WHERE e.transaction_id=t.id AND a.user_id=$1 AND a.account_type='user' AND a.closed_at IS NULL
            ORDER BY (e.direction='debit') DESC,e.id LIMIT 1
         ) e ON true
     )
     SELECT me.*,COUNT(*) OVER()::int AS total,cp.nombre AS counterparty_nombre,cp.email AS counterparty_email
       FROM me LEFT JOIN LATERAL (
         SELECT u.nombre,u.email FROM entries other JOIN accounts oa ON oa.id=other.account_id JOIN users u ON u.id=oa.user_id
          WHERE other.transaction_id=me.id AND oa.user_id<>$1 AND oa.account_type='user' LIMIT 1
       ) cp ON me.type='transfer'
      WHERE ($2::text IS NULL OR CASE WHEN me.type='transfer' AND me.direction='debit' THEN 'transfer_sent' WHEN me.type='transfer' THEN 'transfer_received' ELSE me.type END=$2)
        AND ($3::text IS NULL OR me.currency=$3) AND ($4::timestamptz IS NULL OR me.occurred_at >= $4) AND ($5::timestamptz IS NULL OR me.occurred_at <= $5)
      ORDER BY me.occurred_at DESC,me.id DESC LIMIT $6 OFFSET $7`,
    [filters.userId, filters.type ?? null, filters.currency ?? null, filters.from ?? null, filters.to ?? null, filters.limit, offset],
  );
  const rows = result.rows;
  const total = rows[0]?.total ?? 0;
  const items = rows.map((row) => {
    const type = row.type === 'transfer' ? (row.direction === 'debit' ? 'transfer_sent' : 'transfer_received') : row.type;
    const nombre = row.counterparty_nombre ?? row.counterparty_email;
    return { id: row.id, type, status: 'completed', currency: row.currency, amount: normalizeDecimal(row.amount, 2), created_at: row.occurred_at.toISOString(), description: row.description ?? (type === 'transfer_sent' ? `Transferencia a ${nombre ?? 'un usuario'}` : type === 'transfer_received' ? `Transferencia de ${nombre ?? 'un usuario'}` : row.type === 'withdrawal' ? 'Retiro de cuenta' : 'Ingreso'), counterparty: row.counterparty_email ? { nombre: row.counterparty_nombre ?? row.counterparty_email, email: row.counterparty_email } : null, exchange: null };
  });
  return { items, page: filters.page, limit: filters.limit, total, totalPages: Math.ceil(total / filters.limit) };
}
