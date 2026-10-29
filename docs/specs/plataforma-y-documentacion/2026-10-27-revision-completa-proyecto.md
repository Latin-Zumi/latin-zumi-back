# Spec: Revisión completa del proyecto

## Fecha
2026-10-27

## Orden de ejecución: 024

## Problema
Revisar el proyecto completo para asegurar que está bien estructurado, no hay
duplicación de código, las bases de datos son congruentes, hay división correcta
por capas, no se filtra información confidencial y la documentación refleja el
estado real del proyecto.

## Solución propuesta
Realizar análisis estático del código fuente, migraciones, seeds, configuración,
endpoints, middlewares, pruebas y documentación. Registrar hallazgos y
actualizar la documentación para que coincida con la implementación vigente.
Esta revisión no modifica código de aplicación: los cambios funcionales
detectados se proponen como tareas separadas.

## Archivos afectados
- `docs/specs/plataforma-y-documentacion/2026-10-27-revision-completa-proyecto.md` (nuevo)
- `docs/tareas.md`
- `docs/auditoria-estado-proyecto-y-deploy.md`
- `docs/specs/index-specs.md` (índice)
- `README.md` (estado, endpoints, pruebas y arquitectura)
- `db/README.md` (aclaración sobre `DATABASE_URL` y scripts de base de datos)

## Análisis realizado

### Arquitectura y capas
- Separación correcta: `routes → asyncHandler/middlewares → controllers
  (validación Zod) → services (SQL parametrizado) → PostgreSQL`.
- `errorHandler` centraliza `AppError`, errores de parseo JSON y violaciones de
  PostgreSQL.
- `asyncHandler` envuelve correctamente handlers asíncronos.
- Las rutas específicas `/accounts/:id/balance`, `/accounts/:id/incoming` y
  `/accounts/:id/withdraw` se registran antes de `/accounts/:id`.
- No se encontró SQL en controllers ni acceso directo al pool fuera de
  `services`/`config`.

### Endpoints implementados
- Health: `GET /health` (proceso vivo) y `GET /health/ready` (`SELECT 1`).
- Auth/Users: `POST /users` (rate limit), `POST /auth/login` (rate limits),
  `POST /auth/change-password`, `POST /auth/logout`.
- Accounts: `GET /accounts`, `GET /accounts/:id`,
  `GET /accounts/:id/balance`, `POST /accounts/:id/incoming`,
  `POST /accounts/:id/withdraw`.
- Transactions: `GET /transactions` (paginado y filtrado) y
  `GET /transactions/:id`.
- Documentación: `GET /api-docs`.

### Seguridad
- Tokens base64url con `randomBytes(32)`; se almacena hash SHA-256, no el token.
- Sesiones con expiración de 1 hora, revocación y `password_change_required`.
- Contraseñas con scrypt y comparación en tiempo constante; soporte de rehash
  para hashes legacy.
- Filtrado por `user_id` en lecturas y operaciones del titular; cuentas ajenas
  responden `404`.
- Rate limiting en login, registro y por identificador; el identificador se
  hashea antes de usarlo como clave.
- Validación de UUID, monedas, importes, fechas e `Idempotency-Key` con Zod y
  expresiones regulares.
- Idempotencia con advisory locks y rechazo `409` cuando la clave se reutiliza
  con otro payload.
- Las respuestas de registro y login no exponen contraseñas, hashes ni tokens
  almacenados.

### Base de datos
- Ledger append-only con trigger diferido de balance por moneda y reglas que
  impiden `UPDATE`/`DELETE`.
- Migraciones `001`–`007` secuenciales y aplicadas dentro de una transacción.
- Wallets con moneda principal y cuentas de saldo por moneda.
- `currency_conversions` conserva importes, monedas, tasa, fuente, fecha y
  regla de redondeo.
- Saldos calculados desde `entries` mediante `account_balances`.
- Seeds idempotentes con UUIDs demo y saldos documentados.

### Pruebas
- `npm run build`: correcto.
- `npm test`: 8 archivos, 37 pruebas correctas.
- `npm test`: 1 archivo, 2 pruebas (`AppError`).
- No se ejecutaron pruebas de integración contra PostgreSQL en esta revisión.

## Hallazgos

### Resueltos con esta revisión
- La auditoría afirmaba que no existían el historial de movimientos, los retiros
  ni los health checks. Los tres están implementados y documentados.
- La auditoría afirmaba que la aplicación no consumía `DATABASE_URL`. El pool
  ya la usa con prioridad sobre `DB_*`.
- `.env.example` ya usa `PORT=3000`, alineado con `src/config/env.ts`.
- El README no documentaba el historial paginado ni los retiros.

### Pendientes (requieren cambio funcional independiente)
1. **Exposición de `idempotency_key` en transacciones.** El spec de
   autenticación (orden 011) pedía omitirla. El servicio y Swagger todavía la
   devuelven:

   ```ts
   SELECT t.id, t.idempotency_key, t.description, t.occurred_at
     FROM transactions t
   ```

   El controller responde `{ data: transaction }` y el objeto conserva la clave.
   No es un secreto de sesión, pero es una desviación del contrato público.

2. **`db:init` y `db:seed` no aceptan `DATABASE_URL`.** La aplicación sí, pero
   los scripts exigen `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` y
   `DB_PASSWORD`:

   ```ts
   const client = new Client({
     host: getEnv('DB_HOST'),
     port: Number(getEnv('DB_PORT')),
     database: getEnv('DB_NAME'),
     user: getEnv('DB_USER'),
     password: getEnv('DB_PASSWORD'),
   });
   ```

   En un deploy con Neon y solo `DATABASE_URL`, el pre-deploy fallaría. Hay que
   adaptar los scripts o definir ambos grupos de variables.

3. **`errorHandler` usa `console.log(err)`.** Puede registrar detalles internos
   de PostgreSQL. Conviene un logger estructurado y filtrar datos sensibles.

4. **Rate limiting en memoria.** Con varias réplicas los límites no se
   comparten; evaluar un store común si deben ser globales.

5. **Sin CORS.** Un frontend en otro origen no podrá consumir la API hasta
   definir una allowlist.

6. **`npm test` no ejecuta la suite completa.** Solo corre `AppError`; la suite
   principal es `npm test`. Conviene unificar el comando o documentarlo
   en CI.

7. **Variables de entorno no consumidas.** `.env.example` incluye
   `DB_IDLE_TIMEOUT_MILLIS` y `DB_CONNECTION_TIMEOUT_MILLIS`, pero ni la
   validación ni el `Pool` las usan.

8. **Migraciones sin tabla de versionado.** La secuencia es fija y no hay
   registro de migraciones aplicadas ni protección contra ejecuciones
   concurrentes.

## Cómo probar
- [x] Revisar estructura, capas y duplicación de lógica.
- [x] Revisar rutas, controllers, servicios y middlewares.
- [x] Revisar seguridad, autenticación, autorización e idempotencia.
- [x] Revisar migraciones, seeds y congruencia del modelo de datos.
- [x] Revisar documentación y contrastarla con el código.
- [x] Ejecutar `npm run build`.
- [x] Ejecutar `npm test` (8 archivos, 37 pruebas).
- [x] Actualizar `docs/tareas.md`, la auditoría, el índice de specs y el README.

## Recomendaciones
1. Priorizar la adaptación de `db:init`/`db:seed` a `DATABASE_URL` antes de un
   deploy con Neon, porque el pre-deploy es el primer paso que puede fallar.
2. Crear un spec corto para retirar `idempotency_key` de las respuestas de
   transacciones y actualizar Swagger, pruebas y README.
3. Sustituir `console.log(err)` por logging estructurado sin datos sensibles.
4. Definir CORS y el almacenamiento de rate limiting según la topología de
   deploy (un origen, varias réplicas).
5. Unificar `npm test` y `npm test`, o dejar explícito en CI qué comando
   es la suite obligatoria.
6. Añadir versionado de migraciones antes de operar con varias réplicas o
   cambios concurrentes.
7. Mantener la documentación de estado actualizada al cerrar cada spec; la mayor
   parte de los hallazgos de esta revisión fueron desactualizaciones de docs.

## Riesgos / notas
El proyecto está bien estructurado y no se encontraron fugas de contraseñas,
hashes ni tokens de sesión. Los riesgos principales son operativos
(`DATABASE_URL` en scripts de DB, CORS, rate limiting y migraciones) y de
contrato (`idempotency_key` en transacciones), no de arquitectura. La revisión
fue estática: no reemplaza una prueba de integración contra PostgreSQL ni una
validación de deploy real.
