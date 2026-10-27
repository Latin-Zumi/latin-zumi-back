# Spec: Documentación Swagger de la API

http://localhost:3000/api-docs

## Fecha
2026-10-24

## Orden de ejecución: 004

## Problema
La API no tiene una página interactiva para consultar sus endpoints y contratos. `swagger-ui-express` ya está instalado, pero no se usa.

## Solución propuesta
Definir una especificación OpenAPI en el código del proyecto y montar Swagger UI en `/api-docs` con `swagger-ui-express`. Documentar la ruta existente `GET /accounts/{id}/balance`, incluidos sus respuestas exitosas y errores. Mantener la documentación disponible junto con la aplicación Express.

## Archivos afectados
- src/server.ts
- src/config/swagger.ts
- docs/specs/2026-10-24-swagger-api-docs.md

## Pasos
1. Crear una definición OpenAPI 3 para la API y su endpoint actual de consulta de saldo.
2. Montar Swagger UI en `/api-docs` antes del middleware de ruta no encontrada.
3. Dejar la dependencia existente `swagger-ui-express` como interfaz de documentación, sin añadir generadores de especificaciones.

## Cómo probar
- [x] Iniciar la aplicación y abrir `GET /api-docs` para ver Swagger UI.
- [x] Confirmar que la especificación muestra `GET /accounts/{id}/balance`, sus parámetros y respuestas documentadas.
- [x] Confirmar que la documentación se sirve sin afectar la ruta existente de saldo.

## Riesgos / notas
- La especificación se mantiene manualmente y debe actualizarse junto con cambios futuros en las rutas.
- La documentación describe el endpoint actual; no agrega rutas ni cambia su comportamiento.
