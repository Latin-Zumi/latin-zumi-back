import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAccountsByUserId, getTransactionsByUserId, createGeminiProvider } = vi.hoisted(() => ({
  getAccountsByUserId: vi.fn(),
  getTransactionsByUserId: vi.fn(),
  createGeminiProvider: vi.fn(),
}));

vi.mock('../../../services/accounts.service.js', () => ({
  getAccountsByUserId,
}));
vi.mock('../../../services/transactions.service.js', () => ({
  getTransactionsByUserId,
}));
vi.mock('../../../services/chat/gemini-provider.js', () => ({
  createGeminiProvider,
  normalizeHistory: (history: unknown) => history,
}));

import { sendChatMessage } from '../../../services/chat/chat.service.js';

describe('sendChatMessage', () => {
  beforeEach(() => {
    getAccountsByUserId.mockReset();
    getTransactionsByUserId.mockReset();
    createGeminiProvider.mockReset();
  });

  it('uses account and transaction context without inventing data', async () => {
    getAccountsByUserId.mockResolvedValueOnce([
      { id: 'acc-1', user_id: 'user-1', currency: 'ARS', account_type: 'user', allow_negative: false, balance: '1500' },
    ]);
    getTransactionsByUserId.mockResolvedValueOnce({
      data: [{
        id: 'txn-1',
        description: 'Pago de servicio',
        occurred_at: new Date('2026-01-01T10:00:00Z'),
        entries: [{ amount: '1500', direction: 'debit', currency: 'ARS' }],
      }],
    });
    const generateReply = vi.fn().mockResolvedValueOnce({
      message: 'Tu saldo actual es $1500 ARS.',
      conversationId: 'conversation-1',
      suggestions: ['¿Qué más puedo consultar?'],
    });
    createGeminiProvider.mockReturnValue({
      generateReply,
    });

    const response = await sendChatMessage({
      userId: 'user-1',
      message: '¿Cuánto dinero tengo?',
      conversationId: 'conversation-1',
    });

    expect(response.message).toContain('1500');
    expect(getAccountsByUserId).toHaveBeenCalledWith('user-1');
    expect(getTransactionsByUserId).toHaveBeenCalledWith('user-1', { page: 1, limit: 5 });
    expect(createGeminiProvider).toHaveBeenCalled();
    expect(generateReply).toHaveBeenCalledWith(expect.objectContaining({
      context: {
        accounts: [{ currency: 'ARS', account_type: 'user', balance: '1500' }],
        recentTransactions: [{
          description: 'Pago de servicio',
          occurred_at: new Date('2026-01-01T10:00:00Z'),
          entries: [{ amount: '1500', direction: 'debit', currency: 'ARS' }],
        }],
      },
    }));
    expect(JSON.stringify(generateReply.mock.calls[0])).not.toContain('user-2');
  });

  it('rejects empty messages', async () => {
    await expect(sendChatMessage({ userId: 'user-1', message: '   ' })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('surfaces provider errors as controlled service failures', async () => {
    getAccountsByUserId.mockResolvedValueOnce([]);
    getTransactionsByUserId.mockResolvedValueOnce({ data: [] });
    createGeminiProvider.mockReturnValue({
      generateReply: vi.fn().mockRejectedValueOnce(new Error('upstream unavailable')),
    });

    await expect(sendChatMessage({ userId: 'user-1', message: 'Hola' })).rejects.toMatchObject({ statusCode: 503 });
  });
});
