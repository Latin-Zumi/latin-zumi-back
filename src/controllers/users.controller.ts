import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  findUserByEmail,
  updateUserProfile,
} from '../services/users.service.js';
import { nombreSchema, paisSchema } from '../schemas/profile.js';
import { firstIssueMessage } from '../schemas/password.js';
import { AppError } from '../utils/AppError.js';
import { getAuthContext } from '../middleware/requireAuth.js';
import { toAuthUser } from '../services/auth.service.js';

export async function lookupUser(req: Request, res: Response) {
  const parsed = z.string().trim().email().max(254).safeParse(req.query.email);
  if (!parsed.success) throw new AppError('Email inválido', 400);
  const user = await findUserByEmail(parsed.data.toLowerCase());
  if (!user) throw new AppError('Destinatario no encontrado', 404, 'RECIPIENT_NOT_FOUND');
  return res.status(200).json({ nombre: user.nombre });
}

const updateProfileSchema = z.object({
  nombre: nombreSchema.optional(),
  pais: paisSchema,
});

export async function updateMe(req: Request, res: Response) {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(
      firstIssueMessage(parsed.error, 'Datos de perfil inválidos'),
      400,
    );
  }

  const updatedUser = await updateUserProfile(
    getAuthContext(req).userId,
    parsed.data,
  );
  return res.status(200).json({ user: toAuthUser(updatedUser) });
}
