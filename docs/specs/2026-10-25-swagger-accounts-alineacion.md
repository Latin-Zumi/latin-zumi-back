# Spec: Alinear Swagger UI de accounts

## Fecha
2026-10-25

## Orden de ejecución: 008

## Problema
La definición OpenAPI de los dos endpoints de `accounts` coincide con sus
campos y respuestas actuales. Sin embargo, la respuesta exitosa de
`GET /accounts/{id}/balance` no muestra un ejemplo y ninguna de las dos
operaciones explica que el saldo se devuelve como texto decimal y como cero
cuando la cuenta todavía no tiene balance registrado. La UI no expone esos
detalles visibles del contrato.

## Solución propuesta
Completar los ejemplos y descripciones de las respuestas `200` para que
Swagger UI muestre el contrato actual: incluir un ejemplo de balance con las
propiedades `account_id`, `currency` y `balance`; documentar que `balance` es
texto decimal para preservar precisión; y describir el valor cero cuando aún
no existen movimientos. No cambiar rutas, handlers ni respuestas del API.

## Archivos afectados
- src/config/swagger.ts
- docs/specs/2026-10-25-swagger-accounts-alineacion.md

## Pasos
1. Añadir un ejemplo completo a la respuesta `200` de
   `GET /accounts/{id}/balance`.
2. Aclarar en ambas respuestas que el saldo sin movimientos es
   `"0"`/cero decimal y que el saldo se serializa como texto.
3. Verificar que los esquemas, nombres de campos y respuestas `400`, `404` y
   `500` continúan correspondiendo a los controllers.
4. Compilar y revisar `/api-docs` si el servidor está disponible.

## Cómo probar
- [x] Ejecutar `npm run build` sin errores de TypeScript.
- [ ] Confirmar en Swagger UI que ambos endpoints muestran ejemplos y la
  explicación del saldo cero.
- [x] Confirmar que los esquemas documentados mantienen los campos y errores
  reales de ambos endpoints.

## Riesgos / notas
- El cambio afecta solo a documentación OpenAPI; no modifica el comportamiento
  del API.
- El saldo es texto porque el service convierte el valor `NUMERIC` a texto.
- La revisión del código actual no encontró diferencias en rutas, campos,
  validación UUID ni códigos/mensajes `400` y `404` respecto de Swagger.
