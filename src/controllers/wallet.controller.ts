import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../utils/AppError.js';
import { getAuthContext } from '../middleware/requireAuth.js';
import { transferBetweenUsers } from '../services/transfers.service.js';
import { listWalletTransactions } from '../services/wallet-transactions.service.js';

const transferSchema = z.object({ recipient_email: z.string().trim().toLowerCase().email().max(254), currency: z.enum(['USD','COP','ARS','EUR']), amount: z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/), note: z.string().trim().max(140).optional() });
export async function transfer(req: Request, res: Response) {
  const parsed = transferSchema.safeParse(req.body);
  if (!parsed.success) {
    if (parsed.error.issues.some((issue) => issue.path[0] === 'amount')) {
      throw new AppError('El monto debe ser numérico y tener hasta dos decimales', 400, 'INVALID_AMOUNT');
    }
    throw new AppError('Datos de transferencia inválidos', 400);
  }
  if (/^0+(?:\.0+)?$/.test(parsed.data.amount)) throw new AppError('El monto debe ser mayor a cero', 400, 'INVALID_AMOUNT');
  const key = req.header('Idempotency-Key');
  if (!key || key.length > 200 || !/^[\x21-\x7E]+$/.test(key)) throw new AppError('Se requiere un Idempotency-Key válido (máximo 200 caracteres)', 400, 'INVALID_IDEMPOTENCY_KEY');
  return res.status(200).json(await transferBetweenUsers({ userId: getAuthContext(req).userId, idempotencyKey: key, recipientEmail: parsed.data.recipient_email, currency: parsed.data.currency, amount: parsed.data.amount, note: parsed.data.note }));
}

const types = ['deposit','transfer_sent','transfer_received','withdrawal','exchange'] as const;
export async function getWalletTransactions(req: Request, res: Response) {
  const query = z.object({ type: z.enum(types).optional(), currency: z.enum(['USD','COP','ARS','EUR']).optional(), page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().positive().max(100).default(20), from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional() }).safeParse(req.query);
  if (!query.success || (query.data.from && query.data.to && Date.parse(query.data.from) > Date.parse(query.data.to))) throw new AppError('Filtros de actividad inválidos', 400);
  return res.status(200).json(await listWalletTransactions({ ...query.data, userId: getAuthContext(req).userId }));
}
