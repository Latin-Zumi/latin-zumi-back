import type { PoolClient } from 'pg';
import { pool } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { multiplyAndRoundHalfUp, normalizeDecimal } from '../utils/decimal.js';
import { getExchangeRate } from './exchange-rate.service.js';
import { getAccountsByUserId, getWalletByUserId } from './accounts.service.js';
import { findUserByEmail } from './users.service.js';
import { getInternalAccount } from './internal-account.service.js';

export interface TransferInput { userId: string; idempotencyKey: string; recipientEmail: string; currency: string; amount: string; note?: string }
type Tx = Pick<PoolClient, 'query'>;
async function existingTransfer(db: Tx, key: string) {
  return db.query<{ id: string; description: string | null; occurred_at: Date; sender: string | null; recipient: string | null; currency: string | null; amount: string | null; recipient_currency: string | null; recipient_amount: string | null; rate: string | null }>(
    `SELECT t.id, t.description, t.occurred_at,
            (SELECT a.user_id::text FROM entries e JOIN accounts a ON a.id=e.account_id WHERE e.transaction_id=t.id AND e.direction='debit' AND a.account_type='user' LIMIT 1) AS sender,
            (SELECT a.user_id::text FROM entries e JOIN accounts a ON a.id=e.account_id WHERE e.transaction_id=t.id AND e.direction='credit' AND a.account_type='user' LIMIT 1) AS recipient,
            (SELECT RTRIM(currency) FROM entries e JOIN accounts a ON a.id=e.account_id WHERE e.transaction_id=t.id AND e.direction='debit' AND a.account_type='user' LIMIT 1) AS currency,
            (SELECT amount::text FROM entries e JOIN accounts a ON a.id=e.account_id WHERE e.transaction_id=t.id AND e.direction='debit' AND a.account_type='user' LIMIT 1) AS amount,
            c.destination_currency AS recipient_currency, c.destination_amount::text AS recipient_amount, c.rate::text AS rate
       FROM transactions t LEFT JOIN currency_conversions c ON c.transaction_id=t.id WHERE t.idempotency_key=$1`, [key],
  );
}

export async function transferBetweenUsers(input: TransferInput) {
  const recipient = await findUserByEmail(input.recipientEmail);
  if (!recipient) throw new AppError('Destinatario no encontrado', 404, 'RECIPIENT_NOT_FOUND');
  if (recipient.id === input.userId) throw new AppError('No podés transferirte a vos mismo', 422, 'SELF_TRANSFER');
  const recipientWallet = await getWalletByUserId(recipient.id);
  if (!recipientWallet) throw new AppError('El destinatario no tiene una wallet', 500);
  const amount = normalizeDecimal(input.amount, 2);
  const conversion = input.currency === recipientWallet.primaryCurrency ? null : await getExchangeRate(input.currency, recipientWallet.primaryCurrency).catch(() => {
    throw new AppError('No hay una tasa vigente disponible', 503, 'CONVERSION_UNAVAILABLE');
  });
  const rate = conversion ? normalizeDecimal(conversion.rate, 12) : '1.000000000000';
  const received = conversion ? multiplyAndRoundHalfUp(amount, rate, 2) : amount;
  if (received === '0.00') throw new AppError('El importe convertido es menor a 0.01', 422, 'AMOUNT_TOO_SMALL');
  const senderWallet = await getWalletByUserId(input.userId);
  if (!senderWallet) throw new AppError('Wallet no encontrada', 500);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ids = [senderWallet.id, recipientWallet.id].sort();
    for (const id of ids) await client.query('SELECT id FROM wallets WHERE id=$1 FOR UPDATE', [id]);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`operation:${input.idempotencyKey}`]);
    const prior = (await existingTransfer(client, input.idempotencyKey)).rows[0];
    if (prior) {
      const same = prior.sender === input.userId && prior.recipient === recipient.id && prior.currency === input.currency && prior.amount !== null && normalizeDecimal(prior.amount, 2) === amount && prior.description === (input.note || null);
      if (!same) throw new AppError('Idempotency-Key ya usado con otra solicitud', 409, 'IDEMPOTENCY_CONFLICT');
      const balances = await getAccountsByUserId(input.userId, client);
      await client.query('COMMIT');
      return { transaction: { id: prior.id, type: 'transfer_sent', status: 'completed', currency: input.currency, amount, created_at: prior.occurred_at.toISOString(), description: prior.description ?? `Transferencia a ${recipient.nombre}`, counterparty: { nombre: recipient.nombre, email: recipient.email }, exchange: null }, recipient: { currency: prior.recipient_currency ?? recipientWallet.primaryCurrency, amount: normalizeDecimal(prior.recipient_amount ?? amount, 2), rate: normalizeDecimal(prior.rate ?? '1', 12) }, balances };
    }
    const sender = await client.query<{ account_id: string; sufficient: boolean }>(
      `SELECT a.id AS account_id, COALESCE(b.balance,0) >= $3::numeric AS sufficient FROM accounts a LEFT JOIN account_balances b ON b.account_id=a.id AND b.currency=a.currency WHERE a.wallet_id=$1 AND RTRIM(a.currency)=$2 AND a.account_type='user' AND a.closed_at IS NULL`,
      [senderWallet.id, input.currency, amount],
    );
    if (!sender.rows[0]?.sufficient) throw new AppError('Saldo disponible insuficiente o cuenta inexistente', 422, 'INSUFFICIENT_FUNDS');
    const receiver = await client.query<{ id: string }>(`SELECT id FROM accounts WHERE wallet_id=$1 AND RTRIM(currency)=$2 AND account_type='user' AND closed_at IS NULL`, [recipientWallet.id, recipientWallet.primaryCurrency]);
    if (!receiver.rows[0]) throw new AppError('La wallet no tiene una cuenta principal', 500);
    const tx = await client.query<{ id: string; occurred_at: Date }>(`INSERT INTO transactions (idempotency_key,description,type) VALUES ($1,$2,'transfer') RETURNING id, occurred_at`, [input.idempotencyKey, input.note || null]);
    const txid = tx.rows[0].id;
    if (!conversion) {
      await client.query(`INSERT INTO entries (transaction_id,account_id,amount,direction,currency) VALUES ($1,$2,$3,'debit',$4),($1,$5,$3,'credit',$4)`, [txid,sender.rows[0].account_id,amount,input.currency,receiver.rows[0].id]);
    } else {
      const treasuryAccounts = new Map<string, string>();
      for (const currency of [input.currency, recipientWallet.primaryCurrency].sort()) {
        treasuryAccounts.set(currency, await getInternalAccount(client, currency, 'treasury'));
      }
      const treasurySource = treasuryAccounts.get(input.currency)!;
      const treasuryDestination = treasuryAccounts.get(recipientWallet.primaryCurrency)!;
      await client.query(`INSERT INTO entries (transaction_id,account_id,amount,direction,currency) VALUES ($1,$2,$3,'debit',$4),($1,$5,$3,'credit',$4),($1,$6,$7,'debit',$8),($1,$9,$7,'credit',$8)`, [txid,sender.rows[0].account_id,amount,input.currency,treasurySource,treasuryDestination,received,recipientWallet.primaryCurrency,receiver.rows[0].id]);
      await client.query(`INSERT INTO currency_conversions (transaction_id,wallet_id,account_id,user_id,source_currency,source_amount,destination_currency,destination_amount,rate,rate_source,rate_observed_at,rounding) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'HALF_UP_2')`, [txid,recipientWallet.id,receiver.rows[0].id,recipient.id,input.currency,amount,recipientWallet.primaryCurrency,received,rate,conversion.source,conversion.observedAt]);
    }
    const balances = await getAccountsByUserId(input.userId, client);
    await client.query('COMMIT');
    return { transaction: { id: txid, type: 'transfer_sent', status: 'completed', currency: input.currency, amount, created_at: tx.rows[0].occurred_at.toISOString(), description: input.note ?? `Transferencia a ${recipient.nombre}`, counterparty: { nombre: recipient.nombre, email: recipient.email }, exchange: null }, recipient: { currency: recipientWallet.primaryCurrency, amount: received, rate }, balances };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
