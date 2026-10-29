# Spec: Retiro desde cuenta

## Fecha
2026-10-26

## Orden de ejecución: 021

## Problema
El backend permite consultar cuentas y registrar ingresos, pero no ofrece un
flujo para retirar saldo. El producto requiere permitir la salida de fondos
desde la cuenta activa del usuario sin dejar que el saldo disponible sea
negativo, incluso ante solicitudes concurrentes o reintentos.

## Solución propuesta
Agregar `POST /accounts/:id/withdraw`, protegido por autenticación y limitado
al titular de la cuenta activa. El importe será una cadena decimal positiva
con hasta dos decimales, en la moneda de la cuenta. El servicio bloqueará la
wallet durante la operación, comprobará el saldo disponible con aritmética
decimal en PostgreSQL y registrará en una sola transacción el débito a la
cuenta del usuario y el crédito a una cuenta interna `external`.

El cliente deberá enviar `Idempotency-Key`. Repetir la misma clave y solicitud
devolverá el resultado original; reutilizarla con otra solicitud dará `409`.
Los flujos de ingreso y retiro coordinarán la validación de claves para que
una misma clave no pueda contabilizarse dos veces entre operaciones.

### Flujo HTTP autenticado

```ts
accountsRouter.post(
  '/accounts/:id/withdraw',
  asyncHandler(requireAuth),
  asyncHandler(withdrawAccount),
);
```

La ruta exige una sesión válida antes de ejecutar el controller. El controller
valida el UUID, un `amount` positivo de hasta dos decimales y el header
`Idempotency-Key`; luego entrega el ID del titular autenticado al servicio.
Una cuenta ajena o inexistente responde `404`, sin revelar si existe.

```http
POST /accounts/10000000-0000-4000-8000-000000000001/withdraw
Authorization: Bearer <token>
Idempotency-Key: retiro-orden-123
Content-Type: application/json

{"amount":"50.00"}
```

El cliente solicita retirar 50.00 en la moneda de esa cuenta; no decide la
moneda ni el titular. La clave identifica este intento y permite reintentar
sin generar otro débito.

### Validación de saldo, concurrencia e idempotencia

```ts
await client.query('BEGIN');
const wallet = await client.query(
  `SELECT w.id, a.id AS account_id, RTRIM(a.currency) AS currency
     FROM wallets w
     JOIN accounts a ON a.wallet_id = w.id
    WHERE a.id = $1 AND a.user_id = $2
      AND a.account_type = 'user' AND a.closed_at IS NULL
    FOR UPDATE OF w`,
  [accountId, authenticatedUserId],
);
// Con la wallet bloqueada: resolver la clave idempotente y leer el saldo.
```

El servicio mantiene el bloqueo de la wallet hasta confirmar o revertir la
transacción. Así serializa retiros concurrentes y también se coordina con el
flujo de ingresos que ya bloquea esa misma wallet. Antes de validar fondos,
busca si la clave ya produjo un retiro: una solicitud idéntica devuelve el
resultado guardado; una clave usada con otros datos o en otro tipo de
movimiento devuelve `409`. Si el saldo contable es menor al importe, revierte
y responde `422`.

### Registro atómico en el ledger

```sql
INSERT INTO transactions (idempotency_key, description)
VALUES ($1, 'Retiro de cuenta')
RETURNING id;

INSERT INTO entries (transaction_id, account_id, amount, direction, currency)
VALUES
  ($2, $3, $4, 'debit',  $5),
  ($2, $6, $4, 'credit', $5);
```

El servicio ejecuta ambas escrituras dentro de la misma transacción: debita la
cuenta del usuario y acredita una cuenta interna `external` en la misma
moneda. Si cualquier validación o escritura falla, hace rollback; el ledger no
queda parcialmente contabilizado. La respuesta exitosa será `200` con
`transaction_id`, cuenta, importe y moneda; los reintentos idénticos devuelven
ese mismo resultado.

## Archivos afectados
- src/routes/accounts.route.ts
- src/controllers/accounts.controller.ts
- src/services/internal-account.service.ts
- src/services/withdrawal.service.ts
- src/services/incoming-conversion.service.ts (coordinación de claves idempotentes)
- src/services/withdrawal.service.test.ts
- src/controllers/accounts.controller.test.ts
- src/config/swagger.ts
- docs/auditoria-estado-proyecto-y-deploy.md
- docs/specs/README.md
- docs/specs/cuentas-y-wallet/2026-10-26-retiro-cuenta.md

## Pasos
1. Añadir la ruta autenticada y validar el UUID, importe y clave idempotente.
2. Implementar la operación SQL transaccional, verificando titularidad, cuenta
   activa, saldo disponible e idempotencia mientras la wallet está bloqueada.
3. Registrar el débito y su contrapartida en el ledger, y garantizar rollback
   ante fondos insuficientes o errores.
4. Alinear la búsqueda de claves con el flujo de ingresos para responder
   `409` ante claves ya utilizadas en otra solicitud u operación.
5. Documentar el contrato y actualizar la auditoría; probar acceso, saldo,
   concurrencia, idempotencia e integridad del ledger.

## Cómo probar
- [x] Una sesión válida puede retirar desde su propia cuenta activa; una cuenta
  ajena o inexistente responde `404`.
- [x] Importe inválido, cero, negativo o con más de dos decimales responde
  `400`; clave idempotente ausente o inválida responde `400`.
- [x] Un retiro superior al saldo disponible responde `422` y no crea
  transacción ni entries.
- [ ] Dos retiros concurrentes no pueden gastar el mismo saldo; el saldo nunca
  queda negativo.
- [x] La misma clave con la misma solicitud devuelve el resultado original y
  no duplica movimientos; la clave con datos u operación distintos responde
  `409`.
- [x] El retiro crea débito y crédito por igual importe y moneda; un fallo
  intermedio revierte toda la operación.
- [x] `npm run build`, pruebas focalizadas y contrato Swagger pasan.

## Riesgos / notas
- Este flujo registra la salida en el ledger; no integra un banco, procesador
  ni transferencia real de dinero. Si el producto requiere desembolso externo,
  hace falta definir y conectar ese proveedor antes de tratar el retiro como
  una ejecución de pago.
- La wallet bloqueada serializa operaciones que respetan el mismo bloqueo,
  incluyendo el ingreso existente. Cualquier futuro flujo que cambie saldo
  deberá adquirir el mismo bloqueo.
- La suite usa clientes PostgreSQL simulados; falta validar retiros realmente
  concurrentes contra PostgreSQL antes de cerrar esa comprobación.
- Los importes se aceptan con hasta dos decimales, aunque el ledger conserve
  ocho; no usar `Number` de JavaScript para comparar o calcular saldos.
