import { Router } from 'express';
import { createUser } from '../controllers/users.controller.js';
import { asyncHandler } from '../handlers/asyncHandler.js';

export const usersRouter = Router();

usersRouter.post('/users', asyncHandler(createUser));
