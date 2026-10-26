# Spec: Conversión de ingresos a la moneda de la wallet

## Fecha
2026-10-26

## Problema
Cada usuario tendrá una sola cuenta con una moneda de liquidación, por
ejemplo USD. Cuando reciba fondos en EUR, COP o ARS, esos fondos deben
convertirse y acreditarse en USD. El proyecto aún no define proveedor,
fallback, precisión, tasa fijada, comisiones ni comportamiento ante fallos.

## Solución propuesta
Implementar una operación de conversión al recibir fondos:

1. Leer la moneda de liquidación de la cuenta del usuario.
2. Obtener la tasa desde la API de exchangeRate como proveedor principal.
3. Usar Frankfurt como fallback si exchangeRate falla, expira, responde con
   una moneda no soportada o entrega una tasa inválida.
4. Fijar la tasa usada, la fuente, la fecha de observación, el importe de
   origen, el importe convertido y el redondeo antes de confirmar el ledger.
5. Crear entries balanceados por moneda. La cuenta del usuario recibirá solo
   el importe convertido en su moneda de liquidación; las cuentas internas
   compensarán la moneda de origen y la conversión.
6. Hacer la operación idempotente mediante una clave proporcionada por el
   sistema que origina el ingreso.
7. Si ambos proveedores fallan, no acreditar parcialmente ni inventar una
   tasa: la operación completa debe fallar y poder reintentarse.

La conversión será una operación real del ledger, no una valoración visual.
Por ello, no se debe crear el crédito al usuario y dejar la contrapartida para
después.

### Contrato conceptual

```http
POST /accounts/:id/incoming
Authorization: Bearer <token>
Idempotency-Key: ingreso-externo-123
Content-Type: application/json
```

```json
{
  "source_currency": "EUR",
  "source_amount": "100.00",
  "destination_currency": "USD"
}
```

La respuesta informará el importe acreditado, la tasa, la fuente y la fecha
usada. El endpoint y los nombres finales quedan sujetos a la definición del
flujo de ingresos y de las cuentas internas.

## Archivos afectados
- src/services/exchange-rate.service.ts
- src/services/incoming-conversion.service.ts
- src/routes/accounts.route.ts
- src/controllers/accounts.controller.ts
- src/config/env.ts
- src/config/swagger.ts
- db/migrations/006_currency_conversions.sql — solo si se requiere persistir
  el detalle de la conversión para auditoría.
- tests/ o src/**/*.test.ts
- package.json
- README.md
- docs/specs/2026-10-26-conversion-tasas-exchange-rate.md

## Pasos
1. Confirmar moneda predeterminada, monedas soportadas y si el cliente puede
   elegir una moneda de liquidación distinta.
2. Confirmar endpoints, autenticación, límites y formato de exchangeRate y
   Frankfurt.
3. Definir timeout, antigüedad máxima, redondeo, comisiones y política cuando
   ambos proveedores fallen.
4. Implementar adaptadores separados y normalizar sus respuestas.
5. Implementar la operación idempotente dentro de una transacción SQL que
   incluya tasa y entries balanceados.
6. Añadir pruebas de éxito, fallback, errores, precisión, reintentos y
   rollback.
7. Documentar el contrato y estados de error en Swagger y README.

## Cómo probar
- [ ] Un ingreso en la moneda de la wallet acredita el mismo importe sin
  conversión innecesaria.
- [ ] Un ingreso EUR/COP/ARS obtiene una tasa válida de exchangeRate y acredita
  solo la moneda de liquidación del usuario.
- [ ] Un error o timeout de exchangeRate usa Frankfurt automáticamente.
- [ ] Si ambos proveedores fallan, no se crean entries ni saldo parcial.
- [ ] La tasa, fuente, fecha, importe original y convertido quedan auditables.
- [ ] El cálculo conserva precisión y aplica el redondeo documentado.
- [ ] Repetir la misma `Idempotency-Key` no duplica el ingreso.
- [ ] Un usuario no puede acreditar fondos en la cuenta de otro usuario.
- [ ] Una conversión crea un ledger balanceado por cada moneda involucrada.
- [ ] Swagger, README, pruebas y build reflejan el contrato final.

## Riesgos / notas
- La API externa puede cambiar formato, límites, cobertura o disponibilidad;
  los adaptadores deben aislar esos cambios.
- Frankfurt como fallback puede tener una fecha de actualización diferente;
  debe registrarse claramente la fuente finalmente usada.
- Las tasas, comisiones y redondeos deben fijarse antes de confirmar la
  transacción; no se puede cambiar retroactivamente el resultado.
- Este flujo representa conversión real de fondos. No debe confundirse con una
  simple conversión informativa mostrada en pantalla.
