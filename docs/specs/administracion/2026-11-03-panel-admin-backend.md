# Spec: panel de administración (backend)

## Fecha

2026-11-03

## Orden de ejecución

**044.** Registrado en `docs/specs/index-specs.md`. Depende del contrato del front
(`2026-11-03-Panel-admin-backend.md`) y del spec 043; CORS ya permite `PATCH`. Migración nueva:
`012_admin.sql` (la anterior es `011_exchange_quotes.sql`).

## Problema

El front ya tiene el panel `/admin` completo (resumen, parámetros y usuarios) con servicio,
tipos y mock, pero el back no ofrece ninguna ruta `/admin/*`. Además:

- los usuarios tienen `roles`, pero ninguna ruta los mira;
- no hay parámetros configurables de comisión ni interés;
- `transactions_type_check` no admite `interest`;
- `users_estado_check` permite `inactivo`, que el panel no muestra;
- el login distingue cuentas bloqueadas con `USER_BLOCKED`, mientras el contrato acordado usa
  `ACCOUNT_BLOCKED`.

El panel está oculto en modo real (`ADMIN_ENABLED=false`); este spec implementa cómo encenderlo.

## Solución propuesta

### Acceso y roles

- `findActiveSession` agrega `roles` al `AuthContext` con un `JOIN users`.
- `requireAdmin` va después de `requireAuth`: si `roles` no incluye `admin`, responde
  `403 { code: 'FORBIDDEN' }`.
- El primer admin se crea a mano:
  `UPDATE users SET roles = '{user,admin}' WHERE email = '...';`
- No hay endpoint para asignar roles en esta versión.

### Migración `012_admin.sql`

```sql
CREATE TABLE IF NOT EXISTS app_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    exchange_spread_percent NUMERIC(5,2) NOT NULL DEFAULT 0
        CHECK (exchange_spread_percent BETWEEN 0 AND 10),
    updated_at TIMESTAMPTZ,
    updated_by UUID REFERENCES users (id)
);
INSERT INTO app_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS interest_rates (
    currency CHAR(3) PRIMARY KEY CHECK (currency IN ('USD','COP','ARS','EUR')),
    annual_percent NUMERIC(5,2) NOT NULL DEFAULT 0
        CHECK (annual_percent BETWEEN 0 AND 50),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO interest_rates (currency) VALUES ('ARS'),('COP'),('USD'),('EUR')
ON CONFLICT (currency) DO NOTHING;
CREATE TABLE IF NOT EXISTS settings_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    field TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    changed_by UUID REFERENCES users (id)
);
CREATE TABLE IF NOT EXISTS interest_runs (
    run_date DATE PRIMARY KEY,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE exchange_quotes
    ADD COLUMN IF NOT EXISTS market_rate NUMERIC(30,12),
    ADD COLUMN IF NOT EXISTS spread_percent NUMERIC(5,2) NOT NULL DEFAULT 0;
UPDATE users SET estado = 'bloqueado' WHERE estado = 'inactivo';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_estado_check;
ALTER TABLE users ADD CONSTRAINT users_estado_check
    CHECK (estado IN ('activo', 'bloqueado'));
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_type_check
    CHECK (type IN ('deposit', 'transfer', 'withdrawal', 'exchange', 'interest'));
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_account_type_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_account_type_check
    CHECK (account_type IN ('user', 'external', 'fee', 'treasury', 'expense'));
```

`app_settings` tiene una sola fila (`id = 1`). `interest_rates.updated_at` define desde qué día
aplica la tasa. `interest_runs` registra cada día ya procesado. Las cuentas internas `fee` y
`expense` ya existen o se habilitan acá para que el ledger siga balanceado.

### Endpoints

| Método y ruta | Respuesta |
| --- | --- |
| `GET /admin/metrics?period=day\|month` | `{ period, users: { total, active, blocked, new_in_period }, volume: [{ currency, deposits, exchanges, transfers }] }` |
| `GET /admin/settings` | `{ exchange_spread_percent, interest_rates: [{ currency, annual_percent }], updated_at, updated_by }` |
| `PATCH /admin/settings` | Mismos campos editables, todos opcionales; devuelve el `GET` completo |
| `GET /admin/settings/history?page=1&limit=20` | `{ items: [{ id, field, old_value, new_value, changed_at, changed_by }], page, total }` |
| `GET /admin/users?search=&estado=&page=1&limit=20` | `{ items: AdminUser[], page, total }`, más nuevos primero |
| `GET /admin/users/:id` | `{ user, balances, recent_transactions }` (10 movimientos) |
| `PATCH /admin/users/:id` | `{ estado: 'activo' \| 'bloqueado' }` → `{ user }` |

Reglas:

- Montos y porcentajes son strings con 2 decimales. `volume` incluye las cuatro monedas aunque
  estén en cero.
- `deposits` suma créditos a cuentas `user`; `exchanges` se cuenta en la moneda de origen;
  `transfers` se cuenta una sola vez, del lado de quien envía.
- `PATCH /admin/settings` valida spread `0..10` e interés `0..50`; si falla responde
  `400 INVALID_SETTINGS`. Cada cambio actualiza `interest_rates.updated_at` e inserta una fila en
  `settings_history` (`field = 'exchange_spread_percent'` o `'interest_rates.<MONEDA>'`).
- `PATCH /admin/users/:id` no puede bloquear al propio admin: `422 CANNOT_BLOCK_SELF`.
  Al bloquear, revoca todas las sesiones del usuario. El login y Google responden
  `403 ACCOUNT_BLOCKED` (se reemplaza `USER_BLOCKED`).
- Si el usuario no existe: `404 USER_NOT_FOUND`.

### Aplicar la comisión (spread)

En `createExchangeQuote`, la tasa efectiva se calcula con la tasa de mercado:

```ts
const factor = (1 - Number(spreadPercent) / 100).toFixed(4);
const effectiveRate = multiplyAndRoundHalfUp(quote.rate, factor, 12);
const toAmount = multiplyAndRoundHalfUp(amount, effectiveRate, 2);
```

La cotización guarda `rate = effectiveRate`, `market_rate = quote.rate` y `spread_percent`.
La respuesta agrega `spread_percent`. Al ejecutar el cambio, los asientos son: débito usuario
origen y crédito tesorería origen por `from_amount`; débito tesorería destino por
`market_amount`; crédito usuario destino por `to_amount`; crédito cuenta `fee` por la diferencia.
Si la diferencia es `0.00`, no se inserta el asiento de `fee`. Hace falta `subtractDecimal` en
`utils/decimal.ts`.

### Acreditar intereses

`POST /internal/accrue-interest` (header `X-Internal-Secret`, variable
`INTERNAL_CRON_SECRET`) procesa los días pendientes desde la última fila de `interest_runs`
hasta ayer. Si nunca corrió, procesa solo ayer.

Para cada día y cada cuenta `user` abierta:

1. Calcula el saldo al cierre del día con los asientos con `created_at < D + 1` (UTC).
2. Aplica la tasa vigente para ese día (`interest_rates.updated_at::date <= D`) y redondea
   `saldo × tasa / 100 / 365` con `HALF_UP` a 2 decimales. Si da `0.00`, no registra nada.
3. Inserta una transacción `interest` con clave `interest:<account_id>:<YYYY-MM-DD>`, débito a
   la cuenta interna `expense` y crédito a la cuenta del usuario.
4. Al terminar el día, inserta la fecha en `interest_runs`.

Un cambio de tasa hecho hoy aplica desde mañana. Correr el endpoint dos veces el mismo día no
duplica pagos por la clave idempotente y por la PK de `interest_runs`. El cron externo puede ser
un workflow diario de GitHub Actions que hace el `POST` con el secreto.

## Archivos afectados

- `src/middleware/requireAdmin.ts` (nuevo), `requireAuth.ts`, `services/auth.service.ts`.
- `src/routes/admin.route.ts`, `src/controllers/admin.controller.ts` y
  `src/services/admin-{metrics,settings,users}.service.ts` (nuevos).
- `src/services/exchange-quotes.service.ts`, `exchanges.service.ts`, `internal-account.service.ts`,
  `utils/decimal.ts`.
- `src/services/interest.service.ts`, `src/routes/internal.route.ts`, `src/utils/internal-secret.ts`
  (nuevos), `src/config/env.ts`, `.env.example`, `src/server.ts`, `src/config/swagger.ts`.
- `db/migrations/012_admin.sql`, `db/scripts/init-db.ts`.
- Tests: `src/tests/routes/admin.route.test.ts`, `src/tests/services/admin-*.test.ts`,
  `src/tests/services/interest.service.test.ts`; ajustes en tests de auth.

## Pasos

1. Migración 012, `requireAdmin`, `roles` en `AuthContext` y `ACCOUNT_BLOCKED`.
2. `GET`/`PATCH /admin/settings` y el historial.
3. `GET /admin/users`, `GET /admin/users/:id` y `PATCH /admin/users/:id` con revocación de sesiones.
4. `GET /admin/metrics`.
5. Spread en cotizaciones y ejecución de cambios.
6. Intereses y `POST /internal/accrue-interest`.
7. Swagger, `.env.example` y pruebas.

Los pasos 1 a 4 alcanzan para encender el panel; el 5 y el 6 aplican los parámetros.

## Cómo probar

- [ ] Un usuario sin rol `admin` recibe `403` en cualquier `/admin/*`.
- [ ] El admin cambia el spread y la cotización siguiente usa la tasa nueva; el asiento `fee`
      refleja la diferencia.
- [ ] Cada cambio de parámetros aparece en el historial con quién y cuándo lo hizo.
- [ ] El admin no puede bloquearse a sí mismo; al bloquear a otro, sus sesiones dejan de servir.
- [ ] Un usuario bloqueado recibe `ACCOUNT_BLOCKED` en login y en Google.
- [ ] Las métricas cuentan cada transferencia una sola vez y muestran las cuatro monedas.
- [ ] Correr el interés dos veces el mismo día no duplica pagos.
- [ ] Un cambio de tasa hoy no afecta la acreditación de ayer.
- [ ] `npm run build` y `npm test` pasan.

## Riesgos / notas

- **Interés sobre saldos reales:** tiene implicancias regulatorias. Para la demo, aclarar en la app
  que es una simulación.
- **Spread mal cargado:** afecta todas las cotizaciones. El límite de 10% y el historial son la
  contención; el cambio debe quedar auditado.
- **Interés retroactivo:** si el cron estuvo caído, los días pendientes se calculan con el saldo
  histórico del ledger, no con el saldo actual. Es más costoso, pero evita pagar de más.
- **Front pendiente:** el tipo `interest` todavía no existe en `TransactionType` ni en
  `TRANSACTION_TYPE_LABELS`. Cuando el back lo emita, el front debe sumar la etiqueta “Interés” y
  tratarlo como ingreso.
- **Idempotencia global:** este spec usa claves con `account_id` para el interés; la deuda de claves
  por usuario se resuelve en el spec 045.
