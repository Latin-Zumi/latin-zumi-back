import type { Request, RequestHandler } from 'express';
import { getAuthContext, requireAuth } from '../middleware/requireAuth.js';
import { asyncHandler } from '../handlers/asyncHandler.js';

export interface McpAuthProvider {
  authenticate: RequestHandler;
  getAuthenticatedUserId(request: Request): string;
}

export const latinZumiSessionAuthProvider: McpAuthProvider = {
  authenticate: asyncHandler(requireAuth),
  getAuthenticatedUserId(request) {
    return getAuthContext(request).userId;
  },
};
