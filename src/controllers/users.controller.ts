import type { Request, Response } from 'express';
import { z } from 'zod';
import { registerUser } from '../services/users.service.js';
import { AppError } from '../utils/AppError.js';
import { hashPassword, isPasswordLongEnough } from '../utils/password.js';

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
  password: z.string().max(128).refine(isPasswordLongEnough),
  currency: z
    .string()
    .trim()
    .length(3)
    .regex(/^[a-zA-Z]{3}$/)
    .transform((value) => value.toUpperCase())
    .default('COP'),
});

export async function createUser(req: Request, res: Response) {
  const parsed = registrationSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('Datos de registro inválidos', 400);
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
