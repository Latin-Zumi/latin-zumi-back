# Spec: Reorganización de tests en `src/tests`

## Fecha
2026-10-29

## Orden de ejecución: 035

## Problema
Los 16 archivos de prueba están mezclados con el código de producción dentro de
`src/config`, `src/controllers`, `src/handlers`, `src/routes`, `src/schemas`,
`src/services` y `src/utils`. Esa mezcla dificulta distinguir qué archivos se
despliegan y hace más ruidosas las búsquedas o revisiones del código fuente.

Se necesita una carpeta independiente `src/tests/` que conserve la organización
por área, con todos los tests movidos y sus imports apuntando a las rutas
correctas.

## Solución propuesta
Mover cada archivo `*.test.ts` a `src/tests/<área>/`, replicando la estructura
de `src/`. Por ejemplo, `src/controllers/auth.controller.test.ts` pasa a
`src/tests/controllers/auth.controller.test.ts`.

Como Vitest resuelve los imports relativos desde la ubicación del archivo de
prueba, cada referencia sube un nivel adicional. Esto afecta tanto a los imports
normales como a `vi.mock(...)` y a los `await import(...)` dinámicos.

`AppError.test.ts` se mueve a `src/tests/utils/` porque prueba el módulo
`src/utils/AppError.ts`, aunque hoy viva en `src/handlers/`. La carpeta del test
debe reflejar el módulo bajo prueba, no la carpeta donde estaba el archivo.

También se ajusta `vitest.config.ts` para que la suite se descubra únicamente en
`src/tests/**/*.test.ts` y no vuelva a ejecutar copias antiguas si quedara
alguna.

No se modifica `tsconfig.json`: la compilación sigue incluyendo todo `src`, por
lo que los tests se emiten en `dist/tests/` igual que antes se emitían junto al
código. Separar el build de tests queda fuera de este cambio.

### Estructura antes y después

```text
Antes                                      Después
src/config/cors.test.ts                →   src/tests/config/cors.test.ts
src/controllers/accounts.controller... →   src/tests/controllers/accounts.controller...
src/handlers/AppError.test.ts          →   src/tests/utils/AppError.test.ts
src/routes/accounts.route.test.ts      →   src/tests/routes/accounts.route.test.ts
src/schemas/password.test.ts           →   src/tests/schemas/password.test.ts
src/services/accounts.service.test.ts  →   src/tests/services/accounts.service.test.ts
src/services/chat/chat.service.test.ts →   src/tests/services/chat/chat.service.test.ts
src/utils/decimal.test.ts              →   src/tests/utils/decimal.test.ts
```

**Qué ocurre:** los archivos cambian de carpeta y se agrupan por el módulo que
prueban. **Quién lo ejecuta:** el desarrollador o el agente mediante `git mv`,
para conservar el historial de cada archivo. **Resultado:** todo el código de
prueba vive bajo `src/tests/` y `src/` queda con código de producción.

### Caso especial: `AppError` pasa de `handlers` a `utils`

```ts
// Antes: src/handlers/AppError.test.ts
import { AppError } from "../utils/AppError.js";

// Después: src/tests/utils/AppError.test.ts
import { AppError } from "../../utils/AppError.js";
```

**Qué ocurre:** el test cambia de carpeta temática porque el módulo probado es
`src/utils/AppError.ts`, aunque el archivo original estuviera en `src/handlers/`.
La profundidad relativa sigue siendo dos niveles (`../../`). **Quién lo ejecuta:**
Vitest al cargar el test. **Resultado:** el test queda junto a `decimal.test.ts`
en `src/tests/utils/` y sigue importando el mismo `AppError`.

### Imports de tests que estaban junto a su módulo

```ts
// Antes: src/controllers/accounts.controller.test.ts
import { openApiSpec } from '../config/swagger.js';
vi.mock('../services/accounts.service.js', () => ({ /* ... */ }));
import { getAccounts, withdrawAccount } from './accounts.controller.js';

// Después: src/tests/controllers/accounts.controller.test.ts
import { openApiSpec } from '../../config/swagger.js';
vi.mock('../../services/accounts.service.js', () => ({ /* ... */ }));
import { getAccounts, withdrawAccount } from '../../controllers/accounts.controller.js';
```

**Qué ocurre:** al estar un nivel más abajo, cada import relativo gana un `../`.
Los `vi.mock` se actualizan igual porque Vitest resuelve el mock con la misma
ruta que usaría el import del módulo. **Quién lo ejecuta:** Vitest al cargar el
test. **Resultado:** el test sigue importando el controller real y sustituyendo
los servicios por dobles, sin errores de módulo no encontrado.

### Imports de tests anidados (`services/chat`)

```ts
// src/tests/services/chat/chat.service.test.ts
vi.mock('../../../services/accounts.service.js', () => ({
  getAccountsByUserId,
}));
vi.mock('../../../services/transactions.service.js', () => ({
  getTransactionsByUserId,
}));
vi.mock('../../../services/chat/gemini-provider.js', () => ({
  createGeminiProvider,
  normalizeHistory: (history: unknown) => history,
}));

import { sendChatMessage } from '../../../services/chat/chat.service.js';
```

**Qué ocurre:** al conservar la subcarpeta `chat`, la prueba queda a tres niveles
de `src/`, por eso usa `../../../services/...`. **Quién lo ejecuta:** Vitest al
resolver las dependencias del test. **Resultado:** el servicio y sus dos
dependencias simuladas se cargan desde `src/services/`, no desde `src/tests/`.

### Imports dinámicos y mocks de rutas

```ts
// src/tests/routes/accounts.route.test.ts
vi.mock('../../config/db.js', () => ({ pool: { query } }));
vi.mock('../../services/auth.service.js', () => ({ findActiveSession }));

const [{ accountsRouter }, { errorHandler }] = await Promise.all([
  import('../../routes/accounts.route.js'),
  import('../../middleware/errorHandler.js'),
]);
```

**Qué ocurre:** los imports dinámicos usados para montar la app de Express
también se recalculan desde `src/tests/routes/`. **Quién lo ejecuta:** el bloque
`beforeAll` del test de ruta. **Resultado:** se levanta la ruta real con la base
de datos y la sesión simuladas, igual que antes del movimiento.

### Descubrimiento de tests en Vitest

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/tests/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
  },
});
```

**Qué ocurre:** Vitest deja de buscar tests en cualquier parte de `src/` y los
busca solo dentro de `src/tests/`. **Quién lo ejecuta:** `npm test`, que lanza
`vitest run --config vitest.config.ts`. **Resultado:** se ejecutan los 16
archivos movidos y no se cuelan pruebas residuales en otras carpetas.

## Archivos afectados
- `vitest.config.ts`
- `src/config/cors.test.ts` → `src/tests/config/cors.test.ts`
- `src/controllers/accounts.controller.test.ts` → `src/tests/controllers/accounts.controller.test.ts`
- `src/controllers/auth.controller.test.ts` → `src/tests/controllers/auth.controller.test.ts`
- `src/controllers/transactions.controller.test.ts` → `src/tests/controllers/transactions.controller.test.ts`
- `src/handlers/AppError.test.ts` → `src/tests/utils/AppError.test.ts`
- `src/routes/accounts.route.test.ts` → `src/tests/routes/accounts.route.test.ts`
- `src/routes/chat.route.test.ts` → `src/tests/routes/chat.route.test.ts`
- `src/schemas/password.test.ts` → `src/tests/schemas/password.test.ts`
- `src/services/accounts.service.test.ts` → `src/tests/services/accounts.service.test.ts`
- `src/services/auth.service.test.ts` → `src/tests/services/auth.service.test.ts`
- `src/services/chat/chat.service.test.ts` → `src/tests/services/chat/chat.service.test.ts`
- `src/services/chat/gemini-provider.test.ts` → `src/tests/services/chat/gemini-provider.test.ts`
- `src/services/exchange-rate.service.test.ts` → `src/tests/services/exchange-rate.service.test.ts`
- `src/services/transactions.service.test.ts` → `src/tests/services/transactions.service.test.ts`
- `src/services/withdrawal.service.test.ts` → `src/tests/services/withdrawal.service.test.ts`
- `src/utils/decimal.test.ts` → `src/tests/utils/decimal.test.ts`

## Pasos
1. Crear las subcarpetas necesarias dentro de `src/tests/` (`config`,
   `controllers`, `routes`, `schemas`, `services/chat` y `utils`).
2. Mover cada archivo de prueba con `git mv` a su nueva ruta.
3. Ajustar todos los imports estáticos, `vi.mock(...)` e imports dinámicos para
   que referencien `../../<área>/...` o `../../../services/...` según la
   profundidad de cada test.
4. Actualizar `include` en `vitest.config.ts` a `src/tests/**/*.test.ts`.
5. Ejecutar `npm test` y `npm run build` para comprobar rutas y tipos.
6. Confirmar que no queda ningún `*.test.ts` fuera de `src/tests/`.

## Cómo probar
- [x] `find src -name '*.test.ts' -not -path 'src/tests/*'` no devuelve archivos.
- [x] `find src/tests -name '*.test.ts' | wc -l` devuelve `16`.
- [x] `npm test` pasa con 16 archivos y 85 pruebas.
- [x] `npm run build` termina sin errores de TypeScript.
- [x] Los tests de rutas (`accounts.route`, `chat.route`) levantan Express y
  responden correctamente con sus mocks actualizados.

## Riesgos / notas
- Riesgo principal: olvidar un `vi.mock` o un `import()` dinámico. Vitest falla
  con un error claro de módulo no encontrado, y la suite completa lo detecta.
- Los tests de `services/chat` son los más sensibles por estar dos niveles
  dentro de `src/tests/`; requieren tres `../`.
- `dist/` está ignorado por git y puede conservar artefactos antiguos de tests.
  No se versionan y se regeneran con `npm run build`; limpiar `dist/` queda
  fuera de este cambio.
- Los specs históricos siguen nombrando rutas antiguas de tests; no se editan
  porque son registros cerrados. Este spec 035 documenta la nueva ubicación.
