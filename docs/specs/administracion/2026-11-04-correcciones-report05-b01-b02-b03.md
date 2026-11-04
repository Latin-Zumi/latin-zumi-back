# Spec: correcciones B-01, B-02 y B-03 del Report05

## Fecha

2026-11-04

## Orden de ejecución

**048.** Registrado en `docs/specs/index-specs.md`. Agrupa los tres arreglos de código
pendientes del Report05 (`B-01` P0, `B-02` P1, `B-03` P1). No depende de migraciones
nuevas; requiere el esquema del spec 044 ya aplicado.

## Alcance

| ID | Archivos en alcance |
| --- | --- |
| B-01 | `src/services/interest.service.ts`, `src/tests/services/interest.service.test.ts` (nuevo) |
| B-02 | `src/services/admin.service.ts`, `src/tests/services/admin.service.test.ts` |
| B-03 | `src/controllers/wallet.controller.ts`, `src/config/swagger.ts`, `src/mcp/tools.ts`, `src/tests/controllers/wallet.controller.test.ts` (nuevo), `src/tests/services/wallet-transactions.service.test.ts` |

Fuera de alcance: migraciones, `interest_runs`, carga de tasas reales, `render.yaml`,
variables de entorno y reproceso de días ya registrados.

## Problema

**B-01 — la tasa de interés pierde días.** `accrueInterest()` resuelve la tasa de cada
día con `r.updated_at::date <= $1::date` sobre `interest_rates`, tabla con una fila por
moneda que se actualiza in place (`currency` es PK). Al cambiar `updated_at`, todo día
pendiente anterior al cambio deja de encontrar fila, el `COALESCE(...,0)` devuelve `0` y
el día se marca igual en `interest_runs`, por lo que no se recalcula.

**B-02 — historial de settings con valores sin cambio.** `patchAdminSettings()` lee el
valor actual con `FOR UPDATE` pero no lo compara; actualiza `updated_at`/`updated_by` e
inserta en `settings_history` por cada campo recibido, aunque el valor nuevo sea igual.

**B-03 — `type=interest` rechazado.** `wallet-transactions.service.ts` ya devuelve
`interest` (el `CASE` solo reescribe `transfer`), pero el `z.enum` del controller no lo
incluye y responde 400. Swagger y el contrato MCP replican el enum incompleto.

## Solución propuesta

### B-01

Regla adoptada: la tasa aplicable a cada día procesado es la tasa vigente al momento de
la ejecución, no la que estaba vigente en ese día histórico (decisión de producto **NO
VERIFICADA** con el negocio). No se historizan tasas ni se crean versiones.

Snippet representativo de la consulta resultante:

```sql
COALESCE((SELECT r.annual_percent FROM interest_rates r WHERE r.currency = a.currency), 0)
```

La subconsulta corre por cuenta dentro del bucle diario de `accrueInterest()`, toma
siempre la fila actual de `interest_rates` y elimina la condición temporal que dejaba los
días en cero. El resto del flujo no cambia: cálculo con `multiplyAndRoundHalfUp`,
idempotencia por `interest:<account_id>:<day>`, marcado en `interest_runs` y
`pg_advisory_xact_lock`. No cargar tasas reales hasta que pase el test de cambio de tasa.

### B-02

Snippet representativo de la comparación dentro de la transacción:

```ts
const next = Number(spread).toFixed(2);
if (old.rows[0].value !== next) {
  await client.query(`UPDATE app_settings SET exchange_spread_percent = $1, ...`);
  await client.query(`INSERT INTO settings_history(...) VALUES (...)`);
}
```

`patchAdminSettings()` compara el valor actual contra el nuevo ya normalizado a dos
decimales, para el spread y para cada moneda de `interest_rates`. Si son iguales, no
ejecuta `UPDATE`, no toca `updated_at`/`updated_by` y no inserta historial. Si son
distintos, mantiene el comportamiento actual. La respuesta sigue siendo el estado
completo de `getAdminSettings()` con HTTP 200, aunque ningún campo cambie.

### B-03

Snippet representativo del enum del query:

```ts
const types = ['deposit','transfer_sent','transfer_received','withdrawal','exchange','interest'] as const;
```

El controller valida `type=interest` y lo pasa a `listWalletTransactions`, que ya filtra
por `me.type` sin cambios. Se replica `interest` en el enum de Swagger
(`/wallet/transactions`) y en `activityTypes` y `activityItemSchema.type` de
`src/mcp/tools.ts`. No se modifica SQL ni la forma de la respuesta.

## Archivos afectados

- `src/services/interest.service.ts`
- `src/services/admin.service.ts`
- `src/controllers/wallet.controller.ts`
- `src/config/swagger.ts`
- `src/mcp/tools.ts`
- `src/tests/services/interest.service.test.ts` (nuevo)
- `src/tests/services/admin.service.test.ts`
- `src/tests/services/wallet-transactions.service.test.ts`
- `src/tests/controllers/wallet.controller.test.ts` (nuevo)
- `docs/specs/index-specs.md`

## Pasos

1. Quitar la condición `r.updated_at::date <= $1::date` de la consulta de tasa en `accrueInterest()` y conservar el `COALESCE(...,0)` solo como salvaguarda.
2. Crear `interest.service.test.ts` con cambio de tasa a mitad del período pendiente, reejecución idempotente y moneda sin tasa.
3. Comparar valores normalizados en `patchAdminSettings()` y condicionar update e historial a que exista cambio.
4. Agregar a `admin.service.test.ts` los casos de mismo valor, body mixto y formatos equivalentes.
5. Agregar `interest` al enum del controller, a Swagger y al contrato MCP.
6. Agregar el test de controller para `type=interest` y el de servicio para el filtro.
7. Ejecutar `npm test` y `npm run build`.

## Criterios de aceptación

- **AC-B01-1:** con `interest_runs` vacío y tasa mayor a 0, todos los días pendientes generan transacción distinta de `0.00`.
- **AC-B01-2:** si la tasa cambia entre ejecuciones, los días pendientes posteriores se liquidan con la tasa nueva y ningún día queda en cero.
- **AC-B01-3:** una segunda ejecución sin días nuevos devuelve `processed_days: 0` y `transactions: 0`.
- **AC-B01-4:** moneda sin fila en `interest_rates` produce `0.00` y no genera transacción.
- **AC-B01-5:** no se agregan migraciones ni se altera el esquema.
- **AC-B02-1:** `PATCH` con el mismo spread no inserta historial ni modifica `updated_at`/`updated_by`.
- **AC-B02-2:** `PATCH` con la misma tasa no inserta historial ni modifica `interest_rates.updated_at`.
- **AC-B02-3:** body mixto registra y actualiza solo el campo distinto.
- **AC-B02-4:** valores equivalentes (`5`, `5.0`, `5.00`) se consideran iguales.
- **AC-B02-5:** body vacío o sin cambios responde 200 con el estado actual y cero inserciones.
- **AC-B03-1:** `GET /wallet/transactions?type=interest` responde 200 y devuelve solo transacciones `interest`.
- **AC-B03-2:** `total` y `totalPages` corresponden al filtro y la paginación funciona.
- **AC-B03-3:** un `type` fuera de los seis permitidos sigue respondiendo 400.
- **AC-B03-4:** Swagger y el contrato MCP exponen `interest`.
- **AC-B03-5:** sin `type`, la respuesta no cambia.

## Cómo probar

- [ ] Cambio de tasa a mitad del período pendiente: todos los días se procesan con importe distinto de `0.00` (AC-B01-1, AC-B01-2).
- [x] Reejecución sin días pendientes: sin transacciones nuevas (AC-B01-3).
- [ ] Moneda sin tasa: sin transacción (AC-B01-4).
- [x] `PATCH` con spread idéntico: cero `INSERT INTO settings_history` y cero `UPDATE app_settings` (AC-B02-1).
- [x] `PATCH` con tasa idéntica: cero inserciones y cero updates (AC-B02-2).
- [x] `PATCH` mixto: una inserción y un update sobre el campo distinto (AC-B02-3).
- [x] Formatos equivalentes: sin cambios (AC-B02-4).
- [x] `GET /wallet/transactions?type=interest`: 200 y solo tipos `interest` (AC-B03-1).
- [x] `type=invalid`: 400 (AC-B03-3).
- [x] `npm test` y `npm run build` en verde.

## Riesgos / notas

- Aplicar la tasa actual a días históricos pendientes puede diferir de la tasa que estaba vigente; queda documentado como decisión no verificada con negocio.
- No invocar el cron real antes de B-01: los días quedan marcados en `interest_runs` y no se recalculan solos. Reprocesarlos es destructivo y requiere backup y confirmación explícita.
- El spec agrupa tres fixes independientes por pedido explícito; se pueden implementar y revertir por separado.
