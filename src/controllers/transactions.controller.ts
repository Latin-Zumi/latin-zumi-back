import type { Request, Response } from 'express';
import { z } from 'zod';
import { getTransactionById } from '../services/transactions.service.js';
import { AppError } from '../utils/AppError.js';
import { getAuthContext } from '../middleware/requireAuth.js';

const transactionIdSchema = z.string().uuid();

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
