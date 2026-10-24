# Spec: Resolver conflictos del backend y los seeds

## Fecha
2026-10-24

## Problema
Hay siete archivos en estado de conflicto en Git, aunque el contenido del árbol de trabajo ya no muestra marcadores `<<<<<<<`, `=======` o `>>>>>>>`. Las versiones incluyen cambios para cargar datos de demostración del ledger y cambios de configuración/API. Si se elige una sola versión sin comparar ambas intenciones, podrían perderse scripts de ejecución, validación de entorno, rutas existentes o documentación, y las semillas podrían dejar de coincidir con el esquema de la base.

## Solución propuesta
Resolver los conflictos integrando ambos lados donde corresponda y usando la migración `db/migrations/001_ledger.sql` como fuente de verdad para los datos demo:

- Mantener los comandos de build, inicio, inicialización y carga de seeds en `package.json`.
- Conservar el cliente/pool PostgreSQL y la validación de variables con Zod, incluyendo `DB_MAX`.
- Mantener la interfaz Swagger y el endpoint de saldo, además de las rutas existentes para listar cuentas y consultar transacciones.
- Conservar seeds aditivos, balanceados por moneda e idempotentes; no borrar ni modificar entries existentes.
- Mantener la documentación del flujo de inicialización y carga de seeds.
- Al terminar, registrar como resueltos en Git todos los archivos afectados.

## Archivos afectados
- `db/scripts/seed-db.ts`
- `db/seeds/001_demo_data.sql`
- `docs/specs/2026-10-23-seeds-db.md`
- `package.json`
- `src/config/db.ts`
- `src/config/env.ts`
- `src/server.ts`

## Pasos
1. Comparar los lados en conflicto con el contenido del árbol de trabajo y preservar las capacidades de ambas ramas.
2. Integrar las rutas de cuentas y transacciones existentes con el endpoint de saldo y la documentación Swagger.
3. Confirmar que los seeds usan columnas existentes, respetan las cuentas/transacciones/entries del ledger y conservan el balance por moneda.
4. Resolver el estado de Git de los siete archivos sin descartar otros cambios presentes.
5. Ejecutar la compilación TypeScript y las comprobaciones disponibles para detectar marcadores restantes y errores de integración.
6. Marcar en esta sección únicamente las verificaciones que efectivamente se hayan completado.

## Cómo probar
- [x] Confirmar que no quedan marcadores de conflicto en los archivos afectados.
- [x] Ejecutar `npm run build` y comprobar que termina correctamente.
- [x] Verificar estáticamente que `/api-docs`, `/accounts`, `/accounts/:id/balance` y `/transactions` siguen registrados.
- [ ] Si hay una base PostgreSQL de prueba disponible, ejecutar `npm run db:init` y `npm run db:seed` dos veces y comprobar los balances demo en `account_balances`.

## Riesgos / notas
- El trigger diferido de `entries` exige que cada transacción quede balanceada por moneda al confirmar la transacción SQL.
- `entries` es append-only; las semillas deben seguir siendo aditivas y no deben limpiar datos.
- El montaje de rutas duplicadas debe preservar el endpoint de saldo documentado y las rutas existentes sin ocultar rutas de transacciones.
- La prueba de seeds requiere PostgreSQL y las variables `DB_*`; no se debe afirmar que pasó si no se ejecuta contra una base disponible.
