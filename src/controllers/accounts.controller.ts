import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  getAccountById,
  getBalanceByAccountId,
} from '../services/accounts.service.js';
import { AppError } from '../utils/AppError.js';
import { getAuthContext } from '../middleware/requireAuth.js';
import { recordIncomingConversion } from '../services/incoming-conversion.service.js';
import { multiplyAndRoundHalfUp } from '../utils/decimal.js';

const accountIdSchema = z.string().uuid();
const incomingSchema = z.object({
  source_currency: z.enum(['USD', 'COP', 'ARS', 'EUR']),
  source_amount: z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/),
  destination_currency: z.enum(['USD', 'COP', 'ARS', 'EUR']).optional(),
});

function parseAccountId(value: string | string[] | undefined): string {
  const parsedId = accountIdSchema.safeParse(value);
  if (!parsedId.success) {
    throw new AppError('ID de cuenta inválido', 400);
  }

  return parsedId.data;
}

export async function getAccount(req: Request, res: Response) {
  const accountId = parseAccountId(req.params.id);
  const account = await getAccountById(accountId, getAuthContext(req).userId);
  if (!account) {
    throw new AppError('Cuenta no encontrada', 404);
  }

  return res.status(200).json({ data: account });
}

export async function getAccountBalance(req: Request, res: Response) {
  const accountId = parseAccountId(req.params.id);
  const balance = await getBalanceByAccountId(
    accountId,
    getAuthContext(req).userId,
  );
  if (!balance) {
    throw new AppError('Cuenta no encontrada', 404);
  }

  return res.status(200).json({ data: balance });
}

export async function createIncoming(req: Request, res: Response) {
  const accountId = parseAccountId(req.params.id);
  const parsed = incomingSchema.safeParse(req.body);
  if (!parsed.success || /^0+(?:\.0+)?$/.test(parsed.success ? parsed.data.source_amount : '')) {
    throw new AppError('Datos de ingreso inválidos', 400);
  }
  const idempotencyKey = req.header('Idempotency-Key');
  if (!idempotencyKey || idempotencyKey.length > 200 || !/^[\x21-\x7E]+$/.test(idempotencyKey)) {
    throw new AppError('Se requiere un Idempotency-Key válido (máximo 200 caracteres)', 400);
  }
  const result = await recordIncomingConversion({
    accountId,
    userId: getAuthContext(req).userId,
    idempotencyKey,
    sourceCurrency: parsed.data.source_currency,
    sourceAmount: multiplyAndRoundHalfUp(parsed.data.source_amount, '1', 2),
    destinationCurrency: parsed.data.destination_currency,
  });
  return res.status(200).json({ data: result });
}
