# Spec: mínimo funcional de autenticación (cambios 4, 6 y 8)

## Fecha

2026-10-27

## Orden de ejecución

**025.** Registrado en el índice de `docs/specs/index-specs.md`. No reutilizar
números ya asignados.

## Alcance

Este spec agrupa los cambios 4, 6 y 8 de la tabla **Los ocho cambios del
mínimo** (`~/.opencode/plan/2026-10-27-Checklist-Integrada-Front-Back.md`,
línea 66). El cambio 5 (contrato de sesión y login, decisión D1) se extrajo al
spec 026 (`docs/specs/autenticacion/2026-10-27-contrato-sesion-login.md`), que se implementa
después de la migración 008 y antes del registro y del front.

| # | Cambio | Fase | Qué incluye |
| --- | --- | --- | --- |
| 4 | Migración 008 completa | F7 | `nombre`, `pais`, `moneda_preferida`, `roles`, `estado`, `foto_url`, `google_uid`, `password_hash` nullable, checks e índices. |
| 6 | `POST /auth/register` | F8 | Registro con usuario + wallet + cuenta + sesión en una transacción. |
| 8 | Front contra el contrato mínimo | F13 (subconjunto) | Tipos UUID, payloads, balances con `GET /accounts`, `VITE_API_URL`, mock off, logout real y Google oculto. |

**Fuera de alcance:** el contrato de sesión y login (cambio 5, D1), que vive en
el spec 026; Google (`POST /auth/google`, F9), perfil
(`PATCH /users/me`, F10), `GET /auth/me` (D14 = B), pantalla de cambio de
contraseña (D4 = B), CORS (F6), `DATABASE_URL` en scripts de DB (F3), Node y
`railway.json` (F4), CI (F2), versionado de migraciones (F12),
`idempotency_key` y logging estructurado (F5) y staging formal (F14).

## Decisiones que este spec asume

| ID | Decisión | Valor asumido |
| --- | --- | --- |
| D2 | Registro | A: `POST /auth/register` nuevo; `POST /users` queda legado. |
| D3 | Mínimo de contraseña | A: 15–128 en front y back. |
| D4 | Cambio obligatorio | B: se pospone; no hay pantalla en el mínimo. |
| D5 | Balances | A: el front usa `GET /accounts`. |
| D8 | Logout real | A: el front llama `POST /auth/logout` antes de limpiar `localStorage`. |
| D9 | Topología | A: una réplica; rate limit por proceso documentado. |
| D14 | `GET /auth/me` | B: la sesión se restaura desde `localStorage`. |
| D16 | CORS | Allowlist con `http://localhost:5173` y el dominio de Vercel (F6). |
| D18 | Repo del front | `latin-zumi-front/latin-zumi-react` es la fuente de verdad. |

**D1 (envelope `{ token, user }`)** se define en el spec 026. Este spec lo
asume para el registro y para el front, pero no repite su implementación.

Si alguna decisión cambia antes de implementar, ajustar este spec. En
particular, D4 = A agregaría una pantalla de cambio de contraseña y D14 = A
agregaría `GET /auth/me`; ninguno de los dos es necesario para el mínimo.

## Problema

El flujo **registro → Dashboard → recarga → logout → login** no funciona hoy
con `VITE_USE_MOCK=false`:

- El login todavía devuelve el envelope viejo y no incluye `user`. Eso se
  resuelve en el spec 026; este spec asume `{ token, user }` para el registro y
  el front.
- No existe `POST /auth/register`. El front lo llama, pero el back solo tiene
  `POST /users`, que pide `{ username, email, password, currency }`, no crea
  sesión y devuelve `{ data: { user, account, wallet_id } }`.
- La tabla `users` no tiene `nombre`, `pais`, `moneda_preferida`, `roles`,
  `estado`, `foto_url` ni `google_uid`; `password_hash` es `NOT NULL`. El
  contrato de sesión no se puede cumplir.
- El front tipa `AuthUser.id` como `number` y `Balance.wallet_id` como
  `number`; el back usa UUID.
- El front llama `GET /wallet/balances`, que no existe; el back expone
  `GET /accounts` con `{ data: Account[] }`.
- El front permite contraseñas de 6 caracteres; el back exige 15.
- El logout del front solo borra `localStorage`; no revoca el token del back.
- El botón de Google y la ruta `/completar-perfil` siguen visibles aunque el
  backend no tenga `POST /auth/google` ni `PATCH /users/me`.

## Contrato mínimo

| Método | Ruta | Request | Respuesta | Errores |
| --- | --- | --- | --- | --- |
| `POST` | `/auth/register` | `{ nombre, email, pais, password }` | `201 { token, user }` | `400`, `409`, `429` |
| `POST` | `/auth/logout` | Bearer | `204` | `401` |
| `GET` | `/accounts` (ya existe) | Bearer | `200 { data: Account[] }` | `401`, `403` |

`POST /auth/login` y el shape canónico de `user` se definen en el spec 026
(`toAuthUser`). El registro devuelve el mismo shape, sin `password_hash` ni
`google_uid`:

```json
{
  "id": "20000000-0000-4000-8000-000000000001",
  "nombre": "Ana Pérez",
  "email": "ana@example.com",
  "pais": "Argentina",
  "moneda_preferida": "ARS",
  "roles": ["user"],
  "estado": "activo",
  "foto_url": null
}
```

Reglas:

- `id` es `string` (UUID), no `number`.
- `pais` es `null` hasta que el usuario completa el perfil. En el registro
  normal siempre viene informado.
- `roles` siempre es un arreglo; `getSession()` del front depende de eso.
- `moneda_preferida` se deriva de `pais`: Argentina → `ARS`, Colombia → `COP`,
  Otro → `USD`.
- Las respuestas de autenticación usan `{ token, user }` (D1 = A, spec 026);
  los endpoints de datos existentes conservan `{ data: ... }`.
- El token es el Bearer opaco del backend, no un token de Firebase.
- El login, su validación de `identifier` y la creación de sesión están en el
  spec 026; este spec solo consume `toAuthUser` y `createSessionForUser`.

---

## Cambio 4 — Migración 008 completa (F7)

### Objetivo

Que el modelo soporte el contrato de sesión y deje preparado el terreno para
Google sin tener que migrar dos veces. La migración se aplica entera ahora,
aunque `google_uid` y `foto_url` todavía no se usen en el mínimo.

### Archivo

`db/migrations/008_google_auth_profile.sql` (nuevo).

### SQL propuesto

```sql
-- 008_google_auth_profile.sql
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS nombre TEXT,
    ADD COLUMN IF NOT EXISTS pais TEXT,
    ADD COLUMN IF NOT EXISTS moneda_preferida CHAR(3),
    ADD COLUMN IF NOT EXISTS foto_url TEXT,
    ADD COLUMN IF NOT EXISTS google_uid TEXT,
    ADD COLUMN IF NOT EXISTS roles TEXT[] NOT NULL DEFAULT '{user}',
    ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'activo';

-- 1. Resolver emails duplicados ignorando mayúsculas antes del índice único.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM users
         GROUP BY lower(email)
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Hay emails duplicados ignorando mayúsculas; resolvelos antes de aplicar 008';
    END IF;
END;
$$;

UPDATE users SET email = lower(email) WHERE email <> lower(email);

-- 2. Backfill de los datos existentes.
UPDATE users
   SET nombre = username
 WHERE nombre IS NULL OR nombre = '';

UPDATE users u
   SET moneda_preferida = RTRIM(w.primary_currency)
  FROM wallets w
 WHERE w.user_id = u.id;

UPDATE users
   SET moneda_preferida = 'USD'
 WHERE moneda_preferida IS NULL;

-- 3. Normalizar nullability y defaults (idempotente si la columna ya existía).
UPDATE users SET roles = '{user}' WHERE roles IS NULL;
ALTER TABLE users ALTER COLUMN roles SET DEFAULT '{user}';
ALTER TABLE users ALTER COLUMN roles SET NOT NULL;

UPDATE users SET estado = 'activo' WHERE estado IS NULL;
ALTER TABLE users ALTER COLUMN estado SET DEFAULT 'activo';
ALTER TABLE users ALTER COLUMN estado SET NOT NULL;

ALTER TABLE users ALTER COLUMN moneda_preferida SET DEFAULT 'USD';
ALTER TABLE users ALTER COLUMN moneda_preferida SET NOT NULL;

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- 4. Checks del contrato.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'users_pais_check'
           AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_pais_check
            CHECK (pais IN ('Argentina', 'Colombia', 'Otro'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'users_moneda_preferida_check'
           AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_moneda_preferida_check
            CHECK (moneda_preferida IN ('USD', 'COP', 'ARS', 'EUR'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'users_estado_check'
           AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_estado_check
            CHECK (estado IN ('activo', 'inactivo', 'bloqueado'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'users_access_method_check'
           AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_access_method_check
            CHECK (password_hash IS NOT NULL OR google_uid IS NOT NULL);
    END IF;
END;
$$;

-- 5. Unicidad de Google y de email sin distinguir mayúsculas.
CREATE UNIQUE INDEX IF NOT EXISTS users_google_uid_idx
    ON users (google_uid)
 WHERE google_uid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx
    ON users (lower(email));
```

### Qué hace cada bloque

1. **Columnas nuevas:** `nombre` y `pais` quedan nullable porque un usuario de
   Google puede no tener nombre o país al registrarse. `moneda_preferida` se
   normaliza a `NOT NULL DEFAULT 'USD'` para que el contrato siempre tenga un
   valor; `roles` y `estado` tienen default y `NOT NULL`.
2. **Email:** si hay dos filas que solo difieren en mayúsculas, la migración
   falla con un mensaje claro. Si no, normaliza los emails existentes y recién
   después crea el índice único sobre `lower(email)`.
3. **Backfill:** `nombre` sale de `username`; `moneda_preferida` sale de
   `wallets.primary_currency`; los usuarios sin wallet quedan en `USD`;
   `pais` queda `NULL`.
4. **Acceso:** `password_hash` puede ser `NULL` para usuarios solo-Google. El
   check `users_access_method_check` impide un usuario sin contraseña y sin
   `google_uid`.
5. **Índices:** `google_uid` es único solo cuando no es `NULL`; `email` es
   único sin distinguir mayúsculas.

### `db/scripts/init-db.ts`

Agregar la migración después de `007_currency_conversions.sql`, dentro de la
misma transacción:

```ts
const googleAuthProfileMigration = await readFile(
  new URL('../migrations/008_google_auth_profile.sql', import.meta.url),
  'utf8',
);
await client.query(googleAuthProfileMigration);
```

Quien ejecuta es `npm run db:init`; el resultado es que una base vacía y una
base existente terminan con el mismo esquema. Si F3 ya refactorizó el script
para descubrir archivos o usar una conexión compartida, insertar 008 en el
mismo orden sin duplicar la lectura.

### Seed demo

`db/seeds/001_demo_data.sql` inserta usuarios después de la migración. Para que
los datos demo no queden incoherentes, actualizar el `INSERT INTO users` para
incluir `nombre`, `pais` y `moneda_preferida` acordes a la wallet:

```sql
INSERT INTO users
    (id, username, email, password_hash, nombre, pais, moneda_preferida)
VALUES
    ('20000000-0000-4000-8000-000000000001', 'demo-user',
     'demo@example.com', 'seed-only-not-for-authentication',
     'Demo User', 'Otro', 'USD'),
    ('20000000-0000-4000-8000-000000000002', 'ana.perez',
     'ana@example.com', 'seed-only-not-for-authentication',
     'Ana Pérez', 'Argentina', 'ARS')
    -- ... el resto de identidades demo
ON CONFLICT DO NOTHING;
```

Las filas demo creadas antes de 008 ya quedan corregidas por el backfill de la
migración. Las filas nuevas del seed necesitan los valores explícitos porque el
seed corre después de la migración.

### Normalización de email y username

- Toda escritura y búsqueda de email usa `trim().toLowerCase()`:
  `POST /auth/register`, `POST /auth/login` y `registerUser` legado.
- `username` sigue siendo `NOT NULL UNIQUE`. Como `/auth/register` no lo pide,
  se deriva del email:

```ts
function buildUsername(email: string): string {
  const local = email.split('@')[0] ?? 'user';
  const base = local
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '.')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 24);

  return base.length >= 3 ? base : `user.${base || 'demo'}`;
}
```

Si el username ya existe, se reintenta con un sufijo aleatorio corto
(`base-<4 hex>`) sin abortar la transacción. El username no se expone en el
contrato.

### Archivos afectados

- `db/migrations/008_google_auth_profile.sql` (nuevo)
- `db/scripts/init-db.ts`
- `db/seeds/001_demo_data.sql`
- `db/README.md`

### Cómo probar

- [ ] `npm run db:init` aplica 001–008 sobre una base vacía.
- [ ] `npm run db:init` dos veces seguidas no falla y no duplica columnas,
      checks ni índices.
- [ ] `npm run db:init` aplica 008 sobre una base con usuarios, wallets y
      cuentas existentes.
- [ ] `psql` muestra las columnas, checks e índices esperados en `users`.
- [ ] Un usuario con `password_hash` y sin `google_uid` se inserta.
- [ ] Un usuario con `google_uid` y `password_hash NULL` se inserta.
- [ ] Un usuario con ambos `NULL` falla por `users_access_method_check`.
- [ ] Un email con mayúsculas se guarda en minúsculas y no se puede duplicar
      con otra combinación de mayúsculas.
- [ ] `npm run db:seed` dos veces seguidas mantiene los saldos demo y los
      usuarios con `moneda_preferida` coherente.

---

## Cambio 6 — `POST /auth/register` (F8)

### Objetivo

Que el front tenga un registro que cree usuario, wallet, cuenta inicial y
sesión, y que devuelva `201 { token, user }` sin pasos adicionales.

Este cambio depende del spec 026: reutiliza `toAuthUser` y
`createSessionForUser` para serializar el usuario y crear la sesión. La
migración 008 de este spec debe estar aplicada antes de ejecutarlo.

### Contrato

```http
POST /auth/register
Content-Type: application/json

{
  "nombre": "Ana Pérez",
  "email": "ana@example.com",
  "pais": "Argentina",
  "password": "una-clave-de-15-o-mas"
}
```

```http
201 Created
{
  "token": "<token-opaco>",
  "user": {
    "id": "…",
    "nombre": "Ana Pérez",
    "email": "ana@example.com",
    "pais": "Argentina",
    "moneda_preferida": "ARS",
    "roles": ["user"],
    "estado": "activo",
    "foto_url": null
  }
}
```

### Validación

En `src/controllers/auth.controller.ts` (o un controller de registro separado):

```ts
const registerSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(2, 'Ingresá tu nombre')
    .max(50, 'El nombre no puede superar los 50 caracteres')
    .regex(
      /^[\p{L}\p{M}]+(?:[ '\u2019\u002D\u00B7.][\p{L}\p{M}]+)*$/u,
      'Ingresá un nombre válido, sin números',
    ),
  email: z
    .string()
    .trim()
    .email('Ingresá un email válido')
    .max(254)
    .transform((value) => value.toLowerCase()),
  pais: z.enum(['Argentina', 'Colombia', 'Otro']),
  password: z
    .string()
    .max(128)
    .refine(isPasswordLongEnough, 'La contraseña debe tener entre 15 y 128 caracteres'),
});

export async function register(req: Request, res: Response) {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError('Datos de registro inválidos', 400);

  const result = await registerAccount(parsed.data);
  return res.status(201).json(result);
}
```

La validación de nombre replica la del front (`nombreSchema`) para que un
payload aceptado por la UI no sea rechazado por el back. El email se normaliza
a minúsculas antes de cualquier búsqueda o inserción.

### Transacción de registro

`registerAccount` vive en `src/services/auth.service.ts` y hace todo dentro de
una transacción:

```ts
export async function registerAccount(input: RegisterInput) {
  // scrypt es costoso: se calcula antes de abrir la transacción para no
  // retener una conexión mientras se hashea la contraseña.
  const passwordHash = await hashPassword(input.password);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const user = await createUserWithWallet(client, {
      username: buildUsername(input.email),
      email: input.email,
      passwordHash,
      nombre: input.nombre,
      pais: input.pais,
      monedaPreferida: currencyForCountry(input.pais),
    });

    const session = await createSessionForUser(user.id, {
      passwordChangeRequired: false,
      client,
    });

    await client.query('COMMIT');
    return { token: session.token, user: toAuthUser(user) };
  } catch (error) {
    await client.query('ROLLBACK');

    if (
      isUniqueViolation(error, 'users_email_key') ||
      isUniqueViolation(error, 'users_email_lower_idx')
    ) {
      throw new AppError('Email ya registrado', 409);
    }

    throw error;
  } finally {
    client.release();
  }
}
```

Quién ejecuta: el controller `register` llama al servicio; el servicio abre la
transacción, crea las cuatro filas y recién entonces responde. Si falla
cualquier paso, el `ROLLBACK` deja la base sin usuario, wallet, cuenta ni
sesión.

### Creación compartida de usuario + wallet + cuenta

En `src/services/users.service.ts`, extraer una función que reciba un
`PoolClient` y sirva para registro normal y, en F9, para Google. El tipo
`AuthUserRow` se importa del spec 026 (`auth.service.ts`):

```ts
export async function createUserWithWallet(
  client: PoolClient,
  input: CreateUserWithWalletInput,
): Promise<AuthUserRow> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const username = attempt === 0
      ? input.username
      : withSuffix(input.username, attempt);

    const userResult = await client.query<AuthUserRow>(
      `INSERT INTO users
         (username, email, password_hash, nombre, pais, moneda_preferida)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (username) DO NOTHING
       RETURNING id, username, email, nombre, pais,
                 RTRIM(moneda_preferida) AS moneda_preferida,
                 roles, estado, foto_url`,
      [
        username,
        input.email,
        input.passwordHash,
        input.nombre,
        input.pais,
        input.monedaPreferida,
      ],
    );

    const user = userResult.rows[0];
    if (!user) continue;

    const walletResult = await client.query<{ id: string }>(
      `INSERT INTO wallets (user_id, primary_currency)
       VALUES ($1, $2)
       RETURNING id`,
      [user.id, input.monedaPreferida],
    );

    await client.query(
      `INSERT INTO accounts
         (user_id, wallet_id, currency, account_type, allow_negative)
       VALUES ($1, $2, $3, 'user', false)`,
      [user.id, walletResult.rows[0].id, input.monedaPreferida],
    );

    return user;
  }

  throw new AppError('No se pudo generar un username único', 500);
}
```

Detalles:

- `ON CONFLICT (username) DO NOTHING` evita abortar la transacción si el
  username derivado ya existe; se reintenta con sufijo.
- Un conflicto de email sigue lanzando `23505` y se traduce a `409` en
  `registerAccount`.
- La wallet se crea con `primary_currency` igual a la moneda derivada del país.
- La cuenta inicial se crea con `account_type = 'user'`, `allow_negative =
  false` y la misma moneda.
- No se duplica el SQL entre registro normal y Google: F9 reutiliza esta
  función pasando `passwordHash: null`, `googleUid` y `fotoUrl`.

### Moneda por país

Un helper compartido, por ejemplo `src/utils/country.ts`:

```ts
export const PAISES = ['Argentina', 'Colombia', 'Otro'] as const;
export type Pais = (typeof PAISES)[number];

const CURRENCY_BY_COUNTRY: Record<Pais, string> = {
  Argentina: 'ARS',
  Colombia: 'COP',
  Otro: 'USD',
};

export function currencyForCountry(pais: Pais): string {
  return CURRENCY_BY_COUNTRY[pais];
}
```

El back es la fuente de verdad; el front puede seguir usando su mapa local para
los mocks.

### Errores

| Caso | Respuesta | Mensaje |
| --- | --- | --- |
| Payload inválido (nombre, email, país, contraseña) | `400` | `Datos de registro inválidos` |
| Email ya registrado (incluye mayúsculas distintas) | `409` | `Email ya registrado` |
| Demasiados intentos | `429` | `Demasiados intentos; intenta más tarde` |
| Error inesperado | `500` | `Error interno del servidor` |

El `errorHandler` global hoy traduce `23505` a `400`. Por eso el `409` debe
capturarse en `registerAccount`/controller antes de que escape. No se cambia el
handler global en este spec.

### Rate limit

Agregar `registrationRateLimit` a la ruta nueva, igual que `POST /users`:

```ts
authRouter.post(
  '/auth/register',
  registrationRateLimit,
  asyncHandler(register),
);
```

### `POST /users` legado

Según D2 = A, `POST /users` sigue funcionando para no romper consumidores
existentes, pero:

- Se marca `deprecated: true` en Swagger.
- El summary dice “Legado: crea usuario, wallet y cuenta; no crea sesión”.
- `README.md` indica que el registro nuevo es `POST /auth/register`.
- Su respuesta `{ data: { user, account, wallet_id } }` no cambia.

`registerUser` puede reutilizar `createUserWithWallet` pasando
`nombre: username`, `pais: null`, `monedaPreferida: currency` y el hash
recibido, y luego mapear el resultado al shape legado.

### Archivos afectados

- `src/routes/auth.route.ts`
- `src/controllers/auth.controller.ts` (solo `register`)
- `src/services/auth.service.ts` (solo `registerAccount`; `toAuthUser` y
  `createSessionForUser` son del spec 026)
- `src/services/users.service.ts`
- `src/utils/country.ts` (nuevo)
- `src/config/swagger.ts` (solo `/auth/register` y `/users` legado)
- `README.md`
- `src/controllers/auth.controller.test.ts` (nuevo o ampliado)
- `src/services/users.service.test.ts` (nuevo o ampliado)

### Cómo probar

Requiere el spec 026 implementado (`toAuthUser` y `createSessionForUser`) y la
migración 008 aplicada.

- [ ] Registro válido: `201 { token, user }`; la base tiene una fila en
      `users`, una en `wallets`, una cuenta `user` y una en `auth_sessions`.
- [ ] El `user` devuelto tiene `id` UUID, `nombre`, `email`, `pais`,
      `moneda_preferida`, `roles`, `estado` y `foto_url`.
- [ ] Argentina → `ARS`; Colombia → `COP`; Otro → `USD`.
- [ ] Email duplicado exacto: `409`.
- [ ] Email duplicado con otra combinación de mayúsculas: `409`.
- [ ] Payload inválido (nombre vacío, país inválido, contraseña de 14): `400`.
- [ ] Exceso de intentos: `429`.
- [ ] Si falla la creación de la wallet o la cuenta, no queda usuario ni
      sesión (probar con una falla forzada o revisar el `ROLLBACK`).
- [ ] `POST /users` sigue respondiendo el shape legado y no crea sesión.
- [ ] `/api-docs` muestra `/auth/register` y `/users` como deprecado.

---

## Cambio 8 — Front contra el contrato mínimo (F13, subconjunto)

### Objetivo

Conectar el front al backend real, sin mocks, con los tipos y payloads del
contrato, y hacer que el Dashboard muestre los balances de `GET /accounts`.

El envelope `{ token, user }`, el shape de `user` y la creación de sesión se
definen en el spec 026. Este cambio consume ese contrato y no lo reimplementa.

### 1. Tipos UUID

En `src/services/authService.ts`:

```ts
export interface AuthUser {
  id: string; // UUID del backend, ya no number
  nombre: string;
  email: string;
  pais: string | null;
  moneda_preferida: string;
  roles: string[];
  estado: string;
  foto_url: string | null;
}
```

En `src/types/index.ts`:

```ts
export type Currency = 'ARS' | 'COP' | 'USD' | 'EUR';

export interface Balance {
  account_id: string; // UUID de la cuenta, no wallet_id numérico
  currency: Currency;
  amount: string;     // el back lo manda como texto
}
```

Actualizar `src/mocks/users.ts` para que el `id` sea un UUID
(`crypto.randomUUID()`) y `src/mocks/balances.ts` para usar `account_id` con
UUIDs estables.

En `getSession()`, agregar `typeof session.user?.id === 'string'` a la
validación para descartar sesiones viejas con `id` numérico o de Firebase. La
sesión nueva del backend siempre tiene UUID y `roles`.

### 2. Login y registro

`LoginCredentials` puede seguir siendo `{ email, password }` en la UI; el
servicio traduce el email a `identifier`:

```ts
export function login(credentials: LoginCredentials): Promise<Session> {
  return requestSession(
    '/auth/login',
    { identifier: credentials.email, password: credentials.password },
    (status) => {
      if (status === 401) return new AuthError('Email o contraseña incorrectos.');
      if (status === 403) {
        return new AuthError(
          'El backend exige cambiar tu contraseña. Contactá a soporte.',
        );
      }
      if (status === 429) {
        return new AuthError(
          'Demasiados intentos. Esperá unos minutos y probá de nuevo.',
        );
      }
      if (status === 400) return new AuthError('Revisá los datos ingresados.');
      return new AuthError('No pudimos iniciar sesión. Probá de nuevo.');
    },
  );
}
```

`register()` sigue enviando `{ nombre, email, pais, password }` a
`POST /auth/register`:

```ts
export function register(data: RegisterData): Promise<Session> {
  return requestSession('/auth/register', data, (status) => {
    if (status === 409) return new AuthError('Ya existe una cuenta con ese email.');
    if (status === 429) {
      return new AuthError(
        'Demasiados intentos. Esperá unos minutos y probá de nuevo.',
      );
    }
    if (status === 400) return new AuthError('Revisá los datos ingresados.');
    return new AuthError('No pudimos crear la cuenta. Probá de nuevo.');
  });
}
```

`requestSession()` debe validar el envelope antes de guardar:

```ts
const data = (await response.json()) as Partial<Session>;
if (!data.token || !data.user || !Array.isArray(data.user.roles)) {
  throw new AuthError('Respuesta inválida del servidor.');
}

const session: Session = { token: data.token, user: data.user };
saveSession(session);
return session;
```

Así una respuesta vieja `{ data: { access_token } }` falla con un mensaje claro
en vez de guardar una sesión vacía.

### 3. Validación de contraseña

Alinear `LoginForm` y `RegisterForm` con D3 = A:

- `LoginForm`: `min(15, 'Mínimo 15 caracteres')`, `max(128)`.
- `RegisterForm`: `min(15, 'Mínimo 15 caracteres')`, `max(128)` y mantener el
  rechazo de contraseñas que son solo espacios.
- Mensajes de error alineados con el back: “La contraseña debe tener entre 15
  y 128 caracteres”.

El login no devuelve `403`: el `403` por `password_change_required` aparece en
las rutas protegidas, como `GET /accounts`. El front lo maneja en balances con
el mensaje de arriba y sin borrar la sesión. La pantalla de cambio queda fuera
del mínimo (D4 = B); si hay usuarios legacy con contraseña corta, hay que
priorizar D4 antes de usuarios reales.

### 4. Balances con `GET /accounts`

`src/services/walletService.ts` deja de llamar `/wallet/balances` y mapea
`{ data: Account[] }` al tipo `Balance`:

```ts
interface AccountResponse {
  id: string;
  currency: Currency;
  balance: string;
}

export class WalletSessionExpiredError extends WalletError {}

export async function getBalances(): Promise<Balance[]> {
  if (USE_MOCK) {
    await delay(400);
    return structuredClone(mockBalances);
  }

  const session = getSession();
  if (!session) {
    throw new WalletSessionExpiredError('Necesitás iniciar sesión.');
  }

  let response: Response;
  try {
    response = await apiRequest('/accounts', {
      headers: { Authorization: `Bearer ${session.token}` },
    });
  } catch (error) {
    if (error instanceof ApiConnectionError) {
      throw new WalletError('No pudimos conectar con el servidor. Probá de nuevo.');
    }
    throw error;
  }

  if (response.status === 401) {
    throw new WalletSessionExpiredError('Tu sesión expiró. Volvé a iniciar sesión.');
  }
  if (response.status === 403) {
    throw new WalletError(
      'El backend exige cambiar tu contraseña antes de ver tus balances.',
    );
  }
  if (!response.ok) {
    throw new WalletError('No pudimos cargar tus balances. Probá de nuevo.');
  }

  const { data } = (await response.json()) as { data: AccountResponse[] };
  return data.map((account) => ({
    account_id: account.id,
    currency: account.currency,
    amount: account.balance,
  }));
}
```

`GET /accounts` ya devuelve `balance: "0"` para cuentas sin movimientos
(`COALESCE(b.balance, 0)::text`), así que el Dashboard no debe filtrar los
ceros. No se agrega `wallet_id` al endpoint en este cambio: el front usa `id`
como `account_id`. Si más adelante se necesita agrupar por wallet, se agrega en
F11.

### 5. Dashboard con estados de carga, error y vacío

Conectar `Dashboard.tsx` a `getBalances()`:

```tsx
const [balances, setBalances] = useState<Balance[]>([]);
const [loading, setLoading] = useState(true);
const [error, setError] = useState('');
const navigate = useNavigate();
const { user, logout } = useAuth();

const loadBalances = useCallback(async () => {
  setLoading(true);
  setError('');

  try {
    setBalances(await getBalances());
  } catch (err) {
    if (err instanceof WalletSessionExpiredError) {
      await logout();
      navigate('/login', { replace: true });
      return;
    }

    setError(
      err instanceof WalletError
        ? err.message
        : 'No pudimos cargar tus balances.',
    );
  } finally {
    setLoading(false);
  }
}, [logout, navigate]);

useEffect(() => {
  void loadBalances();
}, [loadBalances]);
```

Render:

- `loading` → `<LoadingState message="Cargando balances..." />`.
- `error` → `<ErrorState message={error} onRetry={() => void loadBalances()} />`.
- `balances.length === 0` → `<EmptyState title="Sin balances" variant="no-balance" />`.
- Caso normal → `<BalanceTable balances={balances} />` o las `BalanceCard`.

Estabilizar `logout` en `AuthProvider` con `useCallback` para que no se
re-ejecute el efecto en cada render.

### 6. Sesión y logout real

Renombrar la limpieza local actual a `clearSession()` y exportarla. Después,
`authService.logout` pasa a ser asíncrono: llama `POST /auth/logout` con el
token y, pase lo que pase, limpia la sesión local:

```ts
export async function logout(): Promise<void> {
  const session = getSession();

  try {
    if (session && !USE_MOCK) {
      await apiRequest('/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.token}` },
      });
    }
  } catch {
    // La sesión local se borra igual; el token vence en una hora.
  } finally {
    clearSession();
  }
}
```

`AuthProvider.logout` llama a esa función y después `setSession(null)`. El
Dashboard ya espera `await logout()`, así que el flujo de UI no cambia.

Ante un `401` de balances, `WalletSessionExpiredError` dispara `logout()` y
redirige a `/login`. Ante un `403`, se muestra el mensaje y **no** se limpia la
sesión: el usuario está autenticado pero el back le exige cambiar la
contraseña.

### 7. Google y perfil ocultos hasta F9/F10

Agregar una bandera local, sin variable de entorno nueva:

```ts
// src/config/features.ts
export const GOOGLE_AUTH_ENABLED = false;
```

- En `LoginForm` y `RegisterForm`, renderizar `<GoogleSignInButton>` solo si
  `GOOGLE_AUTH_ENABLED`.
- En `App.tsx`, montar `/completar-perfil` solo si `GOOGLE_AUTH_ENABLED`.
- En `ProtectedRoute`, redirigir a `/completar-perfil` solo si
  `GOOGLE_AUTH_ENABLED`; si no, dejar pasar (el registro normal siempre tiene
  nombre y país).

Los archivos `GoogleSignInButton.tsx`, `CompleteProfile.tsx` y
`CompleteProfileForm.tsx` se conservan para F9/F10. Mientras la bandera esté en
`false`, el mínimo no llama `/auth/google` ni `/users/me`.

### 8. Entorno y mock

`.env.example` del front:

```env
VITE_API_URL=http://localhost:3000
VITE_USE_MOCK=false

# Firebase se usa recién en F9/F10
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

| Entorno | `VITE_API_URL` | `VITE_USE_MOCK` |
| --- | --- | --- |
| Local contra back | `http://localhost:3000` | `false` |
| Local solo UI | `http://localhost:3000` | `true` |
| Vercel | URL pública de Railway | `false` |

`VITE_USE_MOCK` es de build-time: cambiarlo exige reiniciar Vite o redeployar.
No commitear `.env.local`. Actualizar el README del front con la tabla y con la
nota de que el logout ahora revoca en el backend.

### 9. Mensajes de error del front

| Status | Login | Registro | Balances |
| --- | --- | --- | --- |
| `400` | Revisá los datos ingresados. | Revisá los datos ingresados. | — |
| `401` | Email o contraseña incorrectos. | — | Sesión expirada: logout y `/login`. |
| `403` | El backend exige cambiar tu contraseña. Contactá a soporte. | — | Mismo mensaje; no limpiar sesión. |
| `409` | — | Ya existe una cuenta con ese email. | — |
| `429` | Demasiados intentos; esperá unos minutos. | Demasiados intentos; esperá unos minutos. | — |
| Red/5xx | No pudimos conectar con el servidor. | No pudimos crear la cuenta. | No pudimos cargar tus balances. |

### Archivos afectados

- `src/services/authService.ts`
- `src/services/apiClient.ts` (solo si hace falta para el logout)
- `src/services/walletService.ts`
- `src/types/index.ts`
- `src/mocks/users.ts`
- `src/mocks/balances.ts`
- `src/context/AuthProvider.tsx`
- `src/components/forms/LoginForm.tsx`
- `src/components/forms/RegisterForm.tsx`
- `src/components/ProtectedRoute.tsx`
- `src/pages/Dashboard.tsx`
- `src/App.tsx` (ruta condicional de `/completar-perfil`)
- `src/config/features.ts` (nuevo)
- `.env.example`
- `README.md`

### Cómo probar

- [ ] `npm run build` y `npm run lint` pasan.
- [ ] Con `VITE_USE_MOCK=false`, registro desde el front: `201`, sesión
      guardada y navegación al Dashboard.
- [ ] Recargar el Dashboard mantiene la sesión (el `user` sale de
      `localStorage` con `roles` y `estado`).
- [ ] Login con el usuario creado: `200` y Dashboard.
- [ ] El Dashboard muestra los balances de `GET /accounts`, incluidos los
      `"0"`.
- [ ] En DevTools no hay llamadas a `/wallet/balances`, `/auth/google` ni
      `/users/me`.
- [ ] Logout: `POST /auth/logout` responde `204` (o falla la red), la sesión
      local se borra y recargar lleva al login.
- [ ] Email duplicado: `409` con mensaje claro.
- [ ] Contraseña incorrecta: `401` con mensaje genérico.
- [ ] Contraseña de menos de 15: el formulario la rechaza antes de llamar al
      back.
- [ ] Exceso de intentos: `429` con mensaje de espera.
- [ ] `401` en balances limpia la sesión y redirige al login.
- [ ] `403` en balances muestra el mensaje y no limpia la sesión.
- [ ] `VITE_USE_MOCK=true` sigue mostrando balances mock con el nuevo shape.
- [ ] En Vercel, `VITE_API_URL` apunta al back real, `VITE_USE_MOCK=false` y
      CORS permite el dominio.

---

## Orden de implementación

1. **Precondiciones:** F3 (`DATABASE_URL` en `db:init`/`db:seed`), F4 (Node,
   `railway.json`, `tsx`) y F6 (CORS). Sin F3/F4 el deploy no arranca; sin F6
   el navegador no puede llamar la API.
2. **Cambio 4:** crear `008_google_auth_profile.sql`, agregarla a `init-db.ts`,
   actualizar seed y `db/README.md`. Verificar sobre base limpia y existente.
3. **Spec 026:** `toAuthUser`, `createSessionForUser`, login `{ token, user }` y
   Swagger. Se implementa después de la migración 008.
4. **Cambio 6:** `POST /auth/register`, `createUserWithWallet`, rate limit,
   Swagger y legado `/users`.
5. **Cambio 8:** tipos, payloads, balances, Dashboard, logout, Google oculto y
   entorno/mock.
6. **Verificación integrada:** registro → Dashboard → recarga → logout →
   login, en local y en el deploy.
7. **Documentación:** actualizar `docs/tareas.md`, `README.md`, `db/README.md`
   y el índice de specs. Marcar cada checkbox con evidencia.

El orden real es **migración 008 → spec 026 → registro/front de este spec**.
El spec 026 necesita las columnas nuevas; el registro y el front necesitan el
envelope y `createSessionForUser` del 026.

## Dependencias externas y specs relacionados

- **Spec 026:** `docs/specs/autenticacion/2026-10-27-contrato-sesion-login.md`. Define D1
  (`{ token, user }`), `toAuthUser`, `createSessionForUser` y el login. Se
  implementa después de la migración 008 y antes del registro y el front.
- **F3:** `db:init` y `db:seed` deben aceptar solo `DATABASE_URL` para probar
  contra Neon. Hoy siguen exigiendo `DB_*`; el spec de la migración 008 asume
  que F3 ya está resuelto o que se prueba con PostgreSQL local.
- **F4:** Node fijado, `railway.json` y `tsx` en `dependencies`. Sin esto el
  pre-deploy no corre en Railway.
- **F6:** CORS con allowlist para `http://localhost:5173` y el dominio de
  Vercel. Sin esto el front no puede llamar la API desde el navegador.
- **D18:** el repo del front es `latin-zumi-front`; la app está en
  `latin-zumi-front/latin-zumi-react`. No trabajar sobre `latin-zumi-front/`
  como si fuera la raíz de la app.

## Archivos afectados (resumen)

### Backend

- `db/migrations/008_google_auth_profile.sql` (nuevo)
- `db/scripts/init-db.ts`
- `db/seeds/001_demo_data.sql`
- `db/README.md`
- `src/services/auth.service.ts` (solo `registerAccount`; el resto es del spec
  026)
- `src/services/users.service.ts`
- `src/services/auth.service.test.ts` (nuevo o ampliado, solo registro)
- `src/services/users.service.test.ts` (nuevo o ampliado)
- `src/controllers/auth.controller.ts` (solo `register`)
- `src/controllers/auth.controller.test.ts` (nuevo o ampliado, solo registro)
- `src/routes/auth.route.ts`
- `src/utils/country.ts` (nuevo)
- `src/config/swagger.ts` (solo `/auth/register` y `/users` legado)
- `README.md`

### Frontend (`latin-zumi-front/latin-zumi-react`)

- `src/services/authService.ts`
- `src/services/apiClient.ts` (solo si hace falta para el logout)
- `src/services/walletService.ts`
- `src/types/index.ts`
- `src/mocks/users.ts`
- `src/mocks/balances.ts`
- `src/context/AuthProvider.tsx`
- `src/components/forms/LoginForm.tsx`
- `src/components/forms/RegisterForm.tsx`
- `src/components/ProtectedRoute.tsx`
- `src/pages/Dashboard.tsx`
- `src/App.tsx` (ruta condicional de `/completar-perfil`)
- `src/config/features.ts` (nuevo)
- `.env.example`
- `README.md`

## Cómo probar (integrado)

### Backend

- [ ] `npm run build` y `npm test` pasan.
- [ ] `npm run db:init` funciona sobre base limpia y existente; dos veces
      seguidas es idempotente.
- [ ] `npm run db:seed` dos veces seguidas no duplica datos y los saldos demo
      se mantienen.
- [ ] `psql` confirma columnas, checks e índices de `users`.
- [ ] Registro: `201 { token, user }`, wallet y cuenta creadas, país y moneda
      correctos.
- [ ] Duplicado de email: `409`; payload inválido: `400`; exceso: `429`.
- [ ] Logout: `204` y el token deja de servir (`401`).
- [ ] `/api-docs` refleja `/auth/register` y `/users` como deprecado.
- [ ] Login y `toAuthUser`: cubiertos por el spec 026; verificar que el token
      del login sirve en `GET /accounts` después de este cambio.

### Frontend

- [ ] `npm run build` y `npm run lint` pasan.
- [ ] Con `VITE_USE_MOCK=false`, el flujo registro → Dashboard → recarga →
      logout → login funciona contra el back local.
- [ ] El Dashboard muestra balances de `GET /accounts`, incluidos los `"0"`.
- [ ] No hay llamadas a endpoints inexistentes.
- [ ] Los mensajes de `400`, `401`, `403`, `409` y `429` son claros.
- [ ] `VITE_USE_MOCK=true` sigue funcionando para trabajar solo UI.
- [ ] El flujo funciona en el dominio de Vercel con CORS y `VITE_API_URL`
      correctos.

### Criterio de aceptación del mínimo

- [ ] `GET /health` y `GET /health/ready` responden `200` en la URL pública.
- [ ] `db:init` corrió en el deploy y la base tiene el schema 008.
- [ ] Registro desde el front real: `201`, sesión guardada y Dashboard.
- [ ] Recargar mantiene la sesión con `roles` y `estado`.
- [ ] Login con el usuario creado: `200` y Dashboard.
- [ ] Dashboard muestra balances de `GET /accounts`, incluidos los `"0"`.
- [ ] Logout revoca el token (`401`) y limpia `localStorage`.
- [ ] `400`, `401`, `409` y `429` muestran mensajes claros.
- [ ] No hay llamadas a `/auth/google`, `/users/me` ni `/wallet/balances`.
- [ ] `VITE_USE_MOCK=false`, CORS funcionando y build del front desplegado.

## Riesgos / notas

- **F3/F4/F6 son precondiciones reales.** Si el deploy falla por
  `DATABASE_URL`, Node o CORS, el problema no está en estos tres cambios;
  verificar esas fases antes de diagnosticar el registro o el front.
- **Dependencia con el spec 026:** la migración 008 se aplica primero; el spec
  026 define el envelope, `toAuthUser` y `createSessionForUser`; recién después
  se implementan el registro y el front. No invertir ese orden.
- **Emails duplicados por mayúsculas:** la migración 008 falla a propósito si
  encuentra duplicados. Hay que resolverlos a mano antes de aplicarla; no
  ignorar el error.
- **Username derivado:** el registro no pide username. Si la parte local del
  email es muy corta o está repetida, se usa un sufijo. Si los tres intentos
  fallan, es un `500`; monitorear los logs.
- **Contraseñas legacy:** un usuario con contraseña de menos de 15 puede
  iniciar sesión por API, pero el back le marca `password_change_required` y
  las rutas protegidas responden `403`. Sin D4 = A no hay pantalla para
  cambiarla. El mínimo asume que no hay usuarios legacy; si los hay, priorizar
  D4.
- **`POST /users` legado:** convive con `/auth/register`. Dos caminos de
  registro con respuestas distintas pueden confundir; el README y Swagger deben
  dejar claro cuál usa el front.
- **`errorHandler` global:** hoy traduce `23505` a `400`. El `409` de email
  duplicado debe capturarse antes; no confiar en el handler global.
- **Token de una hora sin refresh:** el front no renueva la sesión. A la hora,
  las llamadas dan `401` y el usuario vuelve a loguearse. Es aceptable para el
  mínimo; el refresh queda para una fase posterior.
- **`VITE_USE_MOCK` es build-time:** un valor incorrecto en Vercel se descubre
  recién después del redeploy. Verificar la variable en el panel de Vercel.
- **Formato decimal:** `GET /accounts` devuelve `balance` como texto con 8
  decimales. Mantenerlo como string hasta `formatMoney`; no hacer aritmética
  con `Number` para saldos reales.
- **Estados de usuario:** se fija el conjunto `activo`, `inactivo`,
  `bloqueado`. Si producto define otros estados, ajustar el CHECK antes de
  aplicar 008; cambiarlo después requiere otra migración.
- **Concurrencia de migraciones:** D11 = B (sin `schema_migrations`). No correr
  dos `db:init` a la vez; una réplica y un operador.
- **Datos sensibles:** no loguear `password`, `password_hash`, tokens ni
  `idToken`. El `console.log(err)` de `errorHandler` queda fuera de este spec
  (F5), pero no agregar logs nuevos con esos datos.

## Fuera de alcance

- El contrato de sesión y login (cambio 5, D1), que vive en el spec 026.
- `POST /auth/google`, `firebase-admin`, variables `FIREBASE_*` y vinculación
  por email verificado (F9).
- `PATCH /users/me`, pantalla de completar perfil y sincronización de moneda de
  wallet (F10).
- `GET /auth/me` (D14 = B).
- Pantalla de cambio de contraseña (D4 = B).
- CORS, rate limit compartido y topología multi-réplica (F6).
- `DATABASE_URL` en scripts de DB y configuración de Railway (F3/F4).
- CI (F2), versionado de migraciones (F12), `idempotency_key` y logging
  estructurado (F5).
- Staging formal, backups y E2E completo (F14).
- Transferencias y demás alcance de producto (F15).
