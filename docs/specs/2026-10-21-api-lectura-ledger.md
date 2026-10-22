# Spec: API de lectura del ledger

## Fecha
2026-10-21

## Problema
El frontend necesita datos consistentes para mostrar los saldos del usuario, su historial de movimientos y el detalle de una transacción. El esquema ledger append-only almacena partidas y saldos derivados, pero no define todavía un contrato HTTP de lectura ni las derivaciones que debe hacer el backend.

## Solución propuesta
Documentar tres endpoints autenticados de solo lectura. `$session_user` representa el `user_id` de la sesión autenticada. Todas las consultas se limitan a transacciones con al menos una entry en una cuenta `user` cuyo `accounts.user_id = $session_user`; no se aceptará un `user_id` proporcionado por el cliente para sustituir este filtro.

### Convenciones de serialización
- Todos los importes, incluidos los balances y amounts, son strings decimales en JSON. Nunca se serializan como `number`; la precisión de `NUMERIC(20,8)` se conserva y el frontend los procesa con decimal.js o big.js. La escala puede normalizarse quitando ceros finales, pero el valor decimal debe ser exacto.
- Todas las fechas se serializan como ISO 8601 UTC con sufijo `Z`.
- Los identificadores UUID son strings. Los códigos de moneda son strings de tres caracteres.
- No se exponen `account_id`, `account_type`, `allow_negative`, `idempotency_key` ni `created_at` de `entries` en ninguna respuesta de lectura.
- Para la vista de historial, `direction` expresa la dirección contable de la entry propia (`debit` o `credit`) y `amount` es el importe positivo de esa entry.
- Los errores usan la forma `{ "error": { "code": "<code>", "message": "<message>" } }`; `message` es apto para diagnóstico funcional y no incluye datos internos sensibles.

### `GET /api/me/balances`
Devuelve el saldo neto por moneda de las cuentas propias tipo `user`, derivado de `account_balances` unido a `accounts` y filtrado con `accounts.user_id = $session_user AND accounts.account_type = 'user'`.

Query params: ninguno.

Respuesta `200`:

```json
{
  "balances": [
    { "currency": "USD", "balance": "125.50" },
    { "currency": "BTC", "balance": "0.00125000" }
  ]
}
```

Se devuelve un objeto por moneda que tenga cuenta/saldo derivado; una lista vacía se representa como `{"balances": []}`. La lista se ordena por `currency` ascendente. Los saldos pueden ser negativos si el ledger los produce.

Estados: `200` lectura correcta; `401` falta sesión válida; `500` error interno al consultar el ledger.

### `GET /api/me/transactions`
Devuelve transacciones del usuario en orden descendente por `(occurred_at, id)`. `occurred_at` procede de `transactions`. El cursor representa esa tupla, es opaco para el cliente y el backend lo compara lexicográficamente: registros posteriores a la tupla se excluyen en el orden descendente. El orden estable desempata timestamps iguales usando `id` descendente.

Query params:
- `limit` (opcional): entero entre 1 y 100; por defecto `20`.
- `cursor` (opcional): cursor opaco devuelto como `next_cursor`.
- `currency` (opcional): código de moneda de tres caracteres; incluye una transacción si tiene al menos una entry propia en esa moneda.
- `from` y `to` (opcionales): instantes ISO 8601; filtran inclusivamente por `occurred_at` (`from <= occurred_at <= to`). Si ambos aparecen, `from` debe ser anterior o igual a `to`.

Cada elemento incluye únicamente las movements del usuario: entries que pertenecen a cuentas con `account_type = 'user' AND user_id = $session_user`. No se devuelven entries `external`, `fee` ni `treasury` en el historial. El backend deriva `type` según las reglas de esta sección.

Respuesta `200`:

```json
{
  "transactions": [
    {
      "id": "7c8ed417-e7f9-43d0-9f8e-e8ef0f0b4913",
      "occurred_at": "2026-10-21T15:30:00.000Z",
      "description": "Compra de BTC",
      "type": "buy",
      "movements": [
        { "currency": "USD", "direction": "debit", "amount": "100.00" },
        { "currency": "BTC", "direction": "credit", "amount": "0.00125000" }
      ]
    }
  ],
  "next_cursor": "eyJvY2N1cnJlZF9hdCI6..."
}
```

`description` es el texto almacenado en `transactions.description` y puede ser `null` si la columna admite nulos. `next_cursor` es `null` cuando no hay más resultados; si hay más, contiene la tupla de orden del último elemento de la página codificada de forma opaca. El backend obtiene hasta `limit + 1` filas para determinar si hay página siguiente. Una página vacía es `{ "transactions": [], "next_cursor": null }`.

Estados: `200` lectura correcta; `400` parámetros inválidos, cursor mal formado o rango invertido; `401` falta sesión válida; `500` error interno al consultar el ledger.

### `GET /api/me/transactions/:id`
Devuelve el detalle si la transacción contiene al menos una entry en una cuenta `user` del usuario autenticado. Una transacción ajena o inexistente responde igual para no revelar su existencia. El backend deriva `type` usando todas las entries de la transacción y marca ownership comparando `accounts.user_id` con `$session_user`.

Query params: ninguno. `:id` debe ser un UUID.

Respuesta `200`:

```json
{
  "transaction": {
    "id": "7c8ed417-e7f9-43d0-9f8e-e8ef0f0b4913",
    "occurred_at": "2026-10-21T15:30:00.000Z",
    "description": "Compra de BTC",
    "type": "buy",
    "entries": [
      { "currency": "USD", "direction": "debit", "amount": "100.00", "is_mine": true },
      { "currency": "BTC", "direction": "credit", "amount": "0.00125000", "is_mine": true },
      { "currency": "BTC", "direction": "debit", "amount": "0.00125000", "is_mine": false }
    ]
  }
}
```

El detalle incluye todas las entries de esa transacción para explicar su efecto contable, incluso las de cuentas `external`, `fee` y `treasury`; estas siempre se marcan `is_mine: false`. No incluye sus identificadores ni tipos de cuenta. El orden de `entries` no tiene significado contractual.

Estados: `200` detalle visible para el usuario; `400` `id` no es UUID válido; `401` falta sesión válida; `404` no existe o el usuario no participa; `500` error interno al consultar el ledger.

### Derivación backend de `type`
`transactions` no tiene columna `type`, así que el backend debe inspeccionar en conjunto las entries y sus cuentas propias y de sistema. Los siguientes patrones establecen los tipos mínimos del contrato:
- `deposit`: una o más entries de crédito en cuenta(s) `user` del usuario, compensadas por débito(s) en cuenta(s) `external` (por ejemplo, débito external USD y crédito user USD).
- `buy`: hay una moneda de pago debitada de cuenta `user` y otra moneda acreditada a cuenta `user`; la contrapartida de la moneda adquirida es una cuenta de sistema (por ejemplo, debit user USD, credit user BTC, con credit/debit compensatorios en `external`/`treasury`).
- `sell`: hay una moneda de cuenta `user` debitada y otra moneda de cuenta `user` acreditada como producto de venta (por ejemplo, debit user BTC y credit user USD con entries compensatorias de sistema).
- `exchange`: hay débitos y créditos de cuenta(s) `user` en dos o más monedas intercambiadas entre sí, sin clasificar el patrón como compra o venta según metadatos/origen de la operación (por ejemplo, debit user USD y credit user EUR, con contrapartidas de sistema).

La integración de escritura deberá guardar contexto suficiente para distinguir `buy`, `sell` y `exchange`, porque la forma contable de las entries por sí sola puede ser ambigua. Hasta que exista esa metadata, una forma de entries ambigua no se debe adivinar: el backend responderá `type: "exchange"` solo si puede probar intercambio; en los otros patrones no clasificables se tratará como error de integridad interno, no se inventará un quinto valor. Los cuatro valores públicos permitidos son `deposit`, `buy`, `sell` y `exchange`.

### Filtros de usuario y propiedad
En los balances e historial, el backend solo devuelve datos de cuentas propias `user` filtradas por sesión. La existencia de una transacción en el ledger no basta para exponerla: debe tener al menos una entry de una cuenta del usuario autenticado. El detalle autorizado muestra todas las partidas únicamente para explicar esa transacción y calcula `is_mine` por entry comparando `accounts.user_id = $session_user`; cuentas `external`, `fee` y `treasury` no son propias y quedan marcadas `false`.

### Escrituras futuras: idempotencia
Toda operación futura de dinero (compra, venta, intercambio o depósito) exigirá que el cliente envíe `idempotency_key` como UUID en el body. El backend insertará ese UUID en `transactions.idempotency_key` y garantizará el comportamiento idempotente de la operación. Este spec no define rutas ni contratos de escritura.

### Deuda explícita fuera de alcance
Este contrato no cubre los datos que el frontend necesita para el producto completo; el frontend puede usar stubs y avanzar sin bloquearse:
- Perfil del usuario: la tabla `users` aún no existe.
- Tasas de cambio: `exchange_rates` aún no existe.
- Catálogo de monedas.
- Fees y límites aplicables.

## Archivos afectados
- `docs/specs/2026-10-21-api-lectura-ledger.md` — documentación del contrato; no implementa endpoints.

## Pasos
1. Aprobar este contrato de lectura y sus reglas de derivación.
2. En un cambio posterior, implementar los endpoints autenticados y su acceso al ledger conforme a este contrato.
3. En ese cambio posterior, cubrir los criterios de aceptación de abajo con `curl` o tests.

## Cómo probar
- [ ] `curl` autenticado a `GET /api/me/balances` devuelve solo las monedas/saldos del usuario, con cada balance como string decimal exacto.
- [ ] `curl` autenticado a `GET /api/me/transactions?limit=...` devuelve una página ordenada por `(occurred_at, id)` descendente, `next_cursor` nullable y solo movements propios.
- [ ] Recorrer páginas usando `next_cursor` no repite ni omite transacciones cuando varias comparten `occurred_at`.
- [ ] Los filtros `currency`, `from` y `to` producen los resultados definidos y los parámetros inválidos responden `400`.
- [ ] `curl` autenticado a `GET /api/me/transactions/:id` devuelve entries del usuario y del sistema, con `is_mine` correcto y sin campos internos prohibidos.
- [ ] La clasificación backend produce `deposit`, `buy`, `sell` y `exchange` según patrones de entries definidos; no expone un tipo desconocido.
- [ ] Las tres rutas responden `401` sin sesión; el detalle responde `404` tanto para una transacción inexistente como para una ajena.
- [ ] Las escrituras futuras rechazan la ausencia o formato inválido de `idempotency_key` UUID y persisten la clave en `transactions.idempotency_key`.

## Riesgos / notas
- `db/migrations/001_ledger.sql` no está presente en el workspace inspeccionado; este documento se apoya en el spec existente `2026-10-21-ledger-append-only.md`, que describe el esquema previsto. Confirmar contra la migración real antes de implementar.
- El patrón contable no distingue siempre por sí solo compra, venta e intercambio. La futura escritura debe aportar/guardar contexto fiable para que el backend derive `type` sin heurísticas ambiguas.
- El cursor debe ser opaco y validado por el backend; no es un offset ni un identificador de autorización.
- Este cambio es solo documentación: no se crean rutas, controladores, middleware, tablas, migraciones ni tests.
