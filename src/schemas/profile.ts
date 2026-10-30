import { z } from 'zod';

export const paisSchema = z.enum(['Argentina', 'Colombia', 'Otro']);

export const nombreSchema = z
  .string()
  .trim()
  .min(2, 'Ingresá tu nombre')
  .max(50, 'El nombre no puede superar los 50 caracteres')
  .regex(
    /^[\p{L}\p{M}]+(?:[ '\u2019\u002D\u00B7.][\p{L}\p{M}]+)*$/u,
    'Ingresá un nombre válido, sin números',
  );
