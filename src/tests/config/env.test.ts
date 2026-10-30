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
