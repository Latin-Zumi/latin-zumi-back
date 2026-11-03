import { pool } from '../config/db.js';
import { getOrCreateUserAccount, getAccountsByUserId, getWalletByUserId } from './accounts.service.js';
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

  const accountId = await getOrCreateUserAccount(pool, wallet.id, input.userId, input.currency);

  const result = await recordIncomingConversion({
    accountId,
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    sourceCurrency: input.currency,
    sourceAmount: normalizeDecimal(input.amount, 2),
    destinationCurrency: input.currency,
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
