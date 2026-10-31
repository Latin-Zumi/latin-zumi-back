import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../handlers/asyncHandler.js';
import { latinZumiSessionAuthProvider, type McpAuthProvider } from './auth.js';
import { createMcpServer, type McpToolServices } from './tools.js';

export interface McpRouterOptions {
  authProvider?: McpAuthProvider;
  services?: McpToolServices;
  allowedOrigins?: readonly string[];
  rateLimiter?: RequestHandler;
}

export function createMcpOriginValidator(
  allowedOrigins: readonly string[] = env.CORS_ORIGINS,
): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, _res, next) => {
    const origin = req.get('Origin');
    if (origin && !allowed.has(origin)) {
      next(new AppError('Origen no permitido', 403, 'ORIGIN_NOT_ALLOWED'));
      return;
    }

    next();
  };
}

const mcpRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

export function createMcpRouter(options: McpRouterOptions = {}): Router {
  const router = Router();
  const authProvider = options.authProvider ?? latinZumiSessionAuthProvider;
  const services = options.services;
  const originValidator = createMcpOriginValidator(options.allowedOrigins);
  const limiter = options.rateLimiter ?? mcpRateLimiter;

  router.all(
    '/mcp',
    limiter,
    authProvider.authenticate,
    originValidator,
    asyncHandler(async (req, res) => {
      const userId = z.string().uuid().safeParse(
        authProvider.getAuthenticatedUserId(req),
      );
      if (!userId.success) {
        throw new AppError('Autenticación requerida', 401);
      }

      const handler = createMcpHandler(
        () => createMcpServer(userId.data, services),
        { responseMode: 'json' },
      );
      const nodeHandler = toNodeHandler({
        fetch: (request) => handler.fetch(request),
      });
      const requestWithoutAuth: Omit<typeof req, 'auth'> = Object.create(req);
      Object.defineProperty(requestWithoutAuth, 'auth', { value: undefined });

      try {
        await nodeHandler(requestWithoutAuth, res, req.body);
      } finally {
        await handler.close();
      }
    }),
  );

  return router;
}
