# Prueba de extremo a extremo: ingreso convertido y retiro

Esta guía verifica registro, autenticación, conversión de un ingreso,
idempotencia, retiro y contabilización en el ledger usando la API y PostgreSQL.

## Requisitos

- PostgreSQL disponible y configurado en `.env`; consulta la
  [guía de base de datos](../db/README.md).
- Dependencias instaladas con `npm install`.
- Una instancia de la API y una terminal adicional para enviar solicitudes.

La prueba crea un crédito en la base de datos. No mueve dinero ni confirma que
un banco haya recibido el depósito. En producción, el sistema de origen debe
confirmar los fondos antes de invocar el endpoint.

## 1. Inicializar la base y arrancar la API

Desde la raíz del repositorio:

```sh
npm run db:init
npm run db:seed
npm run build
npm start
```

La instancia usa `PORT` configurado en `.env`. El `.env.example` propone `5173`;
si `PORT` no está configurado, el backend usa `3000`.

## 2. Registrar una wallet ARS

En otra terminal, define la URL correcta para tu instancia. Este ejemplo usa el
puerto del `.env.example`:

```sh
API_URL=http://localhost:5173
```

Registra un usuario. Si `e2e.conversion` o su correo ya existen, cambia ambos
valores por otros únicos:

```sh
curl -sS -X POST "$API_URL/users" \
  -H 'Content-Type: application/json' \
  -d '{"username":"e2e.conversion","email":"e2e.conversion@example.com","password":"una-frase-de-acceso-larga","currency":"ARS"}'
```

Copia `data.account.id` de la respuesta; lo usarás como `ACCOUNT_ID`. La cuenta
creada establece ARS como la moneda principal de la wallet.

## 3. Iniciar sesión

```sh
curl -sS -X POST "$API_URL/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"e2e.conversion","password":"una-frase-de-acceso-larga"}'
```

Copia `data.access_token` de la respuesta y define los tres valores para las
siguientes solicitudes:

```sh
ACCOUNT_ID='<data.account.id>'
TOKEN='<data.access_token>'
IDEMPOTENCY_KEY='e2e-deposito-eur-001'
```

## 4. Consultar el saldo inicial

```sh
curl -sS "$API_URL/accounts/$ACCOUNT_ID/balance" \
  -H "Authorization: Bearer $TOKEN"
```

Guarda el saldo ARS devuelto para compararlo con el saldo posterior.

## 5. Registrar EUR 100.00

La moneda de destino se toma de la wallet (ARS). La clave debe ser única para
el ingreso externo y debe reutilizarse en los reintentos de esa misma
operación.

```sh
curl -i -X POST "$API_URL/accounts/$ACCOUNT_ID/incoming" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"source_currency":"EUR","source_amount":"100.00"}'
```

La respuesta `200` incluye el `transaction_id`, importes y monedas, tasa,
proveedor, fecha de observación y `rounding: "HALF_UP_2"`. No se cobra
comisión. ExchangeRate-API es el proveedor principal y Frankfurter el fallback;
si ninguno entrega una tasa válida de hasta 24 horas, la API responde `503` sin
crear asientos. Puedes reintentar con la misma clave.

## 6. Comprobar idempotencia

Envía otra vez, sin cambiar nada, el mismo `POST` del paso anterior y la misma
`Idempotency-Key`. La API debe devolver el mismo `transaction_id` y no duplicar
el crédito. Si reutilizas la clave con otro importe o moneda, debe responder
`409`.

## 7. Comprobar saldo y transacción

Consulta el saldo de nuevo y el detalle de la transacción. Sustituye el
marcador por `data.transaction_id` de la respuesta al ingreso:

```sh
curl -sS "$API_URL/accounts/$ACCOUNT_ID/balance" \
  -H "Authorization: Bearer $TOKEN"

curl -sS "$API_URL/transactions/<transaction_id>" \
  -H "Authorization: Bearer $TOKEN"
```

El saldo debe aumentar por `destination.amount`. El detalle visible al usuario
debe incluir el crédito en ARS.

## 8. Verificar auditoría y entries balanceados

Ejecuta estas consultas en PostgreSQL y sustituye `<transaction_id>` por el ID
devuelto por el endpoint:

```sql
SELECT source_currency, source_amount, destination_currency,
       destination_amount, rate, rate_source, rate_observed_at, rounding
  FROM currency_conversions
 WHERE transaction_id = '<transaction_id>';

SELECT RTRIM(e.currency) AS currency, e.direction, e.amount,
       a.account_type, e.account_id
  FROM entries e
  JOIN accounts a ON a.id = e.account_id
 WHERE e.transaction_id = '<transaction_id>'
 ORDER BY e.currency, e.id;
```

Para EUR→ARS deben aparecer cuatro entries: débito de `external` y crédito de
`treasury` en EUR; débito de `treasury` y crédito de `user` en ARS. Débitos y
créditos deben sumar lo mismo por cada moneda.

## Limitación del ingreso

La solicitud escribe un crédito contable en el ledger, pero no está conectada
a un banco o procesador de pagos y no prueba la recepción real de fondos. Las
tasas de los proveedores son referencias indicativas, no precios bancarios
garantizados.

## 9. Retirar saldo de la wallet

Elige un importe menor al saldo ARS acreditado. Este ejemplo retira ARS 1.00;
el retiro usa su propia clave idempotente, distinta a la del ingreso:

```sh
WITHDRAWAL_IDEMPOTENCY_KEY='e2e-retiro-ars-001'

curl -i -X POST "$API_URL/accounts/$ACCOUNT_ID/withdraw" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $WITHDRAWAL_IDEMPOTENCY_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"amount":"1.00"}'
```

La respuesta `200` informa `transaction_id`, `account_id` e importe/moneda.
Guarda el `transaction_id` para revisar los asientos del retiro. El endpoint
solo puede operar sobre una cuenta activa del titular autenticado; no solicita
ni permite al cliente elegir la moneda.

## 10. Comprobar el resultado, idempotencia y saldo insuficiente

Repite exactamente la solicitud con la misma clave: debe responder `200` con
el mismo `transaction_id`, sin otro débito. Un importe diferente con esa misma
clave, o reutilizar la clave del ingreso, debe responder `409`.

Prueba también fondos insuficientes usando una clave nueva; el importe
deliberadamente alto debe devolver `422` y no crear una transacción:

```sh
curl -i -X POST "$API_URL/accounts/$ACCOUNT_ID/withdraw" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: e2e-retiro-insuficiente-001" \
  -H 'Content-Type: application/json' \
  -d '{"amount":"999999999999.00"}'

curl -sS "$API_URL/accounts/$ACCOUNT_ID/balance" \
  -H "Authorization: Bearer $TOKEN"
```

El balance posterior al retiro exitoso debe ser el saldo anterior menos ARS
1.00; la solicitud insuficiente no debe modificarlo. Para comprobar la
serialización en PostgreSQL, también se pueden enviar dos retiros concurrentes
cuyas sumas superen el saldo: como máximo uno debe tener éxito y el saldo nunca
debe quedar negativo.

## 11. Verificar los asientos del retiro en PostgreSQL

Consulta las entries del `transaction_id` devuelto por el retiro:

```sql
SELECT RTRIM(e.currency) AS currency, e.direction, e.amount::text AS amount,
       a.account_type, e.account_id
  FROM entries e
  JOIN accounts a ON a.id = e.account_id
 WHERE e.transaction_id = '<withdrawal_transaction_id>'
 ORDER BY e.id;
```

Debe haber dos entries en la moneda de la cuenta: un débito a la cuenta
`user` y un crédito del mismo importe a `external`. El saldo de la cuenta no
debe ser negativo. Repetir el retiro no debe aumentar el número de entries.

## Limitación del retiro

El retiro registra la salida contable contra una cuenta `external`, pero no
envía fondos a un banco o proveedor externo. El ingreso tampoco está conectado
a un banco o procesador de pagos y no prueba la recepción real de fondos. Las
tasas de los proveedores son referencias indicativas, no precios bancarios
garantizados.
