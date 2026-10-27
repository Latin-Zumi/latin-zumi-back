import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  getTransactionById,
  getTransactionsByUserId,
} from '../services/transactions.service.js';
import { AppError } from '../utils/AppError.js';
import { getAuthContext } from '../middleware/requireAuth.js';

const transactionIdSchema = z.string().uuid();
const historyQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  account_id: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
}).refine(
  ({ from, to, page, limit }) =>
    (!from || !to || new Date(from) <= new Date(to)) &&
    Number.isSafeInteger((page - 1) * limit),
);

export async function getTransactions(req: Request, res: Response) {
  const parsed = historyQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new AppError('Filtros de historial inválidos', 400);
  }

  const history = await getTransactionsByUserId(
    getAuthContext(req).userId,
    parsed.data,
  );
  if (!history) {
    throw new AppError('Cuenta no encontrada', 404);
  }

  return res.status(200).json(history);
}

export async function getTransaction(req: Request, res: Response) {
  const parsedId = transactionIdSchema.safeParse(req.params.id);
  if (!parsedId.success) {
    throw new AppError('ID de transacción inválido', 400);
  }

  const transaction = await getTransactionById(
    parsedId.data,
    getAuthContext(req).userId,
  );
  if (!transaction) {
    throw new AppError('Transacción no encontrada', 404);
  }

  return res.status(200).json({ data: transaction });
}
