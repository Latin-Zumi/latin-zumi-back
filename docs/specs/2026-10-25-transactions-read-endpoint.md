# Spec: Consultar detalle de transactions

## Fecha
2026-10-25

## Problema
El esquema ya guarda cabeceras en `transactions` y asientos asociados en
`entries`, pero la API todavía no expone este historial. Sin una ruta de
consulta no se puede recuperar desde HTTP una operación con sus movimientos.

## Solución propuesta
Crear `transactions.service.ts`, `transactions.controller.ts` y
`transactions.route.ts` siguiendo la división actual de `accounts`:

- `GET /transactions/:id` devuelve la cabecera de la transacción y sus
  asientos asociados.
- El service concentra todas las consultas SQL y devuelve `null` si no existe
  la cabecera.
- El controller valida `id` como UUID, delega al service y forma la respuesta
  `{ data }`; responde `400` para un UUID inválido y `404` si no existe.
- La route conecta el handler mediante `asyncHandler` y se monta en Express.
- Swagger documenta el endpoint y los formatos de sus campos.

La respuesta incluirá `id`, `idempotency_key`, `description`, `occurred_at` y
`entries`; cada asiento incluirá `id`, `account_id`, `amount`, `direction`,
`currency` y `created_at`. Los importes se devolverán como texto decimal para
preservar precisión. El endpoint será solo de lectura, coherente con el ledger
append-only.

### Snippets propuestos

#### Service: tipos y SQL parametrizado

```ts
export interface TransactionEntry {
  id: string;
  account_id: string;
  amount: string;
  direction: 'debit' | 'credit';
  currency: string;
  created_at: Date;
}

export interface Transaction {
  id: string;
  idempotency_key: string;
  description: string | null;
  occurred_at: Date;
  entries: TransactionEntry[];
}

export async function getTransactionById(
  transactionId: string,
): Promise<Transaction | null> {
  const transactionResult = await pool.query<Omit<Transaction, 'entries'>>(
    `SELECT id, idempotency_key, description, occurred_at
       FROM transactions
      WHERE id = $1`,
    [transactionId],
  );
  const transaction = transactionResult.rows[0];
  if (!transaction) return null;

  const entriesResult = await pool.query<TransactionEntry>(
    `SELECT id::text AS id,
            account_id,
            amount::text AS amount,
            direction,
            RTRIM(currency) AS currency,
            created_at
       FROM entries
      WHERE transaction_id = $1
      ORDER BY id`,
    [transactionId],
  );

  return { ...transaction, entries: entriesResult.rows };
}
```

El service es la única capa con acceso a `pool` y SQL; ambas consultas usan el
ID parametrizado y el orden por `id` mantiene estable la lista de asientos.

#### Controller: HTTP, validación y delegación

```ts
const transactionIdSchema = z.string().uuid();

export async function getTransaction(req: Request, res: Response) {
  const parsedId = transactionIdSchema.safeParse(req.params.id);
  if (!parsedId.success) {
    throw new AppError('ID de transacción inválido', 400);
  }

  const transaction = await getTransactionById(parsedId.data);
  if (!transaction) {
    throw new AppError('Transacción no encontrada', 404);
  }

  return res.status(200).json({ data: transaction });
}
```

El controller solo usa `req`/`res`, valida el parámetro y traduce el resultado
del service a una respuesta HTTP.

#### Route y montaje

```ts
export const transactionsRouter = Router();

transactionsRouter.get(
  '/transactions/:id',
  asyncHandler(getTransaction),
);
```

```ts
app.use(transactionsRouter);
```

La route conecta el método HTTP y el handler; `server.ts` monta el router antes
del middleware de 404.

#### OpenAPI: contrato de éxito

```ts
'/transactions/{id}': {
  get: {
    summary: 'Consultar una transacción',
    operationId: 'getTransaction',
    responses: {
      '200': {
        description: 'Cabecera de la transacción y sus asientos.',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['data'],
              example: {
                data: {
                  id: '30000000-0000-4000-8000-000000000001',
                  idempotency_key: 'seed:demo:usd-deposit',
                  description: 'Depósito de demostración en USD',
                  occurred_at: '2026-01-15T12:00:00.000Z',
                  entries: [
                    {
                      id: '1',
                      account_id: '10000000-0000-4000-8000-000000000002',
                      amount: '125.00000000',
                      direction: 'debit',
                      currency: 'USD',
                      created_at: '2026-01-15T12:00:00.000Z',
                    },
                  ],
                },
              },
            },
          },
        },
      },
      '400': { description: 'El identificador no es un UUID válido.' },
      '404': { description: 'No existe una transacción con ese identificador.' },
    },
  },
},
```

La definición final también incluirá el parámetro `id` de tipo UUID y los
esquemas de cada campo de respuesta.

## Archivos afectados
- src/services/transactions.service.ts
- src/controllers/transactions.controller.ts
- src/routes/transactions.route.ts
- src/server.ts
- src/config/swagger.ts
- docs/specs/2026-10-25-transactions-read-endpoint.md

## Pasos
1. Definir tipos de respuesta para transacción y sus asientos.
2. Implementar en el service la consulta parametrizada de la cabecera y de
   sus asientos, con importes `NUMERIC` serializados como texto.
3. Implementar el controller con validación UUID, delegación y errores HTTP,
   sin SQL.
4. Crear y montar `GET /transactions/:id` mediante `asyncHandler`.
5. Documentar el endpoint en OpenAPI y verificar compilación y respuestas.

## Cómo probar
- [ ] Ejecutar `npm run build` sin errores de TypeScript.
- [ ] Consultar la transacción demo
  `30000000-0000-4000-8000-000000000001` y recibir `200`, la cabecera y sus
  dos asientos USD.
- [ ] Confirmar que los importes de los asientos se serializan como texto.
- [ ] Enviar un UUID inválido y recibir `400`.
- [ ] Consultar un UUID válido inexistente y recibir `404`.
- [ ] Confirmar que `GET /transactions/{id}` aparece documentado en `/api-docs`.

## Riesgos / notas
- Este spec asume una consulta de detalle de solo lectura. No agrega creación,
  actualización ni eliminación de transacciones; el payload de escritura y
  sus reglas de idempotencia no están definidos en el pedido.
- Se requiere PostgreSQL inicializado y con los datos demo para probar la
  transacción de ejemplo.
- Las consultas usan parámetros para evitar interpolar IDs en SQL.
