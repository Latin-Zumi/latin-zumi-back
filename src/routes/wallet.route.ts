import { Router } from 'express';
import { transfer, getWalletTransactions } from '../controllers/wallet.controller.js';
import { asyncHandler } from '../handlers/asyncHandler.js';
import { requireAuth } from '../middleware/requireAuth.js';

export const walletRouter = Router();
walletRouter.post('/wallet/transfers', asyncHandler(requireAuth), asyncHandler(transfer));
walletRouter.get('/wallet/transactions', asyncHandler(requireAuth), asyncHandler(getWalletTransactions));
