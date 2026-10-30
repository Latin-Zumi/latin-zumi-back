# Spec: Actualizar Swagger con la estructura actual

## Fecha
2026-10-30

## Orden de ejecución: 041

## Problema
`src/config/swagger.ts` quedó desalineado con las rutas montadas en
`src/server.ts` y con el contrato real de errores:

- Documenta `POST /accounts/{id}` para `createIncoming`, pero la ruta real es
  `POST /accounts/{id}/incoming`.
- Varios errores se describen como `{ error: string }`, mientras que
  `errorHandler` responde siempre `{ code, message }`.
- `GET /wallet/transactions` declara filtros sin enums, descripciones ni
  límites, aunque el controller valida `type`, `currency`, `page`, `limit`,
  `from` y `to`.
- No hay `tags` ni `servers`: la UI no agrupa por módulo ni permite probar
  contra el host actual.

## Solución propuesta
Reordenar y corregir la especificación sin tocar controllers ni rutas:
agrupar las operaciones por módulo con `tags` (`health`, `auth`, `users`,
`wallet`, `accounts`, `transactions`, `chat`), mover el ingreso legado a su
path real, reutilizar el schema `ErrorResponse` en todos los errores y
documentar los filtros de actividad. Mantener `openapi: '3.0.3'` y
`swagger-ui-express`.

```ts
// Antes: el POST vivía bajo /accounts/{id}
'/accounts/{id}': {
  get: { operationId: 'getAccount' },
  post: { operationId: 'createIncoming' },
},

// Después: cada operación en su path real
'/accounts/{id}': { get: { tags: ['accounts'], operationId: 'getAccount' } },
'/accounts/{id}/incoming': {
  post: { tags: ['accounts'], operationId: 'createIncoming', deprecated: true },
},
```

Swagger queda con las mismas 25 operaciones reales, en su path correcto y con
el `operationId` que usa el código.

```ts
const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
});

responses: {
  '400': errorResponse('Datos de registro inválidos.'),
  '409': errorResponse('Email ya registrado.'),
},
```

Cada error documentado refleja el cuerpo real `{ code, message }` que arma
`errorHandler`, en lugar de un `error` plano que la API nunca devuelve.

```ts
parameters: [
  { name: 'type', in: 'query', schema: { type: 'string',
    enum: ['deposit', 'transfer_sent', 'transfer_received', 'withdrawal', 'exchange'] } },
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
  { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
],
```

Los parámetros coinciden con el `z.object(...)` de `getWalletTransactions`,
así que la UI guía con los mismos valores aceptados por el backend.

## Archivos afectados
- `src/config/swagger.ts`
- `docs/specs/plataforma-y-documentacion/2026-10-30-swagger-estructura-actual.md`
- `docs/specs/index-specs.md`

## Pasos
1. Añadir `tags` con descripción y `servers: [{ url: '/' }]`.
2. Mover `createIncoming` a `/accounts/{id}/incoming` y dejar `/accounts/{id}`
   solo con `get`.
3. Etiquetar cada operación según su router (`auth`, `users`, `wallet`,
   `accounts`, `transactions`, `chat`, `health`).
4. Reemplazar los cuerpos `{ error }` por `$ref: ErrorResponse` y completar los
   parámetros de `GET /wallet/transactions`.
5. Mantener las operaciones `deprecated` existentes (`POST /users`,
   `POST /accounts/{id}/incoming`).

## Cómo probar
- [x] `npm run build` sin errores de TypeScript.
- [x] Los 25 `operationId` son únicos y cada operación tiene `tags`.
- [x] `/api-docs` muestra los 26 paths montados (incluye `{id}/incoming`), agrupados por módulo.
- [x] Los errores de Swagger coinciden con `{ code, message }`.
- [x] Los filtros de `/wallet/transactions` muestran enums, defaults y límites.

## Riesgos / notas
- Cambio solo documental: no altera rutas, validaciones ni respuestas.
- La especificación se mantiene a mano; todo cambio de router debe actualizarla.
