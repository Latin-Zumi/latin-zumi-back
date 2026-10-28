# Spec: Transferencias entre usuarios y actividad de la wallet (backend)

## Fecha

2026-10-27

## Orden de ejecución: 029

## Contexto

Este spec es la **parte backend** de un cambio que se dividió en dos:

- **Backend (este spec, orden 029):** todo lo que se implementa en
  `latin-zumi-back`.
- **Frontend:** adaptación de la capa de servicio, tipos, mocks y pantallas en
  `~/.opencode/plan/2026-10-27-Transferencias-y-actividad-wallet-front.md`.

El punto de partida es el contrato de transacciones que propuso el equipo de
front
(`~/Developer/soyHenry/fullStack3.0/proyectoFinal/2026-10-27-Transacciones-contrato-y-mock.md`).
El equipo confirmó que **adapta su capa de servicio al backend**; por eso este
spec define lo que se implementa acá y no crea rutas duplicadas para acomodar al
front.

Comparación con el backend actual:

| Punto del contrato del front | Estado real en `latin-zumi-back` | Decisión |
|---|---|---|
| `GET /wallet/balances` | No existe. Existe `GET /accounts` con `{ data: Account[] }`. | **Se mantiene `/accounts`.** El front adapta su `walletService`; no se agrega `/wallet/balances`. |
| `GET /wallet/transactions` | No existe. `GET /transactions` devuelve el ledger crudo. | Se implementa el feed del titular. |
| `GET /users/lookup?email=` | No existe. | Se implementa. |
| `POST /wallet/transfers` | No existe. | Se implementa con conversión a la moneda principal del receptor. |
| `POST /wallet/deposits` | No existe como tal. | Spec 030. |
| `GET /wallet/exchange/quote` | No existe. | Spec 030. |
| `POST /wallet/exchanges` | No existe. | Spec 030. |
| `Transaction` con `type`, `status`, `counterparty`, `exchange` | No existe. | Se implementa una proyección de lectura. |
| Errores `{ code, message }` | Hoy `errorHandler` responde `{ error }`. | Se cambia el contrato de error. |
| `status: pending \| failed` | El ledger no guarda estados. | Se devuelve siempre `completed`. |
| `Idempotency-Key` | Ya se usa en retiros e ingresos. | Se reutiliza el patrón. |

## Problema

El cliente no puede reemplazar su mock por el backend porque:

1. No existe una operación para transferir saldo a otro usuario.
2. No existe una consulta de actividad con forma de movimiento (`type`,
   `counterparty`, importe y moneda del titular). `GET /transactions` devuelve
   asientos contables y expone `idempotency_key`, que no es parte del contrato
   público.
3. No se puede confirmar el nombre de un destinatario a partir de su email.
4. Los errores no traen un `code` estable.
5. `transactions` no guarda el tipo de operación, así que no se puede clasificar
   un movimiento sin inferirlo de la descripción.
6. El contrato original supone que un destinatario puede recibir cualquier
   moneda en una cuenta nueva. El modelo de wallet ya definido dice lo
   contrario: cada usuario tiene una **moneda principal elegida** y lo que llega
   en otra moneda se convierte a esa moneda; no se abre una cuenta por moneda
   para recibir una transferencia.

## Solución propuesta

Implementar la **etapa 1** de la API de transacciones:

1. **`POST /wallet/transfers`**: transfiere saldo entre dos usuarios. El emisor
   elige una de sus cuentas (moneda de origen); el receptor recibe siempre en su
   **moneda principal**. Si las monedas difieren, el backend convierte con la
   tasa vigente y registra la conversión. No se crea una cuenta nueva para el
   receptor.
2. **`GET /users/lookup?email=`**: devuelve solo el nombre del titular.
3. **`GET /wallet/transactions`**: feed paginado y filtrable con la forma
   `Transaction` del contrato, calculado por titular.
4. **Migración 009**: agrega `transactions.type`
   (`deposit`, `transfer`, `withdrawal`, `exchange`), rellena los datos
   existentes y obliga a las inserciones nuevas a declararlo.
5. **Contrato de error `{ code, message }`**: `AppError` gana un `code` y el
   `errorHandler` deja de responder `{ error }`.

Depósitos, cotización y cambio manual de moneda van en el spec 030.

### Decisión 1: los saldos quedan en `GET /accounts`

No se crea `GET /wallet/balances`. `GET /accounts` ya devuelve todas las cuentas
`user` activas del titular, con `balance: "0"` cuando no hay movimientos. El
equipo de front confirmó que adapta su servicio para leer esta ruta; esa
adaptación vive en el spec de front.

El backend mantiene el contrato existente:

```http
GET /accounts
Authorization: Bearer <token>
```

```json
{
  "data": [
    {
      "id": "10000000-0000-4000-8000-000000000001",
      "user_id": "20000000-0000-4000-8000-000000000001",
      "currency": "USD",
      "account_type": "user",
      "allow_negative": false,
      "balance": "325.00000000"
    }
  ]
}
```

El cliente mapea `id` a `account_id`, `currency` a `currency` y `balance` a
`amount` (detalle en el spec de front). No se elimina la ruta porque sigue
siendo la lectura canónica y el cliente se adapta a ella.

### Decisión 2: el receptor recibe en su moneda principal

El modelo de wallet de los specs 014, 015 y 016 define una moneda principal por
usuario. Los fondos que llegan en otra moneda se convierten a esa moneda; no se
crean cuentas nuevas para recibir una transferencia.

Consecuencias:

- El emisor elige la moneda de origen entre sus cuentas existentes. Si no tiene
  una cuenta en esa moneda, no puede transferir desde ahí.
- El receptor recibe en `wallets.primary_currency`.
- Si la moneda de origen es distinta, se usa `exchange-rate.service` para fijar
  la tasa, se calcula el importe acreditado con redondeo `HALF_UP` a 2 decimales
  y se guarda la conversión en `currency_conversions`.
- Si la moneda coincide, no se consulta ningún proveedor y la tasa es `1`.
- Si el proveedor de tasas falla, la transferencia completa falla con `503`; no
  se acredita nada parcialmente.
- No se crea una cuenta `user` nueva en la moneda de origen del emisor ni en la
  del receptor.

### Decisión 3: `/wallet` para escrituras y feed

Las rutas nuevas son:

- `POST /wallet/transfers`
- `GET /wallet/transactions`
- `GET /users/lookup`

Mantienen las respuestas planas del contrato acordado
(`{ transaction, balances, recipient }`, `{ items, page, total }`, `{ nombre }`),
a diferencia del sobre `{ data }` de las rutas existentes. No se renombran ni se
duplican las rutas de accounts ni de transactions.

### Decisión 4: errores con `code` estable

Todos los errores pasan a `{ "code": string, "message": string }`. El cliente
decide el texto por `code`; `message` queda como respaldo legible.

| HTTP | `code` | Cuándo |
|---|---|---|
| 400 | `INVALID_AMOUNT` | Monto ≤ 0, con más de 2 decimales o no numérico. |
| 400 | `INVALID_IDEMPOTENCY_KEY` | Falta el header o no cumple el formato. |
| 401 | `UNAUTHORIZED` | Token ausente, vencido o inválido. |
| 404 | `RECIPIENT_NOT_FOUND` | No existe un usuario con ese email. |
| 409 | `IDEMPOTENCY_CONFLICT` | La clave ya se usó con otra solicitud. |
| 422 | `INSUFFICIENT_FUNDS` | El emisor no tiene saldo (o cuenta) en esa moneda. |
| 422 | `SELF_TRANSFER` | El destinatario es el mismo usuario. |
| 422 | `AMOUNT_TOO_SMALL` | El importe convertido redondea a `0.00`. |
| 503 | `CONVERSION_UNAVAILABLE` | No hay tasa vigente para la conversión. |

Los errores existentes conservan su status y reciben un código por defecto
según el status (`BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, etc.).

## Contrato

### `GET /users/lookup`

```http
GET /users/lookup?email=mateo@example.com
Authorization: Bearer <token>
```

```json
200 OK
{ "nombre": "Mateo Ríos" }
```

- Requiere sesión.
- Email inválido: `400 BAD_REQUEST`.
- Email inexistente: `404 RECIPIENT_NOT_FOUND`.
- No devuelve el email ni otros datos del usuario: solo el nombre.
- Busca sin distinguir mayúsculas (`lower(email)`).

### `POST /wallet/transfers`

```http
POST /wallet/transfers
Authorization: Bearer <token>
Idempotency-Key: 6f0c2f0e-6a7e-4c1e-9f4b-2d1a8f0e5c31
Content-Type: application/json

{
  "recipient_email": "mateo@example.com",
  "currency": "USD",
  "amount": "10.00",
  "note": "Cena"
}
```

```json
200 OK
{
  "transaction": {
    "id": "30000000-0000-4000-8000-000000000201",
    "type": "transfer_sent",
    "status": "completed",
    "currency": "USD",
    "amount": "10.00",
    "created_at": "2026-10-27T14:05:00.000Z",
    "description": "Cena",
    "counterparty": { "nombre": "Mateo Ríos", "email": "mateo@example.com" },
    "exchange": null
  },
  "recipient": {
    "currency": "COP",
    "amount": "38500.00",
    "rate": "3850.000000000000"
  },
  "balances": [
    {
      "id": "10000000-0000-4000-8000-000000000001",
      "user_id": "20000000-0000-4000-8000-000000000001",
      "currency": "USD",
      "account_type": "user",
      "allow_negative": false,
      "balance": "315.00"
    }
  ]
}
```

- `amount` es un string con hasta 2 decimales y debe ser mayor a `0`.
- `currency` es la moneda de origen; debe ser una de `ARS`, `COP`, `USD`, `EUR`
  y corresponder a una cuenta activa del emisor.
- `note` es opcional, máximo 140 caracteres.
- `transaction` describe el lado del emisor (débito en la moneda de origen).
- `recipient` describe lo que recibe el destinatario en su moneda principal. Si
  la moneda coincide, `rate` es `"1.000000000000"` y `amount` es el mismo
  importe.
- `balances` es el listado de cuentas del emisor con la misma forma de
  `GET /accounts`, para que el cliente actualice su estado sin otra llamada.
- Repetir la misma `Idempotency-Key` con el mismo payload devuelve la misma
  transacción y los saldos actuales, sin duplicar asientos.
- Reutilizar la clave con otro payload, otra moneda u otro destinatario responde
  `409 IDEMPOTENCY_CONFLICT`.

### `GET /wallet/transactions`

```http
GET /wallet/transactions?type=transfer_sent&currency=USD&page=1&limit=20
Authorization: Bearer <token>
```

```json
200 OK
{
  "items": [
    {
      "id": "30000000-0000-4000-8000-000000000201",
      "type": "transfer_sent",
      "status": "completed",
      "currency": "USD",
      "amount": "10.00",
      "created_at": "2026-10-27T14:05:00.000Z",
      "description": "Cena",
      "counterparty": { "nombre": "Mateo Ríos", "email": "mateo@example.com" },
      "exchange": null
    }
  ],
  "page": 1,
  "limit": 20,
  "total": 1,
  "totalPages": 1
}
```

- Filtros opcionales: `type`, `currency`, `from`, `to`, `page`, `limit`.
- Valores de `type`: `deposit`, `transfer_sent`, `transfer_received`,
  `withdrawal`, `exchange`.
- Orden: más reciente primero (`occurred_at DESC, id DESC`).
- `limit` máximo 100; `page` y `limit` enteros positivos.
- `from` y `to` son ISO 8601 inclusivos; si ambos vienen, `from <= to`.
- Solo aparecen movimientos con al menos un asiento en una cuenta `user` activa
  del titular. Nunca se mezclan movimientos de otros titulares.
- `status` es siempre `completed` hasta que el ledger tenga estados.
- `exchange` es `null` en esta etapa.
- En una transferencia con conversión, cada participante ve el importe y la
  moneda de **su propio asiento**: el emisor ve el débito en su moneda; el
  receptor ve el crédito convertido en su moneda principal.
- `withdrawal` se incluye en el feed: los retiros ya existen (spec 021) y deben
  poder mostrarse.

## Migración 009: tipo de transacción

```sql
-- db/migrations/009_transaction_type.sql
ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS type TEXT;

UPDATE transactions
   SET type = CASE
       WHEN description = 'Retiro de cuenta' THEN 'withdrawal'
       ELSE 'deposit'
   END
 WHERE type IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'transactions_type_check'
           AND conrelid = 'transactions'::regclass
    ) THEN
        ALTER TABLE transactions
            ADD CONSTRAINT transactions_type_check
            CHECK (type IN ('deposit', 'transfer', 'withdrawal', 'exchange'));
    END IF;
END;
$$;

ALTER TABLE transactions ALTER COLUMN type SET NOT NULL;

CREATE INDEX IF NOT EXISTS transactions_type_occurred_at_idx
    ON transactions (type, occurred_at DESC);
```

La migración la ejecuta `db:init` dentro de su transacción. Rellena las filas
existentes: todos los seeds actuales son ingresos desde una cuenta `external`
(`deposit`) y los retiros ya usan la descripción `Retiro de cuenta`
(`withdrawal`). Después obliga a que toda transacción nueva declare su tipo y
crea un índice para los filtros del feed.

Los seeds deben declarar el tipo en cada inserción; si no, fallan contra el
`NOT NULL`:

```sql
INSERT INTO transactions (id, idempotency_key, description, occurred_at, type)
VALUES ('30000000-0000-4000-8000-000000000101',
        'seed:portfolio:01:usd:movement-1',
        'Movimiento demo USD 1',
        '2026-02-01T12:00:00Z',
        'deposit')
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING id;
```

El seed corre después de las migraciones, por lo que el valor `'deposit'` debe
estar explícito en los 18 bloques de `db/seeds/001_demo_data.sql`.

## Cambios en el backend

### Errores: `AppError` con `code`

```ts
// src/utils/AppError.ts
const DEFAULT_CODE_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

export class AppError extends Error {
  statusCode: number;
  code: string;
  isOperational: boolean;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code ?? DEFAULT_CODE_BY_STATUS[statusCode] ?? 'INTERNAL_ERROR';
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}
```

Cada `throw new AppError(...)` existente sigue funcionando: si no se pasa un
`code`, se deriva del status. Los flujos nuevos pasan un código explícito, por
ejemplo `new AppError('No tenés saldo suficiente', 422, 'INSUFFICIENT_FUNDS')`.
El `code` de `AppError` no se confunde con el `code` de PostgreSQL porque el
`errorHandler` evalúa primero `instanceof AppError`.

```ts
// src/middleware/errorHandler.ts
if (err instanceof AppError) {
  return res.status(err.statusCode).json({
    code: err.code,
    message: err.message,
  });
}

if (err.type === 'entity.parse.failed') {
  return res.status(400).json({
    code: 'INVALID_JSON',
    message: 'JSON inválido en el body',
  });
}

if (err.code === '23505') {
  return res.status(400).json({
    code: 'DUPLICATE_VALUE',
    message: 'El valor ya existe (violación de unicidad)',
  });
}
```

El handler traduce los errores operativos y de PostgreSQL al contrato
`{ code, message }`. Los clientes actuales solo miran el status, así que el
cambio no rompe el login ni la carga de cuentas.

### Lookup de destinatario

```ts
// src/routes/users.route.ts
usersRouter.get(
  '/users/lookup',
  asyncHandler(requireAuth),
  asyncHandler(lookupUser),
);
```

La ruta se registra antes de cualquier `/users/:id` futuro y exige sesión. El
controller valida `email` con Zod, normaliza a minúsculas y llama al servicio;
una sesión inválida la corta `requireAuth` antes de tocar la base.

```ts
// src/services/users.service.ts
export async function findUserByEmail(email: string): Promise<{
  id: string;
  nombre: string;
  email: string;
} | null> {
  const result = await pool.query<{
    id: string;
    nombre: string | null;
    username: string;
    email: string;
  }>(
    `SELECT id, nombre, username, email
       FROM users
      WHERE lower(email) = $1
      LIMIT 1`,
    [email],
  );
  const row = result.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    nombre: row.nombre?.trim() || row.username,
    email: row.email,
  };
}
```

El servicio busca por el email normalizado y devuelve el nombre con el mismo
fallback que `toAuthUser` (si `nombre` es `NULL`, usa `username`). El
controller responde solo `{ nombre }`.

`getWalletByUserId` vive en `accounts.service.ts` y devuelve la wallet del
titular con la moneda principal normalizada:

```ts
export async function getWalletByUserId(
  userId: string,
): Promise<{ id: string; primaryCurrency: string } | null> {
  const result = await pool.query<{ id: string; primary_currency: string }>(
    `SELECT id, RTRIM(primary_currency) AS primary_currency
       FROM wallets
      WHERE user_id = $1
      LIMIT 1`,
    [userId],
  );
  const row = result.rows[0];
  return row ? { id: row.id, primaryCurrency: row.primary_currency } : null;
}
```

La consulta usa `RTRIM` porque `primary_currency` es `CHAR(3)`; sin eso, la
comparación `input.currency !== recipientWallet.primaryCurrency` fallaría por
los espacios de relleno.

### Controller de transferencia

```ts
// src/controllers/wallet.controller.ts
const transferSchema = z.object({
  recipient_email: z.string().trim().toLowerCase().email().max(254),
  currency: z.enum(['USD', 'COP', 'ARS', 'EUR']),
  amount: z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/),
  note: z.string().trim().max(140).optional(),
});

export async function transfer(req: Request, res: Response) {
  const parsed = transferSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('Datos de transferencia inválidos', 400, 'BAD_REQUEST');
  }
  if (/^0+(?:\.0+)?$/.test(parsed.data.amount)) {
    throw new AppError('El monto debe ser mayor a cero', 400, 'INVALID_AMOUNT');
  }

  const idempotencyKey = req.header('Idempotency-Key');
  if (!idempotencyKey || idempotencyKey.length > 200 || !/^[\x21-\x7E]+$/.test(idempotencyKey)) {
    throw new AppError(
      'Se requiere un Idempotency-Key válido (máximo 200 caracteres)',
      400,
      'INVALID_IDEMPOTENCY_KEY',
    );
  }

  const result = await transferBetweenUsers({
    userId: getAuthContext(req).userId,
    idempotencyKey,
    recipientEmail: parsed.data.recipient_email,
    currency: parsed.data.currency,
    amount: parsed.data.amount,
    note: parsed.data.note,
  });
  return res.status(200).json(result);
}
```

El controller valida el payload y el header antes de abrir una conexión. La
identidad del emisor sale exclusivamente de la sesión, nunca del body.

### Servicio de transferencia

```ts
// src/services/transfers.service.ts
const recipient = await findUserByEmail(input.recipientEmail);
if (!recipient) {
  throw new AppError('Destinatario no encontrado', 404, 'RECIPIENT_NOT_FOUND');
}
if (recipient.id === input.userId) {
  throw new AppError('No podés transferirte a vos mismo', 422, 'SELF_TRANSFER');
}

const recipientWallet = await getWalletByUserId(recipient.id);
if (!recipientWallet) {
  throw new AppError('El destinatario no tiene una wallet', 500);
}

const amount = normalizeDecimal(input.amount, 2);
const needsConversion = input.currency !== recipientWallet.primaryCurrency;

// La tasa se pide antes de abrir la transacción para no retener locks
// mientras se espera al proveedor externo.
const quote = needsConversion
  ? await getExchangeRate(input.currency, recipientWallet.primaryCurrency)
  : { rate: '1', source: 'identity', observedAt: new Date() };

const recipientAmount = multiplyAndRoundHalfUp(amount, quote.rate, 2);
if (recipientAmount === '0.00') {
  throw new AppError(
    'El importe convertido es menor a 0.01',
    422,
    'AMOUNT_TOO_SMALL',
  );
}
```

`getWalletByUserId` lee la moneda principal del receptor. Si el emisor y el
receptor comparten moneda, no se llama al proveedor. Si no, la tasa se fija
antes de bloquear wallets. Un fallo del proveedor se traduce en
`503 CONVERSION_UNAVAILABLE` y no se registra nada.

```ts
const client = await pool.connect();
try {
  await client.query('BEGIN');

  const wallets = await client.query<{ id: string }>(
    `SELECT id FROM wallets WHERE user_id = ANY($1::uuid[])`,
    [[input.userId, recipient.id]],
  );
  if (wallets.rows.length !== 2) {
    throw new AppError('No se encontraron las wallets', 500);
  }

  // Bloqueo determinista: siempre por id ascendente, para que dos
  // transferencias cruzadas no se esperen mutuamente.
  for (const { id } of [...wallets.rows].sort((a, b) => a.id.localeCompare(b.id))) {
    await client.query('SELECT 1 FROM wallets WHERE id = $1 FOR UPDATE', [id]);
  }

  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1))',
    [`operation:${input.idempotencyKey}`],
  );

  const existing = await findExistingTransfer(client, input.idempotencyKey);
  if (existing) {
    if (!isSameTransfer(existing, input, amount, recipient.id)) {
      throw new AppError(
        'Idempotency-Key ya usado con otra solicitud',
        409,
        'IDEMPOTENCY_CONFLICT',
      );
    }
    const transaction = await getWalletTransactionById(
      existing.id,
      input.userId,
      client,
    );
    const balances = await getAccountsByUserId(input.userId, client);
    await client.query('COMMIT');
    return { transaction, recipient: existing.recipient, balances };
  }

  // ...validar saldo, insertar transaction, entries y conversión
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

El servicio bloquea las dos wallets en orden de UUID: eso serializa
transferencias cruzadas y coordina con retiros e ingresos, que bloquean la misma
fila de wallet. Después toma el advisory lock de la clave idempotente. La
comparación (`isSameTransfer`) incluye tipo, cuenta emisora, moneda, importe
normalizado, destinatario y descripción; si cambia cualquiera de esos datos, la
clave se considera reutilizada.

```sql
-- saldo del emisor en la moneda de origen
SELECT a.id AS account_id,
       COALESCE(b.balance, 0) >= $3::numeric AS sufficient
  FROM accounts a
  LEFT JOIN account_balances b
    ON b.account_id = a.id AND b.currency = a.currency
 WHERE a.wallet_id = $1
   AND a.currency = $2
   AND a.account_type = 'user'
   AND a.closed_at IS NULL;

-- cuenta principal del receptor
SELECT a.id AS account_id
  FROM accounts a
 WHERE a.wallet_id = $1
   AND a.currency = $2
   AND a.account_type = 'user'
   AND a.closed_at IS NULL;
```

La primera consulta devuelve la cuenta del emisor y si el saldo alcanza. Si no
hay fila o `sufficient` es falso, se responde `422 INSUFFICIENT_FUNDS` sin
insertar nada. La segunda busca la cuenta principal del receptor; si no existe,
es un error de integridad (`500`), porque el registro siempre crea esa cuenta.
No se crea ninguna cuenta nueva.

```sql
INSERT INTO transactions (idempotency_key, description, type)
VALUES ($1, $2, 'transfer')
RETURNING id, occurred_at;

-- Misma moneda: emisor -> receptor
INSERT INTO entries (transaction_id, account_id, amount, direction, currency)
VALUES ($1, $2, $3, 'debit',  $4),
       ($1, $5, $3, 'credit', $4);

-- Monedas distintas: se balancea cada moneda con cuentas internas
-- X: emisor -> treasury X
-- Y: treasury Y -> receptor
INSERT INTO entries (transaction_id, account_id, amount, direction, currency)
VALUES ($1, $2, $3, 'debit',  $4),
       ($1, $5, $3, 'credit', $4),
       ($1, $6, $7, 'debit',  $8),
       ($1, $9, $7, 'credit', $8);
```

La transacción se registra como `transfer`. En misma moneda hay un débito al
emisor y un crédito al receptor. En monedas distintas se usan las cuentas
internas `treasury` de cada moneda para que el trigger de balance del ledger
valide cada moneda por separado; el emisor y el receptor nunca quedan con
saldos negativos.

```sql
INSERT INTO currency_conversions
  (transaction_id, wallet_id, account_id, user_id,
   source_currency, source_amount, destination_currency, destination_amount,
   rate, rate_source, rate_observed_at, rounding)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'HALF_UP_2');
```

La fila de conversión se asocia a la wallet y a la cuenta **del receptor**,
porque es quien recibe el importe convertido; el importe de origen es el débito
del emisor. Se guardan tasa, fuente, fecha de observación y redondeo, igual que
en el flujo de ingresos del spec 016. En misma moneda no se inserta fila.

### Feed de actividad

```sql
WITH me AS (
  SELECT t.id,
         t.type,
         t.description,
         t.occurred_at,
         e.amount::text AS amount,
         e.direction,
         RTRIM(e.currency) AS currency
    FROM transactions t
    JOIN LATERAL (
      SELECT e.amount, e.direction, e.currency
        FROM entries e
        JOIN accounts a ON a.id = e.account_id
       WHERE e.transaction_id = t.id
         AND a.user_id = $1
         AND a.closed_at IS NULL
       ORDER BY (e.direction = 'debit') DESC, e.id
       LIMIT 1
    ) e ON true
)
SELECT me.*,
       COUNT(*) OVER()::int AS total,
       cp.nombre AS counterparty_nombre,
       cp.email  AS counterparty_email
  FROM me
  LEFT JOIN LATERAL (
    SELECT u.nombre, u.email
      FROM entries other
      JOIN accounts oa ON oa.id = other.account_id
      JOIN users u ON u.id = oa.user_id
     WHERE other.transaction_id = me.id
       AND oa.user_id <> $1
     LIMIT 1
  ) cp ON me.type = 'transfer'
 WHERE ($2::text IS NULL OR (
          CASE
            WHEN me.type = 'transfer' AND me.direction = 'debit' THEN 'transfer_sent'
            WHEN me.type = 'transfer' THEN 'transfer_received'
            ELSE me.type
          END
        ) = $2)
   AND ($3::text IS NULL OR me.currency = $3)
   AND ($4::timestamptz IS NULL OR me.occurred_at >= $4)
   AND ($5::timestamptz IS NULL OR me.occurred_at <= $5)
 ORDER BY me.occurred_at DESC, me.id DESC
 LIMIT $6 OFFSET $7;
```

El lateral `me` elige el asiento principal del titular: en una transferencia
con conversión, el emisor toma su débito en la moneda de origen y el receptor su
crédito en la moneda principal. Por eso cada uno ve el importe que realmente le
corresponde, no el del otro participante.

El segundo lateral busca al otro usuario de la transferencia para armar
`counterparty`; en depósitos y retiros no hay otro usuario y queda `null`. El
`COUNT(*) OVER()` devuelve el total de filas filtradas en la misma consulta, sin
un segundo `COUNT`. Los filtros se aplican después del lateral, así que
`type=transfer_received` funciona con el tipo derivado y no con el valor
almacenado.

```ts
// src/services/wallet-transactions.service.ts
function toWalletTransaction(row: WalletTransactionRow): WalletTransaction {
  const type = row.type === 'transfer'
    ? (row.direction === 'debit' ? 'transfer_sent' : 'transfer_received')
    : row.type;

  return {
    id: row.id,
    type,
    status: 'completed',
    currency: row.currency,
    amount: normalizeDecimal(row.amount, 2),
    created_at: row.occurred_at.toISOString(),
    description: row.description
      ?? (type === 'transfer_sent'
        ? `Transferencia a ${row.counterparty_nombre ?? 'un usuario'}`
        : `Transferencia de ${row.counterparty_nombre ?? 'un usuario'}`),
    counterparty: row.counterparty_email
      ? {
          nombre: row.counterparty_nombre ?? row.counterparty_email,
          email: row.counterparty_email,
        }
      : null,
    exchange: null,
  };
}
```

La fila de PostgreSQL se transforma al contrato: `amount` se normaliza a dos
decimales como string (nunca `number`), `occurred_at` se serializa a ISO 8601 y
el tipo `transfer` se convierte en `transfer_sent` o `transfer_received` según
la dirección del asiento del titular.

### Ajustes en flujos existentes

`incoming-conversion.service.ts` y `withdrawal.service.ts` deben declarar el
tipo al insertar, porque la columna pasa a ser `NOT NULL`:

```ts
// ingreso con conversión
INSERT INTO transactions (idempotency_key, description, type)
VALUES ($1, $2, 'deposit')
RETURNING id;

// retiro
INSERT INTO transactions (idempotency_key, description, type)
VALUES ($1, 'Retiro de cuenta', 'withdrawal')
RETURNING id;
```

Sin estos cambios, cualquier ingreso o retiro fallaría después de aplicar la
migración 009. Los seeds también se actualizan, como se mostró arriba.

## Archivos afectados

- `db/migrations/009_transaction_type.sql` (nuevo)
- `db/seeds/001_demo_data.sql`
- `db/scripts/init-db.ts` (carga la migración 009)
- `src/utils/AppError.ts`
- `src/middleware/errorHandler.ts`
- `src/services/users.service.ts` (`findUserByEmail`)
- `src/controllers/users.controller.ts` (`lookupUser`)
- `src/routes/users.route.ts`
- `src/services/transfers.service.ts` (nuevo)
- `src/services/wallet-transactions.service.ts` (nuevo)
- `src/controllers/wallet.controller.ts` (nuevo)
- `src/routes/wallet.route.ts` (nuevo)
- `src/server.ts`
- `src/services/accounts.service.ts` (`getAccountsByUserId` acepta el cliente de la transacción y se agrega `getWalletByUserId`)
- `src/services/incoming-conversion.service.ts`
- `src/services/withdrawal.service.ts`
- `src/config/swagger.ts`
- `README.md`
- `docs/auditoria-estado-proyecto-y-deploy.md`
- `docs/tareas.md`
- `src/utils/AppError.test.ts`
- `src/middleware/errorHandler.test.ts` (nuevo)
- `src/services/transfers.service.test.ts` (nuevo)
- `src/services/wallet-transactions.service.test.ts` (nuevo)
- `src/controllers/wallet.controller.test.ts` (nuevo)
- `src/controllers/users.controller.test.ts` (nuevo o ampliado)
- `docs/specs/index-specs.md`
- `docs/specs/cuentas-y-wallet/2026-10-27-transferencias-y-actividad-wallet.md`

## Pasos

1. Crear la migración 009 y cargarla en `db:init`; actualizar los seeds y los
   dos servicios que insertan transacciones.
2. Agregar `code` a `AppError`, actualizar `errorHandler` y sus pruebas.
3. Implementar `findUserByEmail`, `getWalletByUserId`, `lookupUser` y
   `GET /users/lookup`.
4. Implementar `transfers.service.ts` con bloqueo de wallets, idempotencia,
   conversión a la moneda principal del receptor y asientos balanceados.
5. Implementar `wallet-transactions.service.ts` y `GET /wallet/transactions`.
6. Crear `wallet.controller.ts` y `wallet.route.ts`; montar el router en
   `server.ts`.
7. Permitir que `getAccountsByUserId` reciba el cliente de la transacción y
   devolver `balances` en la respuesta de la transferencia.
8. Documentar las rutas y los códigos de error en Swagger, README y auditoría.
9. Agregar las pruebas unitarias y de controller; ejecutar build y suite.

## Cómo probar

- [ ] `db:init` aplica la migración 009 sobre una base con datos y
  `transactions.type` queda completo y `NOT NULL`.
- [ ] `db:seed` sigue siendo idempotente y no falla después de la migración.
- [ ] `GET /users/lookup` sin sesión responde `401`; con sesión devuelve
  `{ nombre }`; email inexistente responde `404 RECIPIENT_NOT_FOUND`.
- [ ] Una transferencia en la misma moneda descuenta al emisor y acredita al
  receptor sin crear cuentas nuevas.
- [ ] Una transferencia USD → COP acredita al receptor en COP usando la tasa
  vigente; el emisor ve el débito en USD y el receptor el crédito en COP.
- [ ] La conversión queda registrada en `currency_conversions` con tasa, fuente
  y redondeo.
- [ ] Si el proveedor de tasas falla, responde `503 CONVERSION_UNAVAILABLE` y no
  deja asientos ni conversión.
- [ ] Transferir más que el saldo responde `422 INSUFFICIENT_FUNDS` y no crea
  ninguna transacción.
- [ ] Transferir al propio email responde `422 SELF_TRANSFER`.
- [ ] Repetir la misma `Idempotency-Key` devuelve la misma transacción y no
  duplica asientos.
- [ ] Reutilizar la clave con otro monto o destinatario responde
  `409 IDEMPOTENCY_CONFLICT`.
- [ ] El emisor ve `transfer_sent` y el receptor `transfer_received` en
  `GET /wallet/transactions`, cada uno con su importe y moneda.
- [ ] El feed pagina, filtra por tipo, moneda y fechas, y ordena del más nuevo
  al más viejo.
- [ ] Un usuario no ve movimientos de otro titular.
- [ ] Depósitos y retiros existentes siguen funcionando y aparecen en el feed
  como `deposit` y `withdrawal`.
- [ ] Todos los errores responden `{ code, message }`; `npm run build` y
  `npm run test:vit` pasan.
- [ ] `/api-docs` documenta las tres rutas nuevas y el schema de error.

## Riesgos / notas

- **La moneda del receptor es su moneda principal.** Si el producto quiere que
  el receptor elija otra moneda por transferencia, hay que cambiar el modelo de
  wallet y este contrato. Hoy se respeta la decisión de los specs 014–016.
- **La conversión ocurre dentro de una transferencia.** No se crea una cuenta
  nueva; se usan las cuentas `treasury` de cada moneda y `currency_conversions`
  guarda la auditoría. La fila se asocia a la wallet del receptor porque es
  quien recibe el importe convertido.
- **La tasa se fija antes de bloquear wallets.** Es la misma política del flujo
  de ingresos: la tasa usada queda registrada y no se recalcula al confirmar.
  Si el proveedor falla, no hay acreditación parcial.
- **No hay estados:** `pending` y `failed` no existen en el ledger. Si se
  incorporan pasarelas de pago, hará falta una tabla o columna de estado.
- **`withdrawal` no estaba en el union del contrato original:** se agrega para no
  ocultar los retiros existentes.
- **El tipo se deduce en la migración:** todos los datos actuales son ingresos
  o retiros. Cualquier transacción nueva debe declarar su tipo; no hay default
  para evitar clasificaciones silenciosas.
- **Lookup y privacidad:** la ruta está autenticada y solo devuelve el nombre,
  pero un usuario podría enumerar emails. Considerar un rate limit por sesión.
- **Envelope mixto:** `/wallet` y `/users/lookup` responden plano, mientras las
  rutas existentes usan `{ data }`. No mezclar ambos estilos dentro del mismo
  namespace.
- **CORS sigue pendiente:** un cliente en otro origen no podrá llamar a estas
  rutas hasta resolver F6. Las pruebas de este spec se hacen por HTTP/curl o
  con un proxy de desarrollo.
- **Sin límites ni comisiones:** no se validan montos máximos por operación ni
  por día. Queda para una decisión de producto.

## Fuera de alcance

- `GET /wallet/balances` (se mantiene `GET /accounts`).
- `POST /wallet/deposits`.
- `GET /wallet/exchange/quote` y `POST /wallet/exchanges`.
- El cambio manual de moneda y la creación de saldos secundarios.
- Estados `pending`/`failed`, límites por operación y comisiones.
- CORS (F6) y rate limit del lookup.
- Implementación en el front: ver
  `~/.opencode/plan/2026-10-27-Transferencias-y-actividad-wallet-front.md`.
