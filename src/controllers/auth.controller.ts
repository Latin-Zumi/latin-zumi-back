import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  changeUserPassword,
  loginWithGoogle,
  loginWithPassword,
  registerAccount,
  revokeSession,
} from '../services/auth.service.js';
import { getAuthContext } from '../middleware/requireAuth.js';
import {
  firstIssueMessage,
  loginPasswordSchema,
  passwordSchema,
} from '../schemas/password.js';
import { nombreSchema, paisSchema } from '../schemas/profile.js';
import { AppError } from '../utils/AppError.js';
import {
  requestPasswordReset,
  resetPassword,
} from '../services/password-reset.service.js';

const loginSchema = z.object({
  identifier: z.string().trim().min(3).max(254).transform((value) => value.toLowerCase()),
  password: loginPasswordSchema,
});

const changePasswordSchema = z.object({
  current_password: z.string().min(1).max(128),
  new_password: passwordSchema,
});

const registerSchema = z.object({
  nombre: nombreSchema,
  email: z
    .string()
    .trim()
    .email('Ingresá un email válido')
    .max(254)
    .transform((value) => value.toLowerCase()),
  pais: paisSchema,
  password: passwordSchema,
});

const googleLoginSchema = z.object({
  idToken: z.string().min(20).max(8192),
});

const forgotPasswordSchema = z.object({
  email: z
    .string()
    .trim()
    .email('Ingresá un email válido')
    .max(254)
    .transform((value) => value.toLowerCase()),
});

export async function register(req: Request, res: Response) {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(
      firstIssueMessage(parsed.error, 'Datos de registro inválidos', 'password'),
      400,
    );
  }

  const { token, user } = await registerAccount(parsed.data);
  return res.status(201).json({ token, user, password_change_required: false });
}

export async function login(req: Request, res: Response) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError('Datos de login inválidos', 400);

  const { token, user, passwordChangeRequired } = await loginWithPassword(
    parsed.data.identifier,
    parsed.data.password,
  );
  return res.status(200).json({
    token,
    user,
    password_change_required: passwordChangeRequired,
  });
}

export async function loginGoogle(req: Request, res: Response) {
  const parsed = googleLoginSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError('Datos de Google inválidos', 400);

  const { token, user, passwordChangeRequired } = await loginWithGoogle(
    parsed.data.idToken,
  );
  return res.status(200).json({
    token,
    user,
    password_change_required: passwordChangeRequired,
  });
}

export async function logout(req: Request, res: Response) {
  const auth = getAuthContext(req);
  await revokeSession(auth.userId, auth.sessionId);
  return res.status(204).end();
}

export async function changePassword(req: Request, res: Response) {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(
      firstIssueMessage(parsed.error, 'Datos de contraseña inválidos', 'new_password'),
      400,
    );
  }

  await changeUserPassword(
    getAuthContext(req),
    parsed.data.current_password,
    parsed.data.new_password,
  );
  return res.status(204).end();
}

const resetPasswordSchema = z.object({
  token: z.string().min(32).max(128),
  password: passwordSchema,
});

export async function forgotPassword(req: Request, res: Response) {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('Email inválido', 400);
  }

  await requestPasswordReset(parsed.data.email, req.ip ?? null);
  return res.status(202).json({
    message:
      'Si el email está registrado, te enviamos instrucciones para restablecer la contraseña.',
  });
}

export async function resetPasswordHandler(req: Request, res: Response) {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(
      firstIssueMessage(parsed.error, 'Datos de recuperación inválidos', 'password'),
      400,
    );
  }

  await resetPassword(parsed.data.token, parsed.data.password);
  return res.status(204).end();
}
