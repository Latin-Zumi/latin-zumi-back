# Spec: Cierre de la integración frontend-backend en Render

## Fecha
2026-10-29

## Orden de ejecución: 032

## Problema

El informe del frontend [`docs/9j3sbfdn.md`](../../9j3sbfdn.md) confirma que el
contrato mínimo ya está implementado en el navegador: login con
`{ identifier, password }`, sesión `{ token, user }`, saldos desde
`GET /accounts`, logout contra `POST /auth/logout` y mensajes derivados del
status HTTP. El único ítem pendiente de ese informe es la prueba real contra el
backend desplegado.

Al revisar este repositorio, el contrato principal ya coincide, pero quedan
bloqueos de integración y despliegue:

1. `render.yaml` usa `preDeployCommand`, disponible solo en servicios pagos.
   El plan previsto para esta integración es el gratuito, así que las
   migraciones no se ejecutarían y la API arrancaría sin el esquema esperado.
2. El Blueprint no declara `plan: free`; Render usaría por defecto un plan pago
   (`0.5c-512mb`).
3. `CORS_ORIGINS` viene vacío en `.env.example` y no hay un valor local de
   ejemplo. El navegador en `http://localhost:5173` y el frontend de Vercel
   quedan bloqueados hasta configurarlo a mano.
4. CORS no permite el encabezado `Idempotency-Key`. Los endpoints de depósitos,
   retiros y transferencias ya existen en el backend y lo requieren; si el
   frontend vuelve a habilitarlos, el preflight del navegador fallará.
5. `GET /accounts/:id/balance` devuelve `account_id`, `currency` y `balance`,
   pero no `wallet_id`. El informe del frontend indica que su tipo `Balance`
   ahora incluye `account_id` y `wallet_id`.
6. La documentación de `GET /accounts` y `GET /accounts/:id` no muestra
   `wallet_id`, aunque la API ya lo devuelve desde el spec 031.
7. El timeout de conexión a PostgreSQL es de 2 s. Neon puede tardar más en
   despertar desde cero, sobre todo en el primer request o en el health check.
8. Falta un checklist reproducible de smoke test contra la URL pública:
   health check, CORS, registro, login, saldos y logout.

## Solución propuesta

1. Convertir `render.yaml` en un Blueprint compatible con el plan gratuito:
   declarar `plan: free`, ejecutar las migraciones durante el build con la URL
   directa de Neon y dejar comentada la variante con `preDeployCommand` para
   cuando el servicio pase a un plan pago.
2. Aumentar el timeout de conexión a PostgreSQL en Render a 10 s para tolerar
   el arranque en frío de Neon.
3. Permitir `Idempotency-Key` en CORS y dejar documentados los orígenes exactos
   de desarrollo y producción. No se usa `*` ni se inventan dominios.
4. Añadir `wallet_id` a la respuesta de `GET /accounts/:id/balance` de forma
   aditiva, junto con Swagger, README y tests.
5. Actualizar `.env.example` y `README.md` con el valor local de CORS, los
   ejemplos completos de cuentas y una sección de despliegue e integración.
6. Documentar el smoke test y dejar sin marcar los pasos que dependen de la
   cuenta de Render, Neon y Vercel.

Este spec no implementa Google Auth ni vuelve a habilitar depósitos,
transferencias o cambios de moneda en el frontend. El backend ya expone esos
flujos (specs 029 y 030), pero el frontend los mantiene ocultos con
`TRANSACTIONS_ENABLED`; habilitarlos requiere una verificación de contrato
aparte.

### Flujo 1: Blueprint de Render para plan gratuito

```yaml
services:
  - type: web
    name: latin-zumi-back
    runtime: node
    plan: free
    region: oregon
    buildCommand: 'npm ci --include=dev && npm run build && DATABASE_URL="$DATABASE_URL_UNPOOLED" npm run db:init'
    # En un plan pago, mover la migración a preDeployCommand:
    # preDeployCommand: 'DATABASE_URL="$DATABASE_URL_UNPOOLED" npm run db:init'
    startCommand: npm start
    healthCheckPath: /health/ready
    autoDeployTrigger: commit
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
      - key: DB_CONNECTION_TIMEOUT_MILLIS
        value: 10000
```

Render ejecuta el `buildCommand` en cada deploy. El operador carga
`DATABASE_URL_UNPOOLED` con la URL directa de Neon y el comando la usa solo para
`db:init`; la aplicación arranca después con `DATABASE_URL`, que apunta al
pooler. `--include=dev` garantiza que `typescript` esté disponible aunque
`NODE_ENV=production`. Si una migración falla, el build falla y Render mantiene
la versión anterior. `sync: false` evita versionar secretos. En un plan pago se
puede mover la migración a `preDeployCommand` y quitar el `db:init` del build.

### Flujo 2: CORS para desarrollo local y Vercel

```ts
const options: CorsOptions = {
  origin(origin, callback) {
    callback(null, origin === undefined || allowedOrigins.has(origin));
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
  credentials: false,
};
```

`src/config/cors.ts` construye el middleware que Express aplica antes de las
rutas. El navegador envía el `Origin` real; el middleware solo lo autoriza si
coincide exactamente con un valor de `CORS_ORIGINS`. Añadir
`Idempotency-Key` permite el preflight de los endpoints que ya lo exigen
(`/accounts/:id/incoming`, `/accounts/:id/withdraw` y `/wallet/transfers`).
Sin encabezado `Origin` la solicitud sigue permitida para health checks y
clientes servidor-a-servidor.

```dotenv
# .env local del backend
CORS_ORIGINS=http://localhost:5173

# Variable del servicio en Render
CORS_ORIGINS=http://localhost:5173,https://<dominio-de-vercel>
```

El desarrollador carga el primer valor en su `.env` para probar el frontend
local. El operador carga el segundo en Render para autorizar el frontend
publicado; si Vercel usa un dominio propio o previews estables, se agregan como
orígenes separados por coma. No se usa `*` y no se versiona el dominio real.

### Flujo 3: saldo con `wallet_id`

```ts
export interface AccountBalance {
  account_id: string;
  wallet_id: string;
  currency: string;
  balance: string;
}

export async function getBalanceByAccountId(
  accountId: string,
  userId: string,
): Promise<AccountBalance | null> {
  const account = await getAccountById(accountId, userId);
  if (!account) return null;

  return {
    account_id: account.id,
    wallet_id: account.wallet_id,
    currency: account.currency,
    balance: account.balance,
  };
}
```

El servicio consulta la cuenta con el `userId` de la sesión y solo devuelve el
saldo si la cuenta pertenece al titular. El controlador responde `{ data }` y
el frontend recibe el `wallet_id` que su tipo `Balance` espera, además del
`account_id`, la moneda y el saldo serializado como texto. Es un cambio
aditivo: no altera filtros, permisos ni el formato de error.

```json
{
  "data": {
    "account_id": "10000000-0000-4000-8000-000000000001",
    "wallet_id": "40000000-0000-4000-8000-000000000001",
    "currency": "USD",
    "balance": "325.00000000"
  }
}
```

### Flujo 4: contrato que el frontend ya consume

```json
{
  "token": "<token-bearer>",
  "user": {
    "id": "20000000-0000-4000-8000-000000000001",
    "nombre": "Ana Pérez",
    "email": "ana@example.com",
    "pais": "Argentina",
    "moneda_preferida": "ARS",
    "roles": ["user"],
    "estado": "activo",
    "foto_url": null
  }
}
```

El controlador de login devuelve `{ token, user }` con IDs string (UUID). El
frontend valida ese envelope antes de guardar la sesión. Los errores relevantes
se mantienen así:

| Status | Cuándo ocurre | Efecto en el frontend |
| ---: | --- | --- |
| `400` | Payload inválido o contraseña fuera de 15–128 al registrar | Muestra el mensaje de validación. |
| `401` | Credenciales incorrectas o sesión ausente/vencida | Cierra la sesión y vuelve a `/login`. |
| `403` | La cuenta debe actualizar una contraseña heredada | Muestra el mensaje sin cerrar la sesión. |
| `409` | Email ya registrado | Muestra el mensaje de cuenta existente. |
| `429` | Rate limit de login o registro | Muestra el mensaje de demasiados intentos. |
| `5xx` / red | Backend caído o error interno | Muestra error de conexión o error genérico. |

`GET /accounts` conserva el envelope `{ data }`, incluye `wallet_id` y devuelve
`balance: "0"` cuando la cuenta no tiene movimientos. `POST /auth/logout`
responde `204` y revoca la sesión; el frontend borra su sesión local aunque la
red falle.

### Flujo 5: variables de entorno de integración

```dotenv
# Render: secretos cargados en el dashboard, nunca en Git
DATABASE_URL=postgresql://...-pooler.../neondb?sslmode=verify-full
DATABASE_URL_UNPOOLED=postgresql://.../neondb?sslmode=verify-full
CORS_ORIGINS=http://localhost:5173,https://<dominio-de-vercel>
DB_CONNECTION_TIMEOUT_MILLIS=10000
```

```dotenv
# Vercel: variables de build del frontend
VITE_API_URL=https://<servicio>.onrender.com
VITE_USE_MOCK=false
```

El operador carga las dos primeras variables en Render como secretos. La URL
pooled se usa en tiempo de ejecución y la directa solo en el build para migrar.
En Vercel, `VITE_API_URL` debe apuntar a la URL pública del backend sin barra
final y `VITE_USE_MOCK=false`; como Vite inyecta estas variables en build, hay
que hacer un redeploy después de cambiarlas.

### Flujo 6: smoke test contra la API publicada

```sh
API="https://<servicio>.onrender.com"
EMAIL="prueba-$(date +%s)@example.com"
PASSWORD="una-frase-de-acceso-larga"

curl -i "$API/health/ready"
curl -i -X OPTIONS "$API/auth/login" \
  -H "Origin: https://<dominio-de-vercel>" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type,idempotency-key"

curl -i -X POST "$API/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"nombre\":\"Ana Pérez\",\"email\":\"$EMAIL\",\"pais\":\"Argentina\",\"password\":\"$PASSWORD\"}"

TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"identifier\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).token')

curl -i "$API/accounts" -H "Authorization: Bearer $TOKEN"
curl -i -X POST "$API/auth/logout" -H "Authorization: Bearer $TOKEN"
curl -i "$API/accounts" -H "Authorization: Bearer $TOKEN"
```

El operador ejecuta estos comandos desde su máquina. `/health/ready` debe
responder `200` con `{ status: "ok", db: "ok" }`; el preflight debe responder
`204` con `Access-Control-Allow-Origin` igual al origen de Vercel; el login
debe devolver `{ token, user }`; `/accounts` debe devolver las cuentas con
`wallet_id` y saldo, incluido `"0"`; el logout debe responder `204`; y la
segunda llamada a `/accounts` con el token revocado debe responder `401`.

## Archivos afectados

- `render.yaml`
- `src/config/cors.ts`
- `src/config/cors.test.ts`
- `src/services/accounts.service.ts`
- `src/services/accounts.service.test.ts`
- `src/config/swagger.ts`
- `.env.example`
- `README.md`
- `docs/specs/plataforma-y-documentacion/2026-10-29-cierre-integracion-frontend-render.md`
- `docs/specs/index-specs.md`

## Pasos

1. Actualizar `render.yaml` con `plan: free`, migraciones en el build, timeout
   de 10 s y la variante comentada para planes pagos.
2. Agregar `Idempotency-Key` a los encabezados permitidos por CORS y cubrirlo
   en `cors.test.ts`.
3. Añadir `wallet_id` a `AccountBalance`, al servicio, a Swagger y a un test
   del servicio.
4. Actualizar los ejemplos de `GET /accounts`, `GET /accounts/:id` y
   `GET /accounts/:id/balance` en `README.md`.
5. Actualizar `.env.example` con el origen local de ejemplo y las instrucciones
   de Render/Vercel.
6. Añadir al README la sección de despliegue e integración con el smoke test y
   las limitaciones del plan gratuito.
7. Ejecutar `npm run build` y `npm run test:vit`.
8. Desplegar desde Render, cargar secretos, aplicar migraciones y ejecutar el
   smoke test contra la URL pública.
9. Configurar Vercel y hacer redeploy del frontend.

## Cómo probar

- [x] `npm run build` completa sin errores de tipos.
- [x] `npm run test:vit` pasa, incluidos CORS y el saldo con `wallet_id`.
- [ ] El preflight local desde `http://localhost:5173` responde `204` y
      permite `Authorization`, `Content-Type` e `Idempotency-Key`.
- [x] `GET /accounts/:id/balance` devuelve `wallet_id` sin romper el envelope
      `{ data }`.
- [ ] El Blueprint de Render valida y despliega en el plan gratuito; el build
      aplica `db:init` con `DATABASE_URL_UNPOOLED`.
- [ ] `GET /health/ready` de la URL pública responde `200` con
      `{ status: "ok", db: "ok" }`.
- [ ] El origen de Vercel está en `CORS_ORIGINS` y el navegador completa el
      preflight.
- [ ] Registro, login, consulta de saldos y logout funcionan contra la API
      real; el token revocado responde `401`.
- [ ] Una cuenta sin movimientos muestra `balance: "0"` en `GET /accounts`.
- [ ] El frontend desplegado usa `VITE_USE_MOCK=false` y
      `VITE_API_URL=https://<servicio>.onrender.com`.

## Riesgos / notas

- `preDeployCommand` solo existe en planes pagos. La solución gratuita ejecuta
  la migración en el build; es idempotente y transaccional, pero corre en cada
  deploy. Si el equipo pasa a un plan pago, moverla a `preDeployCommand`.
- Las migraciones en build necesitan `DATABASE_URL_UNPOOLED`; si falta, el
  build falla antes de publicar una versión sin esquema. No se debe ejecutar
  tráfico contra una base sin migrar.
- El plan gratuito de Render suspende el servicio tras 15 minutos sin tráfico.
  El primer request puede tardar cerca de un minuto; el frontend debe reintentar
  o mostrar un mensaje de espera. Neon también puede tardar en despertar.
- El plan gratuito de Render puede suspender un servicio que genera mucho
  tráfico saliente hacia una base externa. Para una demo el volumen es bajo,
  pero Render + Neon gratuitos no son una configuración de producción.
- `CORS_ORIGINS` exige orígenes exactos. No se admite `*`, rutas ni comodines de
  subdominios. Los previews de Vercel con URL dinámica necesitan agregarse uno a
  uno o usar un alias estable.
- `Idempotency-Key` y `wallet_id` son cambios aditivos; no modifican el contrato
  existente ni los permisos por titular.
- Los endpoints de depósitos, retiros, transferencias y cambio de moneda ya
  existen en el backend, pero el frontend los mantiene ocultos con
  `TRANSACTIONS_ENABLED`. Volver a habilitarlos es un cambio posterior que debe
  verificar el contrato y los flags del frontend.
- Google Auth sigue deshabilitado en el frontend (`GOOGLE_AUTH_ENABLED=false`);
  el backend no expone `/auth/google` en este repositorio. No forma parte de
  este cierre.
- Los secretos y dominios reales se cargan en Render y Vercel; no se versionan.
- El informe `docs/9j3sbfdn.md` es la entrada del frontend, no un spec de este
  repositorio; se conserva como referencia.
