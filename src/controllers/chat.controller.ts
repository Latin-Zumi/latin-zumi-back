import type { Request, Response } from 'express';
import { z } from 'zod';
import { getAuthContext } from '../middleware/requireAuth.js';
import { sendChatMessage } from '../services/chat/chat.service.js';
import { AppError } from '../utils/AppError.js';

const chatMessageSchema = z.object({
  message: z.string().min(1).max(2000),
  conversationId: z.string().uuid().optional(),
  history: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string().min(1).max(2000),
    }),
  ).max(10).optional(),
});

export async function postChatMessage(req: Request, res: Response): Promise<void> {
  const parsed = chatMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('Mensaje del chatbot inválido', 400);
  }

  const reply = await sendChatMessage({
    userId: getAuthContext(req).userId,
    message: parsed.data.message,
    conversationId: parsed.data.conversationId,
    history: parsed.data.history,
  });

  res.status(200).json({ data: reply });
}
