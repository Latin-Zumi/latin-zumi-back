# Latin Zumi · Backend

Backend de Latin Zumi, una API para consultar cuentas y saldos derivados de un
ledger contable inmutable. Está construido con Node.js, TypeScript, Express y
PostgreSQL.

## Estado actual

Actualmente el proyecto incluye:

- Persistencia PostgreSQL basada en un ledger contable append-only.
- Wallets con una moneda principal y cuentas de saldo por moneda.
- Registro de usuario, login, cambio de contraseña y logout con sesiones Bearer.
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
[spec 031](./docs/specs/plataforma-y-documentacion/2026-10-28-minimo-funcional-backend.md).

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
comas y sin rutas, por ejemplo `https://sitio-confirmado.example`. El equipo
debe completar el origen real de producción cuando esté confirmado; no se
incluye una URL de producción inventada. Una lista vacía no autoriza orígenes
web. Las solicitudes sin encabezado `Origin` continúan permitidas para health
checks y comunicación entre servidores.

El backend permite los métodos `GET` y `POST` y los encabezados
`Authorization` y `Content-Type`, necesarios para la API y su autenticación
Bearer. No habilita credenciales de cookies. Un origen fuera de la lista no
recibe autorización CORS; CORS es una política del navegador, no reemplaza la
autenticación ni el control de acceso del servidor.

En producción, carga el origen exacto del frontend en la variable
`CORS_ORIGINS` del servicio Render. Sin este valor, el navegador bloqueará las
llamadas del frontend a la API desplegada.

## Ejecutar la aplicación

Compila el proyecto y levanta el servidor:

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

## API

La mayoría de las respuestas exitosas usan el formato `{ "data": ... }`. El
historial paginado devuelve `{ "data": [...], "meta": {...} }` y los endpoints
de logout/cambio de contraseña responden `204`. Los saldos se serializan como
texto para conservar la precisión decimal de PostgreSQL.

### Usuario y sesión

#### Registrar y abrir una sesión

`POST /auth/register` es el flujo nuevo. Crea el usuario, su wallet, la cuenta
inicial y una sesión; el país determina la moneda (`Argentina` → `ARS`,
`Colombia` → `COP`, `Otro` → `USD`). La contraseña debe tener entre 15 y 128
caracteres.

```sh
curl -i -X POST http://localhost:3000/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"nombre":"Ana Pérez","email":"ana@example.com","pais":"Argentina","password":"una-frase-de-acceso-larga"}'
```

Responde `201` con `{ token, user }`, listo para usar el token como Bearer.
Los errores de validación, email duplicado y límite de intentos responden
`400`, `409` y `429`, respectivamente.

#### Registrar usuario y billetera (legado)

`POST /users` está obsoleto; se conserva para clientes existentes y no crea
una sesión. Para nuevas integraciones usa `POST /auth/register`.

Registra un username y email, almacena un hash de la contraseña y crea una
wallet lógica y su cuenta inicial en la moneda principal. La contraseña debe
tener entre 15 y 128 caracteres; `currency` es opcional, acepta `USD`, `COP`,
`ARS` o `EUR` y usa `COP` por defecto.

```sh
curl -X POST http://localhost:3000/users \
  -H 'Content-Type: application/json' \
  -d '{"username":"usuario.prueba","email":"usuario@example.com","password":"una-frase-de-acceso-larga","currency":"COP"}'
```

La respuesta `201` contiene los datos públicos del usuario y la cuenta creada.
No incluye la contraseña ni su hash. La cuenta inicia con saldo `"0"`. Luego
inicia sesión para obtener un token y consultar datos privados.

#### Iniciar sesión

`POST /auth/login`

```sh
curl -i -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"usuario.prueba","password":"una-frase-de-acceso-larga"}'
```

La respuesta `200` tiene el envelope `{ token, user }`:

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
  }
}
```

Usa el `token` devuelto como Bearer token en las rutas de cuenta, saldo y
transacciones:

```sh
curl -i http://localhost:3000/accounts/10000000-0000-4000-8000-000000000001 \
  -H 'Authorization: Bearer <token>'
```

Las sesiones vencen en una hora. Si una cuenta existente inicia sesión con
una contraseña menor a 15 caracteres, el login responde `200` pero las rutas
protegidas responden `403` hasta que la actualice:

```sh
curl -i -X POST http://localhost:3000/auth/change-password \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"current_password":"clave-anterior","new_password":"una-frase-de-acceso-de-quince-o-mas"}'
```

Para revocar la sesión actual:

```sh
curl -i -X POST http://localhost:3000/auth/logout \
  -H 'Authorization: Bearer <token>'
```

### Wallet e ingresos

#### Buscar destinatarios y transferir

`GET /users/lookup?email=...` requiere sesión y responde solo `{ nombre }`.
`POST /wallet/transfers` recibe `recipient_email`, `currency`, `amount` y una
`Idempotency-Key`; acredita al destinatario en la moneda principal de su wallet
y, si hace falta, registra la conversión. La respuesta incluye la transacción,
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
      "currency": "USD",
      "account_type": "user",
      "allow_negative": false,
      "balance": "325.00000000"
    }
  ]
}
```

#### Consultar una cuenta

`GET /accounts/:id`

Devuelve los datos de la cuenta y su saldo. El `id` debe ser un UUID válido.

```sh
curl -i http://localhost:3000/accounts/10000000-0000-4000-8000-000000000001 \
  -H 'Authorization: Bearer <token>'
```

```json
{
  "data": {
    "id": "10000000-0000-4000-8000-000000000001",
    "user_id": "20000000-0000-4000-8000-000000000001",
    "currency": "USD",
    "account_type": "user",
    "allow_negative": false,
    "balance": "325.00000000"
  }
}
```

#### Consultar el saldo

`GET /accounts/:id/balance`

Devuelve únicamente el saldo y la moneda de una cuenta:

```sh
curl -i http://localhost:3000/accounts/10000000-0000-4000-8000-000000000001/balance \
  -H 'Authorization: Bearer <token>'
```

```json
{
  "data": {
    "account_id": "10000000-0000-4000-8000-000000000001",
    "currency": "USD",
    "balance": "325.00000000"
  }
}
```

#### Registrar un ingreso convertido

`POST /accounts/:id/incoming` requiere una sesión Bearer y una clave
`Idempotency-Key` entregada por el sistema que confirmó el ingreso. El importe
se acredita en la moneda principal de la wallet. `destination_currency` es
opcional y, si se envía, debe coincidir con esa moneda.

```sh
curl -X POST http://localhost:3000/accounts/10000000-0000-4000-8000-000000000001/incoming \
  -H 'Authorization: Bearer <token>' \
  -H 'Idempotency-Key: ingreso-externo-123' \
  -H 'Content-Type: application/json' \
  -d '{"source_currency":"EUR","source_amount":"100.00"}'
```

La respuesta informa importes y monedas, tasa, proveedor y fecha de observación.
No se cobra comisión; el importe acreditado se redondea `HALF_UP` a 2
decimales. Una repetición idéntica devuelve el resultado original; reutilizar
la clave con otro ingreso responde `409`. Si ambos proveedores fallan o la tasa
supera las 24 horas, responde `503` sin crear entries. Las tasas son referencias
indicativas, no precios bancarios garantizados. ExchangeRate-API Open Access
requiere atribución; consulta sus [condiciones](https://www.exchangerate-api.com/terms).

Para probar el flujo completo, desde registro hasta verificar las entries del
ledger, sigue la [guía de prueba de extremo a extremo](./docs/guia-e2e-ingreso-convertido.md).

Errores relevantes: `400` para payload o UUID inválido, `401` sin una sesión
válida, `403` si una contraseña legada debe actualizarse, `404` si la cuenta
no existe o no pertenece al usuario, `409` si se reutiliza una clave con otra
solicitud, `422` si el importe convertido redondea a cero y `503` si no hay
una tasa vigente. Los errores internos no controlados responden `500`.

#### Registrar un retiro

`POST /accounts/:id/withdraw` requiere sesión Bearer y una clave
`Idempotency-Key`. Debita la cuenta indicada y registra el contrapeso en una
cuenta interna `external`; no ejecuta un desembolso bancario real.

```sh
curl -X POST http://localhost:3000/accounts/10000000-0000-4000-8000-000000000001/withdraw \
  -H 'Authorization: Bearer <token>' \
  -H 'Idempotency-Key: retiro-123' \
  -H 'Content-Type: application/json' \
  -d '{"amount":"50.00"}'
```

La respuesta incluye `transaction_id`, `account_id` y el importe retirado. Si el
saldo es insuficiente responde `422` sin crear la transacción. Repetir la misma
clave con el mismo importe devuelve el resultado original; reutilizarla con otro
importe u otra operación responde `409`. El retiro queda serializado por wallet
para evitar saldos negativos con solicitudes concurrentes.

### Actividad del ledger

#### Listar transacciones

`GET /transactions`

Devuelve el historial paginado de transacciones con asientos en cuentas activas
del usuario autenticado. Parámetros opcionales:

| Parámetro | Descripción |
| --- | --- |
| `page` | Página solicitada; default `1`. |
| `limit` | Resultados por página; default `20`, máximo `100`. |
| `account_id` | UUID de una cuenta propia para filtrar sus movimientos. |
| `from` | Fecha/hora ISO 8601 mínima (`occurred_at >= from`). |
| `to` | Fecha/hora ISO 8601 máxima (`occurred_at <= to`). |

```sh
curl -i 'http://localhost:3000/transactions?page=1&limit=20' \
  -H 'Authorization: Bearer <token>'
```

La respuesta usa `{ "data": [...], "meta": {...} }` directamente, sin el sobre
`data` adicional:

```json
{
  "data": [
    {
      "id": "30000000-0000-4000-8000-000000000101",
      "description": "Movimiento demo USD 1",
      "occurred_at": "2026-02-01T12:00:00.000Z",
      "entries": [
        {
          "id": "2",
          "account_id": "10000000-0000-4000-8000-000000000001",
          "amount": "125.00000000",
          "direction": "credit",
          "currency": "USD",
          "created_at": "2026-02-01T12:00:00.000Z"
        }
      ]
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

Solo se incluyen asientos de cuentas activas del titular. Una cuenta ajena,
inexistente o cerrada responde `404`; filtros inválidos responden `400`.
Actualmente la respuesta también incluye `idempotency_key`, aunque el spec de
autenticación prevé retirarla de la representación pública.

#### Consultar una transacción

`GET /transactions/:id`

Devuelve solo los asientos asociados a las cuentas del usuario autenticado:

```sh
curl -i http://localhost:3000/transactions/30000000-0000-4000-8000-000000000101 \
  -H 'Authorization: Bearer <token>'
```

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
de PostgreSQL. Las rutas específicas `/accounts/:id/balance`,
`/accounts/:id/incoming` y `/accounts/:id/withdraw` se registran antes de
`/accounts/:id`.

## Pruebas y validación

```sh
npm run build
npm run test:vit
```

`npm run test:vit` ejecuta la suite completa con Vitest. `npm test` solo ejecuta
la prueba básica de `AppError` mediante `node --test`.

La validación manual de integración con PostgreSQL está descrita en la
[guía de extremo a extremo](./docs/guia-e2e-ingreso-convertido.md).

## Documentación del proyecto

- [`docs/guia-e2e-ingreso-convertido.md`](./docs/guia-e2e-ingreso-convertido.md): registro, login, ingreso, idempotencia y verificación del ledger.
- [`db/README.md`](./db/README.md): PostgreSQL, migraciones y seeds.
- [`docs/specs/README.md`](./docs/specs/README.md): guía y reglas para crear specs.
- [`docs/specs/ledger-y-transacciones/2026-10-21-ledger-append-only.md`](./docs/specs/ledger-y-transacciones/2026-10-21-ledger-append-only.md): diseño del ledger inmutable.
- [`docs/specs/ledger-y-transacciones/2026-10-23-seeds-db.md`](./docs/specs/ledger-y-transacciones/2026-10-23-seeds-db.md): datos de demostración e idempotencia.
- [`docs/specs/ledger-y-transacciones/2026-10-24-ledger-balance-route.md`](./docs/specs/ledger-y-transacciones/2026-10-24-ledger-balance-route.md): endpoint de consulta de saldo.
- [`docs/specs/cuentas-y-wallet/2026-10-24-accounts-endpoints.md`](./docs/specs/cuentas-y-wallet/2026-10-24-accounts-endpoints.md): endpoints de consulta de cuentas y separación por capas.
- [`docs/specs/plataforma-y-documentacion/2026-10-24-swagger-api-docs.md`](./docs/specs/plataforma-y-documentacion/2026-10-24-swagger-api-docs.md): documentación OpenAPI.
- [`docs/specs/cuentas-y-wallet/2026-10-24-swagger-account-examples.md`](./docs/specs/cuentas-y-wallet/2026-10-24-swagger-account-examples.md): ejemplos demo usados en Swagger.
- [`docs/specs/autenticacion/2026-10-26-autenticacion-y-acceso-por-titular.md`](./docs/specs/autenticacion/2026-10-26-autenticacion-y-acceso-por-titular.md): autenticación y autorización por titular.
- [`docs/specs/ledger-y-transacciones/2026-10-26-transactions-historial-paginado.md`](./docs/specs/ledger-y-transacciones/2026-10-26-transactions-historial-paginado.md): historial paginado y filtros.
- [`docs/specs/cuentas-y-wallet/2026-10-26-retiro-cuenta.md`](./docs/specs/cuentas-y-wallet/2026-10-26-retiro-cuenta.md): retiro idempotente y serializado por wallet.
- [`docs/specs/plataforma-y-documentacion/2026-10-26-health-check-db.md`](./docs/specs/plataforma-y-documentacion/2026-10-26-health-check-db.md): health checks de proceso y base de datos.
- [`docs/specs/plataforma-y-documentacion/2026-10-27-conexion-backend-neon.md`](./docs/specs/plataforma-y-documentacion/2026-10-27-conexion-backend-neon.md): conexión del pool con `DATABASE_URL`.
- [`docs/auditoria-estado-proyecto-y-deploy.md`](./docs/auditoria-estado-proyecto-y-deploy.md): estado actual, brechas y preparación de deploy.

Cada cambio funcional debe estar acompañado por un spec nuevo en `docs/specs/`,
siguiendo la convención `YYYY-MM-DD-titulo-corto.md`.
