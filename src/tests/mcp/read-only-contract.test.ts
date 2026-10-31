import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const expectedTools = [
  'get_my_profile',
  'list_my_accounts',
  'get_my_account_balance',
  'list_my_wallet_activity',
  'get_my_transaction',
].sort();

const expectedServiceImports = {
  '../services/accounts.service.js': [
    'getAccountsByUserId',
    'getBalanceByAccountId',
  ],
  '../services/transactions.service.js': ['getTransactionById'],
  '../services/users.service.js': ['getMyProfile'],
  '../services/wallet-transactions.service.js': ['listWalletTransactions'],
};
const expectedLocalImports = [
  '../services/accounts.service.js',
  '../services/transactions.service.js',
  '../services/users.service.js',
  '../services/wallet-transactions.service.js',
  '../utils/AppError.js',
].sort();

describe('MCP read-only service contract', () => {
  it('limits tool registration and backend dependencies to the approved read APIs', async () => {
    const source = await readFile(new URL('../../mcp/tools.ts', import.meta.url), 'utf8');
    const serviceImports = Object.fromEntries(
      [...source.matchAll(
        /import\s+\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]\s*;/g,
      )]
        .filter(([, , moduleName]) => moduleName.startsWith('../services/'))
        .map(([, importList, moduleName]) => [
          moduleName,
          importList.split(',')
          .map((name) => name.trim().replace(/\s+as\s+.+$/, ''))
          .filter(Boolean)
          .sort(),
        ]),
    );
    expect(serviceImports).toEqual(expectedServiceImports);
    const localImports = [...source.matchAll(
      /from\s+['"](\.{1,2}\/[^'"]+)['"]/g,
    )].map(([, moduleName]) => moduleName).sort();
    expect(localImports).toEqual(expectedLocalImports);

    const registeredTools = [...source.matchAll(
      /server\.registerTool\(\s*['"]([^'"]+)['"]/g,
    )].map(([, name]) => name);
    expect(registeredTools.sort()).toEqual(expectedTools);

    const serviceContract = source.match(
      /export interface McpToolServices\s*\{([\s\S]*?)\n\}/,
    )?.[1];
    expect(serviceContract).toBeDefined();
    const serviceMembers = [...(serviceContract ?? '').matchAll(/^\s*(\w+)\s*:/gm)]
      .map(([, name]) => name)
      .sort();
    expect(serviceMembers).toEqual([
      'getAccountsByUserId',
      'getBalanceByAccountId',
      'getMyProfile',
      'getTransactionById',
      'listWalletTransactions',
    ]);
  });
});
