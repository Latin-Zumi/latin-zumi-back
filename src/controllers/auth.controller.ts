import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  changeUserPassword,
  loginWithPassword,
  registerAccount,
  revokeSession,
} from '../services/auth.service.js';
import { getAuthContext } from '../middleware/requireAuth.js';
import { AppError } from '../utils/AppError.js';
import { isPasswordLongEnough } from '../utils/password.js';

const loginSchema = z.object({
  identifier: z.string().trim().min(3).max(254).transform((value) => value.toLowerCase()),
  password: z.string().max(128),
});

const changePasswordSchema = z.object({
  current_password: z.string().min(1).max(128),
  new_password: z.string().max(128).refine(isPasswordLongEnough),
});

const nombreSchema = z
  .string()
  .trim()
  .min(2, 'Ingresá tu nombre')
  .max(50, 'El nombre no puede superar los 50 caracteres')
  .regex(
    /^[\p{L}\p{M}]+(?:[ '\u2019\u002D\u00B7.][\p{L}\p{M}]+)*$/u,
    'Ingresá un nombre válido, sin números',
  );

const registerSchema = z.object({
  nombre: nombreSchema,
  email: z
    .string()
    .trim()
    .email('Ingresá un email válido')
    .max(254)
    .transform((value) => value.toLowerCase()),
  pais: z.enum(['Argentina', 'Colombia', 'Otro']),
  password: z
    .string()
    .max(128)
    .refine(isPasswordLongEnough, 'La contraseña debe tener entre 15 y 128 caracteres'),
});

export async function register(req: Request, res: Response) {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError('Datos de registro inválidos', 400);

  const result = await registerAccount(parsed.data);
  return res.status(201).json(result);
}

export async function login(req: Request, res: Response) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError('Datos de login inválidos', 400);

  const { token, user } = await loginWithPassword(
    parsed.data.identifier,
    parsed.data.password,
  );
  return res.status(200).json({ token, user });
}

export async function logout(req: Request, res: Response) {
  const auth = getAuthContext(req);
  await revokeSession(auth.userId, auth.sessionId);
  return res.status(204).end();
}

export async function changePassword(req: Request, res: Response) {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('La contraseña nueva debe tener entre 15 y 128 caracteres', 400);
  }

  await changeUserPassword(
    getAuthContext(req),
    parsed.data.current_password,
    parsed.data.new_password,
  );
  return res.status(204).end();
}
