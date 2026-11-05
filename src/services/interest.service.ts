import { pool } from '../config/db.js';
import { getInternalAccount } from './internal-account.service.js';
import { multiplyAndRoundHalfUp } from '../utils/decimal.js';

export async function accrueInterest(): Promise<{ processed_days: number; transactions: number }> {
  const client = await pool.connect();
  let processedDays = 0, transactionCount = 0;

  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('accrue-interest'))`);
    const last = await client.query<{ run_date: string }>(`SELECT run_date::text FROM interest_runs ORDER BY run_date DESC LIMIT 1`);
    const start = last.rows[0]?.run_date ?? null;
    const dates = await client.query<{ day: string }>(`SELECT d::date::text AS "day" FROM generate_series(COALESCE(($1::date + 1)::timestamp, ((now() AT TIME ZONE 'UTC')::date - 1)::timestamp), (now() AT TIME ZONE 'UTC')::date - 1, interval '1 day') d`,[start]);

    for (const {day} of dates.rows) {
      const accounts = await client.query<{id:string; user_id:string; currency:string; balance:string; rate:string}>(
        `SELECT a.id,a.user_id,RTRIM(a.currency) currency,
          COALESCE(SUM(CASE WHEN e.direction='credit' THEN e.amount ELSE -e.amount END),0)::text balance,
          COALESCE((SELECT r.annual_percent FROM interest_rates r WHERE r.currency=a.currency),0)::text rate
         FROM accounts a LEFT JOIN entries e ON e.account_id=a.id AND e.created_at < (($1::date + 1)::timestamp AT TIME ZONE 'UTC')
         WHERE a.account_type='user' AND a.closed_at IS NULL GROUP BY a.id,a.user_id,a.currency`,[day]);

      for (const account of accounts.rows) {
        const amount = multiplyAndRoundHalfUp(account.balance, (Number(account.rate)/36500).toFixed(12), 2);
        if (amount === '0.00') continue;
        const expense = await getInternalAccount(client,account.currency,'expense');
        const key = `interest:${account.id}:${day}`;
        const exists = await client.query(`SELECT 1 FROM transactions WHERE idempotency_key=$1 AND initiator_user_id=$2`,[key,account.user_id]);
        if (exists.rowCount) continue;
        const tx = await client.query<{id:string}>(`INSERT INTO transactions(idempotency_key,description,type,initiator_user_id) VALUES($1,$2,'interest',$3) RETURNING id`,[key,`Interés ${day}`,account.user_id]);
        await client.query(`INSERT INTO entries(transaction_id,account_id,amount,direction,currency) VALUES($1,$2,$3,'debit',$4),($1,$5,$3,'credit',$4)`,[tx.rows[0].id,expense,amount,account.currency,account.id]);
        transactionCount++;
      }
      await client.query(`INSERT INTO interest_runs(run_date) VALUES($1) ON CONFLICT DO NOTHING`,[day]);
      processedDays++;
    }
    await client.query('COMMIT');
    return {processed_days:processedDays,transactions:transactionCount};
  } catch(error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
