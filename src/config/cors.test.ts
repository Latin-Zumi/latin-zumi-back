import express, { type Express } from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const servers: Server[] = [];

function configureDatabaseEnvironment() {
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('DB_HOST', 'localhost');
  vi.stubEnv('DB_NAME', 'cors-test');
  vi.stubEnv('DB_USER', 'cors-test');
  vi.stubEnv('DB_PASSWORD', 'cors-test');
  vi.stubEnv('DB_PORT', '5432');
  vi.stubEnv('PORT', '3000');
}

async function listen(app: Express): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('No se pudo obtener la dirección del servidor de prueba'));
        return;
      }

      servers.push(server);
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
    server.once('error', reject);
  });
}

describe('CORS allowlist', () => {
  beforeAll(() => {
    configureDatabaseEnvironment();
  });

  afterAll(async () => {
    await Promise.all(
      servers.map((server) => new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      })),
    );
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('defaults an empty allowlist safely and rejects invalid origins', async () => {
    vi.stubEnv('CORS_ORIGINS', '');
    vi.resetModules();
    const { env: emptyEnv } = await import('./env.js');
    expect(emptyEnv.CORS_ORIGINS).toEqual([]);

    vi.stubEnv('CORS_ORIGINS', 'https://frontend.example/path');
    vi.resetModules();
    await expect(import('./env.js')).rejects.toThrow(/CORS_ORIGINS/);
  });

  it('allows configured origins, denies others, permits requests without Origin, and handles preflight', async () => {
    vi.stubEnv('CORS_ORIGINS', 'https://frontend.example, https://admin.example');
    vi.resetModules();
    const { app } = await import('../server.js');
    const { baseUrl } = await listen(app);

    const allowedResponse = await fetch(`${baseUrl}/health`, {
      headers: { Origin: 'https://frontend.example' },
    });
    expect(allowedResponse.status).toBe(200);
    expect(allowedResponse.headers.get('access-control-allow-origin')).toBe('https://frontend.example');

    const deniedResponse = await fetch(`${baseUrl}/health`, {
      headers: { Origin: 'https://untrusted.example' },
    });
    expect(deniedResponse.status).toBe(200);
    expect(deniedResponse.headers.get('access-control-allow-origin')).toBeNull();

    const noOriginResponse = await fetch(`${baseUrl}/health`);
    expect(noOriginResponse.status).toBe(200);
    expect(noOriginResponse.headers.get('access-control-allow-origin')).toBeNull();

    const preflightResponse = await fetch(`${baseUrl}/auth/login`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://frontend.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type,idempotency-key',
      },
    });
    expect(preflightResponse.status).toBe(204);
    expect(preflightResponse.headers.get('access-control-allow-origin')).toBe('https://frontend.example');
    expect(preflightResponse.headers.get('access-control-allow-methods')).toContain('POST');
    const allowedHeaders = preflightResponse.headers.get('access-control-allow-headers')?.toLowerCase();
    expect(allowedHeaders).toContain('authorization');
    expect(allowedHeaders).toContain('content-type');
    expect(allowedHeaders).toContain('idempotency-key');
  });

  it('does not authorize browser origins when the allowlist is empty', async () => {
    const { createCorsMiddleware } = await import('./cors.js');
    const testApp = express();
    testApp.use(createCorsMiddleware([]));
    testApp.get('/health', (_request, response) => response.status(200).json({ status: 'ok' }));

    const { baseUrl } = await listen(testApp);
    const response = await fetch(`${baseUrl}/health`, {
      headers: { Origin: 'https://frontend.example' },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});
