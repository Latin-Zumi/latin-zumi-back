import { pool } from '../config/db.js';
import { getWalletByUserId, getAccountsByUserId } from './accounts.service.js';
import { recordIncomingConversion, findTransactionSummary } from './incoming-conversion.service.js';
import { AppError } from '../utils/AppError.js';
import { normalizeDecimal } from '../utils/decimal.js';

export interface DepositResult {
  transaction: {
    id: string;
    type: 'deposit';
    status: 'completed';
    currency: string;
    amount: string;
    created_at: string;
    description: string;
    counterparty: null;
    exchange: null;
  };
  source: { currency: string; amount: string; rate: string };
  balances: Awaited<ReturnType<typeof getAccountsByUserId>>;
}

export async function depositToWallet(input: {
  userId: string;
  idempotencyKey: string;
  currency: string;
  amount: string;
}): Promise<DepositResult> {
  const wallet = await getWalletByUserId(input.userId);
  if (!wallet) {
    throw new AppError('Wallet no encontrada', 404, 'WALLET_NOT_FOUND');
  }

  const accountResult = await pool.query<{ id: string }>(
    `SELECT a.id
       FROM accounts a
      WHERE a.wallet_id = $1
        AND RTRIM(a.currency) = $2
        AND a.account_type = 'user'
        AND a.closed_at IS NULL
      LIMIT 1`,
    [wallet.id, wallet.primaryCurrency],
  );
  const account = accountResult.rows[0];
  if (!account) {
    throw new AppError(
      'La wallet no tiene una cuenta para su moneda principal',
      500,
      'WALLET_ACCOUNT_MISSING',
    );
  }

  const result = await recordIncomingConversion({
    accountId: account.id,
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    sourceCurrency: input.currency,
    sourceAmount: normalizeDecimal(input.amount, 2),
  });

  const transaction = await findTransactionSummary(result.transaction_id);
  const balances = await getAccountsByUserId(input.userId);

  return {
    transaction: {
      id: transaction.id,
      type: 'deposit',
      status: 'completed',
      currency: result.destination.currency,
      amount: result.destination.amount,
      created_at: transaction.occurred_at.toISOString(),
      description: transaction.description ?? 'Ingreso',
      counterparty: null,
      exchange: null,
    },
    source: {
      currency: result.source.currency,
      amount: result.source.amount,
      rate: result.rate,
    },
    balances,
  };
}
