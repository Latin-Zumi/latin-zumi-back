# Spec: Cierre del mínimo funcional del backend

## Fecha
2026-10-28

## Orden de ejecución: 031

## Problema
La revisión del mínimo funcional confirma que el código backend cubre registro,
login y consulta de cuentas, pero quedan tres brechas dentro del repositorio:
los tests de `GET /accounts` no reflejan el envelope de error real; Express no
confía en el proxy inverso y el rate limit puede agrupar clientes bajo la IP
del proxy; y `GET /accounts` no incluye el `wallet_id` que identifica la wallet
de cada cuenta. La revisión también señala que `CORS_ORIGINS` debe configurarse
en el entorno de deploy para permitir llamadas desde el navegador. El destino
previsto ahora es Render para el servidor y Neon para PostgreSQL; el spec debe
incluir la configuración versionada y los valores operativos para conectar el
frontend con la API publicada.

Este cambio cubre backend, documentación y configuración versionada de Render.
La adaptación del frontend queda fuera. Las variables con credenciales o
dominios reales se cargan en el entorno de Render, no en Git.

## Solución propuesta

1. Configurar Express para confiar en el primer proxy inverso, como el proxy
   de Render, y así obtener la IP del cliente enviada en
   `X-Forwarded-For` para `express-rate-limit`.
2. Incluir `wallet_id` en la consulta y el tipo de cuenta de `GET /accounts`,
   preservando el filtro por titular, cuentas activas y respuesta `{ data }`.
3. Alinear los dos tests de ruta con el contrato central `{ code, message }`
   producido por `errorHandler`.
4. Añadir `render.yaml` para crear el servicio web Node de Render con build,
   start, health check y migraciones pre-deploy.
5. Configurar `DATABASE_URL` con la URL pooled de Neon y TLS validado, y
   `CORS_ORIGINS` con el origen exacto de producción. No versionar secretos ni
   inventar el dominio público del frontend.
6. Si el plan de Render no admite migraciones pre-deploy, documentar y ejecutar
   `npm run db:init` mediante un paso operativo antes de habilitar tráfico.

### Flujo 1: IP del cliente detrás del proxy

```ts
export const app = express();
app.set('trust proxy', 1);
app.use(corsMiddleware);
```

Al inicializar la aplicación, Express confía en un salto de proxy y determina
`req.ip` usando el encabezado reenviado por ese proxy. Los limitadores de login
y registro consumen `req.ip`; el resultado es que sus contadores distinguen las
IP de clientes que llegan por el proxy de Render.

### Flujo 2: cuentas con su wallet

```sql
SELECT a.id,
       a.user_id,
       a.wallet_id,
       RTRIM(a.currency) AS currency,
       a.account_type,
       a.allow_negative,
       COALESCE(b.balance, 0)::text AS balance
  FROM accounts a
  LEFT JOIN account_balances b
    ON b.account_id = a.id AND b.currency = a.currency
 WHERE a.user_id = $1
   AND a.account_type = 'user'
   AND a.closed_at IS NULL
 ORDER BY RTRIM(a.currency), a.id;
```

El servicio backend ejecuta esta consulta con el `userId` obtenido de la
sesión autenticada como parámetro `$1`. El controlador conserva el envelope
`{ data }`; cada cuenta devuelta incluye su `wallet_id` y saldo, sin exponer
cuentas de otros titulares.

### Flujo 3: errores de ruta de cuentas

```ts
// Contrato emitido por errorHandler para AppError y errores inesperados:
{ code: 'UNAUTHORIZED', message: 'Autenticación requerida' }
{ code: 'INTERNAL_ERROR', message: 'Error interno del servidor' }
```

El middleware `errorHandler` construye esas respuestas HTTP; los tests de
`GET /accounts` verifican el contrato existente para el error 401 y el 500. La
suite deja de fallar por esperar `{ error }`, sin cambiar el formato público
de errores de la API.

### Flujo 4: CORS en el entorno de deploy

```dotenv
# En el entorno de Render, con el origen real del frontend:
CORS_ORIGINS=https://<dominio-del-frontend>
```

El operador configura el origen exacto del frontend en Render;
`src/config/cors.ts` lo compara con `Origin` y permite las solicitudes del
navegador. Sin este valor, el frontend desplegado no podrá llamar a la API por
política CORS, así que es un paso urgente de integración. El hostname real se
introduce en el entorno y no se inventa ni versiona en el repositorio.

### Flujo 5: servicio Render conectado a Neon

```yaml
services:
  - type: web
    name: latin-zumi-back
    runtime: node
    buildCommand: npm ci && npm run build
    preDeployCommand: 'DATABASE_URL="$DATABASE_URL_UNPOOLED" npm run db:init'
    startCommand: npm start
    healthCheckPath: /health/ready
    envVars:
      - key: NODE_VERSION
        value: 24
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL
        sync: false
      - key: DATABASE_URL_UNPOOLED
        sync: false
      - key: CORS_ORIGINS
        sync: false
```

Render usa el Blueprint para compilar y arrancar el servidor, y consulta
`/health/ready` para validar readiness incluyendo PostgreSQL. El operador carga
`DATABASE_URL` con el connection string pooled de Neon para las consultas del
servidor y `sslmode=verify-full`; configura también `DATABASE_URL_UNPOOLED` con
el connection string directo para migraciones. El `preDeployCommand` debe
ejecutar `DATABASE_URL="$DATABASE_URL_UNPOOLED" npm run db:init`. `CORS_ORIGINS`
recibe el origen real del frontend. `sync: false` mantiene estos valores fuera
del YAML. Render permite `preDeployCommand` para migraciones solo
en planes pagos; en otro plan, `npm run db:init` debe ejecutarse con un paso
operativo disponible antes del release. Render establece `PORT` para el servicio
y la aplicación ya escucha en `env.PORT`.

Referencias: [Blueprints de Render](https://render.com/docs/blueprint-spec),
[comandos pre-deploy](https://render.com/docs/deploys), [variables y secretos
Render](https://render.com/docs/configure-environment-variables) y la
[guía de conexión PostgreSQL del repositorio](../../../../db/README.md).

## Archivos afectados
- `src/server.ts`
- `src/services/accounts.service.ts`
- `src/services/accounts.service.test.ts`
- `src/routes/accounts.route.test.ts`
- `src/config/swagger.ts`
- `.env.example` (si se necesita aclarar la configuración de CORS para deploy)
- `render.yaml`
- `README.md`
- `docs/specs/plataforma-y-documentacion/2026-10-28-minimo-funcional-backend.md`
- `docs/specs/index-specs.md`

## Pasos
1. Configurar `trust proxy` antes de registrar middleware y rutas.
2. Seleccionar `a.wallet_id`, incluirlo en el tipo `Account` y actualizar los
   datos esperados de los tests del servicio y de la ruta.
3. Cambiar las expectativas de error de los tests de ruta al formato
   `{ code, message }` que produce `errorHandler`.
4. Añadir `render.yaml` con Node 24, build/start, health check y migraciones
   pre-deploy usando la URL directa de Neon; declarar URLs y CORS como valores
   externos.
5. Aclarar en `.env.example` y `README.md` cómo cargar la URL pooled de Neon
   para consultas, la URL directa para migraciones y el origen exacto del
   frontend, sin añadir secretos ni un dominio supuesto.
6. Revisar build y suite de pruebas para comprobar el contrato y los flujos.
7. Configurar Neon y Render, aplicar migraciones según el plan y verificar
   health check, CORS y rate limit desde el entorno desplegado.

## Cómo probar
- [x] `npm run build` completa sin errores de tipos.
- [x] `npm run test:vit` pasa, incluidos los tests de ruta y servicio de
  `GET /accounts`.
- [x] Una respuesta autenticada de `GET /accounts` incluye `wallet_id` por
  cuenta y mantiene el aislamiento por titular.
- [x] La respuesta de errores conserva `{ code, message }` para 401 y 500.
- [ ] Detrás del proxy de Render, los intentos desde IP reenviadas distintas
  consumen contadores distintos y no producen `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`.
- [ ] El origen real del frontend está configurado en `CORS_ORIGINS` en Render
  y el navegador puede completar el preflight.

## Riesgos / notas
- `trust proxy = 1` asume exactamente un proxy confiable delante de Express.
  Si cambia la topología del deploy, debe revisarse este número para no confiar
  en encabezados controlables por el cliente.
- Añadir `wallet_id` extiende el JSON de `GET /accounts` de forma aditiva; no
  cambia sus filtros ni el envelope.
- El ajuste de tests adopta el contrato central vigente `{ code, message }`;
  no introduce una segunda forma de error.
- `preDeployCommand` de Render solo está disponible en planes pagos. El método
  de ejecutar migraciones debe corresponder al plan concreto y usar conexión
  directa; no se debe habilitar tráfico con el esquema pendiente.
- La aplicación usa el connection string pooled de Neon en `DATABASE_URL`;
  las migraciones necesitan el connection string directo en
  `DATABASE_URL_UNPOOLED`. Ambos se guardan como secretos en Render y usan
  `sslmode=verify-full`.
- `CORS_ORIGINS` requiere el dominio real del frontend y acceso a Render. La
  configuración externa es necesaria para la integración frontend-backend,
  aunque el valor no se escriba en el repositorio.
- Render y Neon son el destino previsto; la conectividad real se verifica al
  configurar y desplegar el servicio.
- La parte de frontend del plan de revisión no forma parte de este spec.
