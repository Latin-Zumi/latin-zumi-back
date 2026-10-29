import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  loginPasswordSchema,
  passwordSchema,
} from './password.js';

describe('passwordSchema', () => {
  it('rejects passwords shorter than the minimum', () => {
    const result = passwordSchema.safeParse('a'.repeat(PASSWORD_MIN_LENGTH - 1));

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      'La contraseña debe tener al menos 8 caracteres',
    );
  });

  it('accepts a password at the minimum length', () => {
    expect(passwordSchema.safeParse('a'.repeat(PASSWORD_MIN_LENGTH)).success).toBe(
      true,
    );
  });

  it('accepts a password at the maximum length', () => {
    expect(passwordSchema.safeParse('a'.repeat(PASSWORD_MAX_LENGTH)).success).toBe(
      true,
    );
  });

  it('rejects passwords longer than the maximum', () => {
    const result = passwordSchema.safeParse('a'.repeat(PASSWORD_MAX_LENGTH + 1));

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      'La contraseña no puede superar los 128 caracteres',
    );
  });
});

describe('loginPasswordSchema', () => {
  it('accepts legacy passwords shorter than the minimum', () => {
    expect(loginPasswordSchema.safeParse('short').success).toBe(true);
  });

  it('rejects passwords longer than the maximum', () => {
    expect(
      loginPasswordSchema.safeParse('a'.repeat(PASSWORD_MAX_LENGTH + 1)).success,
    ).toBe(false);
  });
});
