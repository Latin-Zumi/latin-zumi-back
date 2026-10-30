import { Router } from 'express';
import {
  changePassword,
  login,
  loginGoogle,
  logout,
  register,
} from '../controllers/auth.controller.js';
import { asyncHandler } from '../handlers/asyncHandler.js';
import {
  loginIdentifierRateLimit,
  loginRateLimit,
  googleLoginRateLimit,
  registrationRateLimit,
} from '../middleware/loginRateLimit.js';
import { requireAuth } from '../middleware/requireAuth.js';

export const authRouter = Router();

authRouter.post(
  '/auth/register',
  registrationRateLimit,
  asyncHandler(register),
);
authRouter.post(
  '/auth/login',
  loginRateLimit,
  loginIdentifierRateLimit,
  asyncHandler(login),
);
authRouter.post(
  '/auth/google',
  googleLoginRateLimit,
  asyncHandler(loginGoogle),
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
