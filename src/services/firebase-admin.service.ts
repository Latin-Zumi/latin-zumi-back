import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

let firebaseApp: App | undefined;

function getFirebaseApp(): App {
  if (firebaseApp) return firebaseApp;

  const existing = getApps()[0];
  if (existing) {
    firebaseApp = existing;
    return firebaseApp;
  }

  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = env;
  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    throw new AppError(
      'El acceso con Google no está configurado',
      503,
      'GOOGLE_AUTH_UNAVAILABLE',
    );
  }

  try {
    firebaseApp = initializeApp({
      credential: cert({
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
    return firebaseApp;
  } catch {
    throw new AppError(
      'El acceso con Google no está configurado correctamente',
      503,
      'GOOGLE_AUTH_UNAVAILABLE',
    );
  }
}

export interface GoogleIdentity {
  googleUid: string;
  email: string;
  emailVerified: true;
  nombre: string | null;
  fotoUrl: string | null;
}

const INVALID_ID_TOKEN_CODES = new Set([
  'auth/invalid-id-token',
  'auth/id-token-expired',
  'auth/id-token-revoked',
]);

function isInvalidIdTokenError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const { code } = error as { code?: unknown };
  return typeof code === 'string' && INVALID_ID_TOKEN_CODES.has(code);
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  let firebaseAuth;
  let decoded;
  try {
    firebaseAuth = getAuth(getFirebaseApp());
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      'No fue posible inicializar la verificación de Google',
      503,
      'GOOGLE_AUTH_UNAVAILABLE',
    );
  }

  try {
    decoded = await firebaseAuth.verifyIdToken(idToken, true);
  } catch (error) {
    if (isInvalidIdTokenError(error)) {
      throw new AppError(
        'No pudimos validar tu identidad de Google',
        401,
        'GOOGLE_TOKEN_INVALID',
      );
    }
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'auth/user-disabled'
    ) {
      throw new AppError(
        'Tu cuenta de Google no está habilitada',
        403,
        'GOOGLE_ACCOUNT_DISABLED',
      );
    }
    throw new AppError(
      'El acceso con Google no está disponible temporalmente',
      503,
      'GOOGLE_AUTH_UNAVAILABLE',
    );
  }

  if (!decoded.email || decoded.email_verified !== true) {
    throw new AppError(
      'Google no confirmó tu email',
      401,
      'GOOGLE_EMAIL_NOT_VERIFIED',
    );
  }

  if (decoded.firebase.sign_in_provider !== 'google.com') {
    throw new AppError(
      'El token no proviene de Google',
      401,
      'GOOGLE_PROVIDER_INVALID',
    );
  }

  return {
    googleUid: decoded.uid,
    email: decoded.email.trim().toLowerCase(),
    emailVerified: true,
    nombre: decoded.name?.trim() || null,
    fotoUrl: decoded.picture ?? null,
  };
}
