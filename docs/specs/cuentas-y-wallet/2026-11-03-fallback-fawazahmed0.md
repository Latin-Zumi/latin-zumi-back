# Spec: Fallback de tasas con fawazahmed0

## Fecha
2026-11-03

## Orden de ejecución: 046

## Problema
`src/services/exchange-rate.service.ts` usa ExchangeRate-API y Frankfurter. Frankfurter no cubre todas las monedas de la wallet, entre ellas ARS y COP, y por ello algunas cotizaciones terminan en `CONVERSION_UNAVAILABLE` aunque exista un proveedor alternativo.

## Solución propuesta
Reemplazar Frankfurter por el feed diario de fawazahmed0: primero jsDelivr y luego pages.dev. Se verificó con `curl` la URL de jsDelivr; el JSON real tiene `date` y un objeto `usd` con claves minúsculas y valores numéricos (por ejemplo `ars`). Derivar las tasas cruzadas desde USD, validar ambas monedas y preservar la semántica actual de cotización.

La cotización actual redondea `rate` a 12 decimales y `to_amount` a 2 con `multiplyAndRoundHalfUp`; `quote.rate` es string. El servicio proveedor valida la tasa como `number` finito positivo y luego la serializa como string. No se cambia este contrato ni el cálculo de `to_amount`.

Se conserva la caché actual por par para la principal (24 h, `EXCHANGE_RATE_MAX_AGE_HOURS`) y se agrega caché en memoria del JSON USD fallback con TTL configurable `EXCHANGE_RATE_FALLBACK_CACHE_TTL_HOURS`, default 6 h, validado entre 1 y 6 h. Una carga vencida se comparte como promesa en vuelo. Si ExchangeRate-API falla, se intenta jsDelivr y luego pages.dev; el JSON fallback vigente puede servir como respaldo ante fallos de red. Toda respuesta debe incluir fecha válida y las dos tasas solicitadas (excepto USD, cuya tasa es 1). Se registran fuente elegida y uso de caché sin datos de la cotización.

## Archivos afectados
- `src/services/exchange-rate.service.ts`
- `src/config/env.ts`, `.env.example`, `.env.production` (variables de proveedor/TTL)
- `src/tests/services/exchange-rate.service.test.ts`
- `README.md`
- `docs/specs/index-specs.md`

## Flujos principales

### Proveedores y validación

```ts
const urls = [
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
  'https://latest.currency-api.pages.dev/v1/currencies/usd.json',
];
const source = await loadUsdRates(urls, { signal: AbortSignal.timeout(env.EXCHANGE_RATE_TIMEOUT_MS) });
```

`getExchangeRate` ejecuta primero ExchangeRate-API. Ante error de red, timeout, status no 2xx, JSON/fecha/tasas inválidos o moneda solicitada ausente, avanza por las URLs en orden. Cada request usa el timeout ya configurado. Si ambas fallan y existe caché fallback vigente, reutiliza el JSON; agotadas todas las opciones lanza el error que `createExchangeQuote` traduce a `503 CONVERSION_UNAVAILABLE`.

### Tasas cruzadas y normalización

```ts
const rates = Object.fromEntries(Object.entries(body.usd).map(([code, value]) => [code.toUpperCase(), value]));
const usdPerBase = base === 'USD' ? 1 : rates[base];
const usdPerQuote = quote === 'USD' ? 1 : rates[quote];
const rate = usdPerQuote / usdPerBase;
```

El adaptador convierte las claves del feed a mayúsculas y valida que las monedas requeridas estén presentes. `rate` derivada debe ser finita y positiva (cada tasa USD también); si no, esa fuente se considera fallida. Los casos `USD→COP` y `COP→USD` resultan en `usdPerQuote` y su recíproco, respectivamente; `ARS→COP` divide ambas tasas. El proveedor devuelve la tasa serializada y el servicio existente mantiene su redondeo decimal.

### Caché compartida

```ts
if (Date.now() < cached.expiresAt) return { ...cached, cacheHit: true };
if (!inFlight) inFlight = fetchUsdFeed().finally(() => { inFlight = undefined; });
const fresh = await inFlight;
cached = { ...fresh, expiresAt: Date.now() + ttlHours * 3_600_000 };
```

El cliente del servicio comparte una sola carga por proceso cuando vence el feed. La caché guarda solo el JSON base y fecha del proveedor, no tasas por usuario. Al reutilizarla registra que fue caché; las tasas derivadas conservan la fecha del feed. Si el feed no se puede renovar pero la entrada sigue vigente, la cotización puede continuar.

### Persistencia y contrato

```ts
INSERT INTO exchange_quotes (..., rate, rate_source, rate_observed_at, expires_at, ...)
VALUES (..., $rate, $source, $observedAt, now() + interval '60 seconds', ...);
```

La cotización existente persiste `rate_source` y `rate_observed_at`; el fallback se identifica como `fawazahmed0-jsdelivr` o `fawazahmed0-pages`. Se mantienen la forma HTTP, la expiración de 60 segundos y el consumo único de `quote_id`; no se requiere migración. El cálculo vigente aplica spread y redondea la tasa efectiva a 12 decimales y el importe a 2.

## Pasos
1. Sustituir el adaptador Frankfurter por los dos adaptadores del feed USD, con conversión cruzada, validación, timeout y fallback secuencial.
2. Añadir caché fallback en memoria con TTL de 6 h por defecto, carga en vuelo compartida y trazabilidad de proveedor/uso de caché.
3. Retirar variables y menciones de Frankfurter; documentar el nuevo TTL y fuente en `.env.example`/README.
4. Actualizar pruebas con `fetch` mockeado: ARS→COP, USD→COP, COP→USD, claves en mayúscula, fallback desde principal y entre mirrors, agotamiento de fuentes, moneda ausente, y reutilización/coalescencia de caché.
5. Ejecutar `npm run build` y tests existentes y nuevos; revisar que el contrato de quote y consumo de `quote_id` siga intacto.

## Cómo probar
- [x] `npm run build` termina sin errores.
- [x] Los tests comprueban tasas cruzadas, normalización, ambos niveles fallback, moneda ausente y `CONVERSION_UNAVAILABLE` al fallar todas las fuentes.
- [x] Los tests verifican caché vigente, expiración y una sola carga compartida ante solicitudes simultáneas.
- [x] La cotización conserva shape, redondeo, expiración y uso único actuales; esos servicios no cambiaron.

## Riesgos / notas
- El proveedor publica tasas diarias; el TTL de 6 h limita llamadas sin atribuir frescura intradía. La edad máxima permitida seguirá siendo la regla vigente de 24 h para tasas.
- La caché en memoria es por proceso; varias réplicas pueden pedir el feed independientemente.
- La conversión cruzada usa aritmética JS para obtener la tasa del feed, como hace hoy la validación de proveedores; antes de persistirla se normaliza al formato decimal existente.
