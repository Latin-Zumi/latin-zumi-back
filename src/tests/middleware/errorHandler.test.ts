import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { errorHandler } from '../../middleware/errorHandler.js';
import { AppError } from '../../utils/AppError.js';

describe('errorHandler', () => {
  let server: Server;
  let baseUrl: string;
  let warn: Mock;
  let error: Mock;

  beforeAll(async () => {
    const app = express();
    app.get('/boom', () => {
      throw new AppError('Ruta no encontrada', 404);
    });
    app.get('/boom-server-error', () => {
      throw new Error('Unexpected failure');
    });
    app.post('/parse', express.json(), (req, res) => {
      res.status(200).json({ ok: true });
    });
    app.post('/duplicate', (req, res, next) => {
      const err = new Error('duplicate key value violates unique constraint') as Error & { code?: string };
      err.code = '23505';
      next(err);
    });
    app.post('/invalid-reference', (req, res, next) => {
      const err = new Error('violates foreign key constraint') as Error & { code?: string };
      err.code = '23503';
      next(err);
    });
    app.post('/large', express.json({ limit: '100kb' }), (req, res) => {
      res.status(200).json({ ok: true });
    });
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
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((closeError) => (closeError ? reject(closeError) : resolve()));
        server.closeAllConnections();
      });
    }
  });

  it('responds 404 NOT_FOUND and logs a single warn line without stack', async () => {
    const response = await fetch(`${baseUrl}/boom?token=abc`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      code: 'NOT_FOUND',
      message: 'Ruta no encontrada',
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[404] NOT_FOUND GET /boom');
    expect(error).not.toHaveBeenCalled();
  });

  it('does not include the query string in the warn log', async () => {
    await fetch(`${baseUrl}/boom?token=abc`);

    expect(warn).toHaveBeenCalledWith('[404] NOT_FOUND GET /boom');
    expect(warn.mock.calls[0][0]).not.toContain('token=abc');
  });

  it('responds 500 INTERNAL_ERROR and logs via console.error with the error', async () => {
    const response = await fetch(`${baseUrl}/boom-server-error`);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Error interno del servidor',
    });
    expect(error).toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('responds 400 INVALID_JSON for malformed JSON bodies', async () => {
    const response = await fetch(`${baseUrl}/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid json',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'INVALID_JSON',
      message: 'JSON inválido en el body',
    });
    expect(warn).toHaveBeenCalledWith('[400] INVALID_JSON POST /parse');
    expect(error).not.toHaveBeenCalled();
  });

  it('responds 400 DUPLICATE_VALUE for unique constraint violations', async () => {
    const response = await fetch(`${baseUrl}/duplicate`, { method: 'POST' });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'DUPLICATE_VALUE',
      message: 'El valor ya existe (violación de unicidad)',
    });
    expect(warn).toHaveBeenCalledWith('[400] DUPLICATE_VALUE POST /duplicate');
  });

  it('responds 400 INVALID_REFERENCE for foreign key violations', async () => {
    const response = await fetch(`${baseUrl}/invalid-reference`, { method: 'POST' });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'INVALID_REFERENCE',
      message: 'Referencia inválida (foreign key)',
    });
    expect(warn).toHaveBeenCalledWith('[400] INVALID_REFERENCE POST /invalid-reference');
  });

  it('responds 413 PAYLOAD_TOO_LARGE for bodies over 100 KB', async () => {
    const response = await fetch(`${baseUrl}/large`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'x'.repeat(150 * 1024) }),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'El cuerpo de la solicitud supera el límite permitido de 100 KB',
    });
    expect(warn).toHaveBeenCalledWith('[413] PAYLOAD_TOO_LARGE POST /large');
  });
});
