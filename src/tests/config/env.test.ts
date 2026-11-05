import { afterEach, describe, expect, it, vi } from 'vitest';

function configureDatabaseEnvironment() {
  vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost:5432/test');
  vi.stubEnv('DB_HOST', '');
  vi.stubEnv('DB_NAME', '');
  vi.stubEnv('DB_USER', '');
  vi.stubEnv('DB_PASSWORD', '');
}

describe('Firebase environment configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('allows Google auth to remain disabled when all Firebase variables are empty', async () => {
    configureDatabaseEnvironment();
    vi.stubEnv('FIREBASE_PROJECT_ID', '');
    vi.stubEnv('FIREBASE_CLIENT_EMAIL', '');
    vi.stubEnv('FIREBASE_PRIVATE_KEY', '');
    vi.resetModules();

    const { env } = await import('../../config/env.js');

    expect(env.FIREBASE_PROJECT_ID).toBeUndefined();
    expect(env.FIREBASE_CLIENT_EMAIL).toBeUndefined();
    expect(env.FIREBASE_PRIVATE_KEY).toBeUndefined();
  });

  it('rejects a partial Firebase Admin configuration', async () => {
    configureDatabaseEnvironment();
    vi.stubEnv('FIREBASE_PROJECT_ID', 'test-project');
    vi.stubEnv('FIREBASE_CLIENT_EMAIL', '');
    vi.stubEnv('FIREBASE_PRIVATE_KEY', '');
    vi.resetModules();

    await expect(import('../../config/env.js')).rejects.toThrow(
      /FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL y FIREBASE_PRIVATE_KEY juntas/,
    );
  });

  it('accepts a complete Firebase Admin configuration', async () => {
    configureDatabaseEnvironment();
    vi.stubEnv('FIREBASE_PROJECT_ID', 'test-project');
    vi.stubEnv('FIREBASE_CLIENT_EMAIL', 'firebase-admin@example.test');
    vi.stubEnv('FIREBASE_PRIVATE_KEY', 'private-key-for-test');
    vi.resetModules();

    const { env } = await import('../../config/env.js');

    expect(env.FIREBASE_PROJECT_ID).toBe('test-project');
    expect(env.FIREBASE_CLIENT_EMAIL).toBe('firebase-admin@example.test');
    expect(env.FIREBASE_PRIVATE_KEY).toBe('private-key-for-test');
  });
});

describe('Email environment configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('defaults SES_FROM_EMAIL and password reset TTL', async () => {
    configureDatabaseEnvironment();
    vi.stubEnv('EMAIL_PROVIDER', 'console');
    vi.stubEnv('AWS_REGION', '');
    vi.stubEnv('AWS_ACCESS_KEY_ID', '');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', '');
    vi.stubEnv('SES_FROM_EMAIL', undefined);
    vi.stubEnv('PASSWORD_RESET_TTL_MINUTES', undefined);
    vi.resetModules();

    const { env } = await import('../../config/env.js');

    expect(env.SES_FROM_EMAIL).toBe('Latin Zumi <no-reply@latinzumi.com>');
    expect(env.PASSWORD_RESET_TTL_MINUTES).toBe(60);
  });

  it('rejects SES when any AWS credential setting is missing', async () => {
    configureDatabaseEnvironment();
    vi.stubEnv('EMAIL_PROVIDER', 'ses');
    vi.stubEnv('AWS_REGION', 'us-east-1');
    vi.stubEnv('AWS_ACCESS_KEY_ID', '');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'secret-for-test');
    vi.resetModules();

    await expect(import('../../config/env.js')).rejects.toThrow(
      /AWS_REGION, AWS_ACCESS_KEY_ID y AWS_SECRET_ACCESS_KEY son obligatorias con EMAIL_PROVIDER=ses/,
    );
  });
});

describe('Gemini environment configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('defaults GEMINI_MODEL to gemini-3.5-flash-lite when empty', async () => {
    configureDatabaseEnvironment();
    vi.stubEnv('GEMINI_MODEL', '');
    vi.stubEnv('GEMINI_API_KEY', '');
    vi.stubEnv('FIREBASE_PROJECT_ID', '');
    vi.stubEnv('FIREBASE_CLIENT_EMAIL', '');
    vi.stubEnv('FIREBASE_PRIVATE_KEY', '');
    vi.resetModules();

    const { env } = await import('../../config/env.js');

    expect(env.GEMINI_MODEL).toBe('gemini-3.5-flash-lite');
  });
});
