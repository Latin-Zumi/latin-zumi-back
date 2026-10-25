import { Router } from 'express';
import {
  getAccount,
  getAccountBalance,
} from '../controllers/accounts.controller.js';
import { asyncHandler } from '../handlers/asyncHandler.js';

export const accountsRouter = Router();

// Debe registrarse después de la ruta específica para que "balance" no se
// interprete como un UUID dentro de /accounts/:id.
accountsRouter.get('/accounts/:id/balance', asyncHandler(getAccountBalance));
accountsRouter.get('/accounts/:id', asyncHandler(getAccount));
