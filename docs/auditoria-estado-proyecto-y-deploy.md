# Estado del proyecto y preparación para deploy

Fecha de revisión: 2026-10-27  
Alcance: revisión estática del repositorio y comprobaciones locales de build y
pruebas. Railway y Neon son los proveedores tentativos; no se validó un deploy
real ni una conexión contra una base de datos desde este entorno.

## Resumen

El backend compila y su suite de Vitest pasa. Están implementados el registro,
la autenticación, la consulta y el listado de cuentas, los ingresos convertidos,
los retiros, el historial paginado de transacciones y los health checks. La
arquitectura mantiene la separación `route → middleware/handler → controller →
service → PostgreSQL`.

Quedan fuera del alcance funcional las transferencias entre usuarios, la
recuperación de contraseña y un endpoint de perfil. También siguen abiertas
decisiones operativas: CORS, almacenamiento compartido para rate limiting,
versionado de migraciones y validación de un deploy real.

La revisión completa está documentada en
[`docs/specs/2026-10-27-revision-completa-proyecto.md`](./specs/2026-10-27-revision-completa-proyecto.md).

## Comprobaciones locales

| Comprobación | Resultado |
| --- | --- |
| `npm run build` | Correcto (`tsc -p tsconfig.json`). |
| `npm run test:vit` | Correcto: 8 archivos y 37 pruebas. |
| `npm test` | Correcto: 1 archivo y 2 pruebas (`AppError`). |
| `npm ci` | No ejecutado en esta revisión. |
| Inicialización PostgreSQL | No ejecutada; no se validó acceso a una base de datos. |
| Deploy/health check | No ejecutado; no hay servicio desplegado validado desde este entorno. |

`npm test` ejecuta únicamente la prueba de `AppError` mediante `node --test`.
La suite completa del proyecto se ejecuta con `npm run test:vit`.

## Endpoints presentes

Las rutas se contrastaron con `src/routes/`, `src/server.ts` y la definición
OpenAPI en `src/config/swagger.ts`.

| Método y ruta | Acceso | Capacidad |
| --- | --- | --- |
| `GET /health` | Público | Confirmar que el proceso responde. |
| `GET /health/ready` | Público | Ejecutar `SELECT 1` contra PostgreSQL y reportar readiness. |
| `POST /users` | Público, con límite de registro | Crear usuario, wallet y cuenta inicial. |
| `POST /auth/login` | Público, con límites de intentos | Iniciar sesión y obtener Bearer token. |
| `POST /auth/change-password` | Bearer | Cambiar contraseña y revocar otras sesiones. |
| `POST /auth/logout` | Bearer | Revocar la sesión actual. |
| `GET /accounts` | Bearer | Listar cuentas activas y saldos del titular autenticado. |
| `GET /accounts/:id` | Bearer y titular | Consultar una cuenta propia. |
| `GET /accounts/:id/balance` | Bearer y titular | Consultar saldo propio. |
| `POST /accounts/:id/incoming` | Bearer y titular | Registrar un ingreso convertido con idempotencia. |
| `POST /accounts/:id/withdraw` | Bearer y titular | Registrar un retiro con saldo suficiente e idempotencia. |
| `GET /transactions` | Bearer y titular | Historial paginado con filtros por cuenta y fechas. |
| `GET /transactions/:id` | Bearer y titular | Consultar una transacción propia. |
| `GET /api-docs` | Público | Swagger UI/OpenAPI. |

## Cobertura funcional no implementada

La tabla distingue ausencias confirmadas de requisitos de producto todavía no
definidos. No se recomienda agregar rutas solo para completar una lista.

| Capacidad | Estado | Cuándo sería necesaria |
| --- | --- | --- |
| Transferencia (`POST /transfers`) | Ausente. | Solo si se permiten movimientos entre usuarios/cuentas; definir atomicidad, destinatario y reversas. |
| Recuperación de contraseña | Ausente. | Si usuarios finales pueden recuperar acceso sin soporte administrativo. Requiere canal y flujo de verificación. |
| Perfil (`GET /users/me`) | Ausente. | Si el cliente necesita cargar identidad propia tras iniciar sesión. |

La lista anterior no reemplaza un backlog aprobado.

## Preparación de deploy

### Servicio de API

- Conectar el repositorio como servicio Node.js. Railway documenta detección
  Node mediante Railpack y `npm start` como comando de inicio habitual cuando
  existe el script. Para este repositorio, revisar o fijar en Settings:
  - Build: `npm run build`
  - Start: `npm start` (ejecuta `node dist/index.js`)
- El servidor lee `PORT`; Railway inyecta esa variable. No fijar un puerto
  distinto en el servicio.
- Configurar `Healthcheck Path` con `/health/ready` para que la comprobación
  incluya PostgreSQL; `/health` solo confirma que responde el proceso.
- Definir una versión Node LTS compatible como política de equipo. El repo no
  fija `engines` ni `.nvmrc`.
- La aplicación no configura CORS. Si un frontend de navegador vive en otro
  origen, definir una allowlist para sus dominios antes de la integración.

### PostgreSQL y variables

El pool usa `DATABASE_URL` cuando está definida y, si no, cae a los campos
`DB_*`. La URL tiene prioridad. Para Neon se recomienda la cadena pooled con
TLS. Para PostgreSQL local se pueden usar los campos separados.

| Variable de la API | Uso |
| --- | --- |
| `DATABASE_URL` | URL completa de PostgreSQL; tiene prioridad sobre `DB_*`. |
| `DB_HOST` | Host local, requerido junto con los demás campos `DB_*` si no hay URL. |
| `DB_PORT` | Puerto de PostgreSQL; default `5432`. |
| `DB_NAME` | Nombre de la base local. |
| `DB_USER` | Usuario local. |
| `DB_PASSWORD` | Contraseña local. |
| `NODE_ENV` | `production` en el servicio desplegado. |
| `PORT` | Inyectada por la plataforma; no copiarla desde `.env.example`. |
| `DB_MAX` | Opcional; default `20`, revisar según conexiones/replicas. |
| `EXCHANGE_RATE_TIMEOUT_MS` | Opcional; default `3000`. |
| `EXCHANGE_RATE_MAX_AGE_HOURS` | Opcional; default `24`. |

Configurar las credenciales en el gestor de secretos de la plataforma, nunca en
Git. No habilitar acceso TCP público a la base si no hace falta.

### Migraciones

`npm run db:init` ejecuta `db/scripts/init-db.ts` usando `tsx`. **Actualmente
ese script solo lee `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` y `DB_PASSWORD`;
no consume `DATABASE_URL`.** Si el entorno solo define `DATABASE_URL`, el
comando de inicialización falla aunque la aplicación sí pueda conectarse. Antes
de desplegar con Neon hay que definir ambos grupos de variables o adaptar los
scripts de base de datos.

Railway permite configurar un Pre-deploy Command que se ejecuta con variables y
red privada antes de activar la nueva versión. Para este repo, el comando a
validar es:

```sh
npm run db:init
```

La persona operadora ejecuta este comando mediante el paso Pre-deploy; aplica el
esquema/migraciones y, si falla, debe impedir que el deploy continúe. Confirmar
en staging que el build conserva `tsx` para el Pre-deploy Command. No ejecutar
`npm run db:seed` en producción: crea datos de demostración.

El inicializador aplica migraciones en secuencia fija dentro de una
transacción; no hay tabla de historial/versionado de migraciones. Antes de
adoptar cambios concurrentes o despliegues con varias réplicas, validar que el
paso no se ejecute simultáneamente y planear una herramienta con versionado.

### Datos y operación

- Activar backups/PITR según el RPO/RTO esperado y realizar un ensayo de
  restauración antes de depender de datos persistentes.
- Revisar logs de arranque, errores de DB y proveedor de tipo de cambio; no
  enviar secretos ni tokens a logs.
- Validar desde la URL pública: Swagger, health checks, registro, login,
  consulta propia, historial, ingreso y retiro en staging; revisar respuestas
  401/404/409/422/429 y que un usuario no pueda leer ni operar datos ajenos.
- Confirmar dominio HTTPS, política de CORS si aplica, límites de recursos,
  retención de datos y contacto operativo antes de producción.

## Hallazgos y brechas del repositorio

- **`db:init` y `db:seed` no usan `DATABASE_URL`.** La aplicación y el pool sí
  la soportan, pero los scripts de base de datos exigen los campos `DB_*`. Es la
  brecha operativa más importante para un deploy con Neon: el pre-deploy puede
  fallar antes de que la API arranque.
- **`GET /transactions` y `GET /transactions/:id` exponen `idempotency_key`.**
  El spec de autenticación
  ([orden 011](./specs/2026-10-26-autenticacion-y-acceso-por-titular.md))
  pedía retirarla de la respuesta pública. No es un secreto de autenticación,
  pero sí una desviación de contrato que conviene corregir en un cambio
  independiente, junto con Swagger y las pruebas.
- **`errorHandler` registra el error completo con `console.log(err)`.** Puede
  incluir detalles internos de PostgreSQL en los logs. Usar un logger
  estructurado y no registrar tokens, contraseñas ni cuerpos sensibles.
- **Rate limiting en memoria.** `express-rate-limit` usa su almacenamiento por
  defecto; con varias réplicas los límites no se comparten. Evaluar un store
  común si los límites deben ser globales.
- **Sin CORS.** Si el frontend se sirve desde otro origen, las peticiones del
  navegador fallarán hasta definir una allowlist.
- **Variables de entorno no consumidas.** `.env.example` incluye
  `DB_IDLE_TIMEOUT_MILLIS` y `DB_CONNECTION_TIMEOUT_MILLIS`, pero la validación
  de entorno y el `Pool` no las usan. La muestra induce a pensar que sí.
- **Sin `railway.json` ni `engines`/`.nvmrc`.** La plataforma puede detectar el
  proyecto, pero la versión de Node y el health check no están fijados en el
  repositorio.
- **Migraciones sin tabla de versionado.** El inicializador aplica una secuencia
  fija; no hay registro de migraciones aplicadas ni protección contra
  ejecuciones concurrentes.
- **Documentación de pruebas.** `npm test` solo ejecuta `AppError`; la suite
  completa es `npm run test:vit`. Conviene unificarlo o documentarlo con
  claridad para evitar falsos positivos en CI.

## Fortalezas verificadas

- Separación correcta por capas; SQL solo en services.
- Consultas parametrizadas y filtrado por `user_id` en las lecturas y
  operaciones del titular.
- Tokens aleatorios de 32 bytes, almacenados como hash SHA-256, con expiración,
  revocación y `password_change_required`.
- Contraseñas con scrypt y comparación en tiempo constante; respuestas de
  registro y transacciones no incluyen hashes ni tokens de sesión.
- Ledger append-only con trigger de balance por moneda y reglas que bloquean
  `UPDATE`/`DELETE`.
- Idempotencia con advisory locks y validación de payload repetido.
- Validación de UUID, importes, monedas y fechas con Zod; rutas específicas
  registradas antes de las rutas con parámetros.
- Health check de proceso y readiness con consulta a PostgreSQL.

## Fuentes de referencia

- [Deploy de Express en Railway](https://docs.railway.com/guides/express)
- [Health checks](https://docs.railway.com/deployments/healthchecks)
- [Comando Pre-deploy](https://docs.railway.com/deployments/pre-deploy-command)
- [PostgreSQL en Railway](https://docs.railway.com/databases/postgresql)
- [Variables](https://docs.railway.com/variables)
- [Backups y restauración de PostgreSQL](https://docs.railway.com/guides/postgres-backups-restores)
- [Conexión desde cualquier app (Neon)](https://neon.com/docs/connect/connect-from-any-app)
