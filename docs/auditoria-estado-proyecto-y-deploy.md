# Estado del proyecto y preparación para Railway

Fecha de revisión: 2026-10-26  
Alcance: auditoría estática del repositorio y comprobaciones locales. Railway
es el proveedor tentativo; no hay acceso a un proyecto Railway para validar un
deploy real.

## Resumen

El backend compila y sus pruebas actuales pasan. Hay rutas para registro,
autenticación, consultas autenticadas, listado de cuentas y registrar ingresos
convertidos. No hay listado de movimientos. Retiros, transferencias y
recuperación de contraseña tampoco están implementados; deben priorizarse solo
si forman parte del producto requerido.

El repositorio tiene scripts suficientes para compilar, iniciar y aplicar el
esquema en Railway, pero el servicio aún no está configurado. Hay que enlazar
la base PostgreSQL, mapear variables `PG*` a `DB_*`, definir el comando de
migración previo al deploy, configurar el health check y validar conexión y
recuperación de backups en el entorno desplegado.

## Comprobaciones locales

| Comprobación | Resultado |
| --- | --- |
| `npm ci` | Correcto al repetir fuera del sandbox; 0 vulnerabilidades reportadas. |
| `npm run build` | Correcto (`tsc -p tsconfig.json`). |
| `npm test` | 4 archivos y 10 pruebas pasaron. |
| Inicialización PostgreSQL | No ejecutada; no se validó acceso a una base de datos. |
| Deploy/health check Railway | No ejecutado; no hay servicio Railway configurado para este repo. |

La primera ejecución de `npm ci` dentro del sandbox terminó con `EPERM` al
ejecutar la comprobación de versión de esbuild. La repetición autorizada fuera
del sandbox se completó correctamente.

## Endpoints presentes

Las rutas se contrastaron con `src/routes/` y la definición OpenAPI en
`src/config/swagger.ts`.

| Método y ruta | Acceso | Capacidad |
| --- | --- | --- |
| `POST /users` | Público, con límite de registro | Crear usuario, wallet y cuenta inicial. |
| `POST /auth/login` | Público, con límites de intentos | Iniciar sesión y obtener Bearer token. |
| `POST /auth/change-password` | Bearer | Cambiar contraseña y revocar otras sesiones. |
| `POST /auth/logout` | Bearer | Revocar la sesión actual. |
| `GET /accounts/:id` | Bearer y titular | Consultar una cuenta propia. |
| `GET /accounts/:id/balance` | Bearer y titular | Consultar saldo propio. |
| `POST /accounts/:id/incoming` | Bearer y titular | Registrar un ingreso convertido con idempotencia. |
| `GET /transactions/:id` | Bearer y titular | Consultar una transacción propia. |
| `GET /accounts` | Protegido | Listar cuentas activas y saldos del titular autenticado. |
| `GET /api-docs` | Público | Swagger UI/OpenAPI. |

## Endpoints que no existen y decisiones funcionales

La tabla distingue ausencias confirmadas de requisitos de producto todavía no
definidos. No se recomienda agregar rutas solo para completar una lista.

| Capacidad no cubierta | Estado | Cuándo sería necesaria |
| --- | --- | --- |
| `GET /health`, `GET /health/ready` | Implementados: `/health` confirma que responde el proceso y `/health/ready` también ejecuta `SELECT 1` contra PostgreSQL. | Configurar Railway con `/health/ready`; validar en el servicio desplegado. |
| `GET /accounts` | Implementado; lista las cuentas activas del titular y el saldo por moneda sin exigir IDs al cliente. | Permite descubrir las cuentas/monedas del usuario tras autenticarse. |
| `GET /transactions` o historial paginado | Implementado con paginación, filtros por cuenta y fechas, y acceso limitado al titular autenticado. | Permite mostrar actividad reciente; ordena por fecha descendente y limita cada página a 100 resultados. |
| Retiro (`POST /accounts/:id/withdraw`) | Ausente. | Solo si el producto permite salida de fondos; exige saldo disponible, concurrencia, autorización e idempotencia. |
| Transferencia (`POST /transfers`) | Ausente. | Solo si se permiten movimientos entre usuarios/cuentas; definir atomicidad, destinatario y reversas. |
| Recuperación de contraseña | Ausente. | Si usuarios finales pueden recuperar acceso sin soporte administrativo. Requiere canal y flujo de verificación. |
| Perfil (`GET /users/me`) | Ausente. | Si el cliente necesita cargar identidad propia tras iniciar sesión. |

La lista anterior no reemplaza un backlog aprobado. En particular, no hay un
requisito registrado que confirme retiros, transferencias o recuperación de
contraseña.

## Preparación de Railway

### Servicio de API

- Conectar el repositorio como servicio Node.js. Railway documenta detección
  Node mediante Railpack y `npm start` como comando de inicio habitual cuando
  existe el script. Para este repositorio, revisar o fijar en Settings:
  - Build: `npm run build`
  - Start: `npm start` (ejecuta `node dist/index.js`)
- El servidor lee `PORT`; Railway inyecta esa variable. No fijar un puerto
  distinto en el servicio.
- Configurar `Healthcheck Path` con `/health/ready` para que la comprobación
  incluya PostgreSQL; `/health` solo confirma que responde el proceso. Validar
  el comportamiento en el servicio desplegado.
- Definir una versión Node LTS compatible como política de equipo. El repo no
  fija `engines` ni `.nvmrc`; esta auditoría no selecciona un número de versión.
- La aplicación no configura CORS. Si un frontend de navegador vive en otro
  origen, definir una allowlist para sus dominios antes de integración.

### PostgreSQL y variables

Crear PostgreSQL en el mismo proyecto/entorno Railway y mantenerlo privado.
La app no consume `DATABASE_URL`: requiere estas variables y se pueden
configurar con referencias a las variables del servicio Postgres:

| Variable de la API | Referencia Railway sugerida |
| --- | --- |
| `DB_HOST` | `${{Postgres.PGHOST}}` |
| `DB_PORT` | `${{Postgres.PGPORT}}` |
| `DB_NAME` | `${{Postgres.PGDATABASE}}` |
| `DB_USER` | `${{Postgres.PGUSER}}` |
| `DB_PASSWORD` | `${{Postgres.PGPASSWORD}}` |
| `NODE_ENV` | `production` |
| `PORT` | Inyectada por Railway; no copiarla desde `.env.example`. |
| `DB_MAX` | Opcional; actualmente default `20`, revisar según conexiones/replicas. |
| `EXCHANGE_RATE_TIMEOUT_MS` | Opcional; default `3000`. |
| `EXCHANGE_RATE_MAX_AGE_HOURS` | Opcional; default `24`. |

Configurar las credenciales en Railway, nunca en Git. La base puede usar las
variables privadas del servicio Postgres; no habilitar acceso TCP público si
no hace falta.

### Migraciones

`npm run db:init` ejecuta `db/scripts/init-db.ts` usando `tsx` y requiere
`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` y `DB_PASSWORD`. Railway permite
configurar un Pre-deploy Command que se ejecuta con variables y red privada
antes de activar la nueva versión. Para este repo, el comando a validar es:

```sh
npm run db:init
```

La persona operadora ejecuta este comando mediante el paso Pre-deploy de
Railway; aplica el esquema/migraciones y si falla debe impedir que el deploy
continúe. Confirmar en una base de staging que el build de Railway conserva
`tsx` para el Pre-deploy Command. No ejecutar `npm run db:seed` en producción:
crea datos de demostración.

El inicializador aplica migraciones en secuencia fija dentro de una
transacción; no hay tabla de historial/versionado de migraciones. Antes de
adoptar cambios concurrentes o despliegues con varias réplicas, validar que el
paso no se ejecute simultáneamente y planear una herramienta de migración con
versionado.

### Datos y operación

- Activar backups/PITR según el RPO/RTO esperado y realizar un ensayo de
  restauración antes de depender de datos persistentes.
- Revisar logs de arranque, errores de DB y proveedor de tipo de cambio; no
  enviar secretos ni tokens a logs.
- Validar desde la URL pública: Swagger, registro, login, consulta propia y
  flujo de ingreso en staging; revisar respuestas 401/404/429 y que un usuario
  no pueda leer datos ajenos.
- Confirmar dominio HTTPS, política de CORS si aplica, límites de recursos,
  retención de datos y contacto operativo antes de producción.

## Discrepancias y brechas del repositorio

- `.env.example` dice `PORT=5173`, pero `src/config/env.ts` usa `3000` como
  default. En Railway el `PORT` inyectado prevalece; para desarrollo conviene
  alinear el ejemplo con `3000`.
- `.env.example` incluye `DB_IDLE_TIMEOUT_MILLIS` y
  `DB_CONNECTION_TIMEOUT_MILLIS`, pero la validación de entorno y el `Pool`
  no las consumen. No afectan el despliegue actual, pero la muestra induce a
  pensar que sí.
- No hay health endpoint, configuración Railway (`railway.json`), política
  `engines` ni entorno Railway verificado.
- `express-rate-limit` usa su almacenamiento en memoria por defecto; con varias
  réplicas los límites no se comparten. Evaluar un store común antes de escalar
  si esos límites deben ser globales.
- El historial lista únicamente transacciones con asientos en cuentas activas
  del titular autenticado; no expone cuentas internas ni ajenas.

## Fuentes Railway

- [Deploy de Express](https://docs.railway.com/guides/express)
- [Health checks](https://docs.railway.com/deployments/healthchecks)
- [Comando Pre-deploy](https://docs.railway.com/deployments/pre-deploy-command)
- [PostgreSQL](https://docs.railway.com/databases/postgresql)
- [Variables](https://docs.railway.com/variables)
- [Backups y restauración de PostgreSQL](https://docs.railway.com/guides/postgres-backups-restores)
