# Spec: Límite de pedidos y errores del chat

## Fecha
2026-11-04

## Problema
`POST /chat/messages` tiene dos problemas antes de prender el chatbot en producción:

- No tiene límite de pedidos, y cada mensaje consume Gemini, que tiene costo y cuota.
- Si falla el proveedor, el `503` incluye su mensaje de error, que puede traer datos internos.

## Solución propuesta
- **Límite:** 50 mensajes cada 15 minutos por usuario, con una instancia propia. Va después de `requireAuth`. Al superarlo responde `429` con `TOO_MANY_REQUESTS`.
- **Error del proveedor:** el `503` responde siempre `No fue posible generar la respuesta del asistente`. El detalle se escribe en el log con el evento `chat_provider_error`.

El front ya trata el `429` y el `503` con mensajes propios.

## Archivos afectados
- `src/middleware/loginRateLimit.ts`
- `src/routes/chat.route.ts`
- `src/services/chat/gemini-provider.ts`
- `src/config/swagger.ts`
- `src/tests/routes/chat.route.test.ts`
- `src/tests/services/chat/gemini-provider.test.ts`

## Pasos
1. Agregar el límite a la ruta.
2. Sacar el detalle del proveedor de la respuesta y mandarlo al log.
3. Actualizar Swagger y tests.

## Cómo probar
- [x] El mensaje 51 de un usuario responde `429` y no llega al servicio de chat.
- [x] Otro usuario puede seguir enviando mensajes.
- [x] Si falla el proveedor, el `503` no incluye el detalle y el log sí.
- [ ] Con `GEMINI_API_KEY` en Render: el chat responde con los saldos de la cuenta.

## Riesgos / notas
- El contador se guarda en memoria, como los demás límites: se reinicia con cada despliegue y no se comparte entre instancias.
- Antes de prender el chatbot falta confirmar `GEMINI_API_KEY` y aprobar que los saldos y movimientos se manden a Gemini.
- `El proveedor de IA no está configurado`, el `503` sin API key, no cambia: no trae datos del proveedor.
