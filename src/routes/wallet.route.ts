import { Router } from 'express';
import { transfer, getWalletTransactions, deposit, getExchangeQuote, exchange, getWalletRatesHandler } from '../controllers/wallet.controller.js';
import { asyncHandler } from '../handlers/asyncHandler.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { quoteRateLimit, ratesRateLimit } from '../middleware/loginRateLimit.js';

export const walletRouter = Router();
walletRouter.post('/wallet/transfers', asyncHandler(requireAuth), asyncHandler(transfer));
walletRouter.post('/wallet/deposits', asyncHandler(requireAuth), asyncHandler(deposit));
walletRouter.get('/wallet/exchange/quote', quoteRateLimit, asyncHandler(requireAuth), asyncHandler(getExchangeQuote));
walletRouter.post('/wallet/exchanges', asyncHandler(requireAuth), asyncHandler(exchange));
walletRouter.get('/wallet/rates', asyncHandler(requireAuth), ratesRateLimit, asyncHandler(getWalletRatesHandler));
walletRouter.get('/wallet/transactions', asyncHandler(requireAuth), asyncHandler(getWalletTransactions));
