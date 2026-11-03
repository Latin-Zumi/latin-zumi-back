import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const services = vi.hoisted(() => ({
  getMyProfile: vi.fn(),
  getAccountsByUserId: vi.fn(),
  getBalanceByAccountId: vi.fn(),
  listWalletTransactions: vi.fn(),
  getTransactionById: vi.fn(),
}));

vi.mock('../../services/users.service.js', () => ({
  getMyProfile: services.getMyProfile,
}));
vi.mock('../../services/accounts.service.js', () => ({
  getAccountsByUserId: services.getAccountsByUserId,
  getBalanceByAccountId: services.getBalanceByAccountId,
}));
vi.mock('../../services/wallet-transactions.service.js', () => ({
  listWalletTransactions: services.listWalletTransactions,
}));
vi.mock('../../services/transactions.service.js', () => ({
  getTransactionById: services.getTransactionById,
}));

import { createMcpServer, type McpToolServices } from '../../mcp/tools.js';

const ownerId = '20000000-0000-4000-8000-000000000001';
const otherUserId = '20000000-0000-4000-8000-000000000002';
const accountId = '10000000-0000-4000-8000-000000000001';
const transactionId = '30000000-0000-4000-8000-000000000001';

function createServices(): McpToolServices {
  return {
    getMyProfile: services.getMyProfile,
    getAccountsByUserId: services.getAccountsByUserId,
    getBalanceByAccountId: services.getBalanceByAccountId,
    listWalletTransactions: services.listWalletTransactions,
    getTransactionById: services.getTransactionById,
  };
}

function createHandler(userId: string) {
  const handler = createMcpHandler(
    () => createMcpServer(userId, createServices()),
    { responseMode: 'json' },
  );
  const transport = new StreamableHTTPClientTransport(
    new URL('http://mcp.test/mcp'),
    { fetch: (request, init) => handler.fetch(new Request(request, init)) },
  );
  const client = new Client(
    { name: 'latin-zumi-test-client', version: '1.0.0' },
    { versionNegotiation: { mode: 'auto' } },
  );
  return { client, handler, transport };
}

describe('LATIN ZUMI MCP tools', () => {
  beforeEach(() => {
    services.getMyProfile.mockReset();
    services.getAccountsByUserId.mockReset();
    services.getBalanceByAccountId.mockReset();
    services.listWalletTransactions.mockReset();
    services.getTransactionById.mockReset();
  });

  it('initializes the protocol and lists exactly the five read-only tools', async () => {
    const { client, handler, transport } = createHandler(ownerId);
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();

      expect(tools.map(({ name }) => name).sort()).toEqual([
        'get_my_account_balance',
        'get_my_profile',
        'get_my_transaction',
        'list_my_accounts',
        'list_my_wallet_activity',
      ]);
      expect(tools.every(({ annotations }) => annotations?.readOnlyHint === true)).toBe(true);
      expect(tools.every(({ inputSchema }) =>
        !('userId' in (inputSchema.properties ?? {})),
      )).toBe(true);
    } finally {
      await client.close();
      await handler.close();
    }
  });

  it('validates parameters before invoking a service', async () => {
    const { client, handler, transport } = createHandler(ownerId);
    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: 'get_my_account_balance',
        arguments: { account_id: 'not-a-uuid' },
      });

      expect(result.isError).toBe(true);
      expect(services.getBalanceByAccountId).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await handler.close();
    }
  });

  it.each([
    { page: 0 },
    { limit: 101 },
    { from: '2026-10-31T00:00:00Z', to: '2026-10-30T00:00:00Z' },
    { userId: otherUserId },
  ])('rejects invalid activity arguments %o before invoking a service', async (arguments_) => {
    const { client, handler, transport } = createHandler(ownerId);
    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: 'list_my_wallet_activity',
        arguments: arguments_,
      });

      expect(result.isError).toBe(true);
      expect(services.listWalletTransactions).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await handler.close();
    }
  });

  it('projects only safe profile, account, activity, and transaction fields', async () => {
    services.getMyProfile.mockResolvedValue({
      nombre: 'Ana',
      email: 'ana@example.test',
      pais: 'Argentina',
      moneda_preferida: 'ARS',
      foto_url: null,
      password_hash: 'private-hash',
      access_token: 'private-token',
    });
    services.getAccountsByUserId.mockResolvedValue([{
      id: accountId,
      user_id: ownerId,
      wallet_id: '40000000-0000-4000-8000-000000000001',
      currency: 'ARS',
      account_type: 'user',
      allow_negative: false,
      balance: '42.00',
    }]);
    services.getBalanceByAccountId.mockResolvedValue({
      account_id: accountId,
      wallet_id: '40000000-0000-4000-8000-000000000001',
      currency: 'ARS',
      balance: '42.00',
    });
    services.listWalletTransactions.mockResolvedValue({
      items: [{
        id: transactionId,
        type: 'transfer_received',
        status: 'completed',
        currency: 'ARS',
        amount: '10.00',
        created_at: '2026-10-30T12:00:00.000Z',
        description: 'private counterparty details',
        counterparty: { nombre: 'Other user', email: 'other@example.test' },
        exchange: {
          to_currency: 'USD',
          to_amount: '0.01',
          rate: '1000.00',
          provider_secret: 'private-exchange-data',
        },
      }],
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
    services.getTransactionById.mockResolvedValue({
      id: transactionId,
      idempotency_key: 'private-idempotency-key',
      description: 'private transaction note',
      occurred_at: new Date('2026-10-30T12:00:00.000Z'),
      entries: [{
        id: '1',
        account_id: accountId,
        amount: '10.00',
        direction: 'credit',
        currency: 'ARS',
        created_at: new Date('2026-10-30T12:00:00.000Z'),
      }],
    });

    const { client, handler, transport } = createHandler(ownerId);
    try {
      await client.connect(transport);
      const profile = await client.callTool({ name: 'get_my_profile', arguments: {} });
      const accounts = await client.callTool({ name: 'list_my_accounts', arguments: {} });
      const balance = await client.callTool({
        name: 'get_my_account_balance',
        arguments: { account_id: accountId },
      });
      const activity = await client.callTool({
        name: 'list_my_wallet_activity',
        arguments: {},
      });
      const transaction = await client.callTool({
        name: 'get_my_transaction',
        arguments: { transaction_id: transactionId },
      });

      expect(profile.structuredContent).toEqual({
        profile: {
          nombre: 'Ana',
          email: 'ana@example.test',
          pais: 'Argentina',
          moneda_preferida: 'ARS',
          foto_url: null,
        },
      });
      expect(accounts.structuredContent).toEqual({
        items: [{ id: accountId, currency: 'ARS', balance: '42.00' }],
      });
      expect(balance.structuredContent).toEqual({
        account_id: accountId,
        currency: 'ARS',
        balance: '42.00',
      });
      expect(activity.structuredContent).toEqual({
        items: [{
          id: transactionId,
          type: 'transfer_received',
          status: 'completed',
          currency: 'ARS',
          amount: '10.00',
          created_at: '2026-10-30T12:00:00.000Z',
          exchange: {
            to_currency: 'USD',
            to_amount: '0.01',
            rate: '1000.00',
          },
        }],
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
      expect(transaction.structuredContent).toEqual({
        transaction: {
          id: transactionId,
          occurred_at: '2026-10-30T12:00:00.000Z',
          entries: [{
            amount: '10.00',
            direction: 'credit',
            currency: 'ARS',
            created_at: '2026-10-30T12:00:00.000Z',
          }],
        },
      });

      const allOutput = JSON.stringify([
        profile.structuredContent,
        accounts.structuredContent,
        balance.structuredContent,
        activity.structuredContent,
        transaction.structuredContent,
      ]);
      for (const secret of [
        'private-hash',
        'private-token',
        'private-idempotency-key',
        'private counterparty details',
        'other@example.test',
        'private-exchange-data',
      ]) {
        expect(allOutput).not.toContain(secret);
      }

      expect(services.getMyProfile).toHaveBeenCalledWith(ownerId);
      expect(services.getAccountsByUserId).toHaveBeenCalledWith(ownerId);
      expect(services.getBalanceByAccountId).toHaveBeenCalledWith(accountId, ownerId);
      expect(services.listWalletTransactions).toHaveBeenCalledWith({
        page: 1,
        limit: 20,
        userId: ownerId,
      });
      expect(services.getTransactionById).toHaveBeenCalledWith(transactionId, ownerId);
    } finally {
      await client.close();
      await handler.close();
    }
  });

  it('does not reveal whether an unavailable resource belongs to another user', async () => {
    services.getBalanceByAccountId.mockResolvedValue(null);
    const { client, handler, transport } = createHandler(ownerId);
    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: 'get_my_account_balance',
        arguments: { account_id: accountId },
      });

      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        { type: 'text', text: 'Recurso no encontrado.' },
      ]);
      expect(services.getBalanceByAccountId).toHaveBeenCalledWith(accountId, ownerId);
    } finally {
      await client.close();
      await handler.close();
    }
  });

  it('keeps concurrent user requests bound to their own identity', async () => {
    services.getMyProfile.mockImplementation(async (userId: string) => ({
      nombre: userId === ownerId ? 'Owner' : 'Other',
      email: `${userId}@example.test`,
      pais: null,
      moneda_preferida: 'ARS',
      foto_url: null,
    }));

    const first = createHandler(ownerId);
    const second = createHandler(otherUserId);
    try {
      await Promise.all([
        first.client.connect(first.transport),
        second.client.connect(second.transport),
      ]);
      const [ownerProfile, otherProfile] = await Promise.all([
        first.client.callTool({ name: 'get_my_profile', arguments: {} }),
        second.client.callTool({ name: 'get_my_profile', arguments: {} }),
      ]);

      expect(ownerProfile.structuredContent).toMatchObject({
        profile: { nombre: 'Owner' },
      });
      expect(otherProfile.structuredContent).toMatchObject({
        profile: { nombre: 'Other' },
      });
      expect(services.getMyProfile.mock.calls.map(([userId]) => userId).sort())
        .toEqual([ownerId, otherUserId].sort());
    } finally {
      await Promise.all([
        first.client.close(),
        second.client.close(),
        first.handler.close(),
        second.handler.close(),
      ]);
    }
  });
});
