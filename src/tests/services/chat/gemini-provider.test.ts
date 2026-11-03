import { beforeEach, describe, expect, it, vi } from 'vitest';

const { close, connect, generateContent } = vi.hoisted(() => ({
  close: vi.fn().mockResolvedValue(undefined),
  connect: vi.fn().mockResolvedValue(undefined),
  generateContent: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent };

    constructor(_options: { apiKey: string }) {}
  },
  mcpToTool: (tool: unknown) => ({ type: 'mcp_tool', tool }),
}));

vi.mock('@modelcontextprotocol/client', () => ({
  Client: class {
    connect = connect;
    close = close;
  },
  StreamableHTTPClientTransport: class {
    constructor(_url: URL, _options?: unknown) {}
  },
}));

import { GeminiChatProvider } from '../../../services/chat/gemini-provider.js';

describe('GeminiChatProvider', () => {
  beforeEach(() => {
    close.mockReset().mockResolvedValue(undefined);
    connect.mockReset().mockResolvedValue(undefined);
    generateContent.mockReset();
    generateContent.mockResolvedValue({ text: 'Respuesta del asistente.' });
  });

  it('sends readable minimal financial context and attaches the authenticated MCP tool when available', async () => {
    const provider = new GeminiChatProvider('test-key-not-real', 'test-model', {
      authorizationHeader: 'Bearer test-token',
      mcpServerUrl: 'http://localhost:3000',
    });

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

    expect(providerRequest.config.tools).toHaveLength(1);
    expect(serializedRequest).toContain('Tipo: user; saldo: 1500.00 ARS');
    expect(serializedRequest).toContain('Pago de servicio');
    expect(serializedRequest).toContain('debit:250.00 ARS');
    expect(serializedRequest).not.toContain('[object Object]');
    expect(serializedRequest).not.toContain('userId');
    expect(serializedRequest).toContain('mcp_tool');
    expect(serializedRequest).toContain('No tienes herramientas para ejecutar código, consultas SQL ni operaciones financieras');
  });

  it('closes the MCP client and falls back to Gemini without tools when MCP connection fails', async () => {
    connect.mockRejectedValueOnce(new Error('MCP unavailable'));
    const provider = new GeminiChatProvider('test-key-not-real', 'test-model', {
      authorizationHeader: '******',
      mcpServerUrl: 'http://localhost:3000',
    });

    await expect(provider.generateReply({
      conversationId: 'conversation-2',
      message: '¿Cómo funciona LATIN ZUMI?',
    })).resolves.toMatchObject({
      message: 'Respuesta del asistente.',
    });

    expect(generateContent).toHaveBeenCalledOnce();
    expect(generateContent.mock.calls[0]?.[0].config).toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
  });
});
