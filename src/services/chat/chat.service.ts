import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { getAccountsByUserId } from '../accounts.service.js';
import { getTransactionsByUserId } from '../transactions.service.js';
import { createGeminiProvider, normalizeHistory } from './gemini-provider.js';
import type { ChatHistoryEntry, ChatProviderReply } from './chat-provider.js';

export interface ChatMessageInput {
  userId: string;
  message: string;
  conversationId?: string;
  history?: ChatHistoryEntry[];
}

export interface ChatServiceReply extends ChatProviderReply {}

export async function sendChatMessage(input: ChatMessageInput): Promise<ChatServiceReply> {
  const message = input.message.trim();
  if (!message) {
    throw new AppError('El mensaje es obligatorio', 400);
  }
  if (message.length > 2000) {
    throw new AppError('El mensaje es demasiado largo', 400);
  }

  const conversationId = input.conversationId ?? randomUUID();
  const safeHistory = normalizeHistory(input.history)?.slice(-10) ?? [];

  const accounts = await getAccountsByUserId(input.userId);
  const recentTransactions = await getTransactionsByUserId(input.userId, {
    page: 1,
    limit: 5,
  });

  const provider = createGeminiProvider(env.GEMINI_API_KEY ?? '', env.GEMINI_MODEL);
  try {
    const response = await provider.generateReply({
      conversationId,
      message,
      history: safeHistory,
      context: {
        accounts: accounts.map((account) => ({
          currency: account.currency,
          account_type: account.account_type,
          balance: account.balance,
        })),
        recentTransactions: (recentTransactions?.data ?? []).map((transaction) => ({
          description: transaction.description,
          occurred_at: transaction.occurred_at,
          entries: transaction.entries.map((entry) => ({
            amount: entry.amount,
            direction: entry.direction,
            currency: entry.currency,
          })),
        })),
      },
    });

    return response;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError('No fue posible generar la respuesta del asistente', 503);
  }
}
