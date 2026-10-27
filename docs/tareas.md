# Tareas

## Base del proyecto

- [x] Seeds
- [x] Rutas y endpoints
- [x] Servidor
- [x] Controladores
- [x] Manejo de errores
- [x] Handlers
- [x] Router

## Pruebas de integración pendientes

Las pruebas siguientes siguen abiertas en los checklists de sus specs. Están
ordenadas por el índice de ejecución de [`docs/specs/README.md`](./specs/README.md).
Las pruebas unitarias de decimal y adaptadores ya pasan; esta lista se centra
en los casos aún no comprobados, especialmente contra PostgreSQL y por HTTP.
Solo aparecen los órdenes con pendientes abiertos.

### Orden 001 — Esquema del ledger

Spec: [ledger append-only](./specs/2026-10-21-ledger-append-only.md).

- [ ] Aplicar la migración inicial en PostgreSQL y confirmar que crea tablas,
  índices, trigger, reglas y vista.
- [ ] Confirmar que el trigger rechaza una transacción desbalanceada por moneda.
- [ ] Confirmar que `UPDATE` y `DELETE` no alteran entries existentes.
- [ ] Confirmar que `account_balances` calcula correctamente varios movimientos.

### Orden 002 — Seeds

Spec: [seeds de datos](./specs/2026-10-23-seeds-db.md).

- [ ] Ejecutar `db:init` y `db:seed`; comparar `account_balances` con los
  saldos demo documentados.
- [ ] Ejecutar `db:seed` dos veces y comprobar que no duplica cuentas,
  transacciones ni entries.

### Órdenes 005–008 — Cuentas y Swagger

Specs: [endpoints de cuentas](./specs/2026-10-24-accounts-endpoints.md),
[redundancia del flujo de cuentas](./specs/2026-10-25-redundancia-flujo-accounts.md)
y [alineación de Swagger](./specs/2026-10-25-swagger-accounts-alineacion.md).

- [ ] Probar `GET /accounts/:id` y `GET /accounts/:id/balance` contra PostgreSQL
  y confirmar los contratos y saldos esperados.
- [ ] En ambas rutas, verificar UUID inválido (`400`) y UUID válido inexistente
  (`404`).
- [ ] Revisar `/api-docs` y confirmar ejemplos, descripción de saldo cero y
  respuestas documentadas.
- [ ] Confirmar que la refactorización de validación y proyección conserva
  `400` para UUID inválido y `404` para cuenta inexistente.

### Orden 009 — Detalle de transacciones

Spec: [lectura de transactions](./specs/2026-10-25-transactions-read-endpoint.md).

- [ ] Confirmar por HTTP que los importes se serializan como texto.
- [ ] Probar UUID inválido (`400`) y transacción inexistente (`404`).
- [ ] Confirmar que `GET /transactions/{id}` aparece en Swagger.

### Orden 010 — Registro de usuario

Spec: [registro y wallet](./specs/2026-10-26-registro-usuario-billetera.md).

- [ ] Registrar un usuario y verificar `201`, cuenta asociada y saldo inicial cero.
- [ ] Comprobar en DB el hash de contraseña y que la respuesta no filtra hash
  ni contraseña.
- [ ] Probar username/email duplicados (`409`) y payload inválido (`400`),
  verificando que no quedan registros parciales.
- [ ] Confirmar que las consultas previas de account balance y transactions
  conservan su contrato tras el registro.

### Orden 011 — Autenticación y autorización

Spec: [autenticación por titular](./specs/2026-10-26-autenticacion-y-acceso-por-titular.md).

- [ ] Probar login correcto e incorrecto y verificar token Bearer y error `401`
  genérico.
- [ ] Probar token ausente, malformado, expirado y revocado en rutas protegidas.
- [ ] Verificar que el titular accede a cuenta/saldo y otro usuario recibe `404`.
- [ ] Confirmar que una transacción solo muestra entries del titular y omite
  `idempotency_key`.
- [ ] Probar logout y comprobar que el token revocado responde `401`.
- [ ] Probar hash legado, cambio obligatorio de contraseña y revocación de
  otras sesiones.
- [ ] Verificar el rate limit de login sin revelar si existe el usuario.

### Orden 012 — Seguridad y operación

Spec: [revisión de prácticas de wallet](./specs/2026-10-26-revision-practicas-wallet.md).

- [ ] Definir el mecanismo de autenticación del sistema de origen para impedir
  que una sesión de usuario pueda autoacreditar fondos; exigir confirmación del
  procesador antes de crear entries.
- [ ] Definir requisitos de identidad, regulación y operación para la
  jurisdicción y el modelo de negocio antes de custodiar dinero real.
- [ ] Ejecutar una revisión dinámica de seguridad o una prueba de penetración.

### Órdenes 014–016 — Wallet e ingresos convertidos

Specs: [wallet de moneda principal](./specs/2026-10-26-wallet-unica-multimoneda.md),
[conversión original](./specs/2026-10-26-conversion-tasas-exchange-rate.md) y
[evolución a wallet multimoneda](./specs/2026-10-26-ingresos-multimoneda-wallet.md).

El spec 016 amplía el modelo de los specs 014–015: una wallet conserva moneda
principal y puede tener saldos secundarios por moneda. Al verificar, no se debe
aplicar como criterio vigente que el usuario solo pueda tener una cuenta `user`
en toda la wallet.

- [ ] Ejecutar migraciones `005`–`007` en una base existente y en una base
  limpia; repetir `db:init` y comprobar que no cierra saldos secundarios ni
  cambia o elimina entries históricos.
- [ ] Ejecutar seeds dos veces después de las migraciones y verificar wallets,
  cuentas por moneda y balances sin duplicados.
- [ ] Confirmar que una wallet tiene una moneda principal y que se puede
  asociar una cuenta secundaria de otra moneda sin crear otra wallet.
- [ ] Ingresar en la moneda principal y comprobar tasa `1` sin llamar a
  proveedores.
- [ ] Ingresar en otra moneda y comprobar que solo se acredita la moneda
  principal, con tasa y fuente vigentes.
- [ ] Comprobar fallback con timeout, respuesta inválida y tasa vencida del
  principal; verificar también el rechazo sin cambios cuando ambos proveedores
  fallan.
- [ ] Hacer una llamada real a ExchangeRate-API y, si el caso lo permite, a
  Frankfurter; verificar fecha, importe, redondeo y atribución documentada.
- [ ] Revisar `currency_conversions` y confirmar importes, monedas, tasa,
  fuente, fecha y regla de redondeo auditables.
- [ ] Repetir la misma clave y payload sin duplicar el crédito; reutilizar la
  clave con otro payload y confirmar `409`.
- [ ] Intentar acreditar una cuenta ajena y confirmar que no cambia el ledger.
- [ ] Comprobar que entries de origen y destino balancean por separado y que
  ambos lados confirman o revierten juntos.
- [ ] Ejecutar la [guía E2E de ingreso](./guia-e2e-ingreso-convertido.md)
  completa, incluyendo consulta posterior del saldo y la transacción.

## Criterio de cierre

- [ ] Actualizar los checkboxes de los specs únicamente después de ejecutar y
  registrar cada verificación.
- [ ] Mantener esta lista en el mismo orden que el índice de specs; agregar
  nuevas tareas bajo el orden correspondiente.
