import { Router } from 'express';
import {
  getAccounts,
  getAccount,
  getAccountBalance,
  createIncoming,
  withdrawAccount,
} from '../controllers/accounts.controller.js';
import { asyncHandler } from '../handlers/asyncHandler.js';
import { requireAuth } from '../middleware/requireAuth.js';

export const accountsRouter = Router();

accountsRouter.get(
  '/accounts',
  asyncHandler(requireAuth),
  asyncHandler(getAccounts),
);

// Debe registrarse después de la ruta específica para que "balance" no se
// interprete como un UUID dentro de /accounts/:id.
accountsRouter.get(
  '/accounts/:id/balance',
  asyncHandler(requireAuth),
  asyncHandler(getAccountBalance),
);
accountsRouter.post(
  '/accounts/:id/incoming',
  asyncHandler(requireAuth),
  asyncHandler(createIncoming),
);
accountsRouter.post(
  '/accounts/:id/withdraw',
  asyncHandler(requireAuth),
  asyncHandler(withdrawAccount),
);
accountsRouter.get(
  '/accounts/:id',
  asyncHandler(requireAuth),
  asyncHandler(getAccount),
);
