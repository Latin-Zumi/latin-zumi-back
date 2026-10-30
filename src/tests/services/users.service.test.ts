import { beforeEach, describe, expect, it, vi } from 'vitest';

const { clientQuery, release, client, connect } = vi.hoisted(() => {
  const clientQuery = vi.fn();
  const release = vi.fn();
  const client = { query: clientQuery, release };
  return {
    clientQuery,
    release,
    client,
    connect: vi.fn(async () => client),
  };
});

vi.mock('../../config/db.js', () => ({
  pool: { connect },
}));

import { updateUserProfile } from '../../services/users.service.js';

const userId = '20000000-0000-4000-8000-000000000001';
const walletId = '40000000-0000-4000-8000-000000000001';
const updatedUser = {
  id: userId,
  username: 'ana',
  email: 'ana@example.com',
  nombre: 'Ana Pérez',
  pais: 'Argentina',
  moneda_preferida: 'ARS',
  roles: ['user'],
  estado: 'activo',
  foto_url: null,
};

describe('updateUserProfile', () => {
  beforeEach(() => {
    clientQuery.mockReset();
    release.mockReset();
    connect.mockClear();
  });

  it('updates the wallet and active account currency when there are no movements', async () => {
    clientQuery.mockImplementation(async (statement: string) => {
      if (statement.includes('FROM wallets')) {
        return { rows: [{ id: walletId, primary_currency: 'USD' }] };
      }
      if (statement.includes('FROM entries')) return { rows: [] };
      if (statement.includes('FROM accounts')) {
        return {
          rows: [
            { id: 'usd-account', currency: 'USD' },
            { id: 'cop-account', currency: 'COP' },
          ],
        };
      }
      if (statement.includes('UPDATE accounts')) return { rows: [], rowCount: 1 };
      if (statement.includes('UPDATE users')) return { rows: [updatedUser] };
      return { rows: [] };
    });

    await expect(updateUserProfile(userId, { pais: 'Argentina' })).resolves.toEqual(
      updatedUser,
    );

    expect(clientQuery).toHaveBeenCalledWith(
      'UPDATE wallets SET primary_currency = $2 WHERE id = $1',
      [walletId, 'ARS'],
    );
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('WHERE id = $1'),
      ['usd-account', 'ARS', walletId],
    );
    expect(clientQuery.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });

  it.each([
    { pais: 'Colombia' as const, initialCurrency: 'USD', requestedCurrency: 'COP' },
    { pais: 'Otro' as const, initialCurrency: 'ARS', requestedCurrency: 'USD' },
  ])('derives $requestedCurrency from country $pais when the wallet has no movements', async ({
    pais,
    initialCurrency,
    requestedCurrency,
  }) => {
    clientQuery.mockImplementation(async (statement: string) => {
      if (statement.includes('FROM wallets')) {
        return { rows: [{ id: walletId, primary_currency: initialCurrency }] };
      }
      if (statement.includes('FROM entries')) return { rows: [] };
      if (statement.includes('FROM accounts')) {
        return { rows: [{ id: 'active-account', currency: initialCurrency }] };
      }
      if (statement.includes('UPDATE users')) {
        return { rows: [{ ...updatedUser, pais, moneda_preferida: requestedCurrency }] };
      }
      return { rows: [] };
    });

    await updateUserProfile(userId, { pais });

    expect(clientQuery).toHaveBeenCalledWith(
      'UPDATE wallets SET primary_currency = $2 WHERE id = $1',
      [walletId, requestedCurrency],
    );
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE accounts'),
      ['active-account', requestedCurrency, walletId],
    );
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users'),
      [userId, null, pais, requestedCurrency],
    );
  });

  it('uses the existing empty account in the requested currency without changing secondary accounts', async () => {
    clientQuery.mockImplementation(async (statement: string) => {
      if (statement.includes('FROM wallets')) {
        return { rows: [{ id: walletId, primary_currency: 'USD' }] };
      }
      if (statement.includes('FROM entries')) return { rows: [] };
      if (statement.includes('FROM accounts')) {
        return {
          rows: [
            { id: 'ars-account', currency: 'ARS' },
            { id: 'usd-account', currency: 'USD' },
          ],
        };
      }
      if (statement.includes('UPDATE users')) return { rows: [updatedUser] };
      return { rows: [] };
    });

    await updateUserProfile(userId, { pais: 'Argentina' });

    expect(clientQuery).toHaveBeenCalledWith(
      'UPDATE wallets SET primary_currency = $2 WHERE id = $1',
      [walletId, 'ARS'],
    );
    expect(clientQuery.mock.calls.some(([statement]) =>
      statement.includes('UPDATE accounts'),
    )).toBe(false);
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY (currency = $2) DESC'),
      [walletId, 'ARS', 'USD'],
    );
  });

  it('keeps the existing wallet currency when movements already exist', async () => {
    const userWithExistingCurrency = {
      ...updatedUser,
      pais: 'Colombia',
      moneda_preferida: 'USD',
    };
    clientQuery.mockImplementation(async (statement: string) => {
      if (statement.includes('FROM wallets')) {
        return { rows: [{ id: walletId, primary_currency: 'USD' }] };
      }
      if (statement.includes('FROM entries')) return { rows: [{ '?column?': 1 }] };
      if (statement.includes('UPDATE users')) return { rows: [userWithExistingCurrency] };
      return { rows: [] };
    });

    await expect(
      updateUserProfile(userId, { nombre: 'Ana Pérez', pais: 'Colombia' }),
    ).resolves.toEqual(userWithExistingCurrency);

    expect(clientQuery).not.toHaveBeenCalledWith(
      expect.stringContaining('UPDATE wallets'),
      expect.anything(),
    );
    expect(clientQuery).not.toHaveBeenCalledWith(
      expect.stringContaining('UPDATE accounts'),
      expect.anything(),
    );
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users'),
      [userId, 'Ana Pérez', 'Colombia', 'USD'],
    );
    expect(clientQuery.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });

  it('does not inspect movements when the selected country maps to the existing currency', async () => {
    clientQuery.mockImplementation(async (statement: string) => {
      if (statement.includes('FROM wallets')) {
        return { rows: [{ id: walletId, primary_currency: 'ARS' }] };
      }
      if (statement.includes('UPDATE users')) return { rows: [updatedUser] };
      return { rows: [] };
    });

    await updateUserProfile(userId, { pais: 'Argentina' });

    expect(clientQuery.mock.calls.some(([statement]) =>
      statement.includes('FROM entries'),
    )).toBe(false);
    expect(clientQuery.mock.calls.some(([statement]) =>
      statement.includes('UPDATE wallets') || statement.includes('UPDATE accounts'),
    )).toBe(false);
  });

  it('rolls back and reports a currency conflict when the account update violates uniqueness', async () => {
    const uniqueViolation = Object.assign(new Error('duplicate account currency'), {
      code: '23505',
    });
    clientQuery.mockImplementation(async (statement: string) => {
      if (statement.includes('FROM wallets')) {
        return { rows: [{ id: walletId, primary_currency: 'USD' }] };
      }
      if (statement.includes('FROM entries')) return { rows: [] };
      if (statement.includes('FROM accounts')) {
        return { rows: [{ id: 'usd-account', currency: 'USD' }] };
      }
      if (statement.includes('UPDATE accounts')) throw uniqueViolation;
      return { rows: [] };
    });

    await expect(
      updateUserProfile(userId, { pais: 'Argentina' }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'PROFILE_CURRENCY_CONFLICT',
    });
    expect(clientQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });

  it('returns a not-found error when the user has no wallet', async () => {
    clientQuery.mockImplementation(async () => ({ rows: [] }));

    await expect(
      updateUserProfile(userId, { pais: 'Argentina' }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'WALLET_NOT_FOUND' });
    expect(clientQuery).toHaveBeenCalledWith('ROLLBACK');
  });
});
