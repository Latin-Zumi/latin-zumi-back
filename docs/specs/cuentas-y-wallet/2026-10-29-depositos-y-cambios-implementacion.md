# Spec: depósitos y cambios de moneda (implementación pendiente del spec 030)

## Fecha

2026-10-29

## Orden de ejecución

**039.** Registrado en el índice de `docs/specs/index-specs.md`. No reutilizar
números ya asignados.

## Relación con el spec 030

El spec 030
(`docs/specs/cuentas-y-wallet/2026-10-27-depositos-y-cambio-de-moneda.md`)
define el diseño de depósitos y cambios, pero nunca se implementó. Este spec lo
**ejecuta y lo ajusta al código real**; no edita el 030 (regla del equipo).

Diferencias principales con 030:

| Tema | Spec 030 | Este spec |
| --- | --- | --- |
| Migración | 010 | **011**: 010 queda para los tokens de recuperación (spec 036). |
| Depósito | `deposits.service.ts` nuevo desde cero | Reutiliza `recordIncomingConversion`, que ya existe y solo está expuesto por la ruta legada `POST /accounts/:id/incoming`. |
| Balances de la respuesta | `Account[]` (spec 029) | El back mantiene `Account[]`; **el front los normaliza** a su tipo `Balance`. Hoy la transferencia real rompe el Dashboard por esta diferencia. |
| Feed | Completar `exchange` | Igual, más la prueba de que los depósitos con conversión siguen con `exchange: null`. |
| Front | Adaptar pantallas | Además hay que encender `TRANSACTIONS_ENABLED` y agregar los códigos de error que faltan. |

## Dependencias

- Spec 029: feed, transferencias, patrón de idempotencia y `transactions.type`.
- Spec 030: contrato de las tres rutas (se mantiene).
- Migración 009 (`transactions.type`) y 007 (`currency_conversions`), ya
  aplicadas.
- `recordIncomingConversion`, `getExchangeRate`, `getInternalAccount` y
  `account_balances`, ya presentes.
- Ninguna dependencia de los specs 036–038; las migraciones solo comparten
  numeración (036 usa 010, este usa 011).

## Problema

El front ya tiene las pantallas de depósito y cambio de moneda y llama:

- `POST /wallet/deposits`
- `GET /wallet/exchange/quote`
- `POST /wallet/exchanges`

El back no expone ninguna de las tres. Las únicas piezas parecidas son:

- `POST /accounts/:id/incoming`, una ruta legada que registra un ingreso en una
  cuenta concreta, sin documentación Swagger y sin el contrato del front.
- `recordIncomingConversion`, que ya implementa la conversión, la idempotencia
  y los asientos del ledger, pero no se reutiliza desde `/wallet/deposits`.

Además:

- No existe `exchange_quotes` ni un servicio que ejecute un cambio entre dos
  saldos del usuario.
- El feed devuelve siempre `exchange: null`, aunque `transactions.type` ya
  admite `exchange`.
- `TRANSACTIONS_ENABLED` está en `false` para la API real, así que el front
  oculta depósitos, cambios, transferencias e historial aunque las
  transferencias ya funcionan.
- El back devuelve `balances` como `Account[]` (`id`, `balance`), pero el front
  espera `Balance[]` (`account_id`, `amount`). En modo real, después de una
  operación el Dashboard se queda sin saldos utilizables.

## Solución propuesta

### Parte A — `POST /wallet/deposits`

1. Resolver la wallet del titular y su cuenta principal (la de
   `wallets.primary_currency`).
2. Delegar en `recordIncomingConversion` con la moneda de origen que mandó el
   front. Esa función ya:
   - valida que la cuenta pertenezca al usuario;
   - aplica idempotencia;
   - convierte a la moneda principal con la tasa vigente;
   - registra `transactions`, `entries` y `currency_conversions`;
   - balancea cada moneda con `external` y `treasury`.
3. Devolver el contrato del spec 030: `{ transaction, source, balances }`.

No se duplica la lógica de depósito ni se crea otro camino de ledger.

### Parte B — Cotización y ejecución de cambios

1. Migración 011 con `exchange_quotes`.
2. `createExchangeQuote` fija la tasa, calcula `to_amount` con `HALF_UP` a 2
   decimales y guarda la cotización por 60 segundos.
3. `executeExchange` bloquea la wallet y la cotización, valida saldo, crea la
   cuenta destino si no existe, mueve el dinero, registra la conversión y marca
   la cotización como usada.
4. `GET /wallet/transactions` completa `exchange` para los movimientos de tipo
   `exchange`.

### Parte C — Front contra las rutas reales

1. `TRANSACTIONS_ENABLED = true` para que las pantallas dejen de ocultarse con
   la API real.
2. Agregar los códigos de error nuevos a `TransactionErrorCode` y sus mensajes.
3. Normalizar `balances` de las respuestas de operación al tipo `Balance`.
4. Avisar que el depósito es de prueba, también fuera del modo mock.
5. Manejar `QUOTE_ALREADY_USED` además de `QUOTE_EXPIRED` en el modal de
   cambio.

### Contrato

#### `POST /wallet/deposits`

```http
POST /wallet/deposits
Authorization: Bearer <token>
Idempotency-Key: 1c9a4b1e-3a4d-4f6e-8b2a-7d5e9c0f1a2b
Content-Type: application/json

{ "currency": "USD", "amount": "100.00" }
```

```json
200 OK
{
  "transaction": {
    "id": "30000000-0000-4000-8000-000000000301",
    "type": "deposit",
    "status": "completed",
    "currency": "ARS",
    "amount": "385000.00",
    "created_at": "2026-10-29T15:10:00.000Z",
    "description": "Ingreso USD convertido a ARS",
    "counterparty": null,
    "exchange": null
  },
  "source": {
    "currency": "USD",
    "amount": "100.00",
    "rate": "3850.000000000000"
  },
  "balances": [
    {
      "id": "10000000-0000-4000-8000-000000000005",
      "user_id": "20000000-0000-4000-8000-000000000001",
      "wallet_id": "50000000-0000-4000-8000-000000000001",
      "currency": "ARS",
      "account_type": "user",
      "allow_negative": false,
      "balance": "385000.00000000"
    }
  ]
}
```

Reglas:

- `transaction.currency` y `transaction.amount` son la moneda principal y el
  importe **acreditado**, no los del origen.
- `source` conserva lo que mandó el front y la tasa aplicada (`"1"` si no hubo
  conversión).
- Si `currency` no es la principal, se consulta la tasa y se guarda en
  `currency_conversions`.
- No hay pasarela: el ingreso se registra contra la cuenta interna `external`.
- Requiere `Idempotency-Key`; repetir la misma clave con el mismo cuerpo
  devuelve el mismo resultado.

#### `GET /wallet/exchange/quote`

```http
GET /wallet/exchange/quote?from=ARS&to=USD&amount=100000.00
Authorization: Bearer <token>
```

```json
200 OK
{
  "quote_id": "40000000-0000-4000-8000-000000000401",
  "from": "ARS",
  "to": "USD",
  "from_amount": "100000.00",
  "rate": "0.001010000000",
  "to_amount": "101.00",
  "expires_at": "2026-10-29T15:11:00.000Z"
}
```

- `from` y `to` son monedas soportadas y distintas.
- `amount` es un string con hasta 2 decimales y mayor a `0`.
- La tasa se fija en la fila; el cambio no vuelve a consultar al proveedor.
- Vence a los 60 segundos.
- La cotización queda asociada al titular que la pidió.

#### `POST /wallet/exchanges`

```http
POST /wallet/exchanges
Authorization: Bearer <token>
Idempotency-Key: 9e1d2c3b-4a5f-4e6d-8c7b-1a2b3c4d5e6f
Content-Type: application/json

{ "quote_id": "40000000-0000-4000-8000-000000000401" }
```

```json
200 OK
{
  "transaction": {
    "id": "30000000-0000-4000-8000-000000000302",
    "type": "exchange",
    "status": "completed",
    "currency": "ARS",
    "amount": "100000.00",
    "created_at": "2026-10-29T15:10:30.000Z",
    "description": "Cambio ARS a USD",
    "counterparty": null,
    "exchange": {
      "to_currency": "USD",
      "to_amount": "101.00",
      "rate": "0.001010000000"
    }
  },
  "balances": ["…"]
}
```

- La cotización debe pertenecer al titular, no estar vencida y no haber sido
  usada.
- Se debita la cuenta `user` de `from` y se acredita la de `to`. Si la cuenta
  destino no existe, se crea: es la excepción explícita al modelo de una cuenta
  por moneda principal.
- Los asientos se balancean por moneda con las cuentas internas `treasury`.
- La cotización queda con `used_transaction_id`.
- Repetir la misma `Idempotency-Key` con la misma cotización devuelve el mismo
  resultado; con otra cotización responde `409 IDEMPOTENCY_CONFLICT`.

#### Errores

| HTTP | `code` | Cuándo |
| --- | --- | --- |
| 400 | `INVALID_AMOUNT` | Importe ≤ 0, con más de 2 decimales, no numérico o con más de 12 enteros. |
| 400 | `SAME_CURRENCY` | `from` y `to` son iguales. |
| 400 | `INVALID_IDEMPOTENCY_KEY` | Falta el header o no cumple el formato. |
| 404 | `QUOTE_NOT_FOUND` | La cotización no existe o es de otro titular. |
| 404 | `WALLET_NOT_FOUND` | El usuario no tiene wallet. |
| 409 | `QUOTE_ALREADY_USED` | La cotización ya fue ejecutada. |
| 409 | `IDEMPOTENCY_CONFLICT` | La clave se usó con otra solicitud. |
| 410 | `QUOTE_EXPIRED` | La cotización venció. |
| 422 | `INSUFFICIENT_FUNDS` | No alcanza el saldo de la moneda de origen. |
| 422 | `AMOUNT_TOO_SMALL` | El importe convertido redondea a `0.00`. |
| 422 | `AMOUNT_TOO_LARGE` | El importe convertido supera 12 enteros. |
| 503 | `CONVERSION_UNAVAILABLE` | No hay tasa vigente. |

## Backend

### Migración 011: `exchange_quotes`

Archivo nuevo: `db/migrations/011_exchange_quotes.sql`.

```sql
CREATE TABLE IF NOT EXISTS exchange_quotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    user_id UUID NOT NULL REFERENCES users (id),
    from_currency CHAR(3) NOT NULL
        CHECK (from_currency IN ('USD', 'COP', 'ARS', 'EUR')),
    to_currency CHAR(3) NOT NULL
        CHECK (to_currency IN ('USD', 'COP', 'ARS', 'EUR')),
    from_amount NUMERIC(20, 8) NOT NULL CHECK (from_amount > 0),
    to_amount NUMERIC(20, 8) NOT NULL CHECK (to_amount > 0),
    rate NUMERIC(30, 12) NOT NULL CHECK (rate > 0),
    rate_source TEXT NOT NULL,
    rate_observed_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_transaction_id UUID REFERENCES transactions (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT exchange_quotes_different_currencies
        CHECK (from_currency <> to_currency),
    CONSTRAINT exchange_quotes_expiration_after_creation
        CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS exchange_quotes_user_created_idx
    ON exchange_quotes (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS exchange_quotes_pending_idx
    ON exchange_quotes (expires_at)
 WHERE used_transaction_id IS NULL;
```

Qué hace: guarda la tasa y el importe fijados por 60 segundos. El índice
parcial sirve para auditar o limpiar cotizaciones pendientes. La FK a
`transactions` marca el consumo en la misma transacción SQL del cambio.

`db/scripts/init-db.ts` lee las migraciones de forma explícita: agregar el
bloque de `011` después de `010` cuando exista, o después de `009` si el spec
036 todavía no se implementó. El orden tiene que ser numérico.

### Depósito: reutilizar `recordIncomingConversion`

Servicio nuevo: `src/services/deposits.service.ts`.

```ts
export async function depositToWallet(input: {
  userId: string;
  idempotencyKey: string;
  currency: string;
  amount: string;
}): Promise<DepositResult> {
  const wallet = await getWalletByUserId(input.userId);
  if (!wallet) {
    throw new AppError('Wallet no encontrada', 404, 'WALLET_NOT_FOUND');
  }

  const accountResult = await pool.query<{ id: string }>(
    `SELECT a.id
       FROM accounts a
      WHERE a.wallet_id = $1
        AND RTRIM(a.currency) = $2
        AND a.account_type = 'user'
        AND a.closed_at IS NULL
      LIMIT 1`,
    [wallet.id, wallet.primaryCurrency],
  );
  const account = accountResult.rows[0];
  if (!account) {
    throw new AppError(
      'La wallet no tiene una cuenta para su moneda principal',
      500,
      'WALLET_ACCOUNT_MISSING',
    );
  }

  const result = await recordIncomingConversion({
    accountId: account.id,
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    sourceCurrency: input.currency,
    sourceAmount: normalizeDecimal(input.amount, 2),
  });

  const transaction = await findTransactionSummary(result.transaction_id);
  const balances = await getAccountsByUserId(input.userId);

  return {
    transaction: {
      id: result.transaction_id,
      type: 'deposit',
      status: 'completed',
      currency: result.destination.currency,
      amount: result.destination.amount,
      created_at: transaction.occurred_at.toISOString(),
      description: transaction.description ?? 'Ingreso',
      counterparty: null,
      exchange: null,
    },
    source: {
      currency: result.source.currency,
      amount: result.source.amount,
      rate: result.rate,
    },
    balances,
  };
}
```

Qué ocurre: el controller valida y llama al servicio; el servicio busca la
cuenta principal y delega toda la operación en `recordIncomingConversion`, que
abre su propia transacción. `findTransactionSummary` es un `SELECT id,
description, occurred_at FROM transactions WHERE id = $1` para completar el
contrato. No se reimplementa el ledger.

Ajustes a `recordIncomingConversion`:

- `catch` de `getExchangeRate` → `503 CONVERSION_UNAVAILABLE`.
- `convertedAmount === '0.00'` → `422 AMOUNT_TOO_SMALL`.
- Importe convertido con más de 12 enteros → `422 AMOUNT_TOO_LARGE`.
- Conflicto de idempotencia → `409 IDEMPOTENCY_CONFLICT`.
- Descripción: `Ingreso ${currency}` cuando la moneda coincide con la
  principal; `Ingreso ${origen} convertido a ${principal}` cuando no.

La ruta legada `POST /accounts/:id/incoming` se mantiene para no romper
consumidores, pero se marca `deprecated: true` en Swagger. El front usa el
endpoint nuevo.

Controller de depósito:

```ts
const depositSchema = z.object({
  currency: z.enum(['USD', 'COP', 'ARS', 'EUR']),
  amount: z
    .string()
    .regex(/^\d{1,12}(?:\.\d{1,2})?$/)
    .refine((value) => !/^0+(?:\.0+)?$/.test(value), 'El importe debe ser mayor a cero'),
});

export async function deposit(req: Request, res: Response) {
  const parsed = depositSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(
      'El monto no es válido. Usá hasta dos decimales.',
      400,
      'INVALID_AMOUNT',
    );
  }

  const result = await depositToWallet({
    userId: getAuthContext(req).userId,
    idempotencyKey: requireIdempotencyKey(req),
    currency: parsed.data.currency,
    amount: parsed.data.amount,
  });
  return res.status(200).json(result);
}
```

`requireIdempotencyKey` se extrae de `wallet.controller.ts` y
`accounts.controller.ts` a `src/utils/idempotency.ts` para no repetir la regex
tres veces:

```ts
export function requireIdempotencyKey(req: Request): string {
  const key = req.header('Idempotency-Key');
  if (!key || key.length > 200 || !/^[\x21-\x7E]+$/.test(key)) {
    throw new AppError(
      'Se requiere un Idempotency-Key válido (máximo 200 caracteres)',
      400,
      'INVALID_IDEMPOTENCY_KEY',
    );
  }
  return key;
}
```

El helper se usa también en transferencias, retiros e ingresos; es un refactor
sin cambio de comportamiento.

### Cotización

Servicio nuevo: `src/services/exchange-quotes.service.ts`.

```ts
export async function createExchangeQuote(input: {
  userId: string;
  from: string;
  to: string;
  amount: string;
}): Promise<ExchangeQuote> {
  if (input.from === input.to) {
    throw new AppError('Las monedas deben ser distintas', 400, 'SAME_CURRENCY');
  }

  const amount = normalizeDecimal(input.amount, 2);
  let quote;
  try {
    quote = await getExchangeRate(input.from, input.to);
  } catch {
    throw new AppError(
      'No hay una tasa de cambio vigente disponible; reintenta más tarde',
      503,
      'CONVERSION_UNAVAILABLE',
    );
  }

  const toAmount = multiplyAndRoundHalfUp(amount, quote.rate, 2);
  if (toAmount === '0.00') {
    throw new AppError('El importe convertido es menor a 0.01', 422, 'AMOUNT_TOO_SMALL');
  }

  const result = await pool.query<ExchangeQuoteRow>(
    `INSERT INTO exchange_quotes
       (user_id, from_currency, to_currency, from_amount, to_amount,
        rate, rate_source, rate_observed_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + interval '60 seconds')
     RETURNING id, user_id,
               RTRIM(from_currency) AS from_currency,
               RTRIM(to_currency) AS to_currency,
               from_amount::text, to_amount::text, rate::text,
               rate_source, rate_observed_at, expires_at, used_transaction_id`,
    [
      input.userId,
      input.from,
      input.to,
      amount,
      toAmount,
      normalizeDecimal(quote.rate, 12),
      quote.source,
      quote.observedAt,
    ],
  );

  return toExchangeQuote(result.rows[0]);
}
```

`toExchangeQuote` devuelve `quote_id`, `from`, `to`, `from_amount`, `rate`,
`to_amount` y `expires_at` (ISO string). El front solo consume cuatro de esos
campos, pero el contrato completo sirve para Swagger y pruebas.

Controller:

```ts
const quoteQuerySchema = z.object({
  from: z.enum(['USD', 'COP', 'ARS', 'EUR']),
  to: z.enum(['USD', 'COP', 'ARS', 'EUR']),
  amount: z
    .string()
    .regex(/^\d{1,12}(?:\.\d{1,2})?$/)
    .refine((value) => !/^0+(?:\.0+)?$/.test(value)),
});

export async function getExchangeQuote(req: Request, res: Response) {
  const parsed = quoteQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new AppError('Datos de cotización inválidos', 400, 'INVALID_AMOUNT');
  }

  const quote = await createExchangeQuote({
    userId: getAuthContext(req).userId,
    ...parsed.data,
  });
  return res.status(200).json(quote);
}
```

Agregar un rate limit de cotizaciones (el spec 030 lo dejó fuera porque no había
ruta). Cada cotización puede consultar al proveedor externo:

```ts
export const quoteRateLimit = rateLimit({
  ...commonOptions,
  limit: 30,
  keyGenerator: (req) => {
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    return createHash('sha256').update(token).digest('hex');
  },
});
```

### Ejecución del cambio

Servicio nuevo: `src/services/exchanges.service.ts`.

```ts
export async function executeExchange(input: {
  userId: string;
  idempotencyKey: string;
  quoteId: string;
}): Promise<ExchangeResult> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const walletResult = await client.query<{ id: string }>(
      `SELECT id FROM wallets WHERE user_id = $1 FOR UPDATE`,
      [input.userId],
    );
    const wallet = walletResult.rows[0];
    if (!wallet) {
      throw new AppError('Wallet no encontrada', 404, 'WALLET_NOT_FOUND');
    }

    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`operation:${input.idempotencyKey}`],
    );

    const previous = await findExistingExchange(client, input.idempotencyKey);
    if (previous) {
      if (previous.quote_id !== input.quoteId) {
        throw new AppError(
          'Idempotency-Key ya usado con otra solicitud',
          409,
          'IDEMPOTENCY_CONFLICT',
        );
      }
      const balances = await getAccountsByUserId(input.userId, client);
      await client.query('COMMIT');
      return { transaction: toExchangeTransaction(previous), balances };
    }

    const quoteResult = await client.query<ExchangeQuoteRow>(
      `SELECT id, user_id, RTRIM(from_currency) AS from_currency,
              RTRIM(to_currency) AS to_currency,
              from_amount::text, to_amount::text, rate::text,
              rate_source, rate_observed_at, expires_at, used_transaction_id
         FROM exchange_quotes
        WHERE id = $1 AND user_id = $2
        FOR UPDATE`,
      [input.quoteId, input.userId],
    );
    const quote = quoteResult.rows[0];
    if (!quote) {
      throw new AppError('Cotización no encontrada', 404, 'QUOTE_NOT_FOUND');
    }
    if (quote.used_transaction_id) {
      throw new AppError('La cotización ya fue usada', 409, 'QUOTE_ALREADY_USED');
    }
    if (new Date(quote.expires_at) <= new Date()) {
      throw new AppError('La cotización venció', 410, 'QUOTE_EXPIRED');
    }

    const source = await client.query<{ id: string; sufficient: boolean }>(
      `SELECT a.id,
              COALESCE(b.balance, 0) >= $3::numeric AS sufficient
         FROM accounts a
         LEFT JOIN account_balances b
           ON b.account_id = a.id AND b.currency = a.currency
        WHERE a.wallet_id = $1
          AND RTRIM(a.currency) = $2
          AND a.account_type = 'user'
          AND a.closed_at IS NULL`,
      [wallet.id, quote.from_currency, quote.from_amount],
    );
    if (!source.rows[0]?.sufficient) {
      throw new AppError('Saldo disponible insuficiente', 422, 'INSUFFICIENT_FUNDS');
    }

    let destination = await client.query<{ id: string }>(
      `SELECT id FROM accounts
        WHERE wallet_id = $1 AND RTRIM(currency) = $2
          AND account_type = 'user' AND closed_at IS NULL
        LIMIT 1`,
      [wallet.id, quote.to_currency],
    );
    if (!destination.rows[0]) {
      destination = await client.query<{ id: string }>(
        `INSERT INTO accounts
           (user_id, wallet_id, currency, account_type, allow_negative)
         VALUES ($1, $2, $3, 'user', false)
         RETURNING id`,
        [input.userId, wallet.id, quote.to_currency],
      );
    }

    // ...insertar transactions, entries, currency_conversions y marcar la
    // cotización usada...
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

Por qué la wallet se bloquea primero: serializa todos los movimientos del
titular y evita que dos cambios creen la cuenta destino a la vez. La cotización
se bloquea después; si dos pedidos usan la misma, el segundo espera y ve
`used_transaction_id`.

Asientos:

```sql
INSERT INTO transactions (idempotency_key, description, type)
VALUES ($1, $2, 'exchange')
RETURNING id, occurred_at;

-- origen -> treasury origen
INSERT INTO entries (transaction_id, account_id, amount, direction, currency)
VALUES ($1, $2, $3, 'debit', $4),
       ($1, $5, $3, 'credit', $4),
       ($1, $6, $7, 'debit', $8),
       ($1, $9, $7, 'credit', $8);
```

Los pares son: cuenta `user` origen → `treasury` origen, y `treasury` destino →
cuenta `user` destino. Cada moneda cierra en cero; el trigger diferido del
ledger lo valida.

Conversión y consumo:

```sql
INSERT INTO currency_conversions
  (transaction_id, wallet_id, account_id, user_id,
   source_currency, source_amount,
   destination_currency, destination_amount,
   rate, rate_source, rate_observed_at, rounding)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'HALF_UP_2');

UPDATE exchange_quotes
   SET used_transaction_id = $1
 WHERE id = $2 AND user_id = $3;
```

`account_id` es la cuenta destino: es la cuenta que recibe el saldo convertido,
igual que en `recordIncomingConversion`.

Respuesta:

```ts
{
  transaction: {
    id: transactionId,
    type: 'exchange',
    status: 'completed',
    currency: quote.from_currency,
    amount: normalizeDecimal(quote.from_amount, 2),
    created_at: occurredAt.toISOString(),
    description: `Cambio ${quote.from_currency} a ${quote.to_currency}`,
    counterparty: null,
    exchange: {
      to_currency: quote.to_currency,
      to_amount: normalizeDecimal(quote.to_amount, 2),
      rate: normalizeDecimal(quote.rate, 12),
    },
  },
  balances: await getAccountsByUserId(input.userId, client),
}
```

`findExistingExchange` consulta:

```sql
SELECT t.id, t.occurred_at, t.description,
       q.id AS quote_id,
       RTRIM(q.from_currency) AS from_currency,
       q.from_amount::text AS from_amount,
       RTRIM(q.to_currency) AS to_currency,
       q.to_amount::text AS to_amount,
       q.rate::text AS rate
  FROM transactions t
  JOIN exchange_quotes q ON q.used_transaction_id = t.id
 WHERE t.idempotency_key = $1
```

Si la clave existe pero no hay cotización asociada (por ejemplo, se reutilizó
la clave de un depósito), se trata como `IDEMPOTENCY_CONFLICT`.

### Feed con `exchange`

En `src/services/wallet-transactions.service.ts`, sumar los campos de
`currency_conversions` al `SELECT` exterior:

```sql
LEFT JOIN currency_conversions c ON c.transaction_id = me.id
```

```ts
const exchange = row.type === 'exchange' && row.destination_currency
  ? {
      to_currency: row.destination_currency,
      to_amount: normalizeDecimal(row.destination_amount ?? '0', 2),
      rate: normalizeDecimal(row.rate ?? '1', 12),
    }
  : null;
```

En un depósito con conversión `type = 'deposit'`, así que `exchange` sigue
siendo `null`. En un cambio, el asiento principal del titular es el débito de
la moneda de origen y `exchange` informa el destino.

### Rutas

`src/routes/wallet.route.ts`:

```ts
walletRouter.post('/wallet/deposits', asyncHandler(requireAuth), asyncHandler(deposit));
walletRouter.get('/wallet/exchange/quote', quoteRateLimit, asyncHandler(requireAuth), asyncHandler(getExchangeQuote));
walletRouter.post('/wallet/exchanges', asyncHandler(requireAuth), asyncHandler(exchange));
```

Las rutas no chocan con `/wallet/transfers` ni `/wallet/transactions`.

### Swagger y README del back

- Documentar las tres rutas con request, respuesta y errores de la tabla.
- Marcar `POST /accounts/:id/incoming` como deprecado y apuntar a
  `/wallet/deposits`.
- Explicar que el depósito es de prueba y no una transferencia bancaria.
- Actualizar la lista de migraciones en `db/README.md`.
- No documentar `quote_id` como reutilizable: cada ejecución consume uno.

## Frontend (`latin-zumi-front/latin-zumi-react`)

### Encender las operaciones

`src/config/features.ts`:

```ts
// El back ya expone depósitos, cambios y feed.
export const TRANSACTIONS_ENABLED = true;
```

Con esto se muestran el historial, el botón de depósito, el de cambio y las
transferencias en la API real. `VITE_USE_MOCK` sigue decidiendo si se usan los
mocks, pero ya no oculta funcionalidad.

### Códigos de error

`src/services/transactionService.ts`:

```ts
export type TransactionErrorCode =
  | 'INVALID_AMOUNT'
  | 'UNAUTHORIZED'
  | 'RECIPIENT_NOT_FOUND'
  | 'SELF_TRANSFER'
  | 'SAME_CURRENCY'
  | 'INVALID_IDEMPOTENCY_KEY'
  | 'QUOTE_NOT_FOUND'
  | 'QUOTE_EXPIRED'
  | 'QUOTE_ALREADY_USED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INSUFFICIENT_FUNDS'
  | 'AMOUNT_TOO_SMALL'
  | 'AMOUNT_TOO_LARGE'
  | 'CONVERSION_UNAVAILABLE'
  | 'WALLET_NOT_FOUND'
  | 'CONNECTION'
  | 'UNKNOWN';
```

Mensajes:

```ts
const ERROR_MESSAGES: Record<TransactionErrorCode, string> = {
  INVALID_AMOUNT: 'El monto no es válido. Usá hasta dos decimales.',
  UNAUTHORIZED: 'Tu sesión expiró. Volvé a iniciar sesión.',
  RECIPIENT_NOT_FOUND: 'No encontramos una cuenta con ese email.',
  SELF_TRANSFER: 'No podés transferirte a vos mismo.',
  SAME_CURRENCY: 'Elegí dos monedas distintas.',
  INVALID_IDEMPOTENCY_KEY: 'No pudimos identificar la operación. Probá de nuevo.',
  QUOTE_NOT_FOUND: 'La cotización no existe. Pedí una nueva.',
  QUOTE_EXPIRED: 'La cotización venció. Pedí una nueva.',
  QUOTE_ALREADY_USED: 'Esa cotización ya fue usada. Pedí una nueva.',
  IDEMPOTENCY_CONFLICT: 'La operación ya se envió con otros datos. Recargá y probá de nuevo.',
  INSUFFICIENT_FUNDS: 'No tenés saldo suficiente en esa moneda.',
  AMOUNT_TOO_SMALL: 'El importe convertido es demasiado chico.',
  AMOUNT_TOO_LARGE: 'El importe supera el máximo permitido.',
  CONVERSION_UNAVAILABLE: 'No hay una tasa de cambio disponible. Probá más tarde.',
  WALLET_NOT_FOUND: 'No encontramos tu billetera. Volvé a iniciar sesión.',
  CONNECTION: 'No pudimos conectar con el servidor. Probá de nuevo.',
  UNKNOWN: 'No pudimos completar la operación. Probá de nuevo.',
};
```

### Normalizar `balances`

Hoy las respuestas de operación del back traen `Account[]` (`id`, `balance`,
`user_id`, `account_type`, `allow_negative`) y el front las tipa como
`Balance[]` (`account_id`, `amount`). En modo real eso deja los saldos sin
`amount` después de una transferencia, un depósito o un cambio.

Agregar un adaptador:

```ts
interface ApiAccountBalance {
  id: string;
  wallet_id: string;
  currency: Currency;
  balance: string;
}

interface ApiOperationResult<T> {
  transaction: Transaction;
  balances: ApiAccountBalance[];
  [key: string]: unknown;
}

function toBalance(row: ApiAccountBalance): Balance {
  return {
    account_id: row.id,
    wallet_id: row.wallet_id,
    currency: row.currency,
    amount: row.balance,
  };
}

async function requestOperation<T extends { balances: unknown[] }>(
  path: string,
  init: RequestInit,
  mock: (email: string) => MockResult<T>,
): Promise<T & { balances: Balance[] }> {
  const result = await request<T>(path, init, mock);
  if (USE_MOCK) return result as T & { balances: Balance[] };

  const apiResult = result as unknown as ApiOperationResult<T>;
  return { ...apiResult, balances: apiResult.balances.map(toBalance) };
}
```

Usarlo en `transfer`, `deposit` y `exchange` en lugar de `request`. El mock ya
devuelve `Balance[]`, por eso se salta la normalización con `USE_MOCK`.

### Modales

- `DepositModal`: el aviso “Depósito de prueba: el saldo se acredita al
  instante” deja de estar solo en `USE_MOCK`. En la API real sigue sin haber
  pasarela, así que el aviso debe verse siempre.
- `ExchangeModal`: en `confirmExchange`, tratar `QUOTE_ALREADY_USED` como
  cotización vencida:

```ts
if (
  error instanceof TransactionError &&
  (error.code === 'QUOTE_EXPIRED' || error.code === 'QUOTE_ALREADY_USED')
) {
  setExpiredByServer(true);
}
```

Así el usuario ve “La cotización venció” y el botón “Actualizar cotización” en
vez de reintentar la misma.

- `WalletProvider.applyResult` ya reemplaza `balances` y agrega la transacción
  al feed; con la normalización el Dashboard y `AvailableBalance` reciben el
  shape correcto.

### Historial

`TransactionHistory` ya usa `TRANSACTIONS_ENABLED`; al pasar a `true`, muestra
el feed real. Verificar que los tipos `deposit` y `exchange` tengan etiqueta y
que un cambio muestre `to_currency`, `to_amount` y `rate` (el feed ahora los
envía).

## Archivos afectados

### Backend

- `db/migrations/011_exchange_quotes.sql` (nuevo)
- `db/scripts/init-db.ts`
- `db/README.md`
- `src/services/deposits.service.ts` (nuevo)
- `src/services/exchange-quotes.service.ts` (nuevo)
- `src/services/exchanges.service.ts` (nuevo)
- `src/services/incoming-conversion.service.ts` (códigos y descripción)
- `src/services/wallet-transactions.service.ts` (feed `exchange`)
- `src/controllers/wallet.controller.ts`
- `src/routes/wallet.route.ts`
- `src/utils/idempotency.ts` (nuevo)
- `src/controllers/accounts.controller.ts` (usar el helper)
- `src/middleware/loginRateLimit.ts` (rate limit de cotizaciones)
- `src/config/swagger.ts`
- `src/tests/services/deposits.service.test.ts` (nuevo)
- `src/tests/services/exchange-quotes.service.test.ts` (nuevo)
- `src/tests/services/exchanges.service.test.ts` (nuevo)
- `src/tests/services/wallet-transactions.service.test.ts` (ampliar)
- `src/tests/controllers/wallet.controller.test.ts` (nuevo o ampliar)
- `README.md`

### Frontend (`latin-zumi-front/latin-zumi-react`)

- `src/config/features.ts`
- `src/services/transactionService.ts`
- `src/components/wallet/DepositModal.tsx`
- `src/components/wallet/ExchangeModal.tsx`
- `src/types/index.ts` (si se agrega algún tipo auxiliar)
- `tests/helpers/api.ts` (fixtures de balances con `id`/`balance`)
- `tests/components/wallet/DepositModal.test.tsx` (ampliar)
- `tests/components/wallet/ExchangeModal.test.tsx` (nuevo)
- `README.md`

## Pasos

1. Crear la migración 011 y agregarla a `db:init` en orden.
2. Extraer `requireIdempotencyKey` y aplicarlo en las rutas existentes.
3. Implementar `depositToWallet` y `POST /wallet/deposits` reutilizando
   `recordIncomingConversion`; ajustar códigos y descripción.
4. Implementar `createExchangeQuote` y `GET /wallet/exchange/quote`.
5. Implementar `executeExchange` y `POST /wallet/exchanges`.
6. Completar `exchange` en el feed.
7. Documentar Swagger, README y `db/README.md`; deprecar la ruta legada.
8. Encender `TRANSACTIONS_ENABLED`, agregar códigos y normalizar balances en el
   front.
9. Ajustar los modales y agregar pruebas.

## Cómo probar

### Backend

- [ ] `npm run db:init` aplica 001–011 en orden; la tabla `exchange_quotes`
      tiene checks e índices.
- [ ] `npm run db:init` dos veces seguidas no falla.
- [ ] `POST /wallet/deposits` en la moneda principal: `200`, el saldo sube por
      el mismo importe y `source.rate = "1"`.
- [ ] `POST /wallet/deposits` en otra moneda: `200`, se acredita la conversión
      en la moneda principal y `currency_conversions` tiene una fila.
- [ ] Repetir el depósito con la misma `Idempotency-Key` y el mismo cuerpo no
      duplica el saldo ni el movimiento.
- [ ] Cambiar el cuerpo con la misma clave: `409 IDEMPOTENCY_CONFLICT`.
- [ ] Falta `Idempotency-Key`: `400 INVALID_IDEMPOTENCY_KEY`.
- [ ] Importe `0`, negativo, con 3 decimales o no numérico: `400
      INVALID_AMOUNT`.
- [ ] `GET /wallet/exchange/quote` con monedas distintas: `200` con
      `quote_id`, `to_amount`, `rate` y `expires_at` a 60 segundos.
- [ ] Cotización con `from = to`: `400 SAME_CURRENCY`.
- [ ] Cotización con importe que redondea a `0.00`: `422 AMOUNT_TOO_SMALL`.
- [ ] Proveedor de tasas caído: `503 CONVERSION_UNAVAILABLE`.
- [ ] `POST /wallet/exchanges` con saldo suficiente: debita origen, acredita
      destino y crea la cuenta destino si no existía.
- [ ] La cuenta destino nueva aparece en `GET /accounts`.
- [ ] Sin saldo: `422 INSUFFICIENT_FUNDS` y el ledger no cambia.
- [ ] Cotización de otro usuario: `404 QUOTE_NOT_FOUND`.
- [ ] Cotización ya usada: `409 QUOTE_ALREADY_USED`.
- [ ] Cotización vencida (esperar 61 segundos o forzar `expires_at`): `410
      QUOTE_EXPIRED`.
- [ ] Repetir el cambio con la misma clave y la misma cotización: mismo
      resultado, sin duplicar asientos.
- [ ] Reutilizar la clave con otra cotización: `409 IDEMPOTENCY_CONFLICT`.
- [ ] El trigger del ledger acepta los cuatro asientos (cada moneda cierra en
      cero).
- [ ] `GET /wallet/transactions` muestra el cambio con `exchange.to_currency`,
      `exchange.to_amount` y `exchange.rate`.
- [ ] Un depósito con conversión aparece como `deposit` y con `exchange: null`.
- [ ] `POST /accounts/:id/incoming` sigue funcionando y figura como deprecado
      en Swagger.
- [ ] `npm run build` y `npm test` pasan.

### Frontend

- [ ] Con `VITE_USE_MOCK=false`, el Dashboard muestra depósitos, cambios,
      transferencias e historial.
- [ ] Un depósito en la moneda principal actualiza el saldo sin recargar.
- [ ] Un depósito en otra moneda muestra el saldo acreditado en la moneda
      principal.
- [ ] El aviso de “Depósito de prueba” se ve también en la API real.
- [ ] Una transferencia real deja los saldos con `amount` utilizable (el bug de
      `balances` queda corregido).
- [ ] El modal de cambio pide una cotización, muestra la cuenta regresiva y
      confirma con `quote_id`.
- [ ] Al vencer la cotización, el botón “Actualizar cotización” pide una nueva.
- [ ] Si el back responde `QUOTE_ALREADY_USED`, se muestra el mismo camino de
      actualización.
- [ ] `INSUFFICIENT_FUNDS`, `CONVERSION_UNAVAILABLE` y `AMOUNT_TOO_SMALL`
      muestran mensajes claros.
- [ ] El historial muestra el cambio con el importe recibido y la tasa.
- [ ] `VITE_USE_MOCK=true` sigue funcionando con los mocks actuales.
- [ ] `npm run build`, `npm run lint` y `npm test` pasan.

## Riesgos / notas

- **Dinero gratis sin pasarela:** `POST /wallet/deposits` acredita saldo contra
  la cuenta interna `external`. Cualquier usuario autenticado puede aumentar su
  saldo. Es aceptable para la demo, pero **no debe usarse con dinero real**.
  Antes de abrir el registro a usuarios reales, agregar una pasarela o una
  bandera `WALLET_DEPOSITS_ENABLED=false` por defecto en producción.
- **Tasa externa:** la cotización depende de ExchangeRate-API/Frankfurter. Si el
  proveedor falla, la cotización responde `503` y el cambio no se puede
  ejecutar; el depósito en la moneda principal no necesita tasa.
- **Vencimiento de 60 segundos:** el front ya tiene cuenta regresiva; si el
  usuario tarda más, recibe `410` y debe pedir otra cotización. No reutilizar
  el `quote_id`.
- **Cotizaciones huérfanas:** quedan filas vencidas sin usar. El índice parcial
  permite limpiarlas; definir una política si el volumen crece.
- **Bloqueo de wallet:** serializa las operaciones del titular. Es correcto
  para la consistencia, pero un cambio lento (proveedor de tasas dentro de la
  transacción) no ocurre porque la tasa ya está fijada en la cotización.
- **Idempotencia:** la combinación de advisory lock + `idempotency_key` único +
  cotización bloqueada evita dobles débitos. No reemplazar por un `SELECT`
  previo sin lock.
- **Cuenta destino:** se crea solo en un cambio explícito. No crear cuentas en
  depósitos, transferencias ni en el front.
- **`currency_conversions.account_id`:** guardar la cuenta destino; el feed y
  las auditorías esperan esa semántica.
- **Balances:** el back mantiene `Account[]` (contrato del spec 029). El front
  normaliza; si en el futuro el back cambia el shape, actualizar ambos lados y
  el spec.
- **Migración 010:** reservada por el spec 036. Este spec usa 011 para no
  colisionar aunque 036 se implemente después.
- **Spec 030:** queda como referencia de diseño. No editarlo; cualquier cambio
  posterior se documenta en un spec nuevo.
- **Rate limit de cotizaciones:** es por token y por proceso (D9 = A). Con
  varias réplicas el límite no es global.
- **Redondeo:** usar `multiplyAndRoundHalfUp` y `normalizeDecimal`; no hacer
  aritmética con `Number` para saldos.
- **La ruta legada:** `POST /accounts/:id/incoming` sigue expuesta. Si se
  decide eliminarla, hacerlo en un spec aparte con aviso a los consumidores.

## Fuera de alcance

- Pasarela de pago, webhooks y confirmación bancaria.
- Comisiones, spreads, límites por operación o por día.
- Historial dedicado de cotizaciones en la API.
- Limpieza automática de cotizaciones vencidas.
- Cambio de moneda principal de la wallet (spec 038).
- Reemplazo o eliminación de `POST /accounts/:id/incoming`.
- Nuevos proveedores de tasas.
