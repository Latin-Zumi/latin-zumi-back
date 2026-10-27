# Latin Zumi · Backend

Backend de Latin Zumi, una API para consultar cuentas y saldos derivados de un
ledger contable inmutable. Está construido con Node.js, TypeScript, Express y
PostgreSQL.

## Estado actual

Actualmente el proyecto incluye:

- Persistencia PostgreSQL basada en un ledger contable append-only.
- Wallets con una moneda principal y cuentas de saldo por moneda.
- Registro de usuario, login y logout con sesiones Bearer.
- Consultas autenticadas de cuentas, saldos y transacciones propias.
- Ingresos convertidos y registrados de forma idempotente en el ledger.
- Documentación interactiva OpenAPI/Swagger en `/api-docs`.
- Middleware centralizado para errores HTTP y de PostgreSQL.

La guía de PostgreSQL, migraciones y seeds está en [`db/README.md`](./db/README.md).
Para ejecutar el flujo de ingreso completo, usa la
[guía de prueba de extremo a extremo](./docs/guia-e2e-ingreso-convertido.md).
El estado de endpoints y la checklist tentativa de despliegue en Railway están
en la [auditoría del proyecto](./docs/auditoria-estado-proyecto-y-deploy.md).

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

## Ejecutar la aplicación

Compila el proyecto y levanta el servidor:

```sh
npm run build
npm start
```

Con la configuración predeterminada, la API queda disponible en
`http://localhost:3000`.

## API

Todas las respuestas exitosas usan el formato `{ "data": ... }`. Los saldos
se serializan como texto para conservar la precisión decimal de PostgreSQL.

### Usuario y sesión

#### Registrar usuario y billetera

`POST /users`

Registra un username y email, almacena un hash de la contraseña y crea una
Crea una wallet lógica y su cuenta inicial en la moneda principal. La
contraseña debe tener entre 15 y 128 caracteres; `currency` es opcional,
acepta `USD`, `COP`, `ARS` o `EUR` y usa `COP` por defecto.

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

Usa el `access_token` devuelto como Bearer token en las rutas de cuenta,
saldo y transacciones:

```sh
curl -i http://localhost:3000/accounts/10000000-0000-4000-8000-000000000001 \
  -H 'Authorization: Bearer <access_token>'
```

Las sesiones vencen en una hora. Si una cuenta existente inicia sesión con
una contraseña menor a 15 caracteres, primero debe actualizarla:

```sh
curl -i -X POST http://localhost:3000/auth/change-password \
  -H 'Authorization: Bearer <access_token>' \
  -H 'Content-Type: application/json' \
  -d '{"current_password":"clave-anterior","new_password":"una-frase-de-acceso-de-quince-o-mas"}'
```

Para revocar la sesión actual:

```sh
curl -i -X POST http://localhost:3000/auth/logout \
  -H 'Authorization: Bearer <access_token>'
```

### Wallet e ingresos

#### Consultar una cuenta

`GET /accounts/:id`

Devuelve los datos de la cuenta y su saldo. El `id` debe ser un UUID válido.

```sh
curl -i http://localhost:3000/accounts/10000000-0000-4000-8000-000000000001 \
  -H 'Authorization: Bearer <access_token>'
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
  -H 'Authorization: Bearer <access_token>'
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
  -H 'Authorization: Bearer <access_token>' \
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

### Actividad del ledger

#### Consultar una transacción

`GET /transactions/:id`

Devuelve solo los asientos asociados a las cuentas del usuario autenticado:

```sh
curl -i http://localhost:3000/transactions/30000000-0000-4000-8000-000000000101 \
  -H 'Authorization: Bearer <access_token>'
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
├── middleware/   manejo centralizado de errores
├── routes/       definición y conexión de rutas
├── services/     consultas SQL parametrizadas, ledger y tasas externas
└── utils/        errores de aplicación
```

El flujo de una consulta es:

```text
route → asyncHandler → controller → service → PostgreSQL
```

Las rutas no contienen SQL y los controllers no acceden directamente al pool
de PostgreSQL. Las rutas específicas `/accounts/:id/balance` y
`/accounts/:id/incoming` se registran antes de `/accounts/:id`.

## Pruebas y validación

```sh
npm run build
npm test
```

La validación manual de integración con PostgreSQL está descrita en la
[guía de extremo a extremo](./docs/guia-e2e-ingreso-convertido.md).

## Documentación del proyecto

- [`docs/guia-e2e-ingreso-convertido.md`](./docs/guia-e2e-ingreso-convertido.md): registro, login, ingreso, idempotencia y verificación del ledger.
- [`db/README.md`](./db/README.md): PostgreSQL, migraciones y seeds.
- [`docs/specs/README.md`](./docs/specs/README.md): guía y reglas para crear specs.
- [`docs/specs/2026-10-21-ledger-append-only.md`](./docs/specs/2026-10-21-ledger-append-only.md): diseño del ledger inmutable.
- [`docs/specs/2026-10-23-seeds-db.md`](./docs/specs/2026-10-23-seeds-db.md): datos de demostración e idempotencia.
- [`docs/specs/2026-10-24-ledger-balance-route.md`](./docs/specs/2026-10-24-ledger-balance-route.md): endpoint de consulta de saldo.
- [`docs/specs/2026-10-24-accounts-endpoints.md`](./docs/specs/2026-10-24-accounts-endpoints.md): endpoints de consulta de cuentas y separación por capas.
- [`docs/specs/2026-10-24-swagger-api-docs.md`](./docs/specs/2026-10-24-swagger-api-docs.md): documentación OpenAPI.
- [`docs/specs/2026-10-24-swagger-account-examples.md`](./docs/specs/2026-10-24-swagger-account-examples.md): ejemplos demo usados en Swagger.
- [`docs/specs/2026-10-26-autenticacion-y-acceso-por-titular.md`](./docs/specs/2026-10-26-autenticacion-y-acceso-por-titular.md): autenticación y autorización por titular.

Cada cambio funcional debe estar acompañado por un spec nuevo en `docs/specs/`,
siguiendo la convención `YYYY-MM-DD-titulo-corto.md`.
