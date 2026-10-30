# Spec: pantalla de cambio de contraseña y fin del bloqueo por 403

## Fecha

2026-10-29

## Orden de ejecución

**037.** Registrado en el índice de `docs/specs/index-specs.md`. No reutilizar
números ya asignados.

## Dependencias

- `POST /auth/change-password` ya existe en el back (specs 025–028) y
  `requireAuth` lo excluye del bloqueo por `password_change_required`.
- Revisa una decisión del spec 026: el login no devolvía
  `password_change_required`. Este spec lo agrega como campo adicional sin
  romper `{ token, user }`.
- No requiere migraciones.

## Problema

El backend tiene `POST /auth/change-password`, revoca las otras sesiones y
marca `password_change_required` cuando un usuario inicia sesión con una
contraseña corta. Pero:

- El front no tiene ninguna pantalla para cambiar la contraseña.
- `requireAuth` responde `403` en todas las rutas protegidas (salvo
  `/auth/change-password` y `/auth/logout`) cuando la sesión tiene el flag.
  El Dashboard se limita a mostrar un texto de error y el usuario no tiene
  forma de salir del estado.
- El usuario no puede rotar su contraseña de forma voluntaria.
- El front no sabe que debe cambiar la contraseña hasta que una llamada falla
  con `403`, porque el login no devuelve el flag.

## Solución propuesta

1. **Back:** agregar `password_change_required` a la respuesta de
   `POST /auth/login` y `POST /auth/register` (campo adicional). Diferenciar
   los errores de `change-password` con códigos estables y limitar los
   intentos.
2. **Front:** nueva ruta protegida `/cambiar-contrasena` con un formulario de
   contraseña actual, nueva y confirmación.
3. **Front:** `ProtectedRoute` redirige a `/cambiar-contrasena` cuando la
   sesión tiene el flag, sin esperar un `403`.
4. **Front:** al cambiar la contraseña, se limpia el flag local y la sesión
   actual sigue válida (el back actualiza `password_change_required = false`
   para esa sesión).
5. **Front:** enlace “Cambiar contraseña” en la barra de navegación para
   usuarios autenticados.

### Contrato

```http
POST /auth/login
{ "identifier": "ana@example.com", "password": "..." }

200 OK
{
  "token": "<token-opaco>",
  "user": { "...": "..." },
  "password_change_required": false
}
```

```http
POST /auth/change-password
Authorization: Bearer <token>
{ "current_password": "...", "new_password": "..." }

204 No Content
```

Reglas:

- `password_change_required` es `true` solo si la contraseña usada en el login
  tiene menos de `PASSWORD_MIN_LENGTH` (hoy 8). El registro siempre lo devuelve
  en `false`.
- `{ token, user }` no cambia: el campo nuevo es aditivo y un cliente viejo lo
  ignora.
- `change-password` mantiene la sesión actual y revoca las demás.
- La contraseña nueva cumple `passwordSchema` del back (8–128). El front aplica
  su regla habitual (8–24, mayúscula y carácter especial), que es más estricta
  pero compatible.
- La contraseña actual solo se valida como no vacía y con máximo 128: puede ser
  una clave legacy corta.
- Los errores del back usan `{ code, message }`; el front decide por `code` y
  por status.

| Caso | Status | Code |
| --- | --- | --- |
| `current_password` incorrecta | `401` | `INVALID_CURRENT_PASSWORD` |
| Sesión inválida o vencida | `401` | `UNAUTHORIZED` (lo emite `requireAuth`) |
| Usuario solo-Google sin contraseña | `409` | `PASSWORD_NOT_SET` |
| La nueva es igual a la actual | `400` | `PASSWORD_UNCHANGED` |
| La contraseña cambió en otra sesión | `409` | `CONFLICT` |
| Demasiados intentos | `429` | `TOO_MANY_REQUESTS` |
| Payload inválido | `400` | `BAD_REQUEST` |

## Backend

### Login y registro devuelven el flag

`src/services/auth.service.ts` ya calcula `passwordChangeRequired` y
`createSessionForUser` lo devuelve. Propagar el valor:

```ts
export async function loginWithPassword(
  identifier: string,
  password: string,
): Promise<{ token: string; user: AuthUser; passwordChangeRequired: boolean }> {
  // ...verificación y transacción existentes...
  return {
    token: session.token,
    user: toAuthUser(user),
    passwordChangeRequired,
  };
}
```

Controller:

```ts
export async function login(req: Request, res: Response) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError('Datos de login inválidos', 400);

  const { token, user, passwordChangeRequired } = await loginWithPassword(
    parsed.data.identifier,
    parsed.data.password,
  );
  return res.status(200).json({
    token,
    user,
    password_change_required: passwordChangeRequired,
  });
}
```

`registerAccount` puede devolver `{ token, user }` como hoy; el controller de
registro agrega `password_change_required: false` para que el front tenga un
único parser.

### Códigos de error del cambio de contraseña

`changeUserPassword` en `src/services/auth.service.ts`:

```ts
const user = userResult.rows[0];
if (!user) throw new AppError('Credenciales inválidas', 401);

if (!user.password_hash) {
  throw new AppError(
    'Tu cuenta usa Google y no tiene contraseña para cambiar.',
    409,
    'PASSWORD_NOT_SET',
  );
}

if (currentPassword === newPassword) {
  throw new AppError(
    'La nueva contraseña debe ser distinta de la actual.',
    400,
    'PASSWORD_UNCHANGED',
  );
}

const verification = await verifyPassword(currentPassword, user.password_hash);
if (!verification.valid) {
  throw new AppError(
    'La contraseña actual es incorrecta.',
    401,
    'INVALID_CURRENT_PASSWORD',
  );
}
```

Antes de este cambio, una contraseña actual incorrecta y una sesión vencida
respondían igual (`401` sin código). El front necesita distinguirlas: la
primera es un error de campo, la segunda obliga a volver al login.

### Rate limit del cambio de contraseña

Agregar en `src/middleware/loginRateLimit.ts`:

```ts
export const changePasswordRateLimit = rateLimit({
  ...commonOptions,
  limit: 10,
  keyGenerator: (req) => {
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    return `${ipKeyGenerator(req.ip ?? 'unknown')}:${tokenHash}`;
  },
});
```

Y aplicarlo en `src/routes/auth.route.ts`:

```ts
authRouter.post(
  '/auth/change-password',
  changePasswordRateLimit,
  asyncHandler(requireAuth),
  asyncHandler(changePassword),
);
```

Así un token robado no permite probar contraseñas actuales sin límite.

### Swagger

- `POST /auth/login`: agregar `password_change_required` al schema y al
  ejemplo (`false`), y documentar que es aditivo.
- `POST /auth/register`: agregar `password_change_required: false`.
- `POST /auth/change-password`: documentar `400 PASSWORD_UNCHANGED`,
  `401 INVALID_CURRENT_PASSWORD`, `409 PASSWORD_NOT_SET`, `429`.
- Aclarar que `change-password` y `logout` no devuelven `403` por el flag.

## Frontend (`latin-zumi-front/latin-zumi-react`)

### `src/services/authService.ts`

1. Extender `Session`:

```ts
export interface Session {
  token: string;
  user: AuthUser;
  password_change_required?: boolean;
}
```

2. Leer el flag en `requestSession`:

```ts
const session: Session = {
  token: data.token,
  user: data.user,
  password_change_required: data.password_change_required === true,
};
saveSession(session);
```

`getSession()` debe aceptar sesiones viejas sin el campo (se interpretan como
`false`).

3. Agregar el cambio de contraseña:

```ts
export type ChangePasswordErrorCode =
  | 'INVALID_CURRENT_PASSWORD'
  | 'PASSWORD_NOT_SET'
  | 'PASSWORD_UNCHANGED'
  | 'SESSION_EXPIRED'
  | 'CONFLICT'
  | 'TOO_MANY_REQUESTS'
  | 'CONNECTION'
  | 'UNKNOWN';

export class ChangePasswordError extends Error {
  code: ChangePasswordErrorCode;

  constructor(code: ChangePasswordErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const session = getSession();
  if (!session) {
    throw new ChangePasswordError('SESSION_EXPIRED', 'Necesitás iniciar sesión.');
  }

  let response: Response;
  try {
    response = await apiRequest('/auth/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    });
  } catch (error) {
    if (error instanceof ApiConnectionError) {
      throw new ChangePasswordError(
        'CONNECTION',
        'No pudimos conectar con el servidor. Probá de nuevo.',
      );
    }
    throw error;
  }

  if (response.status === 204) return;

  if (response.status === 429) {
    throw new ChangePasswordError(
      'TOO_MANY_REQUESTS',
      'Demasiados intentos. Esperá unos minutos y probá de nuevo.',
    );
  }

  const body = (await response.json().catch(() => null)) as
    | { code?: string; message?: string }
    | null;

  if (response.status === 401 && body?.code === 'INVALID_CURRENT_PASSWORD') {
    throw new ChangePasswordError(
      'INVALID_CURRENT_PASSWORD',
      body.message ?? 'La contraseña actual es incorrecta.',
    );
  }
  if (response.status === 401) {
    throw new ChangePasswordError(
      'SESSION_EXPIRED',
      'Tu sesión expiró. Volvé a iniciar sesión.',
    );
  }
  if (response.status === 409 && body?.code === 'PASSWORD_NOT_SET') {
    throw new ChangePasswordError(
      'PASSWORD_NOT_SET',
      'Tu cuenta usa Google y no tiene contraseña para cambiar.',
    );
  }
  if (response.status === 409) {
    throw new ChangePasswordError(
      'CONFLICT',
      'La contraseña cambió en otra sesión. Iniciá sesión de nuevo.',
    );
  }
  if (response.status === 400 && body?.code === 'PASSWORD_UNCHANGED') {
    throw new ChangePasswordError(
      'PASSWORD_UNCHANGED',
      'La nueva contraseña debe ser distinta de la actual.',
    );
  }

  throw new ChangePasswordError(
    'UNKNOWN',
    body?.message ?? 'No pudimos cambiar tu contraseña. Probá de nuevo.',
  );
}
```

Quién ejecuta: el formulario; el servicio agrega el Bearer y mapea los códigos
del back a errores tipados. Resultado: la página decide qué mostrar en cada
campo sin adivinar por el texto.

### Sesión y redirección

`src/context/auth/AuthContext.ts`:

```ts
export interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  passwordChangeRequired: boolean;
  startSession: (session: Session) => void;
  updateUser: (user: AuthUser) => void;
  updateSession: (changes: Partial<Session>) => void;
  logout: () => Promise<void>;
}
```

`AuthProvider` implementa `updateSession` y deriva `passwordChangeRequired`:

```tsx
const updateSession = (changes: Partial<Session>) => {
  if (!session) return;
  const updated = { ...session, ...changes };
  saveSession(updated);
  setSession(updated);
};

const updateUser = (user: AuthUser) => updateSession({ user });
```

`src/components/ProtectedRoute.tsx`:

```tsx
const { user, passwordChangeRequired } = useAuth();
const { pathname } = useLocation();

if (!user) return <Navigate to="/login" replace />;

if (passwordChangeRequired && pathname !== '/cambiar-contrasena') {
  return <Navigate to="/cambiar-contrasena" replace />;
}

// ...perfil de Google y <Outlet />...
```

La ruta nueva va dentro del bloque protegido de `App.tsx`:

```tsx
<Route element={<ProtectedRoute />}>
  <Route path="/dashboard" element={<Dashboard />} />
  <Route path="/historial" element={<TransactionHistory />} />
  <Route path="/cambiar-contrasena" element={<ChangePassword />} />
</Route>
```

### Página `/cambiar-contrasena`

Archivo nuevo: `src/pages/ChangePassword.tsx`, con un formulario en
`src/components/forms/ChangePasswordForm.tsx` para poder testearlo aparte.

Campos:

| Campo | Validación |
| --- | --- |
| `current_password` | requerido, máximo 128 (acepta claves legacy cortas) |
| `new_password` | `passwordSchema` del front (8–24, mayúscula y especial) |
| `confirm_password` | igual a `new_password` |

Reglas adicionales:

- `new_password !== current_password`, con mensaje de campo.
- No permitir enviar mientras `loading`.
- Mostrar los requisitos de contraseña con el mismo componente/checklist que
  usa el registro (extraer `PasswordChecklist` a
  `src/components/forms/PasswordChecklist.tsx` si hace falta para no duplicar).

Submit:

```tsx
try {
  await changePassword(values.current_password, values.new_password);
  updateSession({ password_change_required: false });
  setSuccess(true);
} catch (error) {
  if (!(error instanceof ChangePasswordError)) {
    setFormError('Ocurrió un error inesperado. Probá de nuevo.');
    return;
  }

  if (error.code === 'INVALID_CURRENT_PASSWORD') {
    setFieldErrors({ current_password: error.message });
    return;
  }
  if (error.code === 'PASSWORD_UNCHANGED') {
    setFieldErrors({ new_password: error.message });
    return;
  }
  if (error.code === 'SESSION_EXPIRED' || error.code === 'CONFLICT') {
    await logout();
    navigate('/login', { replace: true });
    return;
  }

  setFormError(error.message);
}
```

Después de `204`:

- Mensaje “Contraseña actualizada. Las demás sesiones se cerraron.”
- Botón “Volver a mi billetera” que navega a `/dashboard`.
- La sesión actual sigue guardada; no se pide login otra vez.

Casos especiales:

- `PASSWORD_NOT_SET` (usuario solo-Google): mostrar un aviso informativo, no un
  error rojo, con “Tu cuenta usa Google; no tiene contraseña para cambiar.”
- Sesión vencida: `logout()` y `/login`.

### Navegación

En `src/components/common/Navbar.tsx`, para usuarios autenticados:

```tsx
<Link to="/cambiar-contrasena" className="navbar__link">
  Cambiar contraseña
</Link>
```

Mantener “Salir” como está. En móvil el enlace queda dentro del menú
desplegable.

### README del front

Documentar:

- La ruta `/cambiar-contrasena`.
- Que el login devuelve `password_change_required` y que el front redirige
  cuando es `true`.
- Que las cuentas de Google no tienen contraseña y reciben `PASSWORD_NOT_SET`.

## Archivos afectados

### Backend

- `src/services/auth.service.ts`
- `src/controllers/auth.controller.ts`
- `src/routes/auth.route.ts`
- `src/middleware/loginRateLimit.ts`
- `src/config/swagger.ts`
- `src/tests/services/auth.service.test.ts` (ampliar)
- `src/tests/controllers/auth.controller.test.ts` (ampliar)
- `README.md`

### Frontend (`latin-zumi-front/latin-zumi-react`)

- `src/services/authService.ts`
- `src/context/auth/AuthContext.ts`
- `src/context/auth/AuthProvider.tsx`
- `src/components/ProtectedRoute.tsx`
- `src/pages/ChangePassword.tsx` (nuevo)
- `src/components/forms/ChangePasswordForm.tsx` (nuevo)
- `src/components/forms/PasswordChecklist.tsx` (nuevo, si se extrae)
- `src/components/common/Navbar.tsx`
- `src/App.tsx`
- `src/styles/pages/auth.css`
- `tests/components/forms/ChangePasswordForm.test.tsx` (nuevo)
- `tests/components/ProtectedRoute.test.tsx` (ampliar)
- `README.md`

## Pasos

1. Propagar `passwordChangeRequired` en `loginWithPassword`, el controller y
   Swagger; agregar el campo al registro.
2. Agregar los códigos `INVALID_CURRENT_PASSWORD`, `PASSWORD_NOT_SET` y
   `PASSWORD_UNCHANGED` en `changeUserPassword`.
3. Agregar `changePasswordRateLimit` y aplicarlo a la ruta.
4. Extender `Session`, `getSession`, `requestSession` y `changePassword` en el
   front.
5. Extender `AuthContext`/`AuthProvider` y `ProtectedRoute`.
6. Crear la página y el formulario, y registrar la ruta.
7. Agregar el enlace en la barra de navegación.
8. Actualizar README, Swagger y tests.

## Cómo probar

### Backend

- [ ] Login con contraseña de 8 o más: `password_change_required: false`.
- [ ] Login con contraseña legacy de 7 o menos: `password_change_required:
      true`.
- [ ] Registro: `password_change_required: false`.
- [ ] `POST /auth/change-password` con la actual correcta: `204`, el hash
      cambia y las otras sesiones quedan revocadas.
- [ ] La sesión usada para cambiar sigue sirviendo en `GET /accounts`.
- [ ] Contraseña actual incorrecta: `401 INVALID_CURRENT_PASSWORD`.
- [ ] Token inválido: `401 UNAUTHORIZED`.
- [ ] Nueva igual a la actual: `400 PASSWORD_UNCHANGED`.
- [ ] Usuario con `password_hash NULL`: `409 PASSWORD_NOT_SET`.
- [ ] Nueva de 7 caracteres: `400`.
- [ ] Después del cambio, el flag de la sesión actual queda en `false` y
      `GET /accounts` responde `200`.
- [ ] Más de 10 intentos en 15 minutos: `429`.
- [ ] `npm run build` y `npm test` pasan.

### Frontend

- [ ] Login con una cuenta legacy redirige directo a `/cambiar-contrasena`.
- [ ] `/cambiar-contrasena` sin sesión redirige a `/login`.
- [ ] Contraseña actual incorrecta: error bajo el campo y no se pierde la
      sesión.
- [ ] Nueva igual a la actual: error bajo el campo.
- [ ] Confirmación distinta: error bajo el campo, sin llamada al back.
- [ ] Éxito: mensaje, flag limpio y acceso normal al Dashboard.
- [ ] Recargar después del cambio no vuelve a redirigir.
- [ ] Sesión vencida: logout y `/login`.
- [ ] Cuenta de Google: aviso “Tu cuenta usa Google”.
- [ ] `429`: mensaje de espera.
- [ ] El enlace “Cambiar contraseña” aparece en la barra para usuarios
      autenticados.
- [ ] `npm run build`, `npm run lint` y `npm test` pasan.

## Riesgos / notas

- **Cambio de contrato aditivo:** `password_change_required` se agrega al login
  y al registro. No se quita nada de `{ token, user }`; los consumidores
  actuales siguen funcionando. Actualizar Swagger y README para que el campo
  quede documentado.
- **Doble fuente del flag:** el back lo guarda en `auth_sessions` y el front en
  `localStorage`. Si el usuario borra el flag local sin cambiar la contraseña,
  el back sigue devolviendo `403`; por eso se mantiene el manejo de `403` en
  `walletService` como red de seguridad.
- **Contraseñas legacy:** el flag se calcula con la longitud de la contraseña
  usada en el login, no con la del hash. Un usuario con contraseña de 8 o más
  no lo recibe.
- **Usuarios de Google:** no tienen contraseña; el cambio devuelve
  `PASSWORD_NOT_SET`. No ocultar el enlace por ahora: el contrato de `AuthUser`
  no expone el método de acceso y agregarlo es un cambio mayor. Si molesta en
  la UI, se puede agregar `has_password` en un spec posterior.
- **Rate limit por token y por IP:** un atacante con muchos tokens puede rotar
  la clave del límite. El límite por IP del login sigue protegiendo el acceso
  inicial.
- **Revocación de otras sesiones:** es el comportamiento actual del back. El
  usuario de otro dispositivo vuelve al login; documentarlo en el mensaje de
  éxito.
- **Un solo campo de error:** el back devuelve `{ code, message }`; el front
  debe priorizar `code` y no el texto, porque el texto puede cambiar.
- **Token de una hora:** si el cambio tarda más que la sesión, el back responde
  `401 UNAUTHORIZED` y el front manda al login.
- **No loguear** `current_password`, `new_password` ni el hash.

## Fuera de alcance

- Recuperación por email (spec 036).
- Historial de contraseñas o política de reutilización.
- Autenticación de dos factores.
- Exponer `has_password`/`access_method` en `AuthUser`.
- Cambio de email.
- Pantalla de perfil más allá de lo que ya existe (`/completar-perfil`, spec
  038).
