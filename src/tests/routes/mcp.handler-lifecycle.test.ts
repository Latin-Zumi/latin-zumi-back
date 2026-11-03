import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mcpHandlerMocks = vi.hoisted(() => ({
  close: vi.fn(),
  fetch: vi.fn(),
  create: vi.fn(),
  failNodeHandler: false,
}));

vi.mock('@modelcontextprotocol/server', () => ({
  createMcpHandler: (...args: unknown[]) => {
    mcpHandlerMocks.create(...args);
    return {
      fetch: mcpHandlerMocks.fetch,
      close: mcpHandlerMocks.close,
    };
  },
}));

vi.mock('@modelcontextprotocol/node', () => ({
  toNodeHandler: () => async (_request: Request, response: Response) => {
    if (mcpHandlerMocks.failNodeHandler) {
      throw new Error('simulated MCP adapter failure');
    }
    response.status(200).end();
  },
}));

vi.mock('../../config/env.js', () => ({ env: { CORS_ORIGINS: [] } }));
vi.mock('../../mcp/tools.js', () => ({ createMcpServer: vi.fn() }));
vi.mock('../../mcp/auth.js', () => ({
  latinZumiSessionAuthProvider: {
    authenticate: (_req: Request, _res: Response, next: NextFunction) => next(),
    getAuthenticatedUserId: () => '20000000-0000-4000-8000-000000000001',
  },
}));

import { createMcpRouter } from '../../mcp/router.js';

let server: Server;
let baseUrl: string;

describe('MCP request handler lifecycle', () => {
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(createMcpRouter({
      allowedOrigins: [],
      rateLimiter: ((_req, _res, next) => next()) satisfies RequestHandler,
    }));
    app.use((
      _error: Error,
      _req: Request,
      res: Response,
      _next: NextFunction,
    ) => {
      res.status(500).json({ message: 'Internal error' });
    });

    await new Promise<void>((resolve, reject) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('No se pudo iniciar el servidor MCP de ciclo de vida'));
          return;
        }
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
      server.once('error', reject);
    });
  });

  beforeEach(() => {
    mcpHandlerMocks.close.mockReset();
    mcpHandlerMocks.fetch.mockReset();
    mcpHandlerMocks.create.mockReset();
    mcpHandlerMocks.failNodeHandler = false;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    }
  });

  async function sendRequest() {
    return fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    });
  }

  it('closes the request-scoped MCP handler after a successful response', async () => {
    const response = await sendRequest();

    expect(response.status).toBe(200);
    expect(mcpHandlerMocks.create).toHaveBeenCalledOnce();
    expect(mcpHandlerMocks.close).toHaveBeenCalledOnce();
  });

  it('closes the request-scoped MCP handler when the Node adapter throws', async () => {
    mcpHandlerMocks.failNodeHandler = true;

    const response = await sendRequest();

    expect(response.status).toBe(500);
    expect(mcpHandlerMocks.create).toHaveBeenCalledOnce();
    expect(mcpHandlerMocks.close).toHaveBeenCalledOnce();
  });
});
