# Spec: Ejemplos reales de accounts en Swagger

## Fecha
2026-10-24

## Problema
Swagger muestra un `Example Value` genérico donde `id` y `user_id` tienen el
mismo UUID. Además, el parámetro de la ruta no ofrece un ejemplo de una cuenta
existente del seed, lo que facilita probar un UUID válido pero inexistente.

## Solución propuesta
Actualizar la especificación OpenAPI de accounts para:

- mostrar en la respuesta un ejemplo completo con `id` y `user_id` distintos;
- usar como ejemplo del parámetro el ID real de la cuenta demo USD:
  `10000000-0000-4000-8000-000000000001`;
- mantener la validación `format: uuid` y el comportamiento actual de las
  rutas, controllers y services.

### Snippet propuesto

```ts
schema: {
  type: 'string',
  format: 'uuid',
  example: '10000000-0000-4000-8000-000000000001',
}
```

```ts
example: {
  id: '10000000-0000-4000-8000-000000000001',
  user_id: '20000000-0000-4000-8000-000000000001',
  currency: 'USD',
  account_type: 'user',
  allow_negative: false,
  balance: '125.00000000',
}
```

## Archivos afectados
- src/config/swagger.ts
- docs/specs/2026-10-24-swagger-account-examples.md

## Pasos
1. Añadir el ejemplo de ID existente a los parámetros de ambos endpoints de
   accounts.
2. Añadir un ejemplo de respuesta con `id` y `user_id` distintos en
   `GET /accounts/{id}`.
3. Ejecutar `npm run build` y revisar Swagger UI.

## Cómo probar
- [ ] Abrir `/api-docs` y confirmar que el parámetro muestra el ID real de la
  cuenta demo.
- [ ] Confirmar que el `Example Value` muestra IDs distintos.
- [ ] Ejecutar `GET /accounts/{id}` usando el ejemplo y recibir `200` si el
  seed demo está cargado.
- [x] Ejecutar `npm run build` sin errores.

## Riesgos / notas
- Los ejemplos dependen de los UUID estables definidos en
  `db/seeds/001_demo_data.sql`.
- El cambio solo corrige la documentación interactiva; no modifica la ruta ni
  la lógica de consulta.
