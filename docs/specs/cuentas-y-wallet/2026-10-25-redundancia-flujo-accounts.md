# Spec: Reducir duplicación en el flujo de accounts

## Fecha
2026-10-25

## Orden de ejecución: 007

## Problema
Las consultas de cuenta y saldo repiten el mismo `LEFT JOIN` entre `accounts`
y `account_balances`, con filtros y tratamiento de moneda/saldo idénticos.
Además, ambos controllers validan el UUID de la misma forma y traducen una
cuenta inexistente al mismo error HTTP. Esta duplicación hace más probable que
los endpoints diverjan al cambiar sus reglas.

## Solución propuesta
Concentrar la lectura de cuenta en una consulta compartida del service y hacer
que la lectura de saldo derive de esa cuenta, proyectando únicamente
`account_id`, `currency` y `balance` para conservar exactamente el contrato
actual de `/accounts/:id/balance`. En el controller, extraer la validación del
UUID a un helper común que conserve los errores `400` y `404` existentes.
Mantener las rutas como conexiones simples a handlers con `asyncHandler`, sin
cambios de rutas ni de respuestas públicas.

## Archivos afectados
- src/services/accounts.service.ts
- src/controllers/accounts.controller.ts
- docs/specs/cuentas-y-wallet/2026-10-25-redundancia-flujo-accounts.md

## Pasos
1. Inspeccionar los tipos de respuesta y asegurar que la consulta común
   conserve el `LEFT JOIN`, saldo cero cuando no hay balance y moneda
   normalizada.
2. Hacer que la operación de balance reutilice la consulta de cuenta y
   proyecte el resultado al tipo `AccountBalance` existente.
3. Extraer la validación del parámetro UUID para reutilizarla en ambos
   controllers sin cambiar sus códigos ni mensajes de error.
4. Revisar las rutas para confirmar que siguen delegando a los mismos handlers
   mediante `asyncHandler`.

## Cómo probar
- [x] Ejecutar `npm run build` sin errores de TypeScript.
- [x] Confirmar que `GET /accounts/:id` conserva su respuesta, incluido el
  balance y el caso de saldo cero.
- [x] Confirmar que `GET /accounts/:id/balance` conserva exactamente las
  propiedades `account_id`, `currency` y `balance`.
- [ ] Confirmar que ambos endpoints responden `400` ante UUID inválido y `404`
  ante una cuenta válida inexistente.
- [x] Confirmar que las rutas y sus métodos HTTP no cambian.

## Riesgos / notas
- La respuesta pública de ambos endpoints debe permanecer idéntica.
- El endpoint de balance leerá internamente la fila completa de cuenta para
  reutilizar una sola consulta; solo devolverá la proyección de saldo.
- El alcance se limita a eliminar duplicación en services y controllers; las
  rutas ya tienen una única responsabilidad y no requieren cambios funcionales.
