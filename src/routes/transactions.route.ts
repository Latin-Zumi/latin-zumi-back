import { Router } from 'express';
import { getTransaction } from '../controllers/transactions.controller.js';
import { asyncHandler } from '../handlers/asyncHandler.js';

export const transactionsRouter = Router();

transactionsRouter.get('/transactions/:id', asyncHandler(getTransaction));
