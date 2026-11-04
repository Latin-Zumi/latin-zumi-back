# Spec: Tasas y costos para la billetera (backend)

## Fecha
2026-11-04

## Orden de ejecución: 051

## Problema

La billetera tiene que mostrar las tasas de cambio, la comisión y el interés sin que el usuario
abra el modal de cambio. Hoy el back no puede dárselos a un usuario común:

- `GET /admin/settings` tiene la comisión y el interés, pero es solo para admin.
- `GET /wallet/exchange/quote` pide un monto, guarda una fila en `exchange_quotes` por cada
  consulta, consume su propio límite y devuelve la tasa con la comisión aplicada.

Por eso el front muestra tasas simuladas y un "0 %" escrito a mano, aunque la comisión real sea
otra. Este spec implementa el contrato acordado por el front sin cambiarle nombres ni campos.

## Solución propuesta

### Contrato `GET /wallet/rates`

- **Acceso:** `requireAuth`, igual que el resto de `/wallet/*`. No requiere rol admin.
- **Sin escrituras:** no guarda nada en la base; solo lee parámetros y usa la caché de tasas.

**Respuesta `200`:**

```json
{
  "data": {
    "base": "USD",
    "rates": {
      "USD": "1",
      "ARS": "1450.25",
      "COP": "4100.50",
      "EUR": "0.92"
    },
    "observed_at": "2026-11-04T18:00:00.000Z",
    "exchange_spread_percent": "0.00",
    "interest_rates": [
      { "currency": "ARS", "annual_percent": "0.00" },
      { "currency": "COP", "annual_percent": "0.00" },
      { "currency": "EUR", "annual_percent": "0.00" },
      { "currency": "USD", "annual_percent": "0.00" }
    ]
  }
}
```

El front consume este body al abrir la billetera: `rates`, `exchange_spread_percent` e `interest_rates` alimentan el resumen.

**Reglas:**

- `rates` son unidades de cada moneda por 1 USD, **sin la comisión aplicada**. Vienen las cuatro
  monedas aunque el usuario no tenga cuenta en ellas.
- Las tasas salen de `getExchangeRate('USD', moneda)`, el mismo servicio y la misma caché que usa
  la cotización. `USD` vale siempre `"1"` y no se consulta al proveedor.
- `observed_at` es la fecha de observación más vieja de las tasas consultadas, en ISO 8601 UTC.
- `exchange_spread_percent` e `interest_rates` salen de las mismas tablas y con el mismo formato
  que `GET /admin/settings`. Vienen las cuatro monedas.
- No se devuelven `updated_at` ni `updated_by`: identifican al admin. Los parámetros no se cachean: un cambio del panel se ve en la consulta siguiente.

### Servicio de tasas

El controlador delega en un servicio nuevo que reutiliza `getAdminSettings()` y consulta las tres tasas no USD en paralelo.

```ts
const CURRENCIES = ['ARS', 'COP', 'EUR'] as const;

export async function getWalletRates() {
  const settings = await getAdminSettings();
  let quotes: ExchangeRateQuote[];
  try {
    quotes = await Promise.all(CURRENCIES.map((currency) => getExchangeRate('USD', currency)));
  } catch {
    throw new AppError(
      'No hay una tasa de cambio vigente disponible; reintenta más tarde',
      503,
      'CONVERSION_UNAVAILABLE',
    );
  }
  return {
    base: 'USD',
    rates: {
      USD: '1',
      ...Object.fromEntries(CURRENCIES.map((currency, i) => [currency, quotes[i].rate])),
    },
    observed_at: new Date(Math.min(...quotes.map((q) => q.observedAt.getTime()))).toISOString(),
    exchange_spread_percent: settings.exchange_spread_percent,
    interest_rates: settings.interest_rates,
  };
}
```

Cuando un usuario autenticado consulta, el servicio lee los parámetros y pide las tasas a la misma
caché que usa la cotización. Si una sola tasa falla, no se devuelve un resultado parcial: se lanza
`503 CONVERSION_UNAVAILABLE` con un mensaje genérico. Si todas responden, se arma la respuesta con
las cuatro monedas y `observed_at` queda en la observación más antigua. `getAdminSettings()` trae
`updated_at` y `updated_by`, pero el servicio solo toma los dos campos públicos.

### Ruta, controlador y límite propio

`requireAuth` va antes del limitador para que una solicitud sin sesión siempre reciba `401` y el
cupo se cuente por usuario autenticado.

```ts
// wallet.controller.ts
export async function getWalletRatesHandler(_req: Request, res: Response) {
  return res.status(200).json({ data: await getWalletRates() });
}

// wallet.route.ts
walletRouter.get(
  '/wallet/rates',
  asyncHandler(requireAuth),
  ratesRateLimit,
  asyncHandler(getWalletRatesHandler),
);
```

El handler no recibe parámetros ni body. El limitador es una instancia nueva, separada de
`quoteRateLimit`, con la misma ventana de 15 minutos y un límite de 120 consultas por usuario.

```ts
export const ratesRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req) => req.auth?.userId ?? 'anonymous',
});
```

Abrir la billetera consume el cupo de `ratesRateLimit`, nunca el de cotizaciones. Si se agota,
responde `429 { code: 'TOO_MANY_REQUESTS' }` con el handler existente.

### Errores

| Status | Código | Cuándo |
|---|---|---|
| `401` | el de `requireAuth` | Sin sesión o con el token vencido |
| `403` | el de `requireAuth` | Cambio de contraseña pendiente, igual que en `GET /accounts` |
| `429` | `TOO_MANY_REQUESTS` | Se superó el límite propio de `/wallet/rates` |
| `503` | `CONVERSION_UNAVAILABLE` | No se pudo obtener la tasa de alguna moneda |

Con un `503` no se devuelve una tasa parcial ni inventada, y el mensaje no incluye el detalle del
proveedor. La consulta no inserta filas en `exchange_quotes`.

## Archivos afectados

- `src/routes/wallet.route.ts`
- `src/controllers/wallet.controller.ts`
- `src/services/wallet-rates.service.ts` (nuevo)
- `src/middleware/loginRateLimit.ts`
- `src/config/swagger.ts`
- `src/tests/services/wallet-rates.service.test.ts` (nuevo)
- `src/tests/routes/wallet-rates.route.test.ts` (nuevo)
- `docs/specs/index-specs.md` (registro del spec)

## Pasos

1. Crear `wallet-rates.service.ts` con la lectura de parámetros, las tres tasas y el `503` genérico.
2. Agregar `getWalletRatesHandler`, la ruta y `ratesRateLimit`.
3. Documentar el endpoint en Swagger con el contrato exacto.
4. Probar el servicio (cuatro monedas, `observed_at`, sin escrituras y `503`) y la ruta (`401`,
   `200` sin rol admin y separación de límites).
5. Ejecutar `npm run build` y `npm test`.
6. Desplegar en Render y avisar al front.

## Cómo probar

- [x] Sin token responde `401`.
- [x] Un usuario sin rol admin recibe `200` con las cuatro monedas en `rates` y en `interest_rates`.
- [x] Un usuario con una sola cuenta recibe igual las cuatro monedas.
- [x] `rates` no cambia al modificar la comisión desde el panel; `exchange_spread_percent` sí, en la
      consulta siguiente.
- [x] La consulta no agrega filas en `exchange_quotes`.
- [x] Si falla el proveedor de tasas responde `503` con `CONVERSION_UNAVAILABLE`, sin detalles
      internos.
- [x] La respuesta no incluye `updated_at` ni `updated_by`.
- [x] Consultar este endpoint no consume el límite de `/wallet/exchange/quote`.
- [x] `npm run build` pasa.
- [ ] `npm test` pasa. La ejecución completa da 194 pasados y 1 fallo preexistente en
      `src/tests/config/env.test.ts` por el default de `EMAIL_FROM`; ajeno al spec 051.

## Riesgos / notas

- **Orden de despliegue:** primero el back, después el front. El cambio del front está en la rama
  `feat/tasas-reales-billetera`. Sin este endpoint, la billetera avisa que no pudo cargar las tasas
  y deja de mostrar el resumen de la semana.
- **Comisión e interés:** el objetivo es que queden en 0 %. El endpoint devuelve lo que esté
  cargado, sin forzar ese valor.
- **Tasas:** se muestran sin spread; el costo se comunica con `exchange_spread_percent`. Si el
  proveedor no entrega alguna de las tres tasas, toda la respuesta es `503`.
- **Límite:** 120 consultas cada 15 minutos por usuario es un valor inicial; ajustarlo no cambia el
  contrato.
- Si hay que cambiar algún nombre del contrato, lo acordamos antes y ajustamos los dos lados.
