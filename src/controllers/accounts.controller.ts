import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  getAccountById,
  getBalanceByAccountId,
} from '../services/accounts.service.js';
import { AppError } from '../utils/AppError.js';

const accountIdSchema = z.string().uuid();

function parseAccountId(value: string | string[] | undefined): string {
  const parsedId = accountIdSchema.safeParse(value);
  if (!parsedId.success) {
    throw new AppError('ID de cuenta inválido', 400);
  }

  return parsedId.data;
}

export async function getAccount(req: Request, res: Response) {
  const accountId = parseAccountId(req.params.id);
  const account = await getAccountById(accountId);
  if (!account) {
    throw new AppError('Cuenta no encontrada', 404);
  }

  return res.status(200).json({ data: account });
}

export async function getAccountBalance(req: Request, res: Response) {
  const accountId = parseAccountId(req.params.id);
  const balance = await getBalanceByAccountId(accountId);
  if (!balance) {
    throw new AppError('Cuenta no encontrada', 404);
  }

  return res.status(200).json({ data: balance });
}
