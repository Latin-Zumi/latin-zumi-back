# Tareas

> Actualizado el 2026-10-30. Los checkboxes marcados reflejan implementación
> verificada en el repositorio; los de prueba siguen abiertos hasta ejecutarlos
> contra PostgreSQL y por HTTP. La deuda técnica priorizada está en la
> auditoría externa `Report00`.

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
ordenadas por el índice de ejecución de [`docs/specs/index-specs.md`](./specs/index-specs.md).
Las pruebas unitarias de decimal y adaptadores ya pasan; esta lista se centra
en los casos aún no comprobados, especialmente contra PostgreSQL y por HTTP.
Solo aparecen los órdenes con pendientes abiertos.

### Orden 001 — Esquema del ledger

Spec: [ledger append-only](./specs/ledger-y-transacciones/2026-10-21-ledger-append-only.md).

- [ ] Aplicar la migración inicial en PostgreSQL y confirmar que crea tablas,
  índices, trigger, reglas y vista.
- [ ] Confirmar que el trigger rechaza una transacción desbalanceada por moneda.
- [ ] Confirmar que `UPDATE` y `DELETE` no alteran entries existentes.
- [ ] Confirmar que `account_balances` calcula correctamente varios movimientos.

### Orden 002 — Seeds

Spec: [seeds de datos](./specs/ledger-y-transacciones/2026-10-23-seeds-db.md).

- [ ] Ejecutar `db:init` y `db:seed`; comparar `account_balances` con los
  saldos demo documentados.
- [ ] Ejecutar `db:seed` dos veces y comprobar que no duplica cuentas,
  transacciones ni entries.

### Órdenes 005–008 — Cuentas y Swagger

Specs: [endpoints de cuentas](./specs/cuentas-y-wallet/2026-10-24-accounts-endpoints.md),
[redundancia del flujo de cuentas](./specs/cuentas-y-wallet/2026-10-25-redundancia-flujo-accounts.md)
y [alineación de Swagger](./specs/cuentas-y-wallet/2026-10-25-swagger-accounts-alineacion.md).

- [ ] Probar `GET /accounts/:id` y `GET /accounts/:id/balance` contra PostgreSQL
  y confirmar los contratos y saldos esperados.
- [ ] En ambas rutas, verificar UUID inválido (`400`) y UUID válido inexistente
  (`404`).
- [ ] Revisar `/api-docs` y confirmar ejemplos, descripción de saldo cero y
  respuestas documentadas.
- [ ] Confirmar que la refactorización de validación y proyección conserva
  `400` para UUID inválido y `404` para cuenta inexistente.

### Orden 009 — Detalle de transacciones

Spec: [lectura de transactions](./specs/ledger-y-transacciones/2026-10-25-transactions-read-endpoint.md).

- [ ] Confirmar por HTTP que los importes se serializan como texto.
- [ ] Probar UUID inválido (`400`) y transacción inexistente (`404`).
- [ ] Confirmar que `GET /transactions/{id}` aparece en Swagger.

### Orden 010 — Registro de usuario

Spec: [registro y wallet](./specs/autenticacion/2026-10-26-registro-usuario-billetera.md).

- [ ] Registrar un usuario y verificar `201`, cuenta asociada y saldo inicial cero.
- [ ] Comprobar en DB el hash de contraseña y que la respuesta no filtra hash
  ni contraseña.
- [ ] Probar username/email duplicados (`409`) y payload inválido (`400`),
  verificando que no quedan registros parciales.
- [ ] Confirmar que las consultas previas de account balance y transactions
  conservan su contrato tras el registro.

### Orden 011 — Autenticación y autorización

Spec: [autenticación por titular](./specs/autenticacion/2026-10-26-autenticacion-y-acceso-por-titular.md).

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

Spec: [revisión de prácticas de wallet](./specs/cuentas-y-wallet/2026-10-26-revision-practicas-wallet.md).

- [ ] Definir el mecanismo de autenticación del sistema de origen para impedir
  que una sesión de usuario pueda autoacreditar fondos; exigir confirmación del
  procesador antes de crear entries.
- [ ] Definir requisitos de identidad, regulación y operación para la
  jurisdicción y el modelo de negocio antes de custodiar dinero real.
- [ ] Ejecutar una revisión dinámica de seguridad o una prueba de penetración.

### Órdenes 014–016 — Wallet e ingresos convertidos

Specs: [wallet de moneda principal](./specs/cuentas-y-wallet/2026-10-26-wallet-unica-multimoneda.md),
[conversión original](./specs/cuentas-y-wallet/2026-10-26-conversion-tasas-exchange-rate.md) y
[evolución a wallet multimoneda](./specs/cuentas-y-wallet/2026-10-26-ingresos-multimoneda-wallet.md).

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

### Orden 019 — Listado de cuentas

Spec: [listado de cuentas del usuario](./specs/cuentas-y-wallet/2026-10-26-listado-cuentas-usuario.md).

- [ ] Probar por HTTP que `GET /accounts` requiere sesión válida y devuelve solo
  las cuentas `user` activas del titular autenticado.
- [ ] Confirmar en PostgreSQL los saldos, el saldo `"0"` sin movimientos, la
  exclusión de cuentas internas/cerradas y el arreglo vacío sin cuentas.
- [x] Documentar la ruta y su contrato en Swagger, README y la auditoría.
- [x] Ejecutar `npm test` (4 archivos, 10 pruebas) y `npm run build`.

### Orden 020 — Historial paginado de transactions

Spec: [historial paginado](./specs/ledger-y-transacciones/2026-10-26-transactions-historial-paginado.md).

- [ ] Probar por HTTP la primera página, filtros de cuenta/fechas y metadatos
  con datos de PostgreSQL.
- [ ] Verificar por HTTP parámetros inválidos (`400`) y una cuenta ajena,
  inexistente o cerrada (`404`).
- [x] Ejecutar la suite de Vitest y confirmar Swagger para el historial
  paginado.

### Orden 021 — Retiro desde cuenta

Spec: [retiro desde cuenta](./specs/cuentas-y-wallet/2026-10-26-retiro-cuenta.md).

- [ ] Retirar por HTTP desde una cuenta propia activa y confirmar que una
  sesión ausente o una cuenta ajena/inexistente no produce cambios.
- [ ] Probar importe inválido (`400`) y fondos insuficientes (`422`), y
  verificar que no se crean transacciones ni entries al fallar.
- [ ] Repetir la misma solicitud y clave idempotente; confirmar que devuelve
  el mismo `transaction_id` sin duplicar movimientos. Reutilizar la clave con
  otro importe o para un ingreso y confirmar `409`.
- [ ] Ejecutar dos retiros concurrentes contra PostgreSQL con saldo conjunto
  insuficiente y confirmar que como máximo uno se contabiliza y el saldo nunca
  queda negativo.
- [ ] Comprobar en PostgreSQL el débito a la cuenta `user`, el crédito
  equivalente a `external` y la reversión completa ante un fallo.
- [x] Ejecutar `npm test` (36 pruebas), `npm run build` y comprobar el
  contrato documentado en Swagger.
- [ ] Ejecutar la [guía E2E de ingreso y retiro](./guia-e2e-ingreso-convertido.md)
  completa; el retiro es contable y no representa un desembolso bancario real.

### Orden 029 — Transferencias y actividad de wallet (backend)

Spec: [transferencias y actividad](./specs/cuentas-y-wallet/2026-10-27-transferencias-y-actividad-wallet.md).

- [x] Agregar `transactions.type` con migración 009 y declarar tipo en seeds,
  ingresos y retiros.
- [x] Implementar lookup autenticado, transferencias idempotentes y feed
  paginado por titular.
- [x] Devolver errores con `{ code, message }` y documentar las rutas.
- [ ] Aplicar migración y seeds en PostgreSQL y verificar concurrencia,
  conversión, paginación y aislamiento por titular.
- [ ] Ejecutar `npm run build` y `npm test`.

### Orden 024 — Revisión completa del proyecto

Spec: [revisión completa](./specs/plataforma-y-documentacion/2026-10-27-revision-completa-proyecto.md).

- [x] Revisar arquitectura, capas, endpoints, seguridad, migraciones y
  documentación.
- [x] Ejecutar `npm run build` y `npm test` (8 archivos, 37 pruebas).
- [x] Actualizar `docs/tareas.md`, la auditoría, el índice de specs y el README
  con el estado real del proyecto.
- [ ] Retirar `idempotency_key` de las respuestas públicas de transacciones,
  como pedía el spec de autenticación (orden 011), y ajustar Swagger y pruebas.
- [x] Adaptar `db:init` y `db:seed` para aceptar `DATABASE_URL`: ambos usan
  `getClientConfig()`, que prioriza `DATABASE_URL` y cae a `DB_*`.
- [x] Unificar el comando de pruebas: `npm test` ejecuta
  `vitest run --config vitest.config.ts` sobre toda la suite.
- [x] Implementar CORS por allowlist exacta (`CORS_ORIGINS`), validada al
  arrancar y sin comodines.
- [ ] Adoptar un almacenamiento compartido de rate limiting antes de correr
  varias réplicas.

### Órdenes 030–039 — Wallet, autenticación completa y despliegue

Specs: [depósitos y cambio de moneda](./specs/cuentas-y-wallet/2026-10-27-depositos-y-cambio-de-moneda.md),
[cierre del mínimo backend](./specs/plataforma-y-documentacion/2026-10-28-minimo-funcional-backend.md),
[cierre de integración en Render](./specs/plataforma-y-documentacion/2026-10-29-cierre-integracion-frontend-render.md),
[configuración de entorno](./specs/plataforma-y-documentacion/2026-10-29-configuracion-env-y-lectura-dotenv.md),
[archivos .env por escenario](./specs/plataforma-y-documentacion/2026-10-29-archivos-env-escenarios.md),
[reorganización de tests](./specs/plataforma-y-documentacion/2026-10-29-reorganizacion-tests-src.md),
[recuperación de contraseña](./specs/autenticacion/2026-10-29-recuperacion-contrasena.md),
[cambio de contraseña](./specs/autenticacion/2026-10-29-cambio-contrasena-front.md),
[Google y perfil](./specs/autenticacion/2026-10-29-acceso-google-y-perfil.md) y
[depósitos y cambios (implementación)](./specs/cuentas-y-wallet/2026-10-29-depositos-y-cambios-implementacion.md).

- [x] Implementar `POST /wallet/deposits`, `GET /wallet/exchange/quote` y
  `POST /wallet/exchanges` con `exchange_quotes` (migración 011).
- [x] Implementar `POST /auth/forgot-password` y `POST /auth/reset-password`
  con tokens de un solo uso y proveedores `console`/`resend`.
- [x] Implementar `POST /auth/google` con Firebase Admin y `PATCH /users/me`.
- [x] Aplicar la migración 008 y completar el perfil de los seeds demo.
- [x] Mover los tests a `src/tests` y limitar el descubrimiento de Vitest.
- [x] Crear el Blueprint de Render y documentar CORS para localhost y Vercel.
- [ ] Ejecutar `db:init` y `db:seed` en una base limpia y en una existente.
- [ ] Probar por HTTP depósitos, cambios, transferencias y retiros con sus
  códigos `400/409/422/429` y el aislamiento por titular.
- [ ] Verificar el flujo de recuperación de contraseña con el proveedor real.
- [ ] Verificar el login con Google con credenciales de Firebase reales.
- [ ] Ejecutar `npm run build` y `npm test` en limpio y registrar el resultado.

## Criterio de cierre

- [ ] Actualizar los checkboxes de los specs únicamente después de ejecutar y
  registrar cada verificación.
- [ ] Mantener esta lista en el mismo orden que el índice de specs; agregar
  nuevas tareas bajo el orden correspondiente.
