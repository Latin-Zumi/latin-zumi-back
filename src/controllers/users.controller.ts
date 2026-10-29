import type { Request, Response } from 'express';
import { z } from 'zod';
import { findUserByEmail, registerUser } from '../services/users.service.js';
import {
  firstIssueMessage,
  passwordSchema,
} from '../schemas/password.js';
import { AppError } from '../utils/AppError.js';
import { hashPassword } from '../utils/password.js';

export async function lookupUser(req: Request, res: Response) {
  const parsed = z.string().trim().email().max(254).safeParse(req.query.email);
  if (!parsed.success) throw new AppError('Email inválido', 400);
  const user = await findUserByEmail(parsed.data.toLowerCase());
  if (!user) throw new AppError('Destinatario no encontrado', 404, 'RECIPIENT_NOT_FOUND');
  return res.status(200).json({ nombre: user.nombre });
}

const registrationSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9._-]+$/)
    .transform((value) => value.toLowerCase()),
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  password: passwordSchema,
  currency: z
    .enum(['USD', 'COP', 'ARS', 'EUR'])
    .or(
      z
        .string()
        .trim()
        .transform((value) => value.toUpperCase())
        .pipe(z.enum(['USD', 'COP', 'ARS', 'EUR'])),
    )
    .default('COP'),
});

export async function createUser(req: Request, res: Response) {
  const parsed = registrationSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(
      firstIssueMessage(parsed.error, 'Datos de registro inválidos', 'password'),
      400,
    );
  }

  const passwordHash = await hashPassword(parsed.data.password);
  try {
    const registered = await registerUser({
      username: parsed.data.username,
      email: parsed.data.email,
      passwordHash,
      currency: parsed.data.currency,
    });
    return res.status(201).json({ data: registered });
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === '23505'
    ) {
      throw new AppError('Username o email ya registrado', 409);
    }
    throw error;
  }
}
