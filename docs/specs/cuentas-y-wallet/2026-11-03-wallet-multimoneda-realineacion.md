# Spec: wallet multimoneda (realineación de depósitos y transferencias)

## Fecha

2026-11-03

## Orden de ejecución

**043.** Agregado al índice de `docs/specs/index-specs.md`.

## Problema

Esto revierte la conversión automática de los specs 029/039: la wallet vuelve
a tener una cuenta `user` por moneda (014–016). El front ya funciona con ese
modelo, pero el back:

- acredita depósitos en `primary_currency` (`deposits.service.ts`);
- convierte las transferencias a la `primary_currency` del receptor
  (`transfers.service.ts`);
- renombra o bloquea la cuenta al cambiar la moneda preferida
  (`users.service.ts`);
- no permite `PATCH` en CORS, por lo que el perfil posterior a Google queda
  trabado.

## Solución propuesta

- `wallets.primary_currency` pasa a ser **moneda preferida**: se muestra y se
  propone por defecto, pero no limita los saldos.
- Cada wallet puede tener una cuenta `user` por moneda. Se crean **bajo
  demanda** al depositar, recibir o cambiar; no hace falta migración porque el
  índice `(wallet_id, currency)` ya lo permite.
- Depósitos y transferencias acreditan en la moneda elegida/enviada, **sin
  tasa ni `currency_conversions`**.
- La única conversión es `GET /wallet/exchange/quote` + `POST /wallet/exchanges`.

### Helper común y cuentas faltantes

```ts
// accounts.service.ts
export async function getOrCreateUserAccount(client, walletId, userId, currency) {
  await client.query(
    `INSERT INTO accounts (user_id, wallet_id, currency, account_type, allow_negative)
     VALUES ($1, $2, $3, 'user', false)
     ON CONFLICT (wallet_id, currency)
       WHERE account_type = 'user' AND closed_at IS NULL
     DO NOTHING`,
    [userId, walletId, currency],
  );
  const { rows } = await client.query(
    `SELECT id FROM accounts
      WHERE wallet_id = $1 AND RTRIM(currency) = $2
        AND account_type = 'user' AND closed_at IS NULL`,
    [walletId, currency],
  );
  return rows[0].id;
}
```

El helper corre **dentro de la misma transacción**. Si la cuenta no existe, la
crea con saldo cero; la operación no falla. `GET /accounts` la devuelve después.

### Invariante de moneda preferida

El front usa `user.moneda_preferida` del login, no `wallets.primary_currency`.
Back debe mantener ambos iguales:

- registro con contraseña, alta con Google y `PATCH /users/me` escriben
  `users.moneda_preferida` y `wallets.primary_currency` en la misma transacción;
- cualquier cambio de preferencia actualiza los dos;
- un test debe verificar que, tras `PATCH`, login y wallet devuelven la misma
  moneda.

Si divergen, el dashboard muestra primero una moneda distinta de la que el back
considera principal.

## Cambios por archivo

| Archivo | Cambio |
| --- | --- |
| `src/services/accounts.service.ts` | Agregar `getOrCreateUserAccount`. |
| `src/services/deposits.service.ts` | Resolver/crear la cuenta de `input.currency`, no de `primaryCurrency`. Insertar `debit external` + `credit user` en esa moneda. No consultar tasa ni escribir `currency_conversions`. |
| `src/services/transfers.service.ts` | Debitar al emisor y acreditar al receptor en `input.currency`; crear la cuenta del receptor si falta. Quitar conversión, cuentas de tesorería, `currency_conversions` y los errores `TRANSFER_WALLET_*`. El replay de idempotencia debe leer los asientos, no `currency_conversions`. |
| `src/services/incoming-conversion.service.ts` | Acreditar en `source_currency`. En la ruta legada, si `destination_currency` no coincide, responder `400 CURRENCY_MISMATCH`. Sin tasas ni conversiones. |
| `src/services/users.service.ts` | `PATCH /users/me` actualiza `users.moneda_preferida` y `wallets.primary_currency` siempre. No renombra cuentas ni bloquea por movimientos; crea la cuenta de la nueva preferida si falta. |
| `src/config/cors.ts` | Agregar `'PATCH'` a `methods`. |
| `src/config/swagger.ts`, `README.md`, specs 029/039 | Documentar que depósitos/transferencias no convierten y que la preferida no es la única moneda. |
| `src/tests/...` | Actualizar tests de transferencias, perfil, ingreso legado y CORS; agregar cobertura de depósito en moneda distinta y de la invariante de preferencia. |

### Contrato resultante

Depósito de `100 USD` con preferida `ARS`:

```json
{
  "transaction": { "type": "deposit", "currency": "USD", "amount": "100.00" },
  "source": { "currency": "USD", "amount": "100.00", "rate": "1" },
  "balances": ["…incluye la cuenta USD…"]
}
```

Transferencia de `10 USD` a un receptor con preferida `ARS`:

```json
{ "recipient": { "currency": "USD", "amount": "10.00", "rate": "1.000000000000" } }
```

- `transaction.currency/amount` son los realmente acreditados; `source` y
  `recipient` se mantienen por compatibilidad con tasa `1`.
- Desaparece el `503 CONVERSION_UNAVAILABLE`; el feed no cambia.

## Pasos

1. Agregar `PATCH` en CORS y su test (desbloquea el front, cambio aislado).
2. Implementar `getOrCreateUserAccount` y reutilizarlo en `exchanges.service.ts`.
3. Cambiar `deposits.service.ts` al flujo sin conversión.
4. Cambiar `transfers.service.ts`: misma moneda, sin tesorería ni conversión.
5. Simplificar `users.service.ts`, mantener la invariante de preferencia y
   eliminar el bloqueo por movimientos.
6. Alinear el ingreso legado, Swagger/README y tests; verificar con el front.

## Cómo probar

- [ ] Preferida `ARS`, depósito de `100 USD`: sube `USD`, no `ARS`; no hay fila en `currency_conversions`.
- [ ] Primer depósito en `EUR`: se crea la cuenta EUR y `GET /accounts` la devuelve.
- [ ] Transferencia de `10 USD` a un receptor con preferida `ARS` y sin cuenta USD: recibe `USD 10`, se crea la cuenta y no hay conversión.
- [ ] Cambio de país/moneda con saldo existente: cambia la preferencia, no se renombra ninguna cuenta y no se pierde saldo.
- [ ] Tras `PATCH /users/me`, `user.moneda_preferida` del login y `wallets.primary_currency` coinciden.
- [ ] `GET /wallet/exchange/quote` + `POST /wallet/exchanges` sigue convirtiendo y registrando `currency_conversions`.
- [ ] Preflight de `PATCH /users/me` devuelve `PATCH`; `npm run build` y la suite pasan.

## Riesgos / notas

- No renombrar `accounts.currency`: cambiaría el significado de asientos
  históricos. La preferencia vive en `wallets.primary_currency` y
  `users.moneda_preferida`, siempre sincronizadas.
- El replay idempotente de transferencias se reconstruye desde `entries`, no
  desde `currency_conversions`; las conversiones históricas no se borran.
- La migración 005 pudo cerrar cuentas con saldo. Antes de cerrar el cambio,
  auditar `accounts.closed_at IS NOT NULL` con `account_balances.balance <> 0`
  y decidir si se reabren o reconcilian.
- El spec de front `2026-11-03-Operaciones-con-la-API-real.md` debe reemplazar
  su nota de “decisión pendiente” por “no se convierte”. Ese archivo no está en
  este repo; lo actualiza el front.
- Si producto quiere las cuatro monedas visibles con saldo cero, crear las
  cuatro en `createUserWithWallet` y backfill de wallets existentes.
