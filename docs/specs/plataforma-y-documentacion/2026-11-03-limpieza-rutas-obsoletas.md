# Spec: Limpieza de rutas y código obsoleto

## Fecha
2026-11-03

## Orden de ejecución: 047

## Problema
Swagger, routers y código del proyecto pueden conservar endpoints deprecados o inexistentes y sus implementaciones/referencias huérfanas. Esto confunde a consumidores y mantiene código sin uso.

## Solución propuesta
Auditar rutas montadas, sus handlers y el contrato OpenAPI. Eliminar únicamente rutas confirmadas como deprecadas/no existentes junto con controladores, servicios, esquemas, pruebas y referencias exclusivamente asociados. Mantener rutas vigentes y documentar en Swagger el contrato real.

Ejemplo de criterio para retirar una operación obsoleta:

```ts
// Si DELETE /users/:id no está montada ni forma parte del contrato vigente,
// retirar su operación OpenAPI y el handler/código exclusivamente usado por ella.
```

El barrido rastrea cada símbolo retirado en el repositorio antes de borrarlo, para evitar romper flujos activos.

## Archivos afectados
- `src/config/swagger.ts`
- `src/routes/` y `src/controllers/` según hallazgos
- `src/services/`, `src/schemas/`, `src/tests/` y documentación según referencias
- `docs/specs/index-specs.md`

## Pasos
1. Comparar operaciones Swagger con routers efectivamente montados y handlers implementados.
2. Identificar endpoints marcados `deprecated`, inexistentes o código sin referencias activas; rastrear todas sus referencias.
3. Retirar las operaciones/código exclusivamente obsoletos y actualizar documentación y pruebas relacionadas.
4. Verificar que no queden referencias a símbolos eliminados y revisar el diff.

## Cómo probar
- [ ] Build de TypeScript sin errores.
- [ ] Suite de pruebas existente sin fallos.
- [ ] Cada ruta documentada existe en los routers montados y cada ruta montada vigente está documentada.
- [ ] No quedan referencias a símbolos retirados.

## Riesgos / notas
- No inferir obsolescencia solo por falta de uso textual: confirmar el montaje y contrato antes de eliminar.
- No retirar endpoints vigentes aunque aparezcan marcados deprecated sin evaluar referencias y contrato.


## Resultado de auditoría (2026-11-03)

Se revisaron los servicios HTTP del frontend en `latin-zumi-front/latin-zumi-react`.
El frontend usa `GET /accounts` para leer cuentas y `GET /wallet/transactions`
para actividad. También usa `/auth/*`, `/users/lookup`, `/users/me`, `/wallet/*`
y `/admin/*`; ninguno de estos flujos depende de las rutas eliminadas.

Se retiraron del backend y de OpenAPI:

- `POST /users` (registro anterior; el front usa `POST /auth/register`).
- `GET /accounts/:id`, `GET /accounts/:id/balance`,
  `POST /accounts/:id/incoming` y `POST /accounts/:id/withdraw`. El ingreso usa
  `POST /wallet/deposits`; la lectura usa `GET /accounts`. El retiro no tiene
  reemplazo en el front.
- `GET /transactions` y `GET /transactions/:id`; el front usa
  `GET /wallet/transactions`.

Se conservaron `getTransactionById` y `getBalanceByAccountId` en los servicios
porque el servidor MCP los consume. `recordIncomingConversion` se conserva para
los depósitos actuales. El router de transacciones quedó sin operaciones, por lo
que también se retiró su montaje.

Verificación realizada: `npm run build` y `git diff --check`. La suite de tests
no se ejecutó.
