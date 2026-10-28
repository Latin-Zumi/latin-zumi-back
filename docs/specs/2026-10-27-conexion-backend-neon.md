# Spec: Conectar el backend a Neon

## Fecha
2026-10-27

## Orden de ejecución: 023

## Problema
El backend crea su pool con `DB_HOST`, `DB_NAME`, `DB_USER` y `DB_PASSWORD`. La variable `DATABASE_URL` disponible en el entorno apunta a Neon, pero el backend la ignora y usa la configuración local (`DB_HOST=localhost`).

## Solución propuesta
Permitir que `pg.Pool` use `DATABASE_URL` como conexión principal, conservando las variables `DB_*` como alternativa para entornos locales existentes. Si se configura `DATABASE_URL`, esta tiene prioridad. La URL se lee del entorno y no se copia ni se imprime. La conexión pooled de Neon se usa para las consultas normales de la aplicación.

```env
DATABASE_URL=postgresql://<usuario>:<contraseña>@<endpoint-pooler>.neon.tech/<base>?sslmode=require
```

Quien despliega o configura el backend proporciona esta variable en su gestor de secretos. El backend la pasa al driver `pg`; el endpoint pooled y `sslmode=require` permiten que el tráfico normal llegue a Neon con TLS. El valor de ejemplo no es una credencial real.

```ts
const envSchema = z.object({
  DATABASE_URL: z.preprocess((value) => value === '' ? undefined : value, z.string().url().optional()),
  DB_HOST: z.preprocess((value) => value === '' ? undefined : value, z.string().min(1).optional()),
  DB_PORT: z.preprocess((value) => value === '' ? undefined : value, z.coerce.number().int().positive().default(5432)),
  DB_NAME: z.preprocess((value) => value === '' ? undefined : value, z.string().min(1).optional()),
  DB_USER: z.preprocess((value) => value === '' ? undefined : value, z.string().min(1).optional()),
  DB_PASSWORD: z.preprocess((value) => value === '' ? undefined : value, z.string().min(1).optional()),
}).refine(
  ({ DATABASE_URL, DB_HOST, DB_NAME, DB_USER, DB_PASSWORD }) =>
    Boolean(DATABASE_URL || (DB_HOST && DB_NAME && DB_USER && DB_PASSWORD)),
  { message: 'Configura DATABASE_URL o todos los campos DB_* requeridos' },
);
```

El módulo de entorno valida que exista una conexión completa: basta `DATABASE_URL`, o bien se requieren los cuatro campos locales. Así la app deja de exigir `DB_*` cuando se conecta con Neon sin romper la configuración local.

```ts
export const pool = new Pool(
  env.DATABASE_URL
    ? { connectionString: env.DATABASE_URL, max: env.DB_MAX }
    : {
        host: env.DB_HOST,
        port: env.DB_PORT,
        database: env.DB_NAME,
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        max: env.DB_MAX,
      },
);
```

El módulo de configuración del backend crea un único pool compartido por los servicios. Si existe `DATABASE_URL`, el pool se conecta con esa URL; si no, conserva la conexión con campos separados para desarrollo local.

```ts
await pool.query('SELECT 1');
```

El endpoint `GET /health/ready` ya ejecuta esta consulta mediante el pool. Al usar `DATABASE_URL`, una respuesta `200` con `db: "ok"` confirma que el backend pudo consultar la base configurada; una conexión fallida produce `503`.

## Archivos afectados
- src/config/env.ts
- src/config/db.ts
- .env.example
- db/README.md
- docs/specs/2026-10-27-conexion-backend-neon.md
- docs/specs/README.md

## Pasos
1. Validar `DATABASE_URL` como configuración suficiente y mantener `DB_*` para el modo local.
2. Dar prioridad a `DATABASE_URL` al construir el pool de PostgreSQL.
3. Documentar cómo proveer la URL sin incluir credenciales reales en el repositorio.
4. Comprobar la conexión con `GET /health/ready` y una consulta de solo lectura.

## Cómo probar
- [x] La configuración acepta `DATABASE_URL` sin exigir `DB_HOST`, `DB_NAME`, `DB_USER` ni `DB_PASSWORD`.
- [x] Sin `DATABASE_URL`, la configuración existente con `DB_*` sigue siendo válida.
- [x] Con la URL de Neon configurada, `GET /health/ready` responde `200` y `db: "ok"`.

## Riesgos / notas
- `DATABASE_URL` contiene credenciales: debe configurarse como secreto y nunca registrarse en logs ni subirse al repositorio.
- Una URL incorrecta o inaccesible hará que readiness responda `503`; eso evita reportar disponibilidad de base de datos cuando no hay conexión.
- La guía oficial de Neon recomienda pasar `DATABASE_URL` al driver PostgreSQL, usar TLS y preferir la cadena pooled para el tráfico de la aplicación: https://neon.com/docs/connect/connect-from-any-app
