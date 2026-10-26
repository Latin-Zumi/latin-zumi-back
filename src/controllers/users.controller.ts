import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { registerUser } from '../services/users.service.js';
import { AppError } from '../utils/AppError.js';

const scrypt = promisify(scryptCallback);

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
  password: z.string().min(8).max(128),
  currency: z
    .string()
    .trim()
    .length(3)
    .regex(/^[a-zA-Z]{3}$/)
    .transform((value) => value.toUpperCase())
    .default('COP'),
});

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derivedKey.toString('hex')}`;
}

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
