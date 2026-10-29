import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { findActiveSession, sendChatMessage } = vi.hoisted(() => ({
  findActiveSession: vi.fn(),
  sendChatMessage: vi.fn(),
}));

vi.mock('../services/auth.service.js', () => ({
  findActiveSession,
}));
vi.mock('../services/chat/chat.service.js', () => ({
  sendChatMessage,
}));

let server: Server;
let baseUrl: string;

describe('POST /chat/messages', () => {
  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('DB_HOST', 'localhost');
    vi.stubEnv('DB_PORT', '5432');
    vi.stubEnv('DB_NAME', 'chat-route-test');
    vi.stubEnv('DB_USER', 'chat-route-test');
    vi.stubEnv('DB_PASSWORD', 'chat-route-test');
    vi.stubEnv('PORT', '3000');

    const [{ chatRouter }, { errorHandler }] = await Promise.all([
      import('./chat.route.js'),
      import('../middleware/errorHandler.js'),
    ]);

    const app = express();
    app.use(express.json());
    app.use(chatRouter);
    app.use(errorHandler);

    await new Promise<void>((resolve, reject) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('No se pudo obtener la dirección del servidor de prueba'));
          return;
        }
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
      server.once('error', reject);
    });
  });

  beforeEach(() => {
    findActiveSession.mockReset();
    sendChatMessage.mockReset();
    findActiveSession.mockImplementation(async (token: string) => {
      if (token === 'valid-token') {
        return {
          userId: '20000000-0000-4000-8000-000000000001',
          sessionId: '30000000-0000-4000-8000-000000000001',
          passwordChangeRequired: false,
        };
      }
      return null;
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    }
    vi.unstubAllEnvs();
  });

  it('answers a valid authenticated message', async () => {
    sendChatMessage.mockResolvedValueOnce({
      message: 'Tu saldo es el que aparece en la cuenta',
      conversationId: 'cf998d0b-7af7-4d46-ae47-0e7b39f0d85c',
      suggestions: ['¿Cuáles son mis cuentas?'],
    });

    const response = await fetch(`${baseUrl}/chat/messages`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: '¿Cuánto dinero tengo?',
        conversationId: 'cf998d0b-7af7-4d46-ae47-0e7b39f0d85c',
        userId: 'user-2',
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        message: 'Tu saldo es el que aparece en la cuenta',
        conversationId: 'cf998d0b-7af7-4d46-ae47-0e7b39f0d85c',
        suggestions: ['¿Cuáles son mis cuentas?'],
      },
    });
    expect(sendChatMessage).toHaveBeenCalledWith({
      userId: '20000000-0000-4000-8000-000000000001',
      message: '¿Cuánto dinero tengo?',
      conversationId: 'cf998d0b-7af7-4d46-ae47-0e7b39f0d85c',
      history: undefined,
    });
  });

  it('requires authentication', async () => {
    const response = await fetch(`${baseUrl}/chat/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hola' }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: 'UNAUTHORIZED',
      message: 'Autenticación requerida',
    });
    expect(sendChatMessage).not.toHaveBeenCalled();
  });

  it('rejects empty or oversized messages', async () => {
    const emptyResponse = await fetch(`${baseUrl}/chat/messages`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: '' }),
    });

    expect(emptyResponse.status).toBe(400);

    const longMessage = 'a'.repeat(2001);
    const longResponse = await fetch(`${baseUrl}/chat/messages`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: longMessage }),
    });

    expect(longResponse.status).toBe(400);
  });
});
