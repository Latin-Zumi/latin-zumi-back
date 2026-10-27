# Spec: Ruta de consulta de saldo del ledger

## Fecha
2026-10-24

## Orden de ejecución: 003

## Problema
El repositorio ya tiene un esquema de ledger, seeds de demostración y una conexión compartida a PostgreSQL, pero la aplicación Express aún no monta rutas. No hay un flujo HTTP para comprobar que los datos seeded se pueden consultar desde la aplicación. También hace falta revisar el esquema y la carga de seeds dentro de ese flujo.

## Solución propuesta
Revisar la migración, sus restricciones y los seeds demo. Implementar una única ruta `GET /accounts/:id/balance`, un controller que valide el parámetro y delegue al servicio, y un service como única capa de la aplicación que consulte PostgreSQL. La consulta usará `accounts` y `account_balances` para devolver la moneda y el saldo de la cuenta, incluido saldo cero si la cuenta existe sin movimientos; responderá 404 si no existe. Montar el router en Express mediante `asyncHandler` y el middleware de errores existente. Corregir en el esquema o seeds cualquier defecto concreto que impida mantener datos válidos e idempotentes.

## Código propuesto

Los siguientes fragmentos fijan la estructura y el contrato; los imports y tipos se ajustarán al estilo final del proyecto.

### Ruta

```ts
import { Router } from 'express';
import { getAccountBalance } from '../controllers/accounts.controller.js';
import { asyncHandler } from '../handlers/asyncHandler.js';

export const accountsRouter = Router();

accountsRouter.get('/accounts/:id/balance', asyncHandler(getAccountBalance));
```

### Controller

```ts
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getBalanceByAccountId } from '../services/accounts.service.js';
import { AppError } from '../utils/AppError.js';

const accountIdSchema = z.string().uuid();

export async function getAccountBalance(req: Request, res: Response) {
  const parsedId = accountIdSchema.safeParse(req.params.id);
  if (!parsedId.success) throw new AppError('ID de cuenta inválido', 400);

  const balance = await getBalanceByAccountId(parsedId.data);
  if (!balance) throw new AppError('Cuenta no encontrada', 404);

  return res.status(200).json({ data: balance });
}
```

El controller valida parámetros, delega y mapea errores HTTP; no contiene SQL ni accede directamente al pool.

### Service

```ts
import { pool } from '../config/db.js';

export async function getBalanceByAccountId(accountId: string) {
  const result = await pool.query(
    `SELECT a.id AS account_id,
            a.currency,
            COALESCE(b.balance, 0)::text AS balance
       FROM accounts a
       LEFT JOIN account_balances b
         ON b.account_id = a.id AND b.currency = a.currency
      WHERE a.id = $1`,
    [accountId],
  );

  return result.rows[0] ?? null;
}
```

La conversión a texto conserva la precisión decimal de `NUMERIC`; la respuesta de ejemplo tendrá esta forma:

```json
{
  "data": {
    "account_id": "10000000-0000-4000-8000-000000000001",
    "currency": "USD",
    "balance": "125.00000000"
  }
}
```

### Montaje

```ts
import { accountsRouter } from './routes/accounts.route.js';

app.use(accountsRouter);
// El middleware de 404 existente queda después de esta línea.
```

La consulta usa parámetros (`$1`), inicia desde `accounts` para reconocer cuentas sin movimientos y aprovecha `account_balances` para calcular los saldos ledger.

## Archivos afectados
- db/migrations/001_ledger.sql (solo si la revisión encuentra un defecto que requiera corrección)
- db/seeds/001_demo_data.sql (solo si la revisión encuentra un defecto en la carga/idempotencia)
- src/server.ts
- src/routes/accounts.route.ts
- src/controllers/accounts.controller.ts
- src/services/accounts.service.ts
- docs/specs/2026-10-24-ledger-balance-route.md

## Pasos
1. Verificar las relaciones, restricciones, trigger de balance, vista de saldos y comportamiento de repetición de los seeds.
2. Crear el servicio de consulta de cuenta/saldo, manteniendo todo SQL en `src/services/`.
3. Crear el controller para validar `id`, llamar al servicio y formar respuestas HTTP sin SQL.
4. Definir y montar una sola ruta con `asyncHandler`.
5. Ajustar el esquema o los seeds solo si la revisión confirma un problema que afecte la integridad o el flujo solicitado.

## Cómo probar
- [x] Con el esquema ya inicializado, ejecutar `npm run db:seed` dos veces y comprobar que quedan 4 cuentas demo, 2 transacciones y 4 entries.
- [x] Consultar `GET /accounts/10000000-0000-4000-8000-000000000001/balance` y recibir `200` con saldo `125.00000000` y moneda `USD`.
- [x] Consultar una cuenta inexistente y recibir `404`; enviar un `id` inválido y recibir `400`.

## Riesgos / notas
- La ruta depende de que PostgreSQL esté configurado y de haber aplicado migración y seeds.
- `db:init` usa `CREATE TABLE` directo y no se puede volver a ejecutar sobre un esquema ya creado; durante esta implementación la base ya tenía el esquema aplicado.
- La vista solo contiene cuentas con movimientos; el servicio debe devolver cero para una cuenta existente sin entries.
- Se conservará el límite de capas: routes conectan handlers, controllers llaman al servicio y solo services ejecutan SQL.
