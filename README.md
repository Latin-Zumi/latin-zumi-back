# Latin Zumi · Backend

Backend de Latin Zumi, una API para consultar cuentas y saldos derivados de un
ledger contable inmutable. Está construido con Node.js, TypeScript, Express y
PostgreSQL.

## Estado actual

Actualmente el proyecto incluye:

- Persistencia PostgreSQL basada en un ledger contable append-only.
- Seeds idempotentes con cuentas demo en USD y COP.
- API de lectura para consultar una cuenta y su saldo.
- Documentación interactiva OpenAPI/Swagger en `/api-docs`.
- Middleware centralizado para errores HTTP y de PostgreSQL.

Todavía no se incluyen endpoints para crear, editar o eliminar cuentas,
transacciones o asientos.

La explicación del modelo contable, la configuración de PostgreSQL, la
migración y los seeds está en [`db/README.md`](./db/README.md).

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

### Consultar una cuenta

`GET /accounts/:id`

Devuelve los datos de la cuenta y su saldo. El `id` debe ser un UUID válido.

```sh
curl http://localhost:3000/accounts/10000000-0000-4000-8000-000000000001
```

```json
{
  "data": {
    "id": "10000000-0000-4000-8000-000000000001",
    "user_id": "20000000-0000-4000-8000-000000000001",
    "currency": "USD",
    "account_type": "user",
    "allow_negative": false,
    "balance": "125.00000000"
  }
}
```

### Consultar el saldo

`GET /accounts/:id/balance`

Devuelve únicamente el saldo y la moneda de una cuenta:

```sh
curl http://localhost:3000/accounts/10000000-0000-4000-8000-000000000001/balance
```

```json
{
  "data": {
    "account_id": "10000000-0000-4000-8000-000000000001",
    "currency": "USD",
    "balance": "125.00000000"
  }
}
```

Errores relevantes: `400` para UUID inválido, `404` si la cuenta no existe y
`500` ante un error interno no controlado.

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
├── services/     consultas SQL parametrizadas y acceso a datos
└── utils/        errores de aplicación
```

El flujo de una consulta es:

```text
route → asyncHandler → controller → service → PostgreSQL
```

Las rutas no contienen SQL y los controllers no acceden directamente al pool
de PostgreSQL. La ruta específica `/accounts/:id/balance` se registra antes de
`/accounts/:id` para que `balance` no se interprete como un identificador.

## Pruebas y validación

```sh
npm run build
npx vitest run
```

La validación manual de integración requiere PostgreSQL inicializado y los
seeds cargados. Debe comprobar los casos de éxito, UUID inválido, cuenta
inexistente y la documentación en `/api-docs`.

## Documentación del proyecto

- [`docs/specs/README.md`](./docs/specs/README.md): guía y reglas para crear specs.
- [`docs/specs/2026-10-21-ledger-append-only.md`](./docs/specs/2026-10-21-ledger-append-only.md): diseño del ledger inmutable.
- [`docs/specs/2026-10-23-seeds-db.md`](./docs/specs/2026-10-23-seeds-db.md): datos de demostración e idempotencia.
- [`docs/specs/2026-10-24-ledger-balance-route.md`](./docs/specs/2026-10-24-ledger-balance-route.md): endpoint de consulta de saldo.
- [`docs/specs/2026-10-24-accounts-endpoints.md`](./docs/specs/2026-10-24-accounts-endpoints.md): endpoints de consulta de cuentas y separación por capas.
- [`docs/specs/2026-10-24-swagger-api-docs.md`](./docs/specs/2026-10-24-swagger-api-docs.md): documentación OpenAPI.
- [`docs/specs/2026-10-24-swagger-account-examples.md`](./docs/specs/2026-10-24-swagger-account-examples.md): ejemplos demo usados en Swagger.

Cada cambio funcional debe estar acompañado por un spec nuevo en `docs/specs/`,
siguiendo la convención `YYYY-MM-DD-titulo-corto.md`.
