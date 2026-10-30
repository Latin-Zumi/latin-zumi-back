import { Router } from 'express';
import {
  createUser,
  lookupUser,
  updateMe,
} from '../controllers/users.controller.js';
import { asyncHandler } from '../handlers/asyncHandler.js';
import { registrationRateLimit } from '../middleware/loginRateLimit.js';
import { requireAuth } from '../middleware/requireAuth.js';

export const usersRouter = Router();

usersRouter.post('/users', registrationRateLimit, asyncHandler(createUser));
usersRouter.get('/users/lookup', asyncHandler(requireAuth), asyncHandler(lookupUser));
usersRouter.patch('/users/me', asyncHandler(requireAuth), asyncHandler(updateMe));
