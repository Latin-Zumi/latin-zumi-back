# Spec: Esquema SQL ledger append-only

## Fecha
2026-10-21

## Problema
Los saldos almacenados y modificados directamente pueden quedar corruptos sin historial auditable. Se requiere un esquema PostgreSQL que permita derivarlos de asientos contables inmutables y balanceados por moneda.

## Solución propuesta
Crear únicamente `db/migrations/001_ledger.sql`. La migración creará `users`,
`accounts`, `transactions` y `entries` con las restricciones solicitadas;
usará `gen_random_uuid()` disponible en el PostgreSQL del proyecto, añadirá
los índices mínimos, reglas para ignorar `UPDATE`/`DELETE` en `entries`, el
trigger de balance y la vista `account_balances`.

El balance se validará con un constraint trigger diferido al final de la transacción. De ese modo se puede insertar el conjunto completo de partidas antes de comparar débitos y créditos por moneda, y una transacción incompleta no podrá confirmarse. Se usará una vista normal para calcular siempre el saldo actual desde el ledger, sin un proceso de refresco que pueda dejar datos derivados desactualizados.

## Archivos afectados
- `db/migrations/001_ledger.sql` — única pieza de implementación. Contendrá, entre otras, estas definiciones representativas:

```sql
CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  currency CHAR(3) NOT NULL,
  account_type TEXT NOT NULL
    CHECK (account_type IN ('user', 'external', 'fee', 'treasury')),
  allow_negative BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (user_id, currency, account_type)
);
```

```sql
CREATE TABLE entries (
  id BIGSERIAL PRIMARY KEY,
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  account_id UUID NOT NULL REFERENCES accounts(id),
  amount NUMERIC(20,8) NOT NULL CHECK (amount > 0),
  direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
  currency CHAR(3) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

```sql
CREATE VIEW account_balances AS
SELECT account_id, currency,
       SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END) AS balance
FROM entries
GROUP BY account_id, currency;
```

La migración también definirá la cabecera `transactions`, índices, `assert_transaction_balanced()` y su constraint trigger diferido, y las reglas `entries_no_update` / `entries_no_delete` con `DO INSTEAD NOTHING`.

## Pasos
1. Crear la migración SQL en `db/migrations/`, fuera de `src/`.
2. Incluir todas las tablas, restricciones, índices, trigger, reglas y vista solicitados.
3. Revisar el SQL para confirmar que todos los importes usan `NUMERIC(20,8)` y no usan tipos `FLOAT`, `REAL` ni `MONEY`.

## Cómo probar
- [ ] Aplicar `db/migrations/001_ledger.sql` en PostgreSQL crea la extensión, tablas, índices, trigger, reglas y vista.
- [ ] Verificar que el trigger rechaza al confirmar partidas con débitos y créditos desbalanceados por moneda.
- [ ] Verificar que `UPDATE` y `DELETE` sobre `entries` no modifican filas.
- [ ] Verificar que `account_balances` calcula correctamente el saldo con varias partidas.

## Riesgos / notas
- El repositorio no tiene un directorio de migraciones previo; se introducirá `db/migrations/` en la raíz.
- La vista normal garantiza que cada consulta derive el saldo de las partidas confirmadas y evita refrescos manuales.
- Las reglas `DO INSTEAD NOTHING` silencian operaciones de mutación; las filas permanecen intactas.
- No hacen falta tipos TypeScript, helpers, tests Vitest, autenticación, sesiones, endpoints HTTP, frontend, tasas de cambio, emails ni seeds para que la migración SQL corra. Permanecen fuera de alcance.
