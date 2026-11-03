# Latin Zumi · Backend

Backend de Latin Zumi, una API para consultar cuentas y saldos derivados de un
ledger contable inmutable. Está construido con Node.js, TypeScript, Express y
PostgreSQL.

## Estado actual

Actualmente el proyecto incluye:

- Persistencia PostgreSQL basada en un ledger contable append-only.
- Wallets con moneda preferida y cuentas de saldo por moneda.
- Registro de usuario, login, cambio de contraseña y logout con sesiones Bearer.
- Recuperación de contraseña con tokens de un solo uso y proveedor de email.
- Consultas autenticadas de cuentas, saldos y transacciones propias.
- Listado de cuentas e historial paginado de transacciones con filtros.
- Ingresos convertidos y retiros registrados de forma idempotente en el ledger.
- Health checks de proceso (`/health`) y readiness con PostgreSQL (`/health/ready`).
- Documentación interactiva OpenAPI/Swagger en `/api-docs`.
- Middleware centralizado para errores HTTP y de PostgreSQL.

La guía de PostgreSQL, migraciones y seeds está en [`db/README.md`](./db/README.md).
Para ejecutar el flujo de ingreso completo, usa la
[guía de prueba de extremo a extremo](./docs/guia-e2e-ingreso-convertido.md).
El estado histórico de endpoints está en la
[auditoría del proyecto](./docs/auditoria-estado-proyecto-y-deploy.md). La
configuración actual de despliegue en Render con PostgreSQL en Neon está en el
[spec 032](./docs/specs/plataforma-y-documentacion/2026-10-29-cierre-integracion-frontend-render.md).

## Stack

- Node.js con módulos ES.
- TypeScript en modo estricto.
- Express 5.
- PostgreSQL mediante `pg`.
- Zod para validar variables de entorno y UUIDs.
- Swagger UI Express para la documentación de la API.
- Vitest para pruebas.

## Requisitos

- Node.js y npm.
- PostgreSQL configurado según la [guía de base de datos](./db/README.md).

## Instalación y configuración

Instala las dependencias:

```sh
npm install
```

Copia `.env.example` como `.env`:

```sh
cp .env.example .env
```

La configuración de las variables de entorno, incluyendo la conexión a
PostgreSQL, está documentada en [`db/README.md`](./db/README.md). No subas el
archivo `.env` al repositorio.

Para Render con Neon, `DATABASE_URL` debe contener la URL pooled de la rama de
Neon para las consultas de la API y `DATABASE_URL_UNPOOLED` la URL directa para
`db:init`/migraciones. En Render ambas se cargan como secretos; el Blueprint
usa la directa durante el pre-deploy y la pooled al arrancar el servidor. Para
planes de Render sin `preDeployCommand`, ejecuta `npm run db:init` con la URL
directa antes de desplegar tráfico.

### CORS

Configura `CORS_ORIGINS` con los orígenes exactos del frontend, separados por
comas y sin rutas, por ejemplo `https://sitio-confirmado.example`. Para desarrollo
local, usa el origen del frontend en Vite:

```dotenv
CORS_ORIGINS=http://localhost:5173
```

El equipo debe completar el origen real de producción cuando esté confirmado;
no se incluye una URL de producción inventada. Una lista vacía no autoriza
orígenes web. Las solicitudes sin encabezado `Origin` continúan permitidas para
health checks y comunicación entre servidores.

El backend permite los métodos `GET` y `POST` y los encabezados
`Authorization`, `Content-Type` e `Idempotency-Key`, necesarios para la API, su
autenticación Bearer y los endpoints idempotentes de ingresos, retiros y
transferencias. No habilita credenciales de cookies. Un origen fuera de la lista
no recibe autorización CORS; CORS es una política del navegador, no reemplaza la
autenticación ni el control de acceso del servidor.

En producción, carga el origen exacto del frontend en la variable
`CORS_ORIGINS` del servicio Render. Sin este valor, el navegador bloqueará las
llamadas del frontend a la API desplegada. Si el frontend publica en Vercel con
un dominio propio o previews estables, agrega esos orígenes como entradas
separadas por coma. No se usa `*` y no se versionan los dominios reales.

## Ejecutar la aplicación

Para desarrollo, con recarga automática al guardar:

```sh
npm run dev
```

Para replicar producción, compila y ejecuta el JavaScript emitido:

```sh
npm run build
npm start
```

Con la configuración predeterminada, la API queda disponible en
`http://localhost:3000`.

### Health checks

- `GET /health`: responde `200` con `{ "status": "ok" }` si el proceso está vivo.
- `GET /health/ready`: ejecuta `SELECT 1` contra PostgreSQL y responde `200` con
  `{ "status": "ok", "db": "ok" }`; si la base no responde, devuelve `503`.

Para un deploy, usa `/health/ready` como health check si la plataforma debe
esperar también la disponibilidad de la base de datos.

## Servidor MCP

El backend expone un servidor MCP Streamable HTTP en `/mcp`, integrado en la
aplicación Express. El router delega en el handler del SDK la decisión final
sobre métodos HTTP: los mensajes MCP se envían mediante `POST`; en el modo sin
estado actual, `GET`, `DELETE` y los métodos no admitidos responden `405`. Cada
solicitud HTTP se autentica de nuevo y no se conserva una sesión MCP entre
solicitudes. El SDK y los tests usan la línea v2 2.4.0; los tests de ruta
incluyen una negociación explícita del protocolo `2025-11-25`.

El cliente debe enviar en cada solicitud el bearer de una sesión LATIN ZUMI
vigente en `Authorization`. La ruta usa `requireAuth` y valida la sesión
existente; sin una sesión válida responde `401`, y las sesiones bloqueadas por
cambio de contraseña responden `403`. No hay acceso anónimo, OAuth ni flujo de
intercambio de tokens. No coloques credenciales en URLs, argumentos MCP ni
logs.

Las únicas herramientas disponibles son `get_my_profile`,
`list_my_accounts`, `get_my_account_balance`, `list_my_wallet_activity` y
`get_my_transaction`. Todas consultan exclusivamente datos del usuario
autenticado, limitan los campos devueltos y son de solo lectura. El servidor no
ofrece tools de transferencias, depósitos, retiros, cambios de moneda ni
modificación del perfil.

La integración se delimita en [`src/mcp/auth.ts`](./src/mcp/auth.ts) mediante
`McpAuthProvider`. El adaptador incluido usa la sesión de LATIN ZUMI existente.
Si se conecta otra fuente interna de identidad, reemplaza ese proveedor con
middleware que valide la credencial en servidor y resuelva `userId` desde el
contexto autenticado; no aceptes `userId` del cliente. Si la autenticación no
puede producir una identidad, el acceso debe seguir fallando cerrado.

El servidor utiliza los paquetes oficiales MCP v2 `@modelcontextprotocol/server`
2.4.0 y `@modelcontextprotocol/node` 2.1.2. La dependencia de desarrollo
`@modelcontextprotocol/client` 2.4.0 permite verificar el protocolo en tests
sin conectarse a un cliente externo. Para ejecutar pruebas y build:

```sh
npm test
npm run build
```

Configura el cliente MCP para usar la URL de API seguida de `/mcp` y enviar el
bearer vigente como header de autorización en cada solicitud. El backend
rechaza `Origin` no permitido usando `CORS_ORIGINS`. La implementación no
configura ni almacena credenciales del cliente; la gestión de tokens y su
rotación quedan a cargo del operador.

El parser JSON global limita los cuerpos a **100 KB**; los cuerpos mayores
responden `413`. El endpoint permite **60 solicitudes por minuto por IP y por
proceso**, con contadores en memoria que no se comparten entre instancias. Si
se despliega más de una instancia, el límite no constituye una cuota global.

## Despliegue e integración

El backend está desplegado en Render con PostgreSQL en Neon. El Blueprint de
Render se encuentra en [`render.yaml`](./render.yaml) y define el servicio web
Node con `plan: free`, el health check `/health/ready`, el build que compila y
aplica las migraciones con `DATABASE_URL_UNPOOLED`, y el arranque con
`DATABASE_URL` (pooled).

En un plan gratuito, Render no soporta `preDeployCommand`, por lo que las
migraciones se ejecutan durante el `buildCommand`:

```yaml
buildCommand: 'npm ci --include=dev && npm run build && DATABASE_URL="$DATABASE_URL_UNPOOLED" npm run db:init'
# En un plan pago, mover la migración a preDeployCommand:
# preDeployCommand: 'DATABASE_URL="$DATABASE_URL_UNPOOLED" npm run db:init'
```

Si el servicio pasa a un plan pago, la migración puede moverse a `preDeployCommand`.

Variables de entorno para el servicio en Render (cargadas como secretos en el
dashboard, nunca en Git):

```dotenv
DATABASE_URL=postgresql://...-pooler.../neondb?sslmode=verify-full
DATABASE_URL_UNPOOLED=postgresql://.../neondb?sslmode=verify-full
CORS_ORIGINS=http://localhost:5173,https://<dominio-de-vercel>
DB_CONNECTION_TIMEOUT_MILLIS=10000
EMAIL_PROVIDER=resend
RESEND_API_KEY=<secret>
EMAIL_FROM=Latin Zumi <no-reply@latinzumi.com>
PASSWORD_RESET_URL=https://<dominio-del-front>/restablecer-contrasena
PASSWORD_RESET_TTL_MINUTES=30
```

Con `EMAIL_PROVIDER=resend` el servicio de recuperación envía los correos reales
por Resend; la API key es un secreto que se carga en el dashboard de Render. En
producción no se acepta el provider de consola, que responde `503
EMAIL_NOT_CONFIGURED`. El enlace de recuperación apunta al frontend
(`PASSWORD_RESET_URL`), no al backend.

Variables de build para el frontend en Vercel:

```dotenv
VITE_API_URL=https://<servicio>.onrender.com
VITE_USE_MOCK=false
```

Como Vite inyecta las variables en build, hay que hacer un redeploy del frontend
después de cambiarlas.

### Smoke test contra la API publicada

Con la URL pública del servicio (`https://<servicio>.onrender.com`), un email de
prueba y una contraseña larga:

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

El health check debe responder `200` con `{ "status": "ok", "db": "ok" }`; el
preflight debe responder `204` con `Access-Control-Allow-Origin` igual al origen
de Vercel; el login debe devolver `{ token, user }`; `/accounts` debe devolver
las cuentas con `wallet_id` y saldo, incluido `"0"`; el logout debe responder
`204`; y la segunda llamada a `/accounts` con el token revocado debe responder
`401`.

### Limitaciones del plan gratuito

- El plan gratuito de Render suspende el servicio tras 15 minutos sin tráfico; el
  primer request puede tardar cerca de un minuto, y el frontend debe reintentar o
  mostrar un mensaje de espera.
- El plan gratuito de Render puede suspender un servicio que genera mucho
  tráfico saliente hacia una base de datos externa; para una demo el volumen es
  bajo, pero Render + Neon gratuitos no son una configuración de producción.

## API

Los endpoints no comparten un único sobre de respuesta. Conviene que el cliente
lea el contrato de cada uno:

- `{ "data": ... }`: `GET /accounts` y `POST /chat/messages`.
- `{ "items": [...], "page", "limit", "total", "totalPages" }`:
  `GET /wallet/transactions`.
- Objeto plano, sin sobre: `POST /wallet/transfers`,
  `POST /wallet/deposits`, `GET /wallet/exchange/quote`,
  `POST /wallet/exchanges`, `GET /users/lookup` (`{ nombre }`),
  `PATCH /users/me` (`{ user }`), `POST /auth/register`, `POST /auth/login` y
  `POST /auth/google` (`{ token, user, password_change_required }`).
- `204`: `POST /auth/logout`, `POST /auth/change-password` y
  `POST /auth/reset-password`.

Los saldos y montos se serializan como texto para conservar la precisión
decimal de PostgreSQL.

### Asistente IA del backend

#### `POST /chat/messages`

El chatbot autenticado permite responder preguntas generales sobre LATIN ZUMI y orientar al usuario con el contexto seguro de sus cuentas y movimientos recientes. Requiere `Authorization: Bearer <token>`.

Request:

```json
{
  "message": "¿Cuánto dinero tengo disponible?",
  "conversationId": "d4d49d78-1e1d-4f1d-b678-d1f7a4fca5f6"
}
```

Response:

```json
{
  "data": {
    "message": "Te muestro el saldo disponible según tus cuentas activas.",
    "conversationId": "d4d49d78-1e1d-4f1d-b678-d1f7a4fca5f6",
    "suggestions": ["¿Qué cuentas tengo activas?", "¿Cuáles fueron mis últimos movimientos?"]
  }
}
```

El backend incluye el contexto de cuentas y movimientos del usuario autenticado con fines de asistencia, pero nunca inventa saldos ni modifica el ledger. Si falta información o la clave de Gemini no está configurada, responde con un error controlado `503`.

#### Variables de entorno del chatbot

- `GEMINI_API_KEY`: clave de Gemini del backend. Debe mantenerse en `.env` local o el gestor de secretos del deploy. No se registra en Git.
- `GEMINI_MODEL`: modelo a usar, por defecto `gemini-3.5-flash-lite`.

### Acceso con Google y perfil

`POST /auth/google` recibe un ID token de Firebase y devuelve una sesión con
el mismo contrato que el login por contraseña. Firebase debe confirmar el email
y el proveedor `google.com`. Si el usuario es nuevo, se crea con una wallet y
una cuenta inicial en USD; luego debe completar el perfil mediante
`PATCH /users/me`.

Para habilitar el acceso con Google, configura juntas en el backend
`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` y `FIREBASE_PRIVATE_KEY` usando
una cuenta de servicio de Firebase. La clave privada debe guardarse solo en el
gestor de secretos del entorno y usarse con saltos de línea escapados como
`\\n`. Si las tres variables quedan vacías, el endpoint responde
`503 GOOGLE_AUTH_UNAVAILABLE`; si solo algunas están definidas, la
configuración es inválida y el backend no inicia.
La vinculación de una cuenta existente se realiza por email solo después de
verificarlo con Google; al migrar a otro proyecto Firebase, el usuario puede
volver a vincularse por ese email verificado.

`PATCH /users/me` requiere una sesión Bearer y `pais`; `nombre` es opcional.
Actualiza la moneda preferida (wallet y usuario) al valor derivado del país,
sin renombrar cuentas con saldo.
Las cuentas solo-Google no tienen contraseña; `POST /auth/change-password`
responde `409 PASSWORD_NOT_SET`.

### Usuario y sesión

#### Registrar y abrir una sesión

`POST /auth/register` es el flujo nuevo. Crea el usuario, su wallet, la cuenta
inicial y una sesión; el país determina la moneda (`Argentina` → `ARS`,
`Colombia` → `COP`, `Otro` → `USD`). La contraseña debe tener entre 8 y 128
caracteres.

```sh
curl -i -X POST http://localhost:3000/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"nombre":"Ana Pérez","email":"ana@example.com","pais":"Argentina","password":"una-frase-de-acceso-larga"}'
```

Responde `201` con `{ token, user, password_change_required: false }`, listo
para usar el token como Bearer.
Los errores de validación, email duplicado y límite de intentos responden
`400`, `409` y `429`, respectivamente.

#### Iniciar sesión

`POST /auth/login`

```sh
curl -i -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"usuario.prueba","password":"una-frase-de-acceso-larga"}'
```

La respuesta `200` contiene `{ token, user, password_change_required }`. El
campo es `true` cuando la contraseña usada tiene menos de 8 caracteres; en ese
caso las rutas protegidas piden cambiarla antes de continuar:

```json
{
  "token": "<token-bearer>",
  "user": {
    "id": "20000000-0000-4000-8000-000000000001",
    "nombre": "usuario.prueba",
    "email": "usuario@example.com",
    "pais": null,
    "moneda_preferida": "COP",
    "roles": ["user"],
    "estado": "activo",
    "foto_url": null
  },
  "password_change_required": false
}
```

Usa el `token` devuelto como Bearer token en las rutas protegidas. Para
consultar cuentas usa `GET /accounts`:

```sh
curl -i http://localhost:3000/accounts \
  -H 'Authorization: Bearer <token>'
```

Las sesiones vencen en una hora. Si una cuenta existente inicia sesión con
una contraseña menor a 8 caracteres, el login responde `200` pero las rutas
protegidas responden `403` hasta que la actualice. El cambio acepta hasta 10
intentos por sesión y dirección IP cada 15 minutos; contraseña actual
incorrecta devuelve `401 INVALID_CURRENT_PASSWORD`, una contraseña nueva igual
a la actual devuelve `400 PASSWORD_UNCHANGED`, y una cuenta Google sin clave
devuelve `409 PASSWORD_NOT_SET`. Esta ruta y logout quedan exentas del `403`:

```sh
curl -i -X POST http://localhost:3000/auth/change-password \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"current_password":"clave-anterior","new_password":"clave-segura-8"}'
```

Para revocar la sesión actual:

```sh
curl -i -X POST http://localhost:3000/auth/logout \
  -H 'Authorization: Bearer <token>'
```

#### Recuperación de contraseña

`POST /auth/forgot-password` y `POST /auth/reset-password` cierran el ciclo de
recuperación sin exigir la contraseña actual:

- `POST /auth/forgot-password` recibe `{ email }` y responde `202` con un
  mensaje constante (no revela si el email está registrado). Si la cuenta
  existe, genera un token de un solo uso (hash SHA-256 en la base, vence a los
  30 minutos), lo guarda y envía el enlace al frontend.
- `POST /auth/reset-password` recibe `{ token, password }` y responde `204`.
  Consume el token una sola vez, actualiza el hash de la contraseña y revoca
  todas las sesiones del usuario.

```sh
curl -i -X POST http://localhost:3000/auth/forgot-password \
  -H 'Content-Type: application/json' \
  -d '{"email":"ana@example.com"}'
```

Respuesta `202`:

```json
{
  "message": "Si el email está registrado, te enviamos instrucciones para restablecer la contraseña."
}
```

```sh
curl -i -X POST http://localhost:3000/auth/reset-password \
  -H 'Content-Type: application/json' \
  -d '{"token":"<token-del-enlace>","password":"nueva-clave-segura-8"}'
```

Respuesta `204`. Con token vencido o ya usado responde `400` con
`INVALID_RESET_TOKEN`.

Variables de entorno relacionadas con el envío de correos:

- `EMAIL_PROVIDER`: `console` (desarrollo/test) o `resend` (producción). Con
  `EMAIL_PROVIDER=console` en producción el pedido responde `503
  EMAIL_NOT_CONFIGURED`.
- `RESEND_API_KEY`: requerida cuando `EMAIL_PROVIDER=resend`.
- `EMAIL_FROM`: remitente del correo (`Latin Zumi <no-reply@latinzumi.com>` por
  defecto).
- `PASSWORD_RESET_URL`: URL del frontend donde se construye el enlace
  (`http://localhost:5173/restablecer-contrasena` por defecto).
- `PASSWORD_RESET_TTL_MINUTES`: validez del token en minutos (rango 5–240, default
  `30`).

### Wallet e ingresos

#### Buscar destinatarios y transferir

`GET /users/lookup?email=...` requiere sesión y responde solo `{ nombre }`.
`POST /wallet/transfers` recibe `recipient_email`, `currency`, `amount` y una
`Idempotency-Key`; acredita al destinatario en la moneda de la transferencia.
Las wallets pueden tener cuentas por moneda. La respuesta incluye la transacción,
la cantidad recibida y los saldos actualizados del emisor.

```sh
curl -i -X POST http://localhost:3000/wallet/transfers \\
  -H 'Authorization: Bearer <token>' \\
  -H 'Idempotency-Key: transferencia-orden-123' \\
  -H 'Content-Type: application/json' \\
  -d '{"recipient_email":"mateo@example.com","currency":"USD","amount":"10.00","note":"Cena"}'
```

`GET /wallet/transactions` devuelve la actividad paginada del titular con
filtros `type`, `currency`, `from` y `to`. En transferencias cada participante
ve su propio importe y moneda. Los errores API usan `{ code, message }`.

#### Listar las cuentas

`GET /accounts`

Devuelve las cuentas activas de la wallet del usuario autenticado y sus saldos
por moneda. No requiere que el cliente conozca o conserve los IDs de las
cuentas; cada resultado incluye su `id` para las operaciones que lo necesiten.
Si el usuario no tiene cuentas activas, `data` es un arreglo vacío.

```sh
curl -i http://localhost:3000/accounts \
  -H 'Authorization: Bearer <token>'
```

```json
{
  "data": [
    {
      "id": "10000000-0000-4000-8000-000000000001",
      "user_id": "20000000-0000-4000-8000-000000000001",
      "wallet_id": "40000000-0000-4000-8000-000000000001",
      "currency": "USD",
      "account_type": "user",
      "allow_negative": false,
      "balance": "325.00000000"
    }
  ]
}
```

#### Depósitos y cambios de moneda

El front llama a tres endpoints nuevos del wallet:

- `POST /wallet/deposits` registra un depósito en la moneda enviada por el
  usuario autenticado. No hay pasarela: se acredita contra la cuenta interna
  `external`. Requiere `Idempotency-Key`.
- `GET /wallet/exchange/quote?from=...&to=...&amount=...` fija la tasa de
  cambio entre dos monedas distintas por 60 segundos y devuelve el importe
  convertido con redondeo `HALF_UP`.
- `POST /wallet/exchanges` ejecuta un cambio con una cotización: debita la
  moneda de origen, acredita la convertida en la moneda destino (creando la
  cuenta destino si no existía) y consume la cotización.

Las cotizaciones usan ExchangeRate-API como fuente principal y el feed diario
USD de fawazahmed0 como fallback (jsDelivr y luego pages.dev). El JSON fallback
se conserva en memoria durante 6 horas por proceso de forma predeterminada;
`EXCHANGE_RATE_FALLBACK_CACHE_TTL_HOURS` permite configurarlo entre 1 y 6. El
timeout de cada proveedor se controla con `EXCHANGE_RATE_TIMEOUT_MS`.

```sh
curl -i -X POST http://localhost:3000/wallet/deposits \
  -H 'Authorization: Bearer <token>' \
  -H 'Idempotency-Key: deposito-orden-123' \
  -H 'Content-Type: application/json' \
  -d '{"currency":"USD","amount":"100.00"}'
```

```json
{
  "transaction": {
    "id": "30000000-0000-4000-8000-000000000301",
    "type": "deposit",
    "status": "completed",
    "currency": "USD",
    "amount": "100.00",
    "created_at": "2026-10-29T15:10:00.000Z",
    "description": "Ingreso USD",
    "counterparty": null,
    "exchange": null
  },
  "source": { "currency": "USD", "amount": "100.00", "rate": "1" },
  "balances": [
    {
      "id": "10000000-0000-4000-8000-000000000005",
      "user_id": "20000000-0000-4000-8000-000000000001",
      "wallet_id": "50000000-0000-4000-8000-000000000001",
      "currency": "USD",
      "account_type": "user",
      "allow_negative": false,
      "balance": "100.00000000"
    }
  ]
}
```

El error `INVALID_AMOUNT` cubre importes no numéricos, con más de dos decimales
o no mayores a cero; `SAME_CURRENCY` para cambios entre monedas iguales;
`INVALID_IDEMPOTENCY_KEY` para claves mal formadas; `QUOTE_NOT_FOUND`,
`WALLET_NOT_FOUND`, `QUOTE_ALREADY_USED`, `QUOTE_EXPIRED`,
`IDEMPOTENCY_CONFLICT`, `INSUFFICIENT_FUNDS`, `AMOUNT_TOO_SMALL`,
`AMOUNT_TOO_LARGE` y `CONVERSION_UNAVAILABLE` completan el ciclo de errores.
Los depósitos son de prueba: no hay pasarela ni confirmación bancaria.

### Swagger

Con el servidor iniciado, abre [`http://localhost:3000/api-docs`](http://localhost:3000/api-docs)
para consultar y probar los endpoints documentados.

## Arquitectura

```text
src/
├── config/       configuración de entorno, PostgreSQL y OpenAPI
├── controllers/  validación de parámetros y respuestas HTTP
├── handlers/     adaptadores para handlers asíncronos
├── middleware/   autenticación, rate limiting y manejo de errores
├── routes/       definición y conexión de rutas
├── services/     consultas SQL parametrizadas, ledger y tasas externas
└── utils/        errores, decimales y contraseñas
```

El flujo de una consulta es:

```text
route → asyncHandler/requireAuth → controller → service → PostgreSQL
```

Las rutas no contienen SQL y los controllers no acceden directamente al pool
de PostgreSQL.

## Rutas retiradas

Las siguientes operaciones marcadas como obsoletas en el contrato anterior se
retiraron porque el frontend actual no las consume:

| Ruta retirada | Reemplazo vigente |
| --- | --- |
| `POST /users` | `POST /auth/register` |
| `GET /transactions`, `GET /transactions/:id` | `GET /wallet/transactions` para la actividad; el detalle interno sigue disponible para MCP. |
| `POST /accounts/:id/incoming` | `POST /wallet/deposits` |
| `GET /accounts/:id`, `GET /accounts/:id/balance` | `GET /accounts` |
| `POST /accounts/:id/withdraw` | Sin reemplazo público. |
