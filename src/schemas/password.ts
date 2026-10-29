import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const passwordSchema = z
  .string()
  .min(
    PASSWORD_MIN_LENGTH,
    `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`,
  )
  .max(
    PASSWORD_MAX_LENGTH,
    `La contraseña no puede superar los ${PASSWORD_MAX_LENGTH} caracteres`,
  );

// El login solo valida el máximo para no bloquear cuentas con claves legadas.
export const loginPasswordSchema = z
  .string()
  .max(
    PASSWORD_MAX_LENGTH,
    `La contraseña no puede superar los ${PASSWORD_MAX_LENGTH} caracteres`,
  );

export function firstIssueMessage(
  error: z.ZodError,
  fallback: string,
  field?: string,
): string {
  const issue = field
    ? error.issues.find((candidate) => candidate.path[0] === field)
    : error.issues[0];
  return issue?.message ?? fallback;
}
