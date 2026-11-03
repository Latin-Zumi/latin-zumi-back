import { describe, expect, it, vi } from 'vitest';
import { rateLimitHandler } from '../../middleware/rateLimitHandler.js';

describe('rateLimitHandler', () => {
  it('returns the API error envelope with status 429', () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    rateLimitHandler({} as never, res as never, vi.fn(), {} as never);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({ code: 'TOO_MANY_REQUESTS', message: 'Demasiadas solicitudes; intenta más tarde' });
  });
});
