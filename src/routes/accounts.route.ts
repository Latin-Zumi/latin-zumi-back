import { Router } from 'express';
import {
  getAccounts,
} from '../controllers/accounts.controller.js';
import { asyncHandler } from '../handlers/asyncHandler.js';
import { requireAuth } from '../middleware/requireAuth.js';

export const accountsRouter = Router();

accountsRouter.get(
  '/accounts',
  asyncHandler(requireAuth),
  asyncHandler(getAccounts),
);
