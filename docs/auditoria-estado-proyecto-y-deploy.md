# Estado del proyecto y preparación para deploy

Fecha de revisión: 2026-10-30
Alcance: revisión estática del repositorio, contraste de contratos documentados
y verificación de la configuración de despliegue. Esta revisión reemplaza la del
2026-10-27, que describía un estado previo a la implementación de CORS, la
recuperación de contraseña, el perfil, el acceso con Google y los depósitos y
cambios de moneda.

## Resumen

El backend implementa el flujo completo de una wallet multimoneda:
registro y sesión con Bearer, login y alta con Google, recuperación y cambio de
contraseña, consulta de cuentas y saldos, ingresos convertidos, retiros,
transferencias entre usuarios, depósitos, cotización y ejecución de cambios,
historial paginado y asistente conversacional. La arquitectura mantiene la
separación `route → middleware → controller → service → PostgreSQL`, con el
ledger append-only como fuente de verdad de los saldos.

Quedan abiertas decisiones de producto y operación, no de estructura: pasarela
real de fondos, KYC/AML y límites por usuario, versionado de migraciones,
observabilidad, CI y rate limiting compartido entre réplicas. La deuda técnica
detallada está en la auditoría externa `Report00` (2026-10-30).

## Comprobaciones locales

| Comprobación | Resultado |
| --- | --- |
| `npm ci --dry-run` | Correcto: resuelve el árbol completo, incluido `firebase-admin@14.5.0`. |
| `npm run build` | Correcto (`tsc -p tsconfig.json`). |
| `npm test` | Correcto: 24 archivos y 144 pruebas. |
| `npm run dev` | Correcto: levanta el servidor y reinicia al guardar un archivo de `src/`. |
| Inicialización PostgreSQL | No ejecutada desde este entorno. |
| Deploy/health check | No validado contra un servicio desplegado desde este entorno. |

> El entorno de revisión tenía `node_modules` incompleto: faltaba
> `firebase-admin` aunque el lockfile lo declara. Se instaló la dependencia para
> verificar. En una máquina limpia, `npm ci` debe reproducir el mismo resultado.

## Endpoints presentes

Rutas contrastadas con `src/routes/`, `src/server.ts` y la definición OpenAPI de
`src/config/swagger.ts`.

| Método y ruta | Acceso | Capacidad |
| --- | --- | --- |
| `GET /health` | Público | Confirmar que el proceso responde. |
| `GET /health/ready` | Público | Ejecutar `SELECT 1` contra PostgreSQL y reportar readiness. |
| `POST /auth/register` | Público, con límite | Crear usuario, wallet, cuenta y sesión en una transacción. |
| `POST /auth/login` | Público, con límites de intentos | Iniciar sesión y obtener `{ token, user }`. |
| `POST /auth/google` | Público | Validar un ID token de Firebase y crear o vincular la cuenta. |
| `POST /auth/forgot-password` | Público | Solicitar recuperación por email (respuesta uniforme). |
| `POST /auth/reset-password` | Público | Consumir un token de un solo uso y fijar nueva contraseña. |
| `POST /auth/change-password` | Bearer | Cambiar contraseña y revocar otras sesiones. |
| `POST /auth/logout` | Bearer | Revocar la sesión actual. |
| `GET /users/lookup` | Bearer | Buscar destinatario y exponer solo el nombre. |
| `PATCH /users/me` | Bearer | Actualizar el perfil del titular (nombre, foto). |
| `POST /users` | Público, con límite | **Legado y deprecado.** Crear usuario sin sesión; usar `POST /auth/register`. |
| `GET /accounts` | Bearer | Listar cuentas activas y saldos del titular. |
| `GET /accounts/:id` | Bearer y titular | Consultar una cuenta propia. |
| `GET /accounts/:id/balance` | Bearer y titular | Consultar saldo propio. |
| `POST /accounts/:id/incoming` | Bearer y titular | **Legado y deprecado.** Ingreso convertido; usar `POST /wallet/deposits`. |
| `POST /accounts/:id/withdraw` | Bearer y titular | Registrar un retiro con saldo suficiente e idempotencia. |
| `GET /transactions` | Bearer y titular | Historial paginado con filtros por cuenta y fechas. |
| `GET /transactions/:id` | Bearer y titular | Consultar una transacción propia. |
| `GET /wallet/transactions` | Bearer | Actividad paginada y filtrable del titular. |
| `POST /wallet/transfers` | Bearer | Transferir entre usuarios, convirtiendo a la moneda principal del receptor. |
| `POST /wallet/deposits` | Bearer | Registrar un depósito idempotente en la moneda indicada. |
| `GET /wallet/exchange/quote` | Bearer, con límite | Cotizar un cambio de moneda con expiración. |
| `POST /wallet/exchanges` | Bearer | Ejecutar un cambio contra una cotización vigente. |
| `POST /chat/messages` | Bearer | Asistente conversacional con contexto de cuentas. |
| `GET /api-docs` | Público | Swagger UI/OpenAPI. |

## Cobertura funcional no implementada

La tabla distingue ausencias confirmadas de requisitos de producto todavía no
definidos. No se recomienda agregar rutas solo para completar una lista.

| Capacidad | Estado | Cuándo sería necesaria |
| --- | --- | --- |
| Pasarela real de depósito y retiro | Ausente: el ledger acredita contra cuentas internas (`external`/`treasury`). | Antes de mover dinero real. Requiere PSP, conciliación y webhooks firmados. |
| KYC/AML y límites por usuario | Ausente. | Antes de custodiar fondos de terceros. |
| Refresh o rotación de sesión | Ausente: el token dura una hora y no se renueva. | Si el usuario debe permanecer conectado más de una hora. |
| Verificación de email en registro por contraseña | Ausente (Google sí verifica). | Si el email identifica la cuenta o habilita recuperación. |
| `GET /users/me` o `GET /auth/me` | Ausente: solo existe `PATCH /users/me`. | Si el cliente necesita rehidratar la sesión sin confiar en `localStorage`. |
| Segundo factor / passkeys | Ausente. | Según riesgo y requisitos regulatorios. |
| Persistencia de conversaciones del chat | Ausente: el historial lo envía el cliente. | Si se necesita auditoría o continuidad entre dispositivos. |
| Observabilidad (logger, métricas, trazas) | Ausente: solo `console.log`/`console.error`. | Antes de producción. |
| Versión de esquema y rollback | Ausente: no hay tabla de migraciones aplicadas. | Al crecer el equipo o automatizar despliegues. |
| Rate limiting compartido | En memoria: no se comparte entre réplicas. | Al escalar horizontalmente. |

La lista anterior no reemplaza un backlog aprobado.

## Preparación de deploy

### Desarrollo local

`npm run dev` ejecuta `tsx watch src/index.ts` y reinicia el proceso al guardar
archivos de `src/`. No genera `dist/`; para validar el artefacto compilado usar
`npm run build && npm start`. El modo watch no recarga cambios en `.env`.

### Servicio de API

El deploy canónico es Render, definido en `render.yaml`. `railway.json` es un
artefacto legado de una plataforma anterior y no debe tomarse como fuente de
verdad.

- Build: `npm ci --include=dev && npm run build && DATABASE_URL="$DATABASE_URL_UNPOOLED" npm run db:init`.
- Start: `npm start` (ejecuta `node dist/index.js`).
- Healthcheck: `/health/ready`, para que la comprobación incluya PostgreSQL.
- Versión de Node fijada en `package.json` (`engines.node: >=24 <25`), `.nvmrc`
  (`24`) y `NODE_VERSION=24` en el Blueprint.
- En el plan gratuito la migración corre durante el build. En un plan pago,
  moverla a `preDeployCommand` (hay un comentario en `render.yaml`).

### PostgreSQL y variables

El pool usa `DATABASE_URL` cuando está definida y, si no, cae a los campos
`DB_*`. Para Neon se usa la cadena pooled en runtime y `DATABASE_URL_UNPOOLED`
para migraciones. El módulo `src/config/db-connection.ts` normaliza `sslmode` y
rechaza combinaciones contradictorias de `ssl`/`sslmode`.

| Variable | Uso |
| --- | --- |
| `DATABASE_URL` | URL completa de PostgreSQL; tiene prioridad sobre `DB_*`. Pooled en Neon. |
| `DATABASE_URL_UNPOOLED` | URL directa usada por `db:init` en el build. |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Fallback local cuando no hay `DATABASE_URL`. |
| `DB_MAX` | Opcional; default `20`. |
| `DB_IDLE_TIMEOUT_MILLIS` | Opcional; default `30000`. |
| `DB_CONNECTION_TIMEOUT_MILLIS` | Opcional; default `2000`. Render usa `10000`. |
| `NODE_ENV` | `production` en el servicio desplegado. |
| `PORT` | Inyectada por la plataforma; default `3000`. |
| `CORS_ORIGINS` | Orígenes exactos separados por coma, sin comodines ni rutas. |
| `EXCHANGE_RATE_TIMEOUT_MS` | Opcional; default `3000`. |
| `EXCHANGE_RATE_MAX_AGE_HOURS` | Opcional; default `24`. |
| `GEMINI_API_KEY` | Sin ella, `/chat/messages` responde `503` controlado. |
| `GEMINI_MODEL` | Default `gemini-3.5-flash-lite`. |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | Se configuran las tres o ninguna; sin ellas no hay login con Google. |
| `EMAIL_PROVIDER` | `console` (default) o `resend`. |
| `RESEND_API_KEY` | Obligatoria si `EMAIL_PROVIDER=resend`. |
| `EMAIL_FROM` | Remitente de los correos de recuperación. |
| `PASSWORD_RESET_URL` | URL del frontend para fijar la nueva contraseña. |
| `PASSWORD_RESET_TTL_MINUTES` | Vigencia del token; default `30`, rango `5–240`. |

El Blueprint actual solo declara `NODE_VERSION`, `NODE_ENV`, `DATABASE_URL`,
`DATABASE_URL_UNPOOLED`, `CORS_ORIGINS`, `DB_CONNECTION_TIMEOUT_MILLIS`,
`EMAIL_PROVIDER` y `RESEND_API_KEY`. `GEMINI_*`, `FIREBASE_*`,
`PASSWORD_RESET_URL` y `PASSWORD_RESET_TTL_MINUTES` deben agregarse a mano en
el panel o al Blueprint si se despliega por blueprint.

Configurar las credenciales en el gestor de secretos de la plataforma, nunca en
Git. No habilitar acceso TCP público a la base si no hace falta.

### Migraciones

`npm run db:init` ejecuta `db/scripts/init-db.ts` usando `tsx` y
`getClientConfig()`, por lo que **sí admite `DATABASE_URL`** (la revisión
anterior afirmaba lo contrario). Aplica `db/migrations/001`–`011` en orden
dentro de una transacción.

No hay tabla de historial de migraciones: el script reintenta todos los archivos
en cada ejecución y depende de que sean idempotentes. Antes de desplegar con
varias réplicas o cambios concurrentes, agregar versionado y evitar ejecuciones
simultáneas.

No ejecutar `npm run db:seed` en producción: crea datos de demostración,
incluido el usuario `demo-user`.

### Datos y operación

- Activar backups/PITR según el RPO/RTO esperado y ensayar una restauración.
- Revisar logs de arranque, errores de DB y del proveedor de tipo de cambio; no
  enviar secretos ni tokens a logs.
- Validar desde la URL pública: Swagger, health checks, registro, login,
  consulta propia, historial, depósito, cambio, transferencia y retiro en
  staging; revisar respuestas `401/404/409/422/429` y el aislamiento por titular.
- Confirmar dominio HTTPS, `CORS_ORIGINS` con los orígenes reales, límites de
  recursos, retención de datos y contacto operativo antes de producción.

## Hallazgos abiertos

Los detalles, evidencia y prioridad están en `Report00`. Resumen:

- **CORS no permite `PATCH`.** `src/config/cors.ts` declara
  `methods: ['GET', 'POST']`; el preflight de `PATCH /users/me` se bloquea en
  el navegador.
- **`Idempotency-Key` es única global.** `transactions.idempotency_key` no está
  namespaceada por usuario: una clave puede colisionar entre titulares.
- **Fallback de tasas con Frankfurter v1.** No cubre ARS ni COP; debe migrarse a
  v2 (`https://api.frankfurter.dev/v2/rates`).
- **Frescura de tasas de 24 h.** Los fines de semana las tasas de referencia
  quedan vencidas y las conversiones responden `503`.
- **`GET /transactions` y `GET /transactions/:id` exponen `idempotency_key`.**
  El spec de autenticación pedía retirarla de la respuesta pública.
- **Sin `pool.on('error')` ni cierre ordenado.** Un cliente idle que falle puede
  tumbar el proceso; en cada redeploy se cortan conexiones en vuelo.
- **Rate limiting en memoria.** No se comparte entre réplicas.
- **Migraciones sin tabla de versionado.** Ver sección anterior.
- **Rutas legadas activas.** `POST /users` y `POST /accounts/:id/incoming`
  siguen respondiendo aunque estén deprecadas en Swagger.
- **Tres formatos de respuesta.** `{ data }`, `{ data, meta }`, `{ items, ... }`
  y objetos planos conviven sin un sobre común.

## Fortalezas verificadas

- Separación correcta por capas; SQL solo en services.
- Consultas parametrizadas y filtrado por `user_id` en las lecturas y
  operaciones del titular.
- Tokens aleatorios almacenados como hash SHA-256, con expiración, revocación y
  `password_change_required`.
- Tokens de recuperación de un solo uso, hasheados, con TTL configurable.
- Contraseñas con scrypt y comparación en tiempo constante; las respuestas no
  incluyen hashes ni tokens de sesión.
- Ledger append-only con trigger de balance por moneda y reglas que bloquean
  `UPDATE`/`DELETE`.
- Idempotencia con advisory locks y validación de payload repetido.
- Validación de UUID, importes, monedas y fechas con Zod; rutas específicas
  registradas antes de las rutas con parámetros.
- CORS por allowlist exacta, sin comodines, validada al arrancar.
- Health check de proceso y readiness con consulta a PostgreSQL.

## Fuentes de referencia

- [Deploy de Express en Render](https://render.com/docs/deploy-node-express-app)
- [Neon: conexión desde cualquier app](https://neon.com/docs/connect/connect-from-any-app)
- [Neon: pooling de conexiones](https://neon.com/docs/connect/connection-pooling)
- [PostgreSQL: backups y PITR](https://www.postgresql.org/docs/current/continuous-archiving.html)
- [Railway (legado)](https://docs.railway.com/guides/express)
