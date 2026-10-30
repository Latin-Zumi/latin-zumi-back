import { describe, expect, it } from 'vitest';
import { multiplyAndRoundHalfUp, normalizeDecimal } from '../../utils/decimal.js';

describe('decimal arithmetic', () => {
  it('multiplies exactly and rounds HALF_UP to two decimals', () => {
    expect(multiplyAndRoundHalfUp('100.00', '1.2345', 2)).toBe('123.45');
    expect(multiplyAndRoundHalfUp('1', '1.005', 2)).toBe('1.01');
  });

  it('does not use binary floating point for large amounts', () => {
    expect(multiplyAndRoundHalfUp('999999999999.99', '1', 2)).toBe('999999999999.99');
  });

  it('normalizes provider numbers written in scientific notation', () => {
    expect(normalizeDecimal('1e-7', 12)).toBe('0.000000100000');
    expect(multiplyAndRoundHalfUp('1000000', '1e-7', 2)).toBe('0.10');
  });
});
