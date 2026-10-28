import { Router } from 'express';
import { createUser } from '../controllers/users.controller.js';
import { asyncHandler } from '../handlers/asyncHandler.js';
import { registrationRateLimit } from '../middleware/loginRateLimit.js';

export const usersRouter = Router();

usersRouter.post('/users', registrationRateLimit, asyncHandler(createUser));
