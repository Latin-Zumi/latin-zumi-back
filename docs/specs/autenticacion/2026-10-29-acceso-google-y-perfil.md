# Spec: acceso con Google y completar perfil

## Fecha

2026-10-29

## Orden de ejecución

**038.** Registrado en el índice de `docs/specs/index-specs.md`. No reutilizar
números ya asignados.

## Dependencias

- Usa la migración 008 (`google_uid`, `foto_url`, `pais` nullable,
  `password_hash` nullable y `users_access_method_check`), ya aplicada.
- Reutiliza `createUserWithWallet`, `toAuthUser` y `createSessionForUser` de
  los specs 025–028.
- Depende del spec 037 para que un usuario solo-Google reciba
  `409 PASSWORD_NOT_SET` al intentar cambiar contraseña.
- El front ya tiene `loginWithGoogle`, `GoogleSignInButton`,
  `/completar-perfil` y `PATCH /users/me` implementados, pero ocultos o
  apuntando a un endpoint que no existe.

## Problema

El front está listo para Google, pero el back no:

- `src/services/authService.ts` del front llama `POST /auth/google` con
  `{ idToken }`. El back no tiene esa ruta, así que el botón está oculto con
  `GOOGLE_AUTH_ENABLED = false`.
- `src/services/userService.ts` del front llama `PATCH /users/me` para
  completar `nombre` y `pais`. El back solo tiene `GET /users/lookup`; la ruta
  de perfil no existe.
- Los usuarios de Google entran sin `pais` (la columna es nullable) y con
  wallet en USD. Sin `PATCH /users/me`, nunca pueden completar el perfil ni
  alinear la moneda de su billetera.
- No hay verificación de Firebase ID tokens ni variables de entorno para el
  Admin SDK.

## Solución propuesta

### Parte A — `POST /auth/google`

1. Agregar `firebase-admin` al back.
2. Verificar el ID token con el Admin SDK (`verifyIdToken(idToken, true)`),
   exigiendo `email_verified === true` y proveedor `google.com`.
3. Vincular por `google_uid` o, si no existe, por email verificado.
4. Crear usuario + wallet + cuenta + sesión en una transacción si es nuevo.
5. Responder el mismo envelope `{ token, user }` (más
   `password_change_required: false`) que el login.

### Parte B — `PATCH /users/me`

1. Actualizar `nombre` y `pais` del usuario autenticado.
2. Derivar `moneda_preferida` del país.
3. Sincronizar `wallets.primary_currency` y la cuenta `user` solo si la wallet
   no tiene movimientos en `entries`. Si ya tiene movimientos, se conserva la
   moneda de la wallet y `moneda_preferida` se alinea con ella; el perfil se
   guarda igual para no dejar al usuario bloqueado en `/completar-perfil`.
4. Devolver `{ user }` con el shape `AuthUser` que el front ya espera.

### Parte C — Encender el front

1. `GOOGLE_AUTH_ENABLED` pasa a depender de `VITE_GOOGLE_AUTH_ENABLED`.
2. Mapear `403` y `503` del back a mensajes claros.
3. `PATCH /users/me`: mostrar el `message` del back cuando la validación de
   perfil falle.
4. Documentar la configuración de Firebase.

### Contrato

| Método | Ruta | Request | Respuesta | Errores |
| --- | --- | --- | --- | --- |
| `POST` | `/auth/google` | `{ idToken }` | `200 { token, user, password_change_required }` | `400`, `401`, `403`, `409`, `429`, `503` |
| `PATCH` | `/users/me` | `{ nombre?, pais }` | `200 { user }` | `400`, `401`, `409` |

`POST /auth/google`:

```http
POST /auth/google
Content-Type: application/json

{ "idToken": "<firebase-id-token>" }
```

```http
200 OK
{
  "token": "<token-opaco>",
  "user": {
    "id": "…",
    "nombre": "Ana Pérez",
    "email": "ana@example.com",
    "pais": null,
    "moneda_preferida": "USD",
    "roles": ["user"],
    "estado": "activo",
    "foto_url": "https://…"
  },
  "password_change_required": false
}
```

`PATCH /users/me`:

```http
PATCH /users/me
Authorization: Bearer <token>
Content-Type: application/json

{ "pais": "Argentina" }
```

```http
200 OK
{
  "user": {
    "id": "…",
    "nombre": "Ana Pérez",
    "email": "ana@example.com",
    "pais": "Argentina",
    "moneda_preferida": "ARS",
    "roles": ["user"],
    "estado": "activo",
    "foto_url": "https://…"
  }
}
```

Reglas:

- `idToken` es el token de Firebase, no el Bearer del backend. Se usa una sola
  vez y no se guarda.
- `email` se normaliza a minúsculas y debe estar verificado por Firebase.
- El usuario nuevo arranca con `pais = null`, `moneda_preferida = 'USD'` y una
  wallet USD vacía. `PATCH /users/me` la convierte a la moneda del país elegido
  si todavía no hay movimientos.
- Un email que ya pertenece a una cuenta con contraseña se vincula a Google
  porque Firebase verificó el email. Es la decisión de producto para evitar
  cuentas duplicadas.
- Si el `google_uid` ya está vinculado a otro usuario, `409`.
- `roles` y `estado` no se aceptan desde el cliente.

## Backend

### Dependencia y configuración

Agregar `firebase-admin` a `dependencies` en `package.json`.

`src/config/env.ts` y `.env.example`:

```env
# Firebase Admin (service account). Las tres vacías deshabilitan /auth/google
# y el endpoint responde 503 GOOGLE_AUTH_UNAVAILABLE.
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
# Pegar la clave con \n escapados; el código los convierte a saltos reales.
FIREBASE_PRIVATE_KEY=
```

Validación cruzada:

```ts
.refine(
  ({ FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY }) => {
    const values = [
      FIREBASE_PROJECT_ID,
      FIREBASE_CLIENT_EMAIL,
      FIREBASE_PRIVATE_KEY,
    ];
    return values.every(Boolean) || values.every((value) => !value);
  },
  {
    message:
      'Configurá FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL y FIREBASE_PRIVATE_KEY juntas, o ninguna',
    path: ['FIREBASE_PROJECT_ID'],
  },
)
```

`optionalEnvString` ya existe en `env.ts` y convierte `''` en `undefined`.

### Verificación del ID token

Archivo nuevo: `src/services/firebase-admin.service.ts`.

```ts
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

let firebaseApp: App | undefined;

function getFirebaseApp(): App {
  if (firebaseApp) return firebaseApp;

  const existing = getApps()[0];
  if (existing) {
    firebaseApp = existing;
    return firebaseApp;
  }

  const configured =
    env.FIREBASE_PROJECT_ID &&
    env.FIREBASE_CLIENT_EMAIL &&
    env.FIREBASE_PRIVATE_KEY;

  if (!configured) {
    throw new AppError(
      'El acceso con Google no está configurado',
      503,
      'GOOGLE_AUTH_UNAVAILABLE',
    );
  }

  firebaseApp = initializeApp({
    credential: cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
    }),
  });
  return firebaseApp;
}

export interface GoogleIdentity {
  googleUid: string;
  email: string;
  emailVerified: boolean;
  nombre: string | null;
  fotoUrl: string | null;
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  let decoded;
  try {
    decoded = await getAuth(getFirebaseApp()).verifyIdToken(idToken, true);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('No pudimos validar tu identidad de Google', 401, 'GOOGLE_TOKEN_INVALID');
  }

  if (!decoded.email || decoded.email_verified !== true) {
    throw new AppError(
      'Google no confirmó tu email',
      401,
      'GOOGLE_EMAIL_NOT_VERIFIED',
    );
  }

  if (decoded.firebase.sign_in_provider !== 'google.com') {
    throw new AppError(
      'El token no proviene de Google',
      401,
      'GOOGLE_PROVIDER_INVALID',
    );
  }

  return {
    googleUid: decoded.uid,
    email: decoded.email.trim().toLowerCase(),
    emailVerified: true,
    nombre: decoded.name?.trim() || null,
    fotoUrl: decoded.picture ?? null,
  };
}
```

Qué hace: inicializa Firebase Admin una sola vez, valida el token contra el
proyecto y exige que el proveedor sea Google. Un token de otro proveedor de
Firebase, vencido o revocado, no sirve. `verifyIdToken(token, true)` consulta
revocaciones.

### Vincular o crear el usuario

`src/services/users.service.ts` necesita aceptar los campos nuevos. Extender
`CreateUserWithWalletInput`:

```ts
export interface CreateUserWithWalletInput {
  username: string;
  email: string;
  passwordHash: string | null;
  nombre: string;
  pais: string | null;
  monedaPreferida: string;
  googleUid?: string | null;
  fotoUrl?: string | null;
  retryUsernameConflict?: boolean;
}
```

Y el `INSERT`:

```sql
INSERT INTO users
  (username, email, password_hash, nombre, pais, moneda_preferida,
   google_uid, foto_url)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (username) DO NOTHING
RETURNING id, username, email, nombre, pais,
          RTRIM(moneda_preferida) AS moneda_preferida,
          roles, estado, foto_url
```

Las llamadas existentes (registro normal, `/users` legado) no pasan los dos
últimos campos y quedan en `NULL`.

Función nueva en `src/services/auth.service.ts`:

```ts
async function findOrCreateGoogleUser(
  client: PoolClient,
  identity: GoogleIdentity,
): Promise<UserProfileRow> {
  const byGoogle = await client.query<UserProfileRow>(
    `SELECT id, username, email, nombre, pais,
            RTRIM(moneda_preferida) AS moneda_preferida,
            roles, estado, foto_url
       FROM users
      WHERE google_uid = $1
      FOR UPDATE`,
    [identity.googleUid],
  );
  if (byGoogle.rows[0]) return byGoogle.rows[0];

  const byEmail = await client.query<UserProfileRow & { google_uid: string | null }>(
    `SELECT id, username, email, nombre, pais,
            RTRIM(moneda_preferida) AS moneda_preferida,
            roles, estado, foto_url, google_uid
       FROM users
      WHERE lower(email) = $1
      FOR UPDATE`,
    [identity.email],
  );

  const existing = byEmail.rows[0];
  if (existing) {
    if (existing.google_uid && existing.google_uid !== identity.googleUid) {
      throw new AppError(
        'Ese email ya está vinculado a otra cuenta de Google',
        409,
        'GOOGLE_ACCOUNT_CONFLICT',
      );
    }

    const linked = await client.query<UserProfileRow>(
      `UPDATE users
          SET google_uid = $2,
              foto_url = COALESCE(foto_url, $3),
              nombre = COALESCE(NULLIF(trim(nombre), ''), $4)
        WHERE id = $1
        RETURNING id, username, email, nombre, pais,
                  RTRIM(moneda_preferida) AS moneda_preferida,
                  roles, estado, foto_url`,
      [existing.id, identity.googleUid, identity.fotoUrl, identity.nombre],
    );
    return linked.rows[0];
  }

  const { user } = await createUserWithWallet(client, {
    username: buildUsername(identity.email),
    email: identity.email,
    passwordHash: null,
    nombre: identity.nombre ?? buildUsername(identity.email),
    pais: null,
    monedaPreferida: 'USD',
    googleUid: identity.googleUid,
    fotoUrl: identity.fotoUrl,
  });
  return user;
}
```

Qué ocurre:

1. Busca por `google_uid` con `FOR UPDATE` para que dos logins simultáneos del
   mismo usuario no creen dos cuentas.
2. Si no existe, busca por email (sin distinguir mayúsculas). El índice único
   `users_email_lower_idx` respalda la unicidad.
3. Si el email ya existe:
   - sin `google_uid`: lo vincula y completa `foto_url`/`nombre` solo si faltan;
   - con el mismo `google_uid`: no cambia nada;
   - con otro `google_uid`: `409`.
4. Si no existe: crea usuario, wallet y cuenta en la misma transacción con
   `password_hash = NULL` (permitido por `users_access_method_check` porque
   `google_uid` está presente).
5. `pais = null` obliga al front a pasar por `/completar-perfil`.

Login:

```ts
export async function loginWithGoogle(idToken: string): Promise<{
  token: string;
  user: AuthUser;
  passwordChangeRequired: boolean;
}> {
  const identity = await verifyGoogleIdToken(idToken);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const user = await findOrCreateGoogleUser(client, identity);

    if (user.estado !== 'activo') {
      throw new AppError('Tu cuenta no está habilitada', 403, 'USER_BLOCKED');
    }

    const session = await createSessionForUser(user.id, {
      passwordChangeRequired: false,
      client,
    });
    await client.query('COMMIT');

    return {
      token: session.token,
      user: toAuthUser(user),
      passwordChangeRequired: false,
    };
  } catch (error) {
    await client.query('ROLLBACK');

    if (isEmailUniqueViolation(error) || isGoogleUidUniqueViolation(error)) {
      throw new AppError(
        'Ese email ya está vinculado a otra cuenta',
        409,
        'GOOGLE_ACCOUNT_CONFLICT',
      );
    }

    throw error;
  } finally {
    client.release();
  }
}
```

`isEmailUniqueViolation` ya existe en `auth.service.ts`. Agregar
`isGoogleUidUniqueViolation` para `users_google_uid_idx`.

Controller:

```ts
const googleLoginSchema = z.object({
  idToken: z.string().min(20).max(8192),
});

export async function loginGoogle(req: Request, res: Response) {
  const parsed = googleLoginSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError('Datos de Google inválidos', 400);

  const { token, user, passwordChangeRequired } = await loginWithGoogle(
    parsed.data.idToken,
  );
  return res.status(200).json({
    token,
    user,
    password_change_required: passwordChangeRequired,
  });
}
```

Ruta y rate limit:

```ts
export const googleLoginRateLimit = rateLimit({
  ...commonOptions,
  limit: 10,
});

authRouter.post(
  '/auth/google',
  googleLoginRateLimit,
  asyncHandler(loginGoogle),
);
```

### `PATCH /users/me`

Mover `nombreSchema` y `pais` a `src/schemas/profile.ts` para compartirlos
entre `auth.controller.ts` y `users.controller.ts`:

```ts
export const paisSchema = z.enum(['Argentina', 'Colombia', 'Otro']);

export const nombreSchema = z
  .string()
  .trim()
  .min(2, 'Ingresá tu nombre')
  .max(50, 'El nombre no puede superar los 50 caracteres')
  .regex(
    /^[\p{L}\p{M}]+(?:[ '\u2019\u002D\u00B7.][\p{L}\p{M}]+)*$/u,
    'Ingresá un nombre válido, sin números',
  );
```

Controller:

```ts
const updateProfileSchema = z.object({
  nombre: nombreSchema.optional(),
  pais: paisSchema,
});

export async function updateMe(req: Request, res: Response) {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(
      firstIssueMessage(parsed.error, 'Datos de perfil inválidos'),
      400,
    );
  }

  const user = await updateUserProfile(
    getAuthContext(req).userId,
    parsed.data,
  );
  return res.status(200).json({ user });
}
```

Servicio en `src/services/users.service.ts`:

```ts
export async function updateUserProfile(
  userId: string,
  input: { nombre?: string; pais: Pais },
): Promise<UserProfileRow> {
  const currency = currencyForCountry(input.pais);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const walletResult = await client.query<{
      id: string;
      primary_currency: string;
    }>(
      `SELECT id, RTRIM(primary_currency) AS primary_currency
         FROM wallets
        WHERE user_id = $1
        FOR UPDATE`,
      [userId],
    );
    const wallet = walletResult.rows[0];
    if (!wallet) {
      throw new AppError('No encontramos tu billetera', 404, 'WALLET_NOT_FOUND');
    }

    const requestedCurrency = currencyForCountry(input.pais);
    let effectiveCurrency = requestedCurrency;

    if (wallet.primary_currency !== requestedCurrency) {
      const movements = await client.query(
        `SELECT 1
           FROM entries e
           JOIN accounts a ON a.id = e.account_id
          WHERE a.wallet_id = $1
          LIMIT 1`,
        [wallet.id],
      );

      if ((movements.rowCount ?? 0) > 0) {
        // La wallet ya tiene historial: no se puede cambiar la moneda sin
        // romper la FK (account_id, currency) del ledger. El perfil se guarda
        // igual y la preferencia queda alineada con la moneda real.
        effectiveCurrency = wallet.primary_currency;
      } else {
        await client.query(
          `UPDATE wallets SET primary_currency = $2 WHERE id = $1`,
          [wallet.id, requestedCurrency],
        );
        await client.query(
          `UPDATE accounts
              SET currency = $2
            WHERE wallet_id = $1
              AND account_type = 'user'
              AND closed_at IS NULL`,
          [wallet.id, requestedCurrency],
        );
      }
    }

    const userResult = await client.query<UserProfileRow>(
      `UPDATE users
          SET nombre = COALESCE($2, nombre),
              pais = $3,
              moneda_preferida = $4
        WHERE id = $1
        RETURNING id, username, email, nombre, pais,
                  RTRIM(moneda_preferida) AS moneda_preferida,
                  roles, estado, foto_url`,
      [userId, input.nombre ?? null, input.pais, effectiveCurrency],
    );

    await client.query('COMMIT');
    return userResult.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    if (isUniqueViolation(error)) {
      throw new AppError(
        'No pudimos actualizar la moneda de tu billetera',
        409,
        'PROFILE_CURRENCY_CONFLICT',
      );
    }
    throw error;
  } finally {
    client.release();
  }
}
```

Por qué se conserva la moneda: `entries` tiene una FK compuesta
`(account_id, currency) → accounts(id, currency)`. Cambiar la moneda de una
cuenta con movimientos rompería la consistencia del ledger y la conversión.
La wallet de un usuario de Google está vacía, así que el caso normal cambia la
moneda sin problema. Si ya recibió una transferencia antes de completar el
perfil, el país y el nombre se guardan igual y la preferencia queda en la
moneda real de la wallet; así el usuario no queda atrapado en
`/completar-perfil`.

Ruta:

```ts
usersRouter.patch(
  '/users/me',
  asyncHandler(requireAuth),
  asyncHandler(updateMe),
);
```

El orden no choca con `GET /users/lookup`. `PATCH /users/me` no se ve afectado
por `password_change_required` salvo que `requireAuth` lo bloquee con `403`;
en ese caso el front ya redirige a cambiar la contraseña (spec 037).

### Swagger y README del back

- Documentar `/auth/google` con `idToken`, `200`, `400`, `401`, `403`, `409`,
  `429`, `503`.
- Documentar `/users/me` con `nombre` opcional y `pais` requerido. Aclarar que
  si la wallet ya tiene movimientos se conserva su moneda y `moneda_preferida`
  se alinea con ella. Documentar `409 PROFILE_CURRENCY_CONFLICT` para el caso
  excepcional de choque con la cuenta existente.
- Actualizar `.env.example` y el README con Firebase Admin y la nota de que
  las tres variables vacías deshabilitan Google.
- No loguear `idToken` ni la clave privada.

## Frontend (`latin-zumi-front/latin-zumi-react`)

El flujo ya está implementado; faltan los interruptores y el manejo fino de
errores.

### `src/config/features.ts`

```ts
export const GOOGLE_AUTH_ENABLED =
  import.meta.env.VITE_GOOGLE_AUTH_ENABLED === 'true';
```

`.env.example`:

```env
# true: muestra el botón de Google y habilita /completar-perfil.
# Requiere las VITE_FIREBASE_* y que el back tenga Firebase Admin configurado.
VITE_GOOGLE_AUTH_ENABLED=false
```

Con la bandera apagada, `LoginForm`, `RegisterForm`, `App.tsx` y
`ProtectedRoute` siguen ocultando Google y `/completar-perfil` como hoy.

### `src/services/authService.ts`

`googleBackendError` debe distinguir los casos nuevos:

```ts
function googleBackendError(status: number): AuthError {
  if (status === 404 || status === 405 || status === 501 || status === 503) {
    return new AuthUnavailableError(
      'El ingreso con Google todavía no está disponible. Mientras tanto, usá tu email y contraseña.',
    );
  }
  if (status === 401) {
    return new AuthError('Google no pudo confirmar tu identidad. Probá de nuevo.');
  }
  if (status === 403) {
    return new AuthError('Tu cuenta no está habilitada. Contactá a soporte.');
  }
  if (status === 409) {
    return new AuthError(
      'Ese email ya está vinculado a otra cuenta. Ingresá con tu email y contraseña.',
    );
  }
  return new AuthError('No pudimos iniciar sesión con Google. Probá de nuevo.');
}
```

`requestSession` ya valida `{ token, user }` y guarda
`password_change_required` (spec 037). No hace falta más.

### `src/services/userService.ts`

Hoy cualquier error que no sea `401` se muestra genérico. Leer el `code` para
mostrar el mensaje del back cuando exista:

```ts
const body = (await response.json().catch(() => null)) as
  | { code?: string; message?: string }
  | null;

if (response.status === 401) {
  throw new ProfileError('Tu sesión expiró. Volvé a iniciar sesión.');
}
if (!response.ok) {
  throw new ProfileError(
    body?.message ?? 'No pudimos guardar tus datos. Probá de nuevo.',
  );
}
```

### Resto del front

- `LoginForm` y `RegisterForm` ya renderizan `<GoogleSignInButton>` cuando la
  bandera está encendida.
- `App.tsx` ya monta `/completar-perfil` condicionalmente.
- `ProtectedRoute` ya manda a `/completar-perfil` si `pais` es `null`.
- `CompleteProfileForm` ya envía `{ pais, nombre? }` a `PATCH /users/me`.
- No cambiar mocks ni `VITE_USE_MOCK`.

### README del front

Agregar:

- Cómo habilitar Google (`VITE_GOOGLE_AUTH_ENABLED=true` + `VITE_FIREBASE_*`).
- Que el back debe tener `FIREBASE_*` y el proveedor Google habilitado en
  Firebase Console.
- Que los dominios `localhost` y el de Vercel deben estar en “Authorized
  domains”.
- Que un usuario de Google completa `nombre`/`pais` en `/completar-perfil`.

## Archivos afectados

### Backend

- `package.json` / `package-lock.json` (`firebase-admin`)
- `src/config/env.ts`
- `src/services/firebase-admin.service.ts` (nuevo)
- `src/services/auth.service.ts`
- `src/services/users.service.ts`
- `src/schemas/profile.ts` (nuevo)
- `src/controllers/auth.controller.ts`
- `src/controllers/users.controller.ts`
- `src/routes/auth.route.ts`
- `src/routes/users.route.ts`
- `src/middleware/loginRateLimit.ts` (google rate limit)
- `src/config/swagger.ts`
- `src/tests/services/auth.service.test.ts` (ampliar)
- `src/tests/services/users.service.test.ts` (ampliar)
- `src/tests/controllers/auth.controller.test.ts` (ampliar)
- `.env.example`
- `README.md`

### Frontend (`latin-zumi-front/latin-zumi-react`)

- `src/config/features.ts`
- `src/services/authService.ts`
- `src/services/userService.ts`
- `.env.example`
- `README.md`

## Pasos

1. Agregar `firebase-admin` y las variables de entorno con su validación.
2. Implementar `firebase-admin.service.ts`.
3. Extender `createUserWithWallet` con `googleUid` y `fotoUrl`.
4. Implementar `findOrCreateGoogleUser` y `loginWithGoogle`.
5. Agregar controller, rate limit y ruta de `/auth/google`.
6. Implementar `updateUserProfile` y `PATCH /users/me`.
7. Documentar Swagger, README y `.env.example`.
8. Encender `VITE_GOOGLE_AUTH_ENABLED` en el front y ajustar los mensajes.
9. Probar el flujo completo con un proyecto Firebase real.

## Cómo probar

### Backend

- [ ] Sin variables `FIREBASE_*`: `POST /auth/google` responde
      `503 GOOGLE_AUTH_UNAVAILABLE` (no `500`).
- [ ] Con variables configuradas y un ID token válido de Google: `200
      { token, user, password_change_required: false }`.
- [ ] El usuario nuevo tiene `password_hash NULL`, `google_uid` cargado,
      `pais NULL`, `moneda_preferida 'USD'`, wallet y cuenta `user` USD.
- [ ] Segundo login con el mismo usuario: no crea otra fila, reutiliza la
      cuenta y devuelve una sesión nueva.
- [ ] Email existente con contraseña y sin `google_uid`: vincula el
      `google_uid`, conserva la contraseña y devuelve `pais`/moneda actuales.
- [ ] Email existente con otro `google_uid`: `409 GOOGLE_ACCOUNT_CONFLICT`.
- [ ] Token de Firebase vencido o inválido: `401 GOOGLE_TOKEN_INVALID`.
- [ ] Token de un proveedor distinto de `google.com`: `401
      GOOGLE_PROVIDER_INVALID`.
- [ ] Token sin email verificado: `401 GOOGLE_EMAIL_NOT_VERIFIED`.
- [ ] Usuario con `estado = 'bloqueado'`: `403 USER_BLOCKED` y no se crea
      sesión.
- [ ] Payload sin `idToken` o con un valor no string: `400`.
- [ ] El token devuelto sirve en `GET /accounts` y `GET /users/lookup`.
- [ ] `PATCH /users/me` con `{ pais: 'Argentina' }` en una wallet vacía:
      `200`, `moneda_preferida 'ARS'`, wallet y cuenta en ARS.
- [ ] `PATCH /users/me` con `nombre` inválido: `400`.
- [ ] `PATCH /users/me` sin Bearer: `401`.
- [ ] `PATCH /users/me` sobre una wallet con movimientos hacia otra moneda:
      `200`, se guardan `nombre`/`pais`, la wallet conserva su moneda y
      `moneda_preferida` queda igual a la moneda real.
- [ ] `PATCH /users/me` sobre una wallet con movimientos hacia la misma
      moneda: `200` y solo cambian `nombre`/`pais`.
- [ ] `npm run db:init` no requiere migración nueva y sigue pasando.
- [ ] `npm run build` y `npm test` pasan.

### Frontend

- [ ] Con `VITE_GOOGLE_AUTH_ENABLED=false`, el botón de Google y
      `/completar-perfil` no aparecen.
- [ ] Con `VITE_GOOGLE_AUTH_ENABLED=true` y Firebase configurado, el botón
      aparece en login y registro.
- [ ] Google con un usuario nuevo: sesión guardada y redirección a
      `/completar-perfil`.
- [ ] Completar país: `PATCH /users/me` responde `200`; el usuario se guarda en
      `localStorage` y `/dashboard` muestra la moneda correcta.
- [ ] Google con una cuenta existente: entra directo al Dashboard sin pedir
      perfil si ya tiene `pais`.
- [ ] Back sin Firebase: mensaje “El ingreso con Google todavía no está
      disponible” (no un error genérico).
- [ ] `409`: mensaje de email ya vinculado.
- [ ] `403`: mensaje de cuenta no habilitada.
- [ ] Wallet con movimientos: el perfil se guarda y el Dashboard usa la moneda
      real de la wallet, sin errores.
- [ ] `npm run build`, `npm run lint` y `npm test` pasan.

### Configuración externa (checklist manual)

- [ ] Firebase Console → Authentication → Sign-in method → Google habilitado.
- [ ] Dominios autorizados: `localhost` y el dominio de Vercel.
- [ ] Service account con rol mínimo necesario; clave privada solo en el
      secret manager del back.
- [ ] `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` y `FIREBASE_PRIVATE_KEY`
      cargados en Render.
- [ ] Las `VITE_FIREBASE_*` cargadas en Vercel y redeploy del front.

## Riesgos / notas

- **Secretos:** `FIREBASE_PRIVATE_KEY` da acceso administrativo al proyecto.
  Nunca va al repo, al front ni a logs. En Render debe cargarse como secreto y
  con los `\n` escapados.
- **Vinculación automática por email:** es segura solo porque se exige
  `email_verified === true` y proveedor `google.com`. No relajar esa condición.
- **`google_uid` por proyecto:** si se migra de proyecto Firebase, los UID
  cambian y los usuarios se re-vinculan por email. Documentarlo.
- **Cuentas solo-Google:** no pueden usar `POST /auth/change-password`; el spec
  037 devuelve `409 PASSWORD_NOT_SET`. Tampoco pueden usar la recuperación por
  email para “crear” contraseña: el spec 036 actualiza `password_hash`, lo que
  les permitiría iniciar sesión por contraseña. Decidir si eso se permite o se
  bloquea cuando se implemente 036.
- **Moneda de la wallet:** `PATCH /users/me` cambia la moneda solo si no hay
  movimientos. La validación usa `entries` por `wallet_id`; no confiar solo en
  el saldo, porque un saldo 0 puede tener historial. Si hay movimientos, el
  perfil se guarda y `moneda_preferida` queda en la moneda real de la wallet;
  el usuario puede pedir el cambio por soporte.
- **`estado`:** Google valida `estado = 'activo'`, pero el login por contraseña
  todavía no lo hace (riesgo anotado en el spec 026). Conviene alinearlo en un
  spec posterior.
- **Cold start:** `firebase-admin` es una dependencia pesada; la inicialización
  es perezosa para no afectar `/health`.
- **Rate limit por proceso:** igual que el resto de auth (D9 = A).
- **Token de una hora:** el flujo no renueva sesión; a la hora el front vuelve
  a `/login`.
- **Perfil desde Google:** `nombre` y `foto_url` son datos de display, no
  autorización. `roles` y `estado` nunca se toman del token.
- **CORS:** el dominio de Vercel ya debe estar en `CORS_ORIGINS`; Google no
  cambia esa configuración porque el popup ocurre en el navegador y el
  `idToken` se envía al back por HTTPS.
- **Rollback:** si falla la creación de wallet o cuenta, la transacción revierte
  usuario y sesión. Probar con una falla forzada.

## Fuera de alcance

- Otros proveedores de Firebase (Apple, Microsoft, email link).
- Vinculación manual de cuentas o panel de administración.
- Desvincular Google de una cuenta.
- Agregar `access_method`/`has_password` a `AuthUser`.
- Refresco de tokens y sesiones de más de una hora.
- Verificación de email para el registro por contraseña.
- Cambio de email.
