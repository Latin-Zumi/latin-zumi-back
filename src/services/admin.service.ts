import { pool } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { getAccountsByUserId } from './accounts.service.js';
import { listWalletTransactions } from './wallet-transactions.service.js';

const CURRENCIES = ['ARS', 'COP', 'USD', 'EUR'] as const;

export async function getAdminSettings() {
  const [settings, rates] = await Promise.all([
    pool.query(`SELECT s.exchange_spread_percent::text, s.updated_at,
      CASE WHEN u.id IS NULL THEN NULL ELSE json_build_object('id',u.id,'nombre',u.nombre,'email',u.email) END updated_by
      FROM app_settings s LEFT JOIN users u ON u.id=s.updated_by WHERE s.id = 1`),
    pool.query(`SELECT RTRIM(currency) currency, annual_percent::text FROM interest_rates ORDER BY currency`),
  ]);
  const row = settings.rows[0];
  return { exchange_spread_percent: row.exchange_spread_percent, interest_rates: rates.rows,
    updated_at: row.updated_at, updated_by: row.updated_by };
}

export async function patchAdminSettings(userId: string, body: Record<string, unknown>) {
  const spread = body.exchange_spread_percent;
  const interestRates = body.interest_rates;
  if (Object.keys(body).some((key) => !['exchange_spread_percent', 'interest_rates'].includes(key)) ||
      (spread !== undefined && (!Number.isFinite(Number(spread)) || Number(spread) < 0 || Number(spread) > 10)) ||
      (interestRates !== undefined && (!interestRates || typeof interestRates !== 'object' || Array.isArray(interestRates) ||
        Object.entries(interestRates as Record<string, unknown>).some(([currency, value]) =>
          !CURRENCIES.includes(currency as typeof CURRENCIES[number]) || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 50)))) {
    throw new AppError('Parámetros inválidos', 400, 'INVALID_SETTINGS');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (spread !== undefined) {
      const next = Number(spread).toFixed(2);
      const old = await client.query(`SELECT exchange_spread_percent::text value FROM app_settings WHERE id=1 FOR UPDATE`);
      if (old.rows[0].value !== next) {
        await client.query(`UPDATE app_settings SET exchange_spread_percent=$1, updated_at=now(), updated_by=$2 WHERE id=1`, [next, userId]);
        await client.query(`INSERT INTO settings_history(field,old_value,new_value,changed_by) VALUES ('exchange_spread_percent',$1,$2,$3)`, [old.rows[0].value, next, userId]);
      }
    }
    if (interestRates) for (const [currency, value] of Object.entries(interestRates as Record<string, number>)) {
      const next = Number(value).toFixed(2);
      const old = await client.query(`SELECT annual_percent::text value FROM interest_rates WHERE currency=$1 FOR UPDATE`, [currency]);
      if (old.rows[0].value !== next) {
        await client.query(`UPDATE interest_rates SET annual_percent=$2, updated_at=now() WHERE currency=$1`, [currency, next]);
        await client.query(`INSERT INTO settings_history(field,old_value,new_value,changed_by) VALUES ($1,$2,$3,$4)`, [`interest_rates.${currency}`, old.rows[0].value, next, userId]);
      }
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
  return getAdminSettings();
}

function paging(query: Record<string, unknown>) {
  const page = Number(query.page ?? 1), limit = Number(query.limit ?? 20);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new AppError('Paginación inválida', 400);
  return { page, limit, offset: (page - 1) * limit };
}

export async function listAdminUsers(query: Record<string, unknown>) {
  const { page, limit, offset } = paging(query);
  const search = String(query.search ?? '').trim();
  const estado = String(query.estado ?? '');
  if (estado && !['activo', 'bloqueado'].includes(estado)) throw new AppError('Estado inválido', 400);
  const values = [search, estado || null, limit, offset];
  const result = await pool.query(`SELECT u.id,u.nombre,u.username,u.email,u.pais,RTRIM(u.moneda_preferida) moneda_preferida,u.estado,u.roles,u.created_at,
    (SELECT COALESCE(json_agg(json_build_object('currency',RTRIM(b.currency),'balance',b.balance::text) ORDER BY b.currency),'[]'::json) FROM account_balances b JOIN accounts a ON a.id=b.account_id WHERE a.user_id=u.id AND a.account_type='user') balances,
    count(*) OVER()::int total FROM users u WHERE ($1='' OR u.email ILIKE '%'||$1||'%' OR u.nombre ILIKE '%'||$1||'%' OR u.username ILIKE '%'||$1||'%') AND ($2::text IS NULL OR u.estado=$2) ORDER BY u.created_at DESC LIMIT $3 OFFSET $4`, values);
  return { items: result.rows.map(({ total, ...item }) => item), page, total: result.rows[0]?.total ?? 0 };
}

export async function getAdminUser(id: string) {
  const user = await pool.query(`SELECT id,nombre,username,email,pais,RTRIM(moneda_preferida) moneda_preferida,estado,roles,created_at FROM users WHERE id=$1`, [id]);
  if (!user.rows[0]) throw new AppError('Usuario no encontrado',404,'USER_NOT_FOUND');
  const [accounts, transactions] = await Promise.all([
    getAccountsByUserId(id),
    listWalletTransactions({ userId: id, page: 1, limit: 10 }),
  ]);
  const balances = accounts.map((account) => ({
    id: account.id,
    wallet_id: account.wallet_id,
    account_id: account.id,
    currency: account.currency,
    balance: account.balance,
  }));
  return { user:user.rows[0], balances, recent_transactions:transactions.items };
}

export async function setAdminUserState(id: string, estado: unknown, actorId: string) {
  if (!['activo','bloqueado'].includes(String(estado))) throw new AppError('Estado inválido',400);
  if (id === actorId && estado === 'bloqueado') throw new AppError('No puedes bloquear tu cuenta',422,'CANNOT_BLOCK_SELF');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`UPDATE users SET estado=$2 WHERE id=$1 RETURNING id,nombre,username,email,pais,RTRIM(moneda_preferida) moneda_preferida,estado,roles,created_at`,[id,estado]);
    if (!result.rows[0]) throw new AppError('Usuario no encontrado',404,'USER_NOT_FOUND');
    if (estado === 'bloqueado') await client.query(`UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`,[id]);
    await client.query('COMMIT');
    return result.rows[0];
  } catch(error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function getAdminMetrics(period: unknown) {
  if (!['day','month'].includes(String(period ?? 'day'))) throw new AppError('Periodo inválido',400);
  const interval = period === 'month' ? '1 month' : '1 day';
  const users = await pool.query(`SELECT count(*)::int total,count(*) FILTER(WHERE estado='activo')::int active,count(*) FILTER(WHERE estado='bloqueado')::int blocked,count(*) FILTER(WHERE created_at >= now()-$1::interval)::int new_in_period FROM users`,[interval]);
  const volume = await pool.query(`WITH credits AS (SELECT RTRIM(e.currency) currency, SUM(e.amount) FILTER(WHERE t.type='deposit' AND e.direction='credit' AND a.account_type='user') deposits,SUM(e.amount) FILTER(WHERE t.type='exchange' AND e.direction='debit' AND a.account_type='user') exchanges,SUM(e.amount) FILTER(WHERE t.type='transfer' AND e.direction='debit' AND a.account_type='user') transfers FROM entries e JOIN transactions t ON t.id=e.transaction_id JOIN accounts a ON a.id=e.account_id WHERE t.occurred_at >= now()-$1::interval GROUP BY RTRIM(e.currency)) SELECT c.currency,COALESCE(x.deposits,0)::numeric(20,2)::text deposits,COALESCE(x.exchanges,0)::numeric(20,2)::text exchanges,COALESCE(x.transfers,0)::numeric(20,2)::text transfers FROM unnest(ARRAY['USD','COP','ARS','EUR']::text[]) c(currency) LEFT JOIN credits x ON x.currency=c.currency ORDER BY c.currency`,[interval]);
  return { period, users:users.rows[0], volume:volume.rows };
}

export async function getSettingsHistory(query: Record<string, unknown>) {
  const {page,limit,offset}=paging(query);
  const result=await pool.query(`SELECT h.id,h.field,h.old_value,h.new_value,h.changed_at,
    CASE WHEN u.id IS NULL THEN NULL ELSE json_build_object('id',u.id,'nombre',u.nombre,'email',u.email) END changed_by,
    count(*) OVER()::int total FROM settings_history h LEFT JOIN users u ON u.id=h.changed_by ORDER BY h.changed_at DESC LIMIT $1 OFFSET $2`,[limit,offset]);
  return {items:result.rows.map(({total,...item})=>item),page,total:result.rows[0]?.total??0};
}
