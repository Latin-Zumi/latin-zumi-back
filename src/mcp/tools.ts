import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { getBalanceByAccountId, getAccountsByUserId } from '../services/accounts.service.js';
import { listWalletTransactions } from '../services/wallet-transactions.service.js';
import { getTransactionById } from '../services/transactions.service.js';
import { getMyProfile } from '../services/users.service.js';
import { AppError } from '../utils/AppError.js';

export interface McpToolServices {
  getMyProfile: typeof getMyProfile;
  getAccountsByUserId: typeof getAccountsByUserId;
  getBalanceByAccountId: typeof getBalanceByAccountId;
  listWalletTransactions: typeof listWalletTransactions;
  getTransactionById: typeof getTransactionById;
}

const defaultServices: McpToolServices = {
  getMyProfile,
  getAccountsByUserId,
  getBalanceByAccountId,
  listWalletTransactions,
  getTransactionById,
};

const noArgumentsSchema = z.object({}).strict();
const profileSchema = z.object({
  nombre: z.string(),
  email: z.string(),
  pais: z.string().nullable(),
  moneda_preferida: z.string(),
  foto_url: z.string().nullable(),
});
const accountsSchema = z.object({
  items: z.array(z.object({
    id: z.string().uuid(),
    currency: z.string(),
    balance: z.string(),
  })),
});
const balanceSchema = z.object({
  account_id: z.string().uuid(),
  currency: z.string(),
  balance: z.string(),
});
const exchangeSchema = z.object({
  to_currency: z.string(),
  to_amount: z.string(),
  rate: z.string(),
}).nullable();
const activityItemSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['deposit', 'transfer_sent', 'transfer_received', 'withdrawal', 'exchange']),
  status: z.literal('completed'),
  currency: z.string(),
  amount: z.string(),
  created_at: z.string().datetime(),
  exchange: exchangeSchema,
});
const activitySchema = z.object({
  items: z.array(activityItemSchema),
  page: z.number().int().positive(),
  limit: z.number().int().positive().max(100),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});
const transactionSchema = z.object({
  transaction: z.object({
    id: z.string().uuid(),
    occurred_at: z.string().datetime(),
    entries: z.array(z.object({
      amount: z.string(),
      direction: z.enum(['debit', 'credit']),
      currency: z.string(),
      created_at: z.string().datetime(),
    })),
  }),
});

const currencySchema = z.enum(['USD', 'COP', 'ARS', 'EUR']);
const activityTypes = [
  'deposit',
  'transfer_sent',
  'transfer_received',
  'withdrawal',
  'exchange',
] as const;
const activityInputSchema = z.object({
  page: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).default(1),
  limit: z.number().int().positive().max(100).default(20),
  type: z.enum(activityTypes).optional(),
  currency: currencySchema.optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
}).strict().refine(
  ({ page, limit, from, to }) =>
    Number.isSafeInteger((page - 1) * limit)
    && (!from || !to || Date.parse(from) <= Date.parse(to)),
);

function publicErrorMessage(error: unknown): string {
  if (error instanceof AppError) {
    if (error.statusCode === 404) return 'Recurso no encontrado.';
    if (error.statusCode === 401) return 'Autenticación requerida.';
    if (error.statusCode === 403) return 'Acceso denegado.';
    if (error.statusCode === 400 || error.statusCode === 422) {
      return 'La solicitud no es válida.';
    }
  }

  return 'No se pudo completar la consulta.';
}

async function executeRead<T extends Record<string, unknown>>(
  operation: () => Promise<T>,
) {
  try {
    const output = await operation();
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(output) }],
      structuredContent: output,
    };
  } catch (error) {
    return {
      content: [{ type: 'text' as const, text: publicErrorMessage(error) }],
      isError: true,
    };
  }
}

export function createMcpServer(
  userId: string,
  services: McpToolServices = defaultServices,
): McpServer {
  const server = new McpServer({
    name: 'latin-zumi-back',
    version: '1.0.0',
  });
  const readOnly = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };

  server.registerTool(
    'get_my_profile',
    {
      title: 'Consultar mi perfil',
      description: 'Devuelve los campos públicos del perfil autenticado.',
      inputSchema: noArgumentsSchema,
      outputSchema: z.object({ profile: profileSchema }),
      annotations: readOnly,
    },
    async () => executeRead(async () => {
      const profile = await services.getMyProfile(userId);
      if (!profile) throw new AppError('Perfil no encontrado', 404);
      return {
        profile: {
          nombre: profile.nombre,
          email: profile.email,
          pais: profile.pais,
          moneda_preferida: profile.moneda_preferida,
          foto_url: profile.foto_url,
        },
      };
    }),
  );

  server.registerTool(
    'list_my_accounts',
    {
      title: 'Listar mis cuentas',
      description: 'Lista las cuentas activas y saldos del usuario autenticado.',
      inputSchema: noArgumentsSchema,
      outputSchema: accountsSchema,
      annotations: readOnly,
    },
    async () => executeRead(async () => {
      const accounts = await services.getAccountsByUserId(userId);
      return {
        items: accounts.map(({ id, currency, balance }) => ({
          id,
          currency,
          balance,
        })),
      };
    }),
  );

  server.registerTool(
    'get_my_account_balance',
    {
      title: 'Consultar saldo de mi cuenta',
      description: 'Consulta el saldo de una cuenta propia activa.',
      inputSchema: z.object({ account_id: z.string().uuid() }).strict(),
      outputSchema: balanceSchema,
      annotations: readOnly,
    },
    async ({ account_id }) => executeRead(async () => {
      const balance = await services.getBalanceByAccountId(account_id, userId);
      if (!balance) throw new AppError('Cuenta no encontrada', 404);
      return {
        account_id: balance.account_id,
        currency: balance.currency,
        balance: balance.balance,
      };
    }),
  );

  server.registerTool(
    'list_my_wallet_activity',
    {
      title: 'Consultar actividad de mi billetera',
      description: 'Lista la actividad propia con filtros y paginación limitada.',
      inputSchema: activityInputSchema,
      outputSchema: activitySchema,
      annotations: readOnly,
    },
    async (input) => executeRead(async () => {
      const result = await services.listWalletTransactions({
        ...input,
        userId,
      });
      return {
        items: result.items.map((item) => ({
          id: item.id,
          type: item.type,
          status: item.status,
          currency: item.currency,
          amount: item.amount,
          created_at: item.created_at,
          exchange: item.exchange
            ? {
              to_currency: item.exchange.to_currency,
              to_amount: item.exchange.to_amount,
              rate: item.exchange.rate,
            }
            : null,
        })),
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: result.totalPages,
      };
    }),
  );

  server.registerTool(
    'get_my_transaction',
    {
      title: 'Consultar una de mis transacciones',
      description: 'Devuelve el detalle de una transacción visible para el usuario autenticado.',
      inputSchema: z.object({ transaction_id: z.string().uuid() }).strict(),
      outputSchema: transactionSchema,
      annotations: readOnly,
    },
    async ({ transaction_id }) => executeRead(async () => {
      const transaction = await services.getTransactionById(transaction_id, userId);
      if (!transaction) throw new AppError('Transacción no encontrada', 404);
      return {
        transaction: {
          id: transaction.id,
          occurred_at: transaction.occurred_at.toISOString(),
          entries: transaction.entries.map((entry) => ({
            amount: entry.amount,
            direction: entry.direction,
            currency: entry.currency,
            created_at: entry.created_at.toISOString(),
          })),
        },
      };
    }),
  );

  return server;
}
