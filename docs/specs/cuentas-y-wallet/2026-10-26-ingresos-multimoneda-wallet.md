# Spec: Ingresos convertidos a la moneda principal de la wallet

## Fecha
2026-10-26

## Orden de ejecución: 016

## Problema
La wallet del usuario debe ser una sola experiencia, con una moneda
principal elegida al crearla. Si recibe fondos en otra moneda, esos fondos
deben convertirse y llegar al saldo principal; el usuario no quiere que cada
moneda de origen cree automáticamente un saldo aparte. A futuro sí debe poder
convertir parte del saldo principal a otra moneda y conservar ese nuevo saldo
dentro de la misma wallet.

El modelo actual guarda la moneda directamente en cada cuenta `user` y
restringe a una cuenta activa por usuario. Eso sirve para el saldo principal,
pero no permite que una sola wallet mantenga en el futuro saldos secundarios
en otras monedas. El ingreso convertido también necesita una tasa verificable,
idempotencia y entries balanceados por moneda, todo en una sola transacción.

## Solución propuesta
Modelar una wallet lógica por usuario con una `primary_currency` elegida al
registrarse. Las cuentas `user` representan saldos por moneda dentro de esa
wallet: al inicio existe la cuenta de la moneda principal; una futura
conversión entre saldos podrá crear otra cuenta `user` para la moneda destino
sin abrir otra wallet. La conversión entre saldos existentes queda fuera de
este cambio; se prepara el modelo para soportarla.

El endpoint de ingreso mantiene la ruta aprobada. El ID identifica una cuenta
activa del titular y el servicio resuelve la wallet y su moneda principal. El
cliente indica moneda e importe de origen, pero no elige la moneda de
acreditación: siempre será `primary_currency`. Si se incluye
`destination_currency` por compatibilidad con el contrato conceptual, debe
coincidir con la moneda principal; si no coincide se responde `400`.

```http
POST /accounts/{id}/incoming
Authorization: Bearer <token>
Idempotency-Key: ingreso-externo-123
Content-Type: application/json
```

```json
{
  "source_currency": "EUR",
  "source_amount": "100.00"
}
```

Si la moneda principal de la wallet es ARS, la respuesta comunica que se
acreditaron ARS e informa la tasa, fuente, fecha de observación, importe
original, importe convertido y regla de redondeo. Un ingreso que ya llega en
ARS se acredita sin consultar proveedores, a tasa `1`.

### Proveedores y cálculo

- Principal: [ExchangeRate-API Open Access](https://www.exchangerate-api.com/docs/free)
  (`open.er-api.com/v6/latest/{base}`),
  sin API key. Como devuelve la tabla desde la moneda base, se toma la tasa de
  destino. La fuente requiere atribución en el producto que muestra tasas.
- Fallback: [Frankfurter](https://frankfurter.dev/v1/)
  (`api.frankfurter.dev/v1/latest?from={base}&to={quote}`).
- Timeout: 3 segundos por proveedor. Se usa Frankfurt si el principal falla,
  vence, no informa las monedas solicitadas o la tasa no es finita y positiva.
- Antigüedad máxima: 24 horas, comparada con la fecha de actualización
  informada por la fuente. Una tasa más antigua se considera inválida.
- Las cotizaciones aceptadas se cachean en memoria por par de monedas durante
  su vigencia para limitar solicitudes al proveedor.
- No hay comisión. La tasa se multiplica usando aritmética decimal, no
  `number` binario de JavaScript. El importe acreditado se redondea a 2
  decimales con `HALF_UP`; si queda en cero, el ingreso se rechaza.
- Se guarda la tasa y metadatos usados antes de insertar entries. No se usa
  una tasa inventada ni se acredita parcialmente si ambos proveedores fallan.

```ts
const quote = await getExchangeRate(sourceCurrency, wallet.primaryCurrency);
const converted = multiplyDecimal(sourceAmount, quote.rate)
  .round(2, 'HALF_UP');
if (converted.isZero()) throw new AppError('Importe convertido demasiado pequeño', 422);
```

Las tasas de estos servicios son referencias indicativas, no una garantía de
ejecución o precio de liquidación de una operación bancaria. El ledger registra
la conversión contable acordada por Latin Zumi; el sistema de pagos que recibe
los fondos debe confirmar por separado el importe efectivamente recibido. No
se debe presentar esta tasa como precio bancario garantizado.

### Persistencia e idempotencia

La migración crea una wallet por titular y enlaza las cuentas `user`
existentes, usando la cuenta activa como moneda principal. Conserva cuentas y
entries históricos; no convierte saldos ni elimina datos. La cuenta `user`
activa por moneda queda única dentro de cada wallet. Cuentas internas
`external` y `treasury` se mantienen globales por moneda y no son wallets de
usuario.

La tabla de conversiones conserva una fila por transacción con moneda e
importe de origen, moneda e importe acreditado, tasa, fuente, instante de
observación y regla de redondeo. La creación de transacción, conversión y
entries se hace en una única transacción SQL. Una clave repetida devuelve el
resultado original si corresponde al mismo ingreso; si la clave se reutiliza
con otro titular o payload, se responde `409`.

```sql
-- Ejemplo conceptual de las dos parejas balanceadas en una conversión EUR→ARS:
-- Cada moneda se balancea por separado; todas las filas son parte de la misma
-- transacción SQL y comparten transaction_id.
INSERT INTO entries (transaction_id, account_id, amount, direction, currency)
VALUES
  (:tx, :external_eur, :source_amount, 'debit',  'EUR'),
  (:tx, :treasury_eur, :source_amount, 'credit', 'EUR'),
  (:tx, :treasury_ars, :converted,     'debit',  'ARS'),
  (:tx, :user_ars,     :converted,     'credit', 'ARS');
```

La consulta de la wallet puede exponer sus saldos reales por moneda. El total
valorado en otra moneda será una consulta informativa separada, con tasa y
fecha propias; no alterará el ledger ni los saldos.

### Contrato de respuesta

```json
{
  "data": {
    "transaction_id": "30000000-0000-4000-8000-000000000123",
    "wallet_id": "20000000-0000-4000-8000-000000000123",
    "source": { "currency": "EUR", "amount": "100.00" },
    "destination": { "currency": "ARS", "amount": "123456.78" },
    "rate": "1234.56780000",
    "rate_source": "exchangeRate-api",
    "rate_observed_at": "2026-10-26T12:00:00.000Z",
    "rounding": "HALF_UP_2"
  }
}
```

## Archivos afectados
- db/migrations/006_wallet_container.sql
- db/migrations/007_currency_conversions.sql
- db/migrations/005_single_user_account.sql — ajustada para no cerrar saldos
  secundarios al volver a ejecutar `db:init`.
- db/scripts/init-db.ts
- db/seeds/001_demo_data.sql
- src/services/accounts.service.ts
- src/services/users.service.ts
- src/controllers/users.controller.ts
- src/services/exchange-rate.service.ts
- src/services/incoming-conversion.service.ts
- src/routes/accounts.route.ts
- src/controllers/accounts.controller.ts
- src/config/env.ts
- src/config/swagger.ts
- src/utils/AppError.ts
- tests/ o src/**/*.test.ts
- package.json
- README.md
- db/README.md
- docs/specs/cuentas-y-wallet/2026-10-26-conversion-tasas-exchange-rate.md
- docs/specs/cuentas-y-wallet/2026-10-26-ingresos-multimoneda-wallet.md

## Pasos
1. Crear la migración de wallet lógica, moneda principal y relación de las
   cuentas `user`, preservando los IDs, saldos y entries históricos.
2. Crear los adaptadores separados de ExchangeRate-API y Frankfurter; validar
   monedas, tasa positiva, fecha, timeout y fallback.
3. Implementar cálculo decimal exacto y redondeo `HALF_UP` a 2 decimales.
4. Implementar el ingreso idempotente dentro de una transacción SQL, con
   cuatro entries balanceados por moneda y detalle de conversión auditable.
5. Proteger el endpoint con autenticación y comprobar que la cuenta indicada
   pertenece al titular autenticado y está activa.
6. Documentar request, response, errores, monedas soportadas y atribución del
   proveedor en Swagger y README.
7. Añadir pruebas de paridad de moneda, éxito, fallback, proveedor inválido,
   timeout, tasa vencida, precisión, idempotencia, rollback y autorización.

## Cómo probar
- [ ] Ingreso en la moneda principal acredita el mismo importe con tasa `1`.
- [ ] Ingreso en otra moneda usa la tasa válida de ExchangeRate-API y acredita
  únicamente la moneda principal de la wallet.
- [x] Error o respuesta sin el par solicitado del principal usa
  Frankfurter.
- [ ] Si ambos proveedores fallan, no se crea transacción, conversión, entry ni
  saldo parcial.
- [ ] La conversión registra moneda e importe originales y acreditados, tasa,
  fuente, fecha y redondeo.
- [x] El cálculo decimal aplica `HALF_UP` a 2 decimales sin error de punto
  flotante y rechaza un resultado redondeado a cero.
- [ ] Repetir una clave idempotente con el mismo payload no duplica el ingreso;
  reutilizarla con distinto payload responde `409`.
- [ ] Un usuario no puede ingresar fondos a una wallet ajena.
- [ ] Cada moneda involucrada balancea por separado en el ledger.
- [ ] La migración conserva cuentas y entries previos y permite más adelante
  una cuenta `user` secundaria por moneda dentro de la misma wallet.
- [x] Swagger, README, pruebas y build reflejan el contrato.

## Riesgos / notas
- ExchangeRate-API Open Access actualiza tasas una vez al día, limita
  solicitudes y exige atribución. Sus condiciones indican que las tasas son
  informativas/ilustrativas; no representan necesariamente el tipo aplicado
  por un banco. La tasa registrada es el tipo contable del ingreso, no una
  promesa de liquidación bancaria. Ver [documentación del endpoint gratuito](https://www.exchangerate-api.com/docs/free)
  y [condiciones del proveedor](https://www.exchangerate-api.com/terms).
- Frankfurter puede no ofrecer algún par o puede publicar tasas con fechas
  distintas. La respuesta debe guardar la fuente y fecha realmente usadas; si
  supera las 24 horas o no cubre el par, se considera fallida. Ver
  [documentación de Frankfurter](https://frankfurter.dev/v1/).
- La vigencia máxima estricta de 24 horas puede hacer que ambos proveedores
  sean rechazados durante fines de semana o festivos. En ese caso el ingreso
  falla y se puede reintentar cuando haya una tasa reciente; no se usa una tasa
  vencida.
- El redondeo puede generar una diferencia inferior a un centavo respecto del
  producto matemático exacto; se registra el importe final acreditado y no se
  cobra comisión.
- La wallet lógica con cuentas `user` por moneda deja preparada la conversión
  futura de saldo entre monedas, pero esa operación futura no se incluye aquí.
- El endpoint requiere que el sistema de origen haya confirmado el ingreso
  externo; solicitar una cotización no constituye evidencia de fondos
  recibidos.
