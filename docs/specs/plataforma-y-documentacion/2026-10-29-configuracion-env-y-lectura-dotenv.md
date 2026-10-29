# Spec: Configuración de entorno y lectura de dotenv

## Fecha

2026-10-29

## Orden de ejecución: 033

## Problema

`src/config/env.ts` ya es el módulo único que importa `dotenv/config`, lee
`process.env`, valida las variables con Zod y exporta el objeto `env` para el
resto del proyecto.

Sin embargo, los dos scripts de base de datos (`db/scripts/init-db.ts` y
`db/scripts/seed-db.ts`) además de importar `getClientConfig()` —que a su vez
importa a `src/config/env.ts` vía `db-connection.ts`— mantenían un
`import 'dotenv/config';` propio.

Hoy el arranque funciona por la cadena de imports, pero la regla de "un solo
punto de carga" se rompe: hay un segundo cargador de variables en el mismo
proceso. Si un script o módulo futuro agrega un cargador paralelo, la validación
y los defaults de `env.ts` dejarían de aplicarse.

## Solución propuesta

Quitar el `import 'dotenv/config';` duplicado de los dos scripts de `db/`.
`src/config/env.ts` se mantiene sin cambios funcionales como el único módulo que
carga el archivo `.env`, lee `process.env`, valida y exporta `env`. Los scripts
obtienen la configuración mediante `getClientConfig()`, que depende de `env`.

Este spec no agrega variables nuevas, no agrega tests ni incluye refactors fuera
del alcance.

### Flujo 1: los scripts de base de datos ya no cargan `.env`

Estado final de `db/scripts/init-db.ts`:

```ts
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { getClientConfig } from '../../src/config/db-connection.js';

const { Client } = pg;

const client = new Client(getClientConfig());
```

Estado final de `db/scripts/seed-db.ts`:

```ts
import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';
import { getClientConfig } from '../../src/config/db-connection.js';

const { Client } = pg;

const client = new Client(getClientConfig());
```

Antes de este spec, la primera línea de cada archivo era:

```ts
import 'dotenv/config';
```

Al eliminarla, el script ya no registra un cargador de `.env`. Quien carga y
valida el entorno pasa a ser únicamente `src/config/env.ts`, a través de la cadena
de imports `init-db.ts -> db-connection.ts -> env.ts`. El helper
`getClientConfig()` construye la configuración del `Client` a partir del objeto
`env` validado, por lo que el comportamiento de conexión no cambia.

### Flujo 2: `src/config/env.ts` sigue siendo el único punto de carga

```ts
import 'dotenv/config';
import { z } from 'zod';

// ... esquema y validaciones ...

export const env = envSchema.parse(process.env);
```

`import 'dotenv/config'` registra el archivo `.env` antes de que se ejecute el
parse; `envSchema.parse(process.env)` valida y transforma las variables; y
`export const env` expone el único objeto consumido por el resto del proyecto.

Si en el futuro se necesita una ruta distinta para el archivo de entorno, ese
cambio debe hacerse dentro de este mismo archivo, nunca en otro módulo.

### Flujo 3: los consumidores obtienen la configuración vía helpers

```ts
import { getClientConfig } from '../../src/config/db-connection.js';

const client = new Client(getClientConfig());
```

`getClientConfig()` (definido en `src/config/db-connection.ts`) lee valores de
`env` y devuelve la configuración con `connectionTimeoutMillis`. Los módulos que
necesitan una configuración derivada pueden usarlo directamente o
`getPoolConfig()`. Ningún consumidor lee `process.env` ni ejecuta dotenv por su
cuenta.

## Archivos afectados

- `db/scripts/init-db.ts` (quitar `import 'dotenv/config'`)
- `db/scripts/seed-db.ts` (quitar `import 'dotenv/config'`)
- `src/config/env.ts` (sin cambios funcionales; se mantiene como único cargador
  y exportador)
- `docs/specs/index-specs.md`

No se modifican tests ni se agregan archivos de test.

## Pasos

1. Confirmar con `grep` que `dotenv` y `process.env` aparecen solo en
   `src/config/env.ts` y en los dos scripts.
2. Quitar `import 'dotenv/config';` de `db/scripts/init-db.ts`.
3. Quitar `import 'dotenv/config';` de `db/scripts/seed-db.ts`.
4. Confirmar que ambos scripts conservan `getClientConfig()` y no leen
   `process.env` directamente.
5. Mantener `src/config/env.ts` como está: carga, valida y exporta `env`.
6. Revisar que todos los consumidores importen `env` o un helper que lo importe.
7. Verificar los escenarios de `.env` con build, `db:init` y arranque local.
8. Crear un archivo `.env.<escenario>` por cada escenario.
9. Confirmar que `.env` y `.env.<escenario>` se encuentran ignorados por Git.

## Cómo probar

- [x] `grep -rn "dotenv" src db --include='*.ts'` solo retorna `src/config/env.ts`.
- [x] `grep -rn "process\.env" src db --include='*.ts'` solo retorna `src/config/env.ts`.
- [x] `grep -rn "config/env\|getClientConfig\|getPoolConfig" src db --include='*.ts'`
      muestra consumidores que usan `env` o helpers que lo importan.
- [x] `npm run build` completa sin errores de tipos.
- [ ] `npm run db:init` funciona con `.env` local.
- [ ] `npm start` funciona con `.env` y también solo con variables del shell.
- [x] `.env` no se versiona (`git check-ignore -v .env`).

## Riesgos / notas

- Quitar `dotenv/config` de los scripts de DB es seguro porque
  `getClientConfig()` importa `db-connection.ts`, que importa `env.ts`, y las
  importaciones de ESM se evalúan antes de ejecutar `new Client(...)`.
- No se debe "resolver" una variable leyendo `process.env` en un servicio o
  controlador. Si falta una variable, se agrega al esquema de `env.ts` y se
  consume desde `env`.
- `DATABASE_URL_UNPOOLED` no debe pasar por el pool de la aplicación: es solo
  para el build/migraciones.
- En Render no se sube `.env`; se usan las variables de entorno del servicio.
- El objeto `env` contiene credenciales en `DATABASE_URL` y `DB_PASSWORD`; no
  debe imprimirse completo en logs.
