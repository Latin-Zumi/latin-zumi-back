import type { Request, Response } from 'express';
import {
  getAccountsByUserId,
} from '../services/accounts.service.js';
import { getAuthContext } from '../middleware/requireAuth.js';

export async function getAccounts(req: Request, res: Response) {
  const accounts = await getAccountsByUserId(getAuthContext(req).userId);
  return res.status(200).json({ data: accounts });
}
