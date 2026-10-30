import { createHash } from 'node:crypto';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';

const commonOptions = {
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8' as const,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos; intenta más tarde' },
};

export const loginRateLimit = rateLimit(commonOptions);
export const googleLoginRateLimit = rateLimit({
  ...commonOptions,
  limit: 10,
});
export const loginIdentifierRateLimit = rateLimit({
  ...commonOptions,
  keyGenerator: (req) => {
    const identifier =
      typeof req.body?.identifier === 'string'
        ? req.body.identifier.trim().toLowerCase()
        : '';
    const identifierHash = createHash('sha256').update(identifier).digest('hex');
    const clientIp = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    return `${ipKeyGenerator(clientIp)}:${identifierHash}`;
  },
});
export const registrationRateLimit = rateLimit({
  ...commonOptions,
  limit: 10,
});
