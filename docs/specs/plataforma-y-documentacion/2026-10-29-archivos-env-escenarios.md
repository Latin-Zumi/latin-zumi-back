# Spec: Archivos .env por escenario

## Fecha

2026-10-29

## Orden de ejecución: 034

## Problema

El spec 033 (`2026-10-29-configuracion-env-y-lectura-dotenv.md`) dejó la
arquitectura de entorno centralizada en `src/config/env.ts` y documentó los
escenarios de `.env` definidos en el plan
`~/.opencode/plan/2026-10-29-Configuracion-Env-y-Lectura-Dotenv.md`:

- Escenario A: PostgreSQL local (línea 152).
- Escenario B: desarrollo local contra Neon (línea 173).
- Escenario C: producción en Render (línea 188).

Sin embargo, el repositorio no tiene archivos `.env` por escenario creados: el
desarrollador debe armarlos manualmente en cada máquina. Además, el `.gitignore`
cubre `*.env`, `.env.local`, `.env.test`, `.env.development` y
`.env.production`, pero no un patrón genérico para los sufijos de escenario del
plan (por ejemplo `.env.neon`), por lo que un archivo con ese nombre quedaría
versionable por accidente.

## Solución propuesta

Crear un archivo `.env` por escenario con el contenido definido en el plan y
ajustar el `.gitignore` para que ningún archivo de entorno quede versionado,
conservando `.env.example` como plantilla versionada.

### Flujo 1: Escenario A — PostgreSQL local

```dotenv
NODE_ENV=development
PORT=3000

DB_HOST=localhost
DB_PORT=5432
DB_NAME=latin_zumi
DB_USER=postgres
DB_PASSWORD=cambiar
DB_MAX=20
DB_IDLE_TIMEOUT_MILLIS=30000
DB_CONNECTION_TIMEOUT_MILLIS=2000

CORS_ORIGINS=http://localhost:5173

EXCHANGE_RATE_TIMEOUT_MS=3000
EXCHANGE_RATE_MAX_AGE_HOURS=24
```

El desarrollador coloca este contenido en `.env`. Al arrancar, `src/config/env.ts`
carga el archivo con `dotenv` y valida con Zod: como no define `DATABASE_URL`,
la validación exige `DB_HOST`, `DB_NAME` y `DB_USER` (junto con `DB_PASSWORD`).
El pool de `src/config/db.ts` y los scripts de `db/scripts/` conectan a
PostgreSQL local en `localhost:5432`. El desarrollador lo ejecuta con
`npm run db:init` y `npm start`.

### Flujo 2: Escenario B — desarrollo local contra Neon

```dotenv
NODE_ENV=development
PORT=3000

DATABASE_URL=postgresql://usuario:password@host-pooler.neon.tech/neondb?sslmode=verify-full
DATABASE_URL_UNPOOLED=postgresql://usuario:password@host.neon.tech/neondb?sslmode=verify-full

CORS_ORIGINS=http://localhost:5173

EXCHANGE_RATE_TIMEOUT_MS=3000
EXCHANGE_RATE_MAX_AGE_HOURS=24
```

El desarrollador coloca este contenido en `.env.neon`. Con `DATABASE_URL`
presente, `src/config/env.ts` lo usa como vía principal y la validación no exige
los campos `DB_*`. `getClientConfig()` normaliza `sslmode=verify-full` sobre la
URL pooled; `DATABASE_URL_UNPOOLED` queda disponible para el build y las
migraciones, no para el runtime. El desarrollador renombra o copia este archivo
a `.env` cuando quiere trabajar contra Neon.

### Flujo 3: Escenario C — producción en Render

```dotenv
NODE_ENV=production
DATABASE_URL=postgresql://usuario:password@host-pooler.neon.tech/neondb?sslmode=verify-full
DATABASE_URL_UNPOOLED=postgresql://usuario:password@host.neon.tech/neondb?sslmode=verify-full
CORS_ORIGINS=https://<dominio-del-frontend>
DB_CONNECTION_TIMEOUT_MILLIS=10000
```

El operador usa este contenido en `.env.production` como plantilla del entorno
de producción: `NODE_ENV=production`, `DATABASE_URL` para la app,
`DATABASE_URL_UNPOOLED` para el build/migraciones y un timeout de conexión de
10 s para tolerar el arranque en frío de Neon. En Render la vía real es el
dashboard del servicio y el Blueprint; el archivo no se sube con valores
reales.

### Flujo 4: `.gitignore` cubre los archivos de escenario

```gitignore
# ---------- React / JS ----------
*.env
.env.*
!/.env.example
!.env.example
coverage/
```

El mantenedor reemplaza las entradas específicas (`.env.local`, `.env.test`,
`.env.development`, `.env.production`) por el patrón genérico `.env.*`.
`*.env` ignora `.env`; `.env.*` ignora los archivos de escenario
(`.env.neon`, `.env.production`, etc.); `!.env.example` reintroduce la plantilla
versionada. El resultado es que `git check-ignore` marca los tres archivos de
escenario y no marca `.env.example`, y `git status --short` no lista ninguno de
los `.env`.

## Archivos afectados

- `.env` (nuevo; Escenario A: PostgreSQL local)
- `.env.neon` (nuevo; Escenario B: desarrollo local contra Neon)
- `.env.production` (nuevo; Escenario C: producción en Render)
- `.gitignore` (patrones `*.env`, `.env.*` y `!.env.example`)

No se modifican tests ni código de producción.

## Pasos

1. Crear el archivo `.env` con el contenido del Escenario A.
2. Crear el archivo `.env.neon` con el contenido del Escenario B.
3. Crear el archivo `.env.production` con el contenido del Escenario C.
4. Ajustar `.gitignore` para ignorar `.env` y `.env.<escenario>` conservando la
   excepción `!.env.example`.
5. Verificar con `git check-ignore -v` y `git status --short`.

## Cómo probar

- [x] `git check-ignore -v .env` retorna un match (`.gitignore:40:*.env`).
- [x] `git check-ignore -v .env.neon` retorna un match (`.gitignore:41:.env.*`).
- [x] `git check-ignore -v .env.production` retorna un match (`.gitignore:41:.env.*`).
- [x] `git check-ignore -v .env.example` NO retorna match (debe seguir versionado).
- [x] `git status --short` no lista los archivos `.env` creados.

## Riesgos / notas

- Ninguno de los archivos `.env` creados debe contener credenciales reales: los
  valores de Neon y Render son marcadores de posición y se cargan en gestores de
  secretos.
- El patrón `.env.*` requiere la excepción `!.env.example`; sin ella, la
  plantilla versionada dejaría de estar rastreada.
- `DATABASE_URL_UNPOOLED` queda incluida en los escenarios B y C aunque el
  runtime no la use: sirve para el build y las migraciones.
- En producción (Render) no se sube `.env`; las variables reales se cargan como
  secretos en el dashboard o el Blueprint.
- El objeto `env` contiene credenciales en `DATABASE_URL` y `DB_PASSWORD`; no
  debe imprimirse completo en logs.
- Este spec no registra entrada en `docs/specs/index-specs.md`: el índice fue
  revertido manualmente y se actualiza aparte cuando el equipo decida.
