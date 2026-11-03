import { beforeEach, describe, expect, it, vi } from 'vitest';

const { clientQuery, release, client, connect, query } = vi.hoisted(() => {
  const clientQuery = vi.fn();
  const release = vi.fn();
  const client = { query: clientQuery, release };
  return {
    clientQuery,
    release,
    client,
    connect: vi.fn(async () => client),
    query: vi.fn(),
  };
});

vi.mock('../../config/db.js', () => ({
  pool: { connect, query },
}));

import { getMyProfile, updateUserProfile } from '../../services/users.service.js';

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

describe('getMyProfile', () => {
  beforeEach(() => query.mockReset());

  it('selects only the authenticated user profile fields', async () => {
    const profile = {
      nombre: 'Ana Pérez',
      email: 'ana@example.com',
      pais: 'Argentina',
      moneda_preferida: 'ARS',
      foto_url: null,
    };
    query.mockResolvedValueOnce({ rows: [profile] });

    await expect(getMyProfile(userId)).resolves.toEqual(profile);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE id = $1'),
      [userId],
    );
    expect(query.mock.calls[0][0]).toContain('COALESCE(NULLIF(trim(nombre), \'\'), username)');
    expect(query.mock.calls[0][0]).not.toContain('password_hash');
    expect(query.mock.calls[0][0]).not.toContain('google_uid');
  });

  it('returns null when the authenticated profile does not exist', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(getMyProfile(userId)).resolves.toBeNull();
  });
});

describe('updateUserProfile', () => {
  beforeEach(() => {
    clientQuery.mockReset();
    release.mockReset();
    connect.mockClear();
  });

  it('updates the wallet and user preferences without moving or renaming accounts', async () => {
    clientQuery.mockImplementation(async (statement: string) => {
      if (statement.includes('FROM wallets')) return { rows: [{ id: walletId, primary_currency: 'USD' }] };
      if (statement.includes('INSERT INTO accounts')) return { rows: [{ id: 'created-ars-account' }] };
      if (statement.includes('SELECT id FROM accounts')) return { rows: [{ id: 'created-ars-account' }] };
      if (statement.includes('UPDATE wallets')) return { rows: [], rowCount: 1 };
      if (statement.includes('UPDATE users')) return { rows: [updatedUser] };
      return { rows: [] };
    });

    await expect(updateUserProfile(userId, { pais: 'Argentina' })).resolves.toEqual(updatedUser);

    expect(clientQuery).toHaveBeenCalledWith(
      'UPDATE wallets SET primary_currency = $2 WHERE id = $1',
      [walletId, 'ARS'],
    );
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users'),
      [userId, null, 'Argentina', 'ARS'],
    );
    expect(clientQuery.mock.calls.some(([statement]) =>
      String(statement).includes('UPDATE accounts'),
    )).toBe(false);
    expect(clientQuery.mock.calls.some(([statement]) =>
      String(statement).includes('FROM entries'),
    )).toBe(false);
    expect(clientQuery.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });

  it.each([
    { pais: 'Colombia' as const, requestedCurrency: 'COP' },
    { pais: 'Otro' as const, requestedCurrency: 'USD' },
  ])('derives the requested currency from country $pais', async ({ pais, requestedCurrency }) => {
    clientQuery.mockImplementation(async (statement: string) => {
      if (statement.includes('FROM wallets')) return { rows: [{ id: walletId, primary_currency: 'USD' }] };
      if (statement.includes('INSERT INTO accounts')) return { rows: [{ id: 'account' }] };
      if (statement.includes('SELECT id FROM accounts')) return { rows: [{ id: 'account' }] };
      if (statement.includes('UPDATE wallets')) return { rows: [], rowCount: 1 };
      if (statement.includes('UPDATE users')) {
        return { rows: [{ ...updatedUser, pais, moneda_preferida: requestedCurrency }] };
      }
      return { rows: [] };
    });

    const result = await updateUserProfile(userId, { pais });

    expect(result.moneda_preferida).toBe(requestedCurrency);
    expect(clientQuery).toHaveBeenCalledWith(
      'UPDATE wallets SET primary_currency = $2 WHERE id = $1',
      [walletId, requestedCurrency],
    );
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users'),
      [userId, null, pais, requestedCurrency],
    );
  });

  it('returns a not-found error when the user has no wallet', async () => {
    clientQuery.mockImplementation(async () => ({ rows: [] }));

    await expect(
      updateUserProfile(userId, { pais: 'Argentina' }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'WALLET_NOT_FOUND' });
    expect(clientQuery).toHaveBeenCalledWith('ROLLBACK');
  });
});
