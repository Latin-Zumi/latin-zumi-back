# Spec: endurecimiento del contrato de wallet y endpoints legados

## Fecha

2026-11-03

## Orden de ejecución

**045.** Registrado en `docs/specs/index-specs.md`. Depende del spec 044 solo por convención de
orden; no comparte migración ni código. No reutilizar números ya asignados.

## Problema

El Report04 dejó tres deudas del back que no son parte del panel admin pero afectan el contrato:

- **F-06:** `transactions.idempotency_key` es única global (migración 001). Dos usuarios que repiten
  la misma clave se bloquean entre sí; el `Idempotency-Key` debería ser único **por usuario**.
- **F-07:** conviven endpoints nuevos y legados para las mismas operaciones (`POST /users`,
  `GET /transactions`, `/accounts/:id/*`). El front no los usa y no está claro cuáles son públicos.
- **F-09:** `GET /wallet/transactions` calcula `total` con `COUNT(*) OVER()` sobre las filas
  devueltas. Si se pide una página fuera de rango, responde `total: 0` en vez del total real.

Quedan fuera de alcance F-05 (`ACCOUNT_BLOCKED`) y F-10 (`estado='inactivo'`), que se resuelven en
el spec 044, y F-08 (filtros/paginación del front), que es un cambio del front.

## Solución propuesta

### 1. Idempotencia por usuario

Migración `013_idempotency_per_user.sql`:

```sql
ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS initiator_user_id UUID REFERENCES users (id);

UPDATE transactions t
   SET initiator_user_id = (
       SELECT a.user_id
         FROM entries e
         JOIN accounts a ON a.id = e.account_id
        WHERE e.transaction_id = t.id AND a.user_id IS NOT NULL
        ORDER BY (e.direction = 'debit') DESC, e.id
        LIMIT 1
   )
 WHERE t.initiator_user_id IS NULL;

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_idempotency_key_key;

CREATE UNIQUE INDEX IF NOT EXISTS transactions_user_idempotency_idx
    ON transactions (initiator_user_id, idempotency_key)
    WHERE initiator_user_id IS NOT NULL;
```

El backfill toma al emisor en una transferencia y al titular en depósitos, cambios e intereses.
Las filas que no tengan un usuario asociado quedan con `NULL` y no participan del índice parcial.

Cambios en los servicios:

- Cada `INSERT INTO transactions` setea `initiator_user_id` con el usuario que originó la
  operación (`userId` o el dueño de la cuenta en intereses).
- Las búsquedas de idempotencia (`existingTransfer`, `findExistingExchange` y el `previous` de
  `recordIncomingConversion`) filtran por `idempotency_key = $1 AND initiator_user_id = $2`.
- Los `pg_advisory_xact_lock` usan `operation:<user_id>:<key>`, no solo la clave.
- La comparación de payload sigue igual: misma clave + mismos datos devuelve la respuesta original;
  misma clave + otros datos responde `409 IDEMPOTENCY_CONFLICT`.

Así, dos usuarios pueden usar el mismo UUID sin interferirse, y el interés conserva su clave
`interest:<account_id>:<fecha>`, que ya es única por cuenta.

### 2. Endpoints legados

No se eliminan en este spec (podrían tener consumidores externos); se marcan como legados y se
documenta el reemplazo:

| Legado | Reemplazo |
| --- | --- |
| `POST /users` | `POST /auth/register` |
| `GET /transactions`, `GET /transactions/:id` | `GET /wallet/transactions` para el usuario; el detalle del ledger queda interno |
| `POST /accounts/:id/incoming` | `POST /wallet/deposits` |
| `GET /accounts/:id`, `GET /accounts/:id/balance` | `GET /accounts` |
| `POST /accounts/:id/withdraw` | Sin reemplazo público todavía |

Acciones concretas:

- Agregar `deprecated: true` a esas operaciones en `src/config/swagger.ts`.
- Agregar una sección “Endpoints legados” en `README.md` con la tabla anterior.
- No tocar sus tests ni su comportamiento en este spec.

### 3. `total` del historial

Separar el conteo de la página. El `COUNT(*) OVER()` se reemplaza por una consulta con el mismo
CTE `me` y los mismos filtros, sin `LIMIT/OFFSET`:

```ts
const countResult = await pool.query<{ total: number }>(
  `WITH me AS (/* mismos filtros que la consulta principal */)
   SELECT COUNT(*)::int AS total FROM me
    WHERE ($2::text IS NULL OR CASE WHEN me.type='transfer' AND me.direction='debit'
             THEN 'transfer_sent' WHEN me.type='transfer' THEN 'transfer_received'
             ELSE me.type END = $2)
      AND ($3::text IS NULL OR me.currency = $3)
      AND ($4::timestamptz IS NULL OR me.occurred_at >= $4)
      AND ($5::timestamptz IS NULL OR me.occurred_at <= $5)`,
  [filters.userId, filters.type ?? null, filters.currency ?? null,
   filters.from ?? null, filters.to ?? null],
);
```

La consulta de la página se queda con `LIMIT $6 OFFSET $7` y ya no necesita la ventana. Con eso,
una página fuera de rango devuelve `items: []` y el `total` real.

## Archivos afectados

- `db/migrations/013_idempotency_per_user.sql`, `db/scripts/init-db.ts`.
- `src/services/transfers.service.ts`, `exchanges.service.ts`, `incoming-conversion.service.ts`,
  `interest.service.ts` (si ya existe por el spec 044).
- `src/services/wallet-transactions.service.ts`.
- `src/config/swagger.ts`, `README.md`.
- Tests: `src/tests/services/transfers.service.test.ts`, `exchanges`/`wallet-transactions` y
  `src/tests/routes/wallet.route.test.ts`.

## Pasos

1. Migración 013 y backfill; `init-db.ts`.
2. Pasar `userId` a los helpers de idempotencia y cambiar los locks.
3. Setear `initiator_user_id` en los cuatro flujos que insertan transacciones.
4. Separar el conteo del historial.
5. Swagger, README y pruebas.

## Cómo probar

- [ ] Dos usuarios usan el mismo `Idempotency-Key` en transferencias distintas y ambas se registran.
- [ ] El mismo usuario repite la misma clave con los mismos datos y recibe la respuesta original.
- [ ] El mismo usuario repite la clave con otros datos y recibe `409 IDEMPOTENCY_CONFLICT`.
- [ ] Un depósito, un cambio, una transferencia y un interés guardan su `initiator_user_id`.
- [ ] `GET /wallet/transactions?page=999` devuelve `items: []` y el `total` real.
- [ ] `GET /wallet/transactions` sigue devolviendo el orden y los filtros actuales.
- [ ] Swagger marca los legados como `deprecated` y el README explica el reemplazo.
- [ ] `npm run build` y `npm test` pasan.

## Riesgos / notas

- **Backfill ambiguo:** una transacción entre dos usuarios se asigna al emisor. Es lo correcto para
  idempotencia, pero conviene revisar que no existan claves repetidas antes de crear el índice.
- **Clientes viejos:** al dejar de ser global, una clave usada por el usuario A ya no bloquea al B.
  Es el comportamiento buscado; no cambia la respuesta para un mismo usuario.
- **Legados:** si se eliminan en el futuro, hacerlo en un spec aparte con aviso de breaking change.
- **Interés:** la clave incluye `account_id`, así que sigue siendo única incluso sin usuario; el
  `initiator_user_id` es solo para auditoría y consistencia.
