# Spec: contrato de sesión y login `{ token, user }`

## Fecha

2026-10-27

## Orden de ejecución: 026

Requiere la migración 008 del spec 025
(`docs/specs/autenticacion/2026-10-27-minimo-funcional-auth-front-back.md`). Se implementa
después de aplicar esa migración y antes del registro (`POST /auth/register`) y
del front del spec 025.

## Problema

`POST /auth/login` devuelve hoy
`{ data: { access_token, token_type, expires_at, password_change_required } }`.
No incluye `user`, así que el front no puede restaurar la sesión ni conocer
`roles`, `estado` o `moneda_preferida`. El front ya espera `{ token, user }`
(decisión **D1 = A**) y, con la respuesta actual, guarda una sesión incompleta y
vuelve al login.

Además, `createLoginSession` mezcla verificación de contraseña, rehash,
creación del token e inserción de `auth_sessions` en una sola función. El
registro y Google necesitan reutilizar la creación de sesión y la
serialización del usuario sin duplicar SQL. Después de la migración 008,
`password_hash` puede ser `NULL` para usuarios solo-Google; el tipo actual
`string` y `changeUserPassword` no lo contemplan.

## Solución propuesta

**D1 = A:** las respuestas de autenticación usan `{ token, user }`; el resto de
los endpoints conservan `{ data: ... }`.

El cambio se concentra en `src/services/auth.service.ts`:

1. Un serializador puro `toAuthUser(row)` que devuelve solo los campos del
   contrato.
2. Una función `createSessionForUser(userId, options)` que crea el token y la
   fila de `auth_sessions`, sin abrir su propia transacción.
3. Un login por contraseña que verifica, rehashea si hace falta, crea la sesión
   y responde `{ token, user }`.

### Contrato

```http
POST /auth/login
Content-Type: application/json

{
  "identifier": "ana@example.com",
  "password": "una-clave-de-15-o-mas"
}
```

```http
200 OK
{
  "token": "<token-opaco>",
  "user": {
    "id": "20000000-0000-4000-8000-000000000001",
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

Reglas:

- `id` es `string` (UUID), no `number`.
- `nombre` siempre es un string; si `users.nombre` es `NULL`, se usa
  `username` como fallback.
- `pais` puede ser `null` en usuarios viejos o de Google; en el registro normal
  siempre viene informado.
- `moneda_preferida` se lee con `RTRIM` porque la columna es `CHAR(3)`.
- `roles` siempre es un arreglo; `getSession()` del front depende de eso.
- La respuesta **no** incluye `password_hash`, `google_uid`, `access_token`,
  `token_type`, `expires_at` ni `password_change_required`.
- `identifier` acepta email o username. El front manda el email como
  `identifier`; no se agrega un alias `email` en el back.
- El token es el Bearer opaco del backend, no un token de Firebase, y vence en
  una hora.
- Errores del login: `400` payload inválido, `401` credenciales inválidas
  (genérico), `429` demasiados intentos. El `403` no lo devuelve el login: lo
  devuelve `requireAuth` en rutas protegidas cuando la sesión tiene
  `password_change_required`.

### `toAuthUser(row)`

En `src/services/auth.service.ts`:

```ts
export interface AuthUserRow {
  id: string;
  username: string;
  email: string;
  nombre: string | null;
  pais: string | null;
  moneda_preferida: string;
  roles: string[];
  estado: string;
  foto_url: string | null;
}

export interface AuthUser {
  id: string;
  nombre: string;
  email: string;
  pais: string | null;
  moneda_preferida: string;
  roles: string[];
  estado: string;
  foto_url: string | null;
}

export function toAuthUser(row: AuthUserRow): AuthUser {
  return {
    id: row.id,
    nombre: row.nombre?.trim() || row.username,
    email: row.email,
    pais: row.pais,
    moneda_preferida: row.moneda_preferida,
    roles: row.roles,
    estado: row.estado,
    foto_url: row.foto_url,
  };
}
```

Es una función pura: la llaman el login, el registro (spec 025) y, en F9,
Google. El resultado nunca incluye `password_hash` ni `google_uid`.

### `createSessionForUser(userId, options)`

Extraer la creación del token y la fila de `auth_sessions` de
`createLoginSession`:

```ts
import type { PoolClient } from 'pg';

type Queryable = Pick<PoolClient, 'query'>;

export interface CreatedSession {
  token: string;
  expiresAt: Date;
  passwordChangeRequired: boolean;
}

export async function createSessionForUser(
  userId: string,
  options: { passwordChangeRequired: boolean; client?: Queryable },
): Promise<CreatedSession> {
  const token = randomBytes(32).toString('base64url');
  const queryable = options.client ?? pool;

  const result = await queryable.query<{ expires_at: Date }>(
    `INSERT INTO auth_sessions
       (user_id, token_hash, expires_at, password_change_required)
     VALUES ($1, $2, now() + interval '1 hour', $3)
     RETURNING expires_at`,
    [userId, tokenHash(token), options.passwordChangeRequired],
  );

  return {
    token,
    expiresAt: result.rows[0].expires_at,
    passwordChangeRequired: options.passwordChangeRequired,
  };
}
```

Puntos clave:

- **No abre su propia transacción.** El llamador decide si usa el `pool` o un
  `PoolClient` que ya tiene `BEGIN`. Eso permite que el registro cree usuario,
  wallet, cuenta y sesión en una sola transacción.
- Mantiene token aleatorio de 32 bytes, hash SHA-256, expiración de una hora y
  revocación por `revoked_at`.
- El login sigue haciendo su propia transacción para el rehash de contraseña y
  la sesión.

### Login por contraseña

`POST /auth/login` acepta `{ identifier, password }`. La respuesta es
`200 { token, user }`.

```ts
export async function loginWithPassword(
  identifier: string,
  password: string,
): Promise<{ token: string; user: AuthUser }> {
  const normalized = identifier.trim().toLowerCase();

  const userResult = await pool.query<
    AuthUserRow & { password_hash: string | null }
  >(
    `SELECT id, username, email, nombre, pais,
            RTRIM(moneda_preferida) AS moneda_preferida,
            roles, estado, foto_url, password_hash
       FROM users
      WHERE username = $1 OR email = $1
      LIMIT 1`,
    [normalized],
  );

  const user = userResult.rows[0];
  const storedHash = user?.password_hash ?? DUMMY_PASSWORD_HASH;
  const verification = await verifyPassword(password, storedHash);

  if (!user || !verification.valid) {
    throw new AppError('Credenciales inválidas', 401);
  }

  const passwordChangeRequired = Array.from(password).length < 15;
  // scrypt es costoso: se calcula antes de abrir la transacción para no
  // retener una conexión mientras se hashea la contraseña.
  const upgradedHash = verification.needsRehash
    ? await hashPassword(password)
    : null;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (upgradedHash) {
      await client.query(
        'UPDATE users SET password_hash = $2 WHERE id = $1',
        [user.id, upgradedHash],
      );
    }

    const session = await createSessionForUser(user.id, {
      passwordChangeRequired,
      client,
    });
    await client.query('COMMIT');

    return { token: session.token, user: toAuthUser(user) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

Comportamiento:

- Usuario inexistente o contraseña incorrecta: `401` genérico, sin revelar si el
  email existe.
- Usuario solo-Google (`password_hash NULL`): se verifica contra
  `DUMMY_PASSWORD_HASH` y responde `401`, sin romper el servicio.
- `passwordChangeRequired` se calcula con la longitud de la contraseña. El
  registro normal siempre crea sesiones con `false` porque exige 15.
- La respuesta no incluye `access_token`, `token_type`, `expires_at` ni
  `password_change_required`; el contrato mínimo es `{ token, user }`.

### Controller

`src/controllers/auth.controller.ts` deja de envolver la sesión en `data`:

```ts
export async function login(req: Request, res: Response) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError('Datos de login inválidos', 400);

  const { token, user } = await loginWithPassword(
    parsed.data.identifier,
    parsed.data.password,
  );
  return res.status(200).json({ token, user });
}
```

El `loginSchema` actual ya normaliza `identifier` a minúsculas y limita
`password` a 128; no hace falta cambiarlo.

### Ajustes de tipos y compatibilidad

- `UserCredential.password_hash` pasa a `string | null`.
- `changeUserPassword` debe cortar con `401` si `password_hash` es `NULL`, para
  que un usuario solo-Google no pueda cambiar una contraseña que no tiene:

```ts
const user = userResult.rows[0];
if (!user || !user.password_hash) {
  throw new AppError('Credenciales inválidas', 401);
}

const verification = await verifyPassword(currentPassword, user.password_hash);
```

- `POST /auth/change-password` y `POST /auth/logout` siguen existiendo. El
  logout ya revoca la sesión; el cambio de contraseña queda fuera del mínimo
  (D4 = B), pero no debe romperse por el tipo nullable.

### Swagger y documentación

- Actualizar `/auth/login` en `src/config/swagger.ts`: request
  `{ identifier, password }`, respuesta `200 { token, user }` con el schema de
  `AuthUser`, errores `400`, `401` y `429`.
- Documentar que el token es opaco y vence en una hora.
- Aclarar que el `403` aparece en rutas protegidas, no en el login.
- Actualizar `README.md` con el contrato nuevo y un ejemplo de respuesta.

## Archivos afectados

- `src/services/auth.service.ts`
- `src/controllers/auth.controller.ts`
- `src/config/swagger.ts`
- `README.md`
- `src/services/auth.service.test.ts` (nuevo o ampliado)
- `src/controllers/auth.controller.test.ts` (nuevo o ampliado)

No se toca la base de datos en este spec: la migración 008 y sus columnas
pertenecen al spec 025.

## Pasos

1. Agregar `AuthUserRow`, `AuthUser` y `toAuthUser` en `auth.service.ts`.
2. Extraer `createSessionForUser` de `createLoginSession` y exportarlo.
3. Implementar `loginWithPassword` con la transacción de rehash + sesión.
4. Reemplazar `createLoginSession` en el controller y devolver
   `res.status(200).json({ token, user })` sin el envelope `data`.
5. Cambiar `UserCredential.password_hash` a `string | null` y proteger
   `changeUserPassword`.
6. Actualizar Swagger y `README.md`.
7. Agregar o ampliar los tests unitarios y de controller.

## Cómo probar

- [ ] Login con email y contraseña correctos: `200 { token, user }` con los
      ocho campos del contrato.
- [ ] Login con username y contraseña correctos: mismo resultado.
- [ ] Contraseña incorrecta: `401` genérico.
- [ ] Email inexistente: `401` genérico.
- [ ] Usuario con `password_hash NULL`: `401` genérico, sin error 500.
- [ ] El token devuelto sirve en `GET /accounts`.
- [ ] `POST /auth/logout` con ese token responde `204`; el mismo token vuelve a
      dar `401` en `GET /accounts`.
- [ ] `toAuthUser` no devuelve `password_hash` ni `google_uid` (test unitario).
- [ ] `toAuthUser` usa `username` cuando `nombre` es `NULL`.
- [ ] `createSessionForUser` usa el `PoolClient` recibido y no abre una
      transacción propia.
- [ ] Una contraseña de menos de 15 crea la sesión con
      `password_change_required = true`; una ruta protegida responde `403`.
- [ ] `/api-docs` muestra el nuevo envelope y no muestra `access_token`.

## Riesgos / notas

- **Dependencia de la migración 008:** la consulta del login selecciona
  `nombre`, `pais`, `moneda_preferida`, `roles`, `estado` y `foto_url`. Sin la
  migración 008 aplicada, el login falla. Orden real: migración 008 (spec 025)
  → este spec 026 → registro y front del spec 025.
- **D1 = A es el contrato:** si se cambia a B (todo dentro de `{ data }`), hay
  que ajustar el controller, el front y Swagger. No mezclar ambos envelopes.
- **`password_change_required` no viaja en la respuesta:** el front no puede
  saberlo hasta llamar una ruta protegida y recibir `403`. Con D4 = B no hay
  pantalla de cambio; si hay usuarios legacy con contraseña corta, priorizar
  D4 antes de usuarios reales.
- **Token de una hora sin refresh:** el front no renueva la sesión. A la hora,
  las llamadas dan `401` y el usuario vuelve a loguearse. Es aceptable para el
  mínimo; el refresh queda para una fase posterior.
- **Usuarios solo-Google:** no pueden iniciar sesión por contraseña; reciben
  `401` genérico. La vinculación por email queda para F9.
- **`estado` no se valida en el login:** un usuario `inactivo` o `bloqueado`
  puede iniciar sesión porque la consulta no filtra por `estado`. El mínimo
  asume que no hay usuarios en esos estados; si se empiezan a usar, agregar el
  filtro o un `403` explícito antes de crear la sesión.
- **`identifier` ambiguo:** si un username coincide con el email de otro
  usuario, `WHERE username = $1 OR email = $1` puede devolver cualquiera de los
  dos. Es el comportamiento actual; no se cambia en este spec.
- **`moneda_preferida` es `CHAR(3)`:** olvidar `RTRIM` devuelve `"ARS"` con
  espacios y rompe el contrato. El `SELECT` debe mantener el `RTRIM`.
- **Rate limit por proceso:** D9 = A, una réplica. Si se escala a varias, el
  límite de login deja de ser global.
- **Datos sensibles:** no loguear `password`, `password_hash`, tokens ni
  `idToken`. No agregar logs nuevos con esos datos.

## Fuera de alcance

- Migración 008 (spec 025).
- `POST /auth/register`, `createUserWithWallet` y el front (spec 025).
- `POST /auth/google`, `firebase-admin` y variables `FIREBASE_*` (F9).
- `PATCH /users/me` y pantalla de completar perfil (F10).
- `GET /auth/me` (D14 = B).
- Pantalla de cambio de contraseña (D4 = B).
- CORS (F6), `DATABASE_URL` en scripts de DB (F3) y configuración de Railway
  (F4).
