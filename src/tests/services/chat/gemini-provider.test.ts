import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateContent } = vi.hoisted(() => ({
  generateContent: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent };

    constructor(_options: { apiKey: string }) {}
  },
}));

import { GeminiChatProvider } from '../../../services/chat/gemini-provider.js';

describe('GeminiChatProvider', () => {
  beforeEach(() => {
    generateContent.mockReset();
    generateContent.mockResolvedValue({ text: 'Respuesta del asistente.' });
  });

  it('sends readable minimal financial context without exposing executable tools', async () => {
    const provider = new GeminiChatProvider('test-key-not-real', 'test-model');

    await provider.generateReply({
      conversationId: 'conversation-1',
      message: '¿Cuál es mi saldo?',
      context: {
        accounts: [
          { account_type: 'user', balance: '1500.00', currency: 'ARS' },
        ],
        recentTransactions: [
          {
            occurred_at: '2026-01-01',
            description: 'Pago de servicio',
            entries: [{ direction: 'debit', amount: '250.00', currency: 'ARS' }],
          },
        ],
      },
    });

    const providerRequest = generateContent.mock.calls[0]?.[0];
    const serializedRequest = JSON.stringify(providerRequest);

    expect(serializedRequest).toContain('Tipo: user; saldo: 1500.00 ARS');
    expect(serializedRequest).toContain('Pago de servicio');
    expect(serializedRequest).toContain('debit:250.00 ARS');
    expect(serializedRequest).not.toContain('[object Object]');
    expect(serializedRequest).not.toContain('userId');
    expect(serializedRequest).not.toContain('"tools"');
    expect(serializedRequest).toContain('No tienes herramientas para ejecutar código, consultas SQL ni operaciones financieras');
  });
});
