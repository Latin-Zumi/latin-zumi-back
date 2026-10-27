import { describe, expect, it } from 'vitest';
import { AppError } from "../utils/AppError.js";

describe('AppError', () => {
  it('creates an operational error with an HTTP status', () => {
    const err = new AppError('No encontrado', 404);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
    expect(err.message).toBe('No encontrado');
    expect(err.statusCode).toBe(404);
    expect(err.isOperational).toBe(true);
    expect(err.stack).toBeDefined();
  });

  it('inherits from Error', () => {
    const err = new AppError('boom', 500);
    expect(err.name).toBe('Error');
    expect(Object.getPrototypeOf(err)).toBe(AppError.prototype);
  });
});
