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

export const passwordResetRequestRateLimit = rateLimit({
  ...commonOptions,
  limit: 5,
});

export const passwordResetEmailRateLimit = rateLimit({
  ...commonOptions,
  keyGenerator: (req) => {
    const email =
      typeof req.body?.email === 'string'
        ? req.body.email.trim().toLowerCase()
        : '';
    const emailHash = createHash('sha256').update(email).digest('hex');
    const clientIp = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    return `${ipKeyGenerator(clientIp)}:${emailHash}`;
  },
});

export const changePasswordRateLimit = rateLimit({
  ...commonOptions,
  limit: 10,
  keyGenerator: (req) => {
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const clientIp = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    return `${ipKeyGenerator(clientIp)}:${tokenHash}`;
  },
});

// Las cotizaciones consultan al proveedor de tasas y se pueden agotar rápido
export const quoteRateLimit = rateLimit({
  ...commonOptions,
  limit: 30,
  keyGenerator: (req) => {
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    return createHash('sha256').update(token).digest('hex');
  },
});
