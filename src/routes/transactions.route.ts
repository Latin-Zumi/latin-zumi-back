import { Router } from 'express';
import {
  getTransaction,
  getTransactions,
} from '../controllers/transactions.controller.js';
import { asyncHandler } from '../handlers/asyncHandler.js';
import { requireAuth } from '../middleware/requireAuth.js';

export const transactionsRouter = Router();

transactionsRouter.get(
  '/transactions',
  asyncHandler(requireAuth),
  asyncHandler(getTransactions),
);
transactionsRouter.get(
  '/transactions/:id',
  asyncHandler(requireAuth),
  asyncHandler(getTransaction),
);
