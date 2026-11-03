import { Router } from 'express';
import {
  lookupUser,
  updateMe,
} from '../controllers/users.controller.js';
import { asyncHandler } from '../handlers/asyncHandler.js';
import { requireAuth } from '../middleware/requireAuth.js';

export const usersRouter = Router();

usersRouter.get('/users/lookup', asyncHandler(requireAuth), asyncHandler(lookupUser));
usersRouter.patch('/users/me', asyncHandler(requireAuth), asyncHandler(updateMe));
