import { Router } from 'express';
import {
  changePassword,
  login,
  logout,
} from '../controllers/auth.controller.js';
import { asyncHandler } from '../handlers/asyncHandler.js';
import {
  loginIdentifierRateLimit,
  loginRateLimit,
} from '../middleware/loginRateLimit.js';
import { requireAuth } from '../middleware/requireAuth.js';

export const authRouter = Router();

authRouter.post(
  '/auth/login',
  loginRateLimit,
  loginIdentifierRateLimit,
  asyncHandler(login),
);
authRouter.post(
  '/auth/change-password',
  asyncHandler(requireAuth),
  asyncHandler(changePassword),
);
authRouter.post(
  '/auth/logout',
  asyncHandler(requireAuth),
  asyncHandler(logout),
);
