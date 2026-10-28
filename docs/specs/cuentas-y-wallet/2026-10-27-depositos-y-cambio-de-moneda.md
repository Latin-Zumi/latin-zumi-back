# Spec: Depósitos y cambio de moneda

## Fecha

2026-10-27

## Orden de ejecución: 030

Depende del spec 029
(`docs/specs/cuentas-y-wallet/2026-10-27-transferencias-y-actividad-wallet.md`):
reutiliza `transactions.type`, el contrato de errores `{ code, message }`, el
feed `GET /wallet/transactions` y el patrón de idempotencia de transferencias.

## Problema

La etapa 1 deja transferencias y actividad, pero el usuario todavía no puede:

1. Ingresar dinero a su wallet desde la app.
2. Cambiar saldo de su moneda principal a otra moneda y conservar ese saldo.

El front ya define `POST /wallet/deposits`, `GET /wallet/exchange/quote` y
`POST /wallet/exchanges` en su contrato, pero el backend no los implementa. El
modelo de wallet de los specs 014–016 permite una moneda principal y saldos
secundarios **solo cuando el usuario hace un cambio explícito**; una
transferencia recibida no crea cuentas nuevas, pero un cambio sí puede hacerlo.

## Solución propuesta

1. **`POST /wallet/deposits`**: acredita un ingreso en la moneda principal de la
   wallet. Si la moneda de origen es distinta, convierte con la tasa vigente y
   registra la conversión. Es un crédito de prueba mientras no haya pasarela de
   pago.
2. **`GET /wallet/exchange/quote`**: cotiza un cambio `from → to` para un
   importe, guarda la tasa y devuelve un `quote_id` con vencimiento.
3. **`POST /wallet/exchanges`**: ejecuta una cotización vigente y no usada.
   Debita la cuenta de origen, crea la cuenta de destino si el usuario no la
   tiene y acredita el importe convertido.
4. **Migración 010**: tabla `exchange_quotes` para persistir cotizaciones,
   vencimiento y uso.
5. **Feed**: `GET /wallet/transactions` completa el campo `exchange` para los
   movimientos de tipo `exchange`.

La creación de una cuenta de destino en el cambio es la excepción explícita al
modelo de "no crear cuentas por moneda": el usuario eligió conservar ese saldo.
Una transferencia recibida sigue acreditando solo la moneda principal.

## Contrato

### `POST /wallet/deposits`

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
    "created_at": "2026-10-27T15:10:00.000Z",
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
      "currency": "ARS",
      "account_type": "user",
      "allow_negative": false,
      "balance": "385000.00"
    }
  ]
}
```

- El importe acreditado es siempre la moneda principal de la wallet.
- Si `currency` coincide con la principal, no hay conversión y `source.rate` es
  `"1"`.
- Si no coincide, se consulta la tasa, se calcula el importe con redondeo
  `HALF_UP` a 2 decimales y se guarda en `currency_conversions`.
- No hay pasarela de pago: el ingreso se registra contra la cuenta interna
  `external` de la moneda de origen.
- Requiere `Idempotency-Key`; repetir la misma clave devuelve el mismo
  resultado.

### `GET /wallet/exchange/quote`

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
  "expires_at": "2026-10-27T15:11:00.000Z"
}
```

- `from` y `to` deben ser monedas soportadas y distintas.
- Requiere sesión; la cotización queda asociada al titular.
- `amount` es el importe de origen, string con hasta 2 decimales y mayor a `0`.
- La cotización vence a los 60 segundos.
- La tasa se obtiene de `exchange-rate.service` (ExchangeRate-API con fallback a
  Frankfurter) y queda fijada en la fila de `exchange_quotes`.
- Si el importe convertido redondea a `0.00`, responde `422 AMOUNT_TOO_SMALL`.
- Si no hay tasa disponible, responde `503 CONVERSION_UNAVAILABLE`.

### `POST /wallet/exchanges`

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
    "created_at": "2026-10-27T15:10:30.000Z",
    "description": "Cambio ARS a USD",
    "counterparty": null,
    "exchange": {
      "to_currency": "USD",
      "to_amount": "101.00",
      "rate": "0.001010000000"
    }
  },
  "balances": [
    {
      "id": "10000000-0000-4000-8000-000000000005",
      "user_id": "20000000-0000-4000-8000-000000000001",
      "currency": "ARS",
      "account_type": "user",
      "allow_negative": false,
      "balance": "0.00"
    },
    {
      "id": "10000000-0000-4000-8000-000000000011",
      "user_id": "20000000-0000-4000-8000-000000000001",
      "currency": "USD",
      "account_type": "user",
      "allow_negative": false,
      "balance": "101.00"
    }
  ]
}
```

- La cotización debe pertenecer al titular, no estar vencida y no haber sido
  usada.
- Se debita la cuenta `user` de `from` y se acredita la cuenta `user` de `to`.
  Si la cuenta de destino no existe, se crea con `allow_negative = false`.
- Los asientos se balancean por moneda con las cuentas internas `treasury`.
- La operación se registra en `currency_conversions` con la tasa de la
  cotización.
- La fila de `exchange_quotes` queda con `used_transaction_id`.
- Requiere `Idempotency-Key`; repetir la misma clave con la misma cotización
  devuelve el mismo resultado. Reutilizar la clave con otra cotización responde
  `409 IDEMPOTENCY_CONFLICT`.

### Errores del spec

| HTTP | `code` | Cuándo |
|---|---|---|
| 400 | `INVALID_AMOUNT` | Importe ≤ 0, con más de 2 decimales o no numérico. |
| 400 | `SAME_CURRENCY` | `from` y `to` son iguales. |
| 400 | `INVALID_IDEMPOTENCY_KEY` | Falta el header o no cumple el formato. |
| 404 | `QUOTE_NOT_FOUND` | La cotización no existe o es de otro titular. |
| 409 | `QUOTE_ALREADY_USED` | La cotización ya fue ejecutada. |
| 409 | `IDEMPOTENCY_CONFLICT` | La clave se usó con otra solicitud. |
| 410 | `QUOTE_EXPIRED` | La cotización venció. |
| 422 | `INSUFFICIENT_FUNDS` | No alcanza el saldo de la moneda de origen. |
| 422 | `AMOUNT_TOO_SMALL` | El importe convertido redondea a `0.00`. |
| 503 | `CONVERSION_UNAVAILABLE` | No hay tasa vigente. |

## Migración 010: cotizaciones

```sql
-- db/migrations/010_exchange_quotes.sql
CREATE TABLE IF NOT EXISTS exchange_quotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
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
    used_transaction_id UUID REFERENCES transactions(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (from_currency <> to_currency)
);

CREATE INDEX IF NOT EXISTS exchange_quotes_user_created_idx
    ON exchange_quotes (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS exchange_quotes_pending_idx
    ON exchange_quotes (expires_at)
 WHERE used_transaction_id IS NULL;
```

La ejecuta `db:init` dentro de su transacción. `expires_at` se calcula en el
servicio (`now() + interval '60 seconds'`). `used_transaction_id` marca la
cotización como consumida en la misma transacción SQL que crea el cambio. El
índice parcial sirve para limpiar o auditar cotizaciones vencidas.

## Cambios en el backend

### Cotización

```ts
// src/services/exchange-quotes.service.ts
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
  const quote = await getExchangeRate(input.from, input.to);
  const toAmount = multiplyAndRoundHalfUp(amount, quote.rate, 2);

  if (toAmount === '0.00') {
    throw new AppError(
      'El importe convertido es menor a 0.01',
      422,
      'AMOUNT_TOO_SMALL',
    );
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

El servicio valida las monedas, fija la tasa y guarda la cotización antes de
devolverla. La fila queda asociada al titular que la pidió. El controller
responde con `quote_id`, monedas, importes, tasa y `expires_at`.

La fila y el mapeo al contrato son compartidos por cotización y ejecución:

```ts
export interface ExchangeQuoteRow {
  id: string;
  user_id: string;
  from_currency: string;
  to_currency: string;
  from_amount: string;
  to_amount: string;
  rate: string;
  rate_source: string;
  rate_observed_at: Date;
  expires_at: Date;
  used_transaction_id: string | null;
}

export interface ExchangeQuote {
  quote_id: string;
  from: string;
  to: string;
  from_amount: string;
  to_amount: string;
  rate: string;
  expires_at: string;
}

function toExchangeQuote(row: ExchangeQuoteRow): ExchangeQuote {
  return {
    quote_id: row.id,
    from: row.from_currency,
    to: row.to_currency,
    from_amount: normalizeDecimal(row.from_amount, 2),
    to_amount: normalizeDecimal(row.to_amount, 2),
    rate: normalizeDecimal(row.rate, 12),
    expires_at: row.expires_at.toISOString(),
  };
}
```

`ExchangeQuoteRow` usa los nombres de columna tal como los devuelve PostgreSQL
(con `RTRIM` para las columnas `CHAR(3)`) y `toExchangeQuote` aplica el
`snake_case` del contrato y normaliza los importes como strings.

### Ejecución del cambio

```ts
// src/services/exchanges.service.ts
const client = await pool.connect();
try {
  await client.query('BEGIN');

  const walletResult = await client.query<{ id: string; primary_currency: string }>(
    `SELECT id, RTRIM(primary_currency) AS primary_currency
       FROM wallets
      WHERE user_id = $1
      FOR UPDATE`,
    [input.userId],
  );
  const wallet = walletResult.rows[0];
  if (!wallet) throw new AppError('Wallet no encontrada', 404, 'NOT_FOUND');

  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1))',
    [`operation:${input.idempotencyKey}`],
  );

  const existing = await findExistingExchange(client, input.idempotencyKey);
  if (existing) {
    if (!isSameExchange(existing, input)) {
      throw new AppError(
        'Idempotency-Key ya usado con otra solicitud',
        409,
        'IDEMPOTENCY_CONFLICT',
      );
    }
    const transaction = await getWalletTransactionById(
      existing.transaction_id,
      input.userId,
      client,
    );
    const balances = await getAccountsByUserId(input.userId, client);
    await client.query('COMMIT');
    return { transaction, balances };
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
  if (!quote) throw new AppError('Cotización no encontrada', 404, 'QUOTE_NOT_FOUND');
  if (quote.used_transaction_id) {
    throw new AppError('La cotización ya fue usada', 409, 'QUOTE_ALREADY_USED');
  }
  if (new Date(quote.expires_at) <= new Date()) {
    throw new AppError('La cotización venció', 410, 'QUOTE_EXPIRED');
  }

  // ...validar saldo, crear la cuenta destino si falta, insertar entries,
  // currency_conversions y marcar la cotización usada
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

El servicio bloquea la wallet del titular y la cotización, verifica que no esté
vencida ni usada, y recién entonces mueve el dinero. La cotización se marca con
`used_transaction_id` en la misma transacción. Si dos solicitudes compiten por
la misma cotización, la segunda ve `used_transaction_id` y responde `409`.

```sql
-- saldo de la cuenta de origen
SELECT a.id AS account_id,
       COALESCE(b.balance, 0) >= $3::numeric AS sufficient
  FROM accounts a
  LEFT JOIN account_balances b
    ON b.account_id = a.id AND b.currency = a.currency
 WHERE a.wallet_id = $1
   AND a.currency = $2
   AND a.account_type = 'user'
   AND a.closed_at IS NULL;

-- cuenta destino: se usa si existe; si no, se crea porque el usuario
-- eligió conservar ese saldo
INSERT INTO accounts (user_id, wallet_id, currency, account_type, allow_negative)
VALUES ($1, $2, $3, 'user', false)
RETURNING id;
```

La cuenta de origen debe existir y tener saldo; si no, `422 INSUFFICIENT_FUNDS`.
La cuenta de destino se crea solo en este flujo explícito de cambio. La
restricción única `(wallet_id, currency)` evita duplicados; la wallet bloqueada
serializa la creación.

```sql
INSERT INTO transactions (idempotency_key, description, type)
VALUES ($1, $2, 'exchange')
RETURNING id, occurred_at;

-- ARS: origen -> treasury ARS
-- USD: treasury USD -> destino
INSERT INTO entries (transaction_id, account_id, amount, direction, currency)
VALUES ($1, $2, $3, 'debit',  $4),
       ($1, $5, $3, 'credit', $4),
       ($1, $6, $7, 'debit',  $8),
       ($1, $9, $7, 'credit', $8);

INSERT INTO currency_conversions
  (transaction_id, wallet_id, account_id, user_id,
   source_currency, source_amount, destination_currency, destination_amount,
   rate, rate_source, rate_observed_at, rounding)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'HALF_UP_2');

UPDATE exchange_quotes
   SET used_transaction_id = $1
 WHERE id = $2;
```

La transacción se registra como `exchange`; los asientos usan las cuentas
internas `treasury` para balancear cada moneda. `currency_conversions` guarda la
tasa de la cotización y `exchange_quotes` queda consumida. El trigger diferido
del ledger valida que cada moneda cierre en cero.

### Feed con `exchange`

El feed del spec 029 devuelve `exchange: null`. Este spec lo completa:

```sql
LEFT JOIN currency_conversions c ON c.transaction_id = me.id
```

```ts
const exchange = row.type === 'exchange' && row.destination_currency
  ? {
      to_currency: row.destination_currency,
      to_amount: normalizeDecimal(row.destination_amount, 2),
      rate: normalizeDecimal(row.rate, 12),
    }
  : null;
```

Para un cambio, el asiento principal del titular es el débito de la moneda de
origen; `exchange` informa la moneda y el importe acreditados. En depósitos con
conversión el campo sigue `null` porque el movimiento es un ingreso, no un
cambio entre saldos del usuario.

### Depósito

```ts
// src/services/deposits.service.ts
const wallet = await getWalletByUserId(input.userId);
if (!wallet) throw new AppError('Wallet no encontrada', 404, 'NOT_FOUND');

const amount = normalizeDecimal(input.amount, 2);
const needsConversion = input.currency !== wallet.primaryCurrency;
const quote = needsConversion
  ? await getExchangeRate(input.currency, wallet.primaryCurrency)
  : { rate: '1', source: 'identity', observedAt: new Date() };

const creditedAmount = multiplyAndRoundHalfUp(amount, quote.rate, 2);
if (creditedAmount === '0.00') {
  throw new AppError('El importe convertido es menor a 0.01', 422, 'AMOUNT_TOO_SMALL');
}
```

El depósito reutiliza la lógica de ingresos: acredita solo la moneda principal,
usa `external` y `treasury` para balancear y guarda `currency_conversions`
cuando hay conversión. La respuesta separa el importe de origen (`source`) del
importe acreditado (`transaction.amount`).

## Adaptaciones en el front

1. **Depósito.** La pantalla envía `{ currency, amount }` a
   `POST /wallet/deposits` con `Idempotency-Key` y muestra el importe acreditado
   (`transaction.amount`/`transaction.currency`) y, si hubo conversión, el
   importe de origen (`source`). Refresca balances desde `/accounts`.
2. **Cotización.** La pantalla de cambio pide
   `GET /wallet/exchange/quote?from=&to=&amount=`, muestra `to_amount`, `rate` y
   una cuenta regresiva hasta `expires_at`. Al vencer, pide otra cotización; no
   reutiliza el `quote_id`.
3. **Ejecución.** `POST /wallet/exchanges` envía `{ quote_id }` con
   `Idempotency-Key`. Maneja `410 QUOTE_EXPIRED` pidiendo una cotización nueva y
   `409 QUOTE_ALREADY_USED` sin reintentar la misma.
4. **Balances.** Después de un cambio puede aparecer una cuenta nueva en
   `/accounts` (la moneda destino). El front debe refrescar la lista y no asumir
   una sola cuenta.
5. **Feed.** `Transaction.type` ya incluye `exchange`; cuando `type` es
   `exchange`, el campo `exchange` trae `to_currency`, `to_amount` y `rate`.
6. **Errores.** Leer `{ code, message }`; en particular `QUOTE_EXPIRED`,
   `QUOTE_ALREADY_USED`, `INSUFFICIENT_FUNDS` y `CONVERSION_UNAVAILABLE`.
7. **No crear cuentas en el cliente.** El backend crea la cuenta destino del
   cambio; el front no debe inventar saldos ni `account_id`.

## Archivos afectados

- `db/migrations/010_exchange_quotes.sql` (nuevo)
- `db/scripts/init-db.ts`
- `src/services/exchange-quotes.service.ts` (nuevo)
- `src/services/exchanges.service.ts` (nuevo)
- `src/services/deposits.service.ts` (nuevo)
- `src/controllers/wallet.controller.ts`
- `src/routes/wallet.route.ts`
- `src/services/wallet-transactions.service.ts`
- `src/config/swagger.ts`
- `README.md`
- `docs/auditoria-estado-proyecto-y-deploy.md`
- `docs/tareas.md`
- `src/services/exchange-quotes.service.test.ts` (nuevo)
- `src/services/exchanges.service.test.ts` (nuevo)
- `src/services/deposits.service.test.ts` (nuevo)
- `src/controllers/wallet.controller.test.ts`
- `docs/specs/index-specs.md`
- `docs/specs/cuentas-y-wallet/2026-10-27-depositos-y-cambio-de-moneda.md`

## Pasos

1. Crear la migración 010 y cargarla en `db:init`.
2. Implementar `createExchangeQuote` y `GET /wallet/exchange/quote`.
3. Implementar `executeExchange` con bloqueo de wallet y cotización,
   idempotencia, creación de cuenta destino y asientos balanceados.
4. Implementar `POST /wallet/exchanges`.
5. Implementar `POST /wallet/deposits` reutilizando el patrón de ingresos.
6. Completar `exchange` en el feed.
7. Documentar Swagger, README y auditoría.
8. Agregar pruebas y ejecutar build y suite.

## Cómo probar

- [ ] `db:init` aplica la migración 010 y la tabla `exchange_quotes` queda
  creada con sus índices.
- [ ] `GET /wallet/exchange/quote` devuelve `quote_id`, tasa e importe
  convertido; `from = to` responde `400 SAME_CURRENCY`.
- [ ] Una cotización vencida responde `410 QUOTE_EXPIRED` al ejecutarla.
- [ ] Ejecutar dos veces la misma cotización responde `409 QUOTE_ALREADY_USED`.
- [ ] Un usuario no puede ejecutar la cotización de otro (`404 QUOTE_NOT_FOUND`).
- [ ] Un cambio con saldo suficiente debita origen, acredita destino y crea la
  cuenta destino si no existía.
- [ ] Un cambio sin saldo responde `422 INSUFFICIENT_FUNDS` y no toca el ledger.
- [ ] Repetir la misma `Idempotency-Key` no duplica el cambio.
- [ ] El feed muestra el cambio como `exchange` con `to_currency`,
  `to_amount` y `rate`.
- [ ] Un depósito en la moneda principal acredita el mismo importe; un depósito
  en otra moneda acredita la conversión en la moneda principal.
- [ ] Los depósitos y cambios aparecen en `GET /wallet/transactions` y los
  balances se actualizan.
- [ ] `npm run build` y `npm run test:vit` pasan; `/api-docs` documenta las
  rutas nuevas.

## Riesgos / notas

- **Cotizaciones en base de datos:** sobreviven a reinicios y funcionan con más
  de una réplica, a diferencia de un `Map` en memoria. Hay que definir una
  política de limpieza de cotizaciones vencidas si el volumen crece.
- **Vencimiento de 60 segundos:** es un valor de producto. Si el front tarda más
  en confirmar, recibirá `410` y deberá pedir otra cotización.
- **Tasa fijada:** la cotización congela la tasa y el importe; el cambio no
  vuelve a consultar al proveedor. Es la misma política del flujo de ingresos.
- **La cuenta destino se crea en el cambio:** es la excepción explícita al
  modelo de "no crear cuentas por moneda". Solo ocurre cuando el usuario elige
  convertir y conservar ese saldo.
- **Depósitos de prueba:** sin pasarela de pago, el ingreso se registra contra
  `external`. No debe presentarse como un depósito bancario real.
- **Sin comisiones:** el cambio no cobra fee. Si se agrega, hay que usar una
  cuenta interna `fee` y ampliar el contrato.
- **CORS:** sigue pendiente (F6); las pruebas se hacen por HTTP/curl o con
  proxy de desarrollo.
- **Estados:** igual que en el spec 029, el ledger no tiene `pending`/`failed`;
  todas las operaciones confirmadas son `completed`.

## Fuera de alcance

- Pasarela de pago real y confirmación bancaria.
- Comisiones, límites por operación o por día.
- Cotizaciones con proveedor distinto a `exchange-rate.service`.
- Historial dedicado de cotizaciones en la API.
- CORS (F6) y rate limit del endpoint de cotización.
