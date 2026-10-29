import { Router } from 'express';
import { asyncHandler } from '../handlers/asyncHandler.js';
import { postChatMessage } from '../controllers/chat.controller.js';
import { requireAuth } from '../middleware/requireAuth.js';

export const chatRouter = Router();

chatRouter.post(
  '/chat/messages',
  asyncHandler(requireAuth),
  asyncHandler(postChatMessage),
);
