import { beforeEach, describe, expect, it, vi } from 'vitest';

const { cert, getApps, initializeApp, getAuth, verifyIdToken } = vi.hoisted(() => ({
  cert: vi.fn((options: unknown) => options),
  getApps: vi.fn(),
  initializeApp: vi.fn(),
  getAuth: vi.fn(),
  verifyIdToken: vi.fn(),
}));

vi.mock('firebase-admin/app', () => ({
  cert,
  getApps,
  initializeApp,
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth,
}));

const firebaseApp = { name: 'test-app' };

function configureDatabaseEnvironment() {
  vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost:5432/test');
  vi.stubEnv('DB_HOST', '');
  vi.stubEnv('DB_NAME', '');
  vi.stubEnv('DB_USER', '');
  vi.stubEnv('DB_PASSWORD', '');
}

describe('verifyGoogleIdToken', () => {
  beforeEach(() => {
    configureDatabaseEnvironment();
    vi.stubEnv('FIREBASE_PROJECT_ID', 'test-project');
    vi.stubEnv('FIREBASE_CLIENT_EMAIL', 'firebase-admin@example.test');
    vi.stubEnv('FIREBASE_PRIVATE_KEY', 'line-one\\nline-two');
    getApps.mockReset().mockReturnValue([]);
    initializeApp.mockReset().mockReturnValue(firebaseApp);
    getAuth.mockReset().mockReturnValue({ verifyIdToken });
    verifyIdToken.mockReset().mockResolvedValue({
      uid: 'google-uid',
      email: 'ANA@example.com',
      email_verified: true,
      name: ' Ana Pérez ',
      picture: 'https://example.test/photo.png',
      firebase: { sign_in_provider: 'google.com' },
    });
    vi.resetModules();
  });

  it('initializes Firebase Admin lazily and returns a normalized Google identity', async () => {
    const { verifyGoogleIdToken } = await import('../../services/firebase-admin.service.js');

    await expect(verifyGoogleIdToken('firebase-token')).resolves.toEqual({
      googleUid: 'google-uid',
      email: 'ana@example.com',
      emailVerified: true,
      nombre: 'Ana Pérez',
      fotoUrl: 'https://example.test/photo.png',
    });
    expect(verifyIdToken).toHaveBeenCalledWith('firebase-token', true);
    expect(cert).toHaveBeenCalledWith({
      projectId: 'test-project',
      clientEmail: 'firebase-admin@example.test',
      privateKey: 'line-one\nline-two',
    });
    expect(initializeApp).toHaveBeenCalledOnce();
  });

  it('returns a controlled unavailable error when Firebase is not configured', async () => {
    vi.stubEnv('FIREBASE_PROJECT_ID', '');
    vi.stubEnv('FIREBASE_CLIENT_EMAIL', '');
    vi.stubEnv('FIREBASE_PRIVATE_KEY', '');
    vi.resetModules();
    const { verifyGoogleIdToken } = await import('../../services/firebase-admin.service.js');

    await expect(verifyGoogleIdToken('firebase-token')).rejects.toMatchObject({
      statusCode: 503,
      code: 'GOOGLE_AUTH_UNAVAILABLE',
    });
    expect(getAuth).not.toHaveBeenCalled();
  });

  it('maps Firebase Admin initialization failures to 503 without leaking details', async () => {
    initializeApp.mockImplementationOnce(() => {
      throw new Error('private key contents must not be exposed');
    });
    vi.resetModules();
    const { verifyGoogleIdToken } = await import('../../services/firebase-admin.service.js');

    await expect(verifyGoogleIdToken('firebase-token')).rejects.toMatchObject({
      statusCode: 503,
      code: 'GOOGLE_AUTH_UNAVAILABLE',
      message: 'El acceso con Google no está configurado correctamente',
    });
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('rejects unverified email and non-Google providers', async () => {
    const { verifyGoogleIdToken } = await import('../../services/firebase-admin.service.js');
    verifyIdToken.mockResolvedValueOnce({
      uid: 'google-uid',
      email: 'ana@example.com',
      email_verified: false,
      firebase: { sign_in_provider: 'google.com' },
    });

    await expect(verifyGoogleIdToken('unverified-token')).rejects.toMatchObject({
      statusCode: 401,
      code: 'GOOGLE_EMAIL_NOT_VERIFIED',
    });

    verifyIdToken.mockResolvedValueOnce({
      uid: 'firebase-uid',
      email: 'ana@example.com',
      email_verified: true,
      firebase: { sign_in_provider: 'password' },
    });
    await expect(verifyGoogleIdToken('other-provider-token')).rejects.toMatchObject({
      statusCode: 401,
      code: 'GOOGLE_PROVIDER_INVALID',
    });
  });

  it.each([
    'auth/invalid-id-token',
    'auth/id-token-expired',
    'auth/id-token-revoked',
  ])('maps Firebase token error %s to a controlled 401', async (code) => {
    const { verifyGoogleIdToken } = await import('../../services/firebase-admin.service.js');
    verifyIdToken.mockRejectedValueOnce(
      Object.assign(new Error('sensitive Firebase error details'), { code }),
    );

    await expect(verifyGoogleIdToken('revoked-token')).rejects.toMatchObject({
      statusCode: 401,
      code: 'GOOGLE_TOKEN_INVALID',
      message: 'No pudimos validar tu identidad de Google',
    });
  });

  it('maps a disabled Firebase user to a generic 403 without exposing Firebase details', async () => {
    const { verifyGoogleIdToken } = await import('../../services/firebase-admin.service.js');
    verifyIdToken.mockRejectedValueOnce(
      Object.assign(new Error('sensitive Firebase user and credential details'), {
        code: 'auth/user-disabled',
      }),
    );

    await expect(verifyGoogleIdToken('firebase-token')).rejects.toMatchObject({
      statusCode: 403,
      code: 'GOOGLE_ACCOUNT_DISABLED',
      message: 'Tu cuenta de Google no está habilitada',
    });
  });

  it.each([
    'app/network-error',
    'auth/internal-error',
    'auth/invalid-credential',
    'unknown/firebase-error',
  ])('maps Firebase service error %s to a controlled 503', async (code) => {
    const { verifyGoogleIdToken } = await import('../../services/firebase-admin.service.js');
    verifyIdToken.mockRejectedValueOnce(
      Object.assign(new Error('private credential and token details'), { code }),
    );

    await expect(verifyGoogleIdToken('firebase-token')).rejects.toMatchObject({
      statusCode: 503,
      code: 'GOOGLE_AUTH_UNAVAILABLE',
      message: 'El acceso con Google no está disponible temporalmente',
    });
  });

  it('maps Firebase errors without a code to a controlled 503', async () => {
    const { verifyGoogleIdToken } = await import('../../services/firebase-admin.service.js');
    verifyIdToken.mockRejectedValueOnce(
      new Error('private credential and token details'),
    );

    await expect(verifyGoogleIdToken('firebase-token')).rejects.toMatchObject({
      statusCode: 503,
      code: 'GOOGLE_AUTH_UNAVAILABLE',
      message: 'El acceso con Google no está disponible temporalmente',
    });
  });
});
