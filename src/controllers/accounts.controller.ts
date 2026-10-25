import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  getAccountById,
  getBalanceByAccountId,
} from '../services/accounts.service.js';
import { AppError } from '../utils/AppError.js';

const accountIdSchema = z.string().uuid();

export async function getAccount(req: Request, res: Response) {
  const parsedId = accountIdSchema.safeParse(req.params.id);
  if (!parsedId.success) {
    throw new AppError('ID de cuenta inválido', 400);
  }

  const account = await getAccountById(parsedId.data);
  if (!account) {
    throw new AppError('Cuenta no encontrada', 404);
  }

  return res.status(200).json({ data: account });
}

export async function getAccountBalance(req: Request, res: Response) {
  const parsedId = accountIdSchema.safeParse(req.params.id);
  if (!parsedId.success) {
    throw new AppError('ID de cuenta inválido', 400);
  }

  const balance = await getBalanceByAccountId(parsedId.data);
  if (!balance) {
    throw new AppError('Cuenta no encontrada', 404);
  }

  return res.status(200).json({ data: balance });
}
