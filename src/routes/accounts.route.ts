import { Router } from 'express';
import { getAccountBalance } from '../controllers/accounts.controller.js';
import { asyncHandler } from '../handlers/asyncHandler.js';

export const accountsRouter = Router();

accountsRouter.get('/accounts/:id/balance', asyncHandler(getAccountBalance));
