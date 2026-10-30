# Spec: recuperación de contraseña entre front y back

## Fecha

2026-10-29

## Orden de ejecución

**036.** Registrado en el índice de `docs/specs/index-specs.md`. No reutilizar
números ya asignados.

## Dependencias

- Parte del contrato de sesión ya implementado en los specs 025–028
  (`{ token, user }`, `auth_sessions`, `POST /auth/login` y
  `POST /auth/logout`).
- No requiere cambios en `POST /auth/login` ni en el modelo de wallet.
- Usa la migración 010, que es el siguiente número libre después de
  `009_transaction_type.sql`.

## Problema

El front tiene la ruta `/recuperar-contrasena` y el enlace “¿Olvidaste tu
contraseña?” en `LoginForm`, pero la página solo valida el email en el navegador
y muestra un aviso de que el backend no ofrece el proceso. El back no tiene
endpoints de recuperación, tabla de tokens ni forma de enviar correos.

Consecuencias:

- Un usuario que olvida su contraseña queda bloqueado y depende de soporte
  manual.
- La pantalla existente promete un flujo que no existe y no envía ningún
  correo.
- No hay forma segura de restablecer una contraseña sin conocer la actual,
  porque `POST /auth/change-password` exige `current_password`.

## Solución propuesta

Implementar el ciclo completo de recuperación con dos endpoints públicos,
tokens de un solo uso y un proveedor de email desacoplado:

1. `POST /auth/forgot-password` recibe un email. Si el email pertenece a una
   cuenta, crea un token, lo guarda hasheado y encola el envío del correo.
   Siempre responde `202` con el mismo mensaje para no revelar qué emails
   existen.
2. `POST /auth/reset-password` recibe `{ token, password }`. Consume el token
   una sola vez, actualiza el hash y revoca todas las sesiones del usuario.
3. El envío de correo se hace mediante una interfaz `EmailProvider` con dos
   implementaciones: `console` para desarrollo y `resend` para producción
   (HTTP, sin SDK nuevo).
4. El front conecta `/recuperar-contrasena` al primer endpoint y agrega
   `/restablecer-contrasena?token=...` para el segundo.

### Contrato

| Método | Ruta | Request | Respuesta | Errores |
| --- | --- | --- | --- | --- |
| `POST` | `/auth/forgot-password` | `{ email }` | `202 { message }` | `400`, `429`, `503` |
| `POST` | `/auth/reset-password` | `{ token, password }` | `204` | `400`, `429` |

Respuesta constante de `forgot-password`:

```json
{ "message": "Si el email está registrado, te enviamos instrucciones para restablecer la contraseña." }
```

Reglas:

- `202` se devuelve tanto si el email existe como si no.
- El token viaja solo en el enlace del correo. Nunca se devuelve en la
  respuesta HTTP ni se escribe en logs.
- El token es aleatorio (32 bytes, base64url) y en la base se guarda solo su
  SHA-256, igual que `auth_sessions.token_hash`.
- Vence a los 30 minutos (`PASSWORD_RESET_TTL_MINUTES`) y es de un solo uso.
- Al restablecer se revocan todas las sesiones activas del usuario; el front
  manda a `/login` y no inicia sesión automáticamente.
- La contraseña nueva usa el mismo `passwordSchema` del backend (8–128). El
  front aplica su regla más estricta ya existente (8–24, mayúscula y carácter
  especial), que es un subconjunto válido para el back.

## Backend

### Migración 010: `password_reset_tokens`

Archivo nuevo: `db/migrations/010_password_reset_tokens.sql`.

```sql
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    requested_ip TEXT,
    CONSTRAINT password_reset_tokens_expiration_after_creation
        CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_active_idx
    ON password_reset_tokens (user_id, expires_at)
    WHERE used_at IS NULL;
```

Qué hace: guarda un hash por token emitido, con vencimiento y marca de uso. El
índice parcial acelera la invalidación de tokens activos de un usuario. El
`ON DELETE CASCADE` evita tokens huérfanos si se borra el usuario.

`db/scripts/init-db.ts` lee las migraciones de forma explícita, no por
descubrimiento. Agregar el bloque después de `009`:

```ts
const passwordResetMigration = await readFile(
  new URL('../migrations/010_password_reset_tokens.sql', import.meta.url),
  'utf8',
);
await client.query(passwordResetMigration);
```

Quién ejecuta: `npm run db:init`. Resultado: una base vacía o existente termina
con la tabla y el índice; correrlo dos veces no falla.

### Configuración de entorno

Agregar a `src/config/env.ts` y `.env.example`:

```env
# console: imprime el enlace en el log (solo desarrollo/test).
# resend: envía el correo real por HTTPS.
EMAIL_PROVIDER=console
RESEND_API_KEY=
EMAIL_FROM=Latin Zumi <no-reply@latinzumi.com>
PASSWORD_RESET_URL=http://localhost:5173/restablecer-contrasena
PASSWORD_RESET_TTL_MINUTES=30
```

Validación propuesta:

```ts
EMAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
RESEND_API_KEY: optionalEnvString,
EMAIL_FROM: z.string().min(3).default('Latin Zumi <no-reply@latinzumi.com>'),
PASSWORD_RESET_URL: z
  .string()
  .url()
  .default('http://localhost:5173/restablecer-contrasena'),
PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(240).default(30),
```

Y una regla cruzada:

```ts
.refine(
  ({ EMAIL_PROVIDER, RESEND_API_KEY }) =>
    EMAIL_PROVIDER !== 'resend' || Boolean(RESEND_API_KEY),
  {
    message: 'RESEND_API_KEY es obligatoria con EMAIL_PROVIDER=resend',
    path: ['RESEND_API_KEY'],
  },
)
```

`PASSWORD_RESET_URL` es la URL del **front**, no la del back. El enlace se
construye con `URL` para no romper si la URL ya trae query string.

### Proveedor de email

Archivos nuevos:

- `src/services/email/email-provider.ts`
- `src/services/email/console-email-provider.ts`
- `src/services/email/resend-email-provider.ts`

```ts
export interface PasswordResetEmail {
  to: string;
  nombre: string;
  resetUrl: string;
}

export interface EmailProvider {
  sendPasswordReset(message: PasswordResetEmail): Promise<void>;
}
```

`ConsoleEmailProvider` imprime el enlace en desarrollo:

```ts
console.info(`[password-reset] ${message.to}: ${message.resetUrl}`);
```

`ResendEmailProvider` usa `fetch` para no agregar dependencias:

```ts
await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    from,
    to: [message.to],
    subject: 'Restablecé tu contraseña de Latin Zumi',
    html: buildResetEmailHtml(message),
  }),
});
```

Si Resend responde un status no exitoso, lanzar un error con status y cuerpo
resumido, sin incluir el token.

Factory:

```ts
export function getEmailProvider(): EmailProvider {
  if (env.EMAIL_PROVIDER === 'resend') {
    return new ResendEmailProvider(env.RESEND_API_KEY!, env.EMAIL_FROM);
  }

  // En producción no se acepta el provider de consola: evita "enviar" correos
  // que nadie recibe y deja el fallo visible.
  if (env.NODE_ENV === 'production') {
    throw new AppError(
      'El envío de correos no está configurado',
      503,
      'EMAIL_NOT_CONFIGURED',
    );
  }

  return new ConsoleEmailProvider();
}
```

Quién ejecuta: el servicio de recuperación; el controller nunca conoce el
proveedor. Resultado: en local el enlace aparece en la terminal; en producción
sale un correo real por Resend.

### `POST /auth/forgot-password`

Servicio nuevo: `src/services/password-reset.service.ts`.

```ts
export async function requestPasswordReset(
  email: string,
  requestedIp: string | null,
): Promise<void> {
  // Se resuelve antes de buscar al usuario: si el proveedor de producción no
  // está configurado, todos los emails reciben 503, no solo los existentes.
  const provider = getEmailProvider();

  const user = await findUserByEmail(email);
  if (!user) return; // misma respuesta y mismo camino externo

  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');

  await pool.query(
    `UPDATE password_reset_tokens
        SET used_at = now()
      WHERE user_id = $1 AND used_at IS NULL`,
    [user.id],
  );

  await pool.query(
    `INSERT INTO password_reset_tokens
       (user_id, token_hash, expires_at, requested_ip)
     VALUES ($1, $2, now() + make_interval(mins => $3), $4)`,
    [user.id, tokenHash, env.PASSWORD_RESET_TTL_MINUTES, requestedIp],
  );

  const resetUrl = new URL(env.PASSWORD_RESET_URL);
  resetUrl.searchParams.set('token', token);

  // Se envía después de responder. El tiempo de respuesta no depende de si el
  // email existe y el usuario no espera a que Resend termine.
  void provider
    .sendPasswordReset({ to: user.email, nombre: user.nombre, resetUrl: resetUrl.toString() })
    .catch((error: unknown) => {
      console.error(
        'No se pudo enviar el email de recuperación',
        error instanceof Error ? error.message : error,
      );
    });
}
```

Qué ocurre:

1. `findUserByEmail` normaliza el email con `trim().toLowerCase()`.
2. Si no hay usuario, el servicio termina sin tocar la base y el controller
   responde igual.
3. Si hay usuario, invalida los tokens anteriores y crea uno nuevo.
4. Responde y recién después intenta enviar el correo. Un fallo de Resend
   queda en el log; el usuario puede volver a pedir otro enlace.

Controller:

```ts
const forgotPasswordSchema = z.object({
  email: z
    .string()
    .trim()
    .email('Ingresá un email válido')
    .max(254)
    .transform((value) => value.toLowerCase()),
});

export async function forgotPassword(req: Request, res: Response) {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError('Email inválido', 400);

  await requestPasswordReset(parsed.data.email, req.ip ?? null);
  return res.status(202).json({
    message:
      'Si el email está registrado, te enviamos instrucciones para restablecer la contraseña.',
  });
}
```

Rate limits en `src/middleware/loginRateLimit.ts`:

```ts
export const passwordResetRequestRateLimit = rateLimit({
  ...commonOptions,
  limit: 5,
});

export const passwordResetEmailRateLimit = rateLimit({
  ...commonOptions,
  keyGenerator: (req) => {
    const email =
      typeof req.body?.email === 'string'
        ? req.body.email.trim().toLowerCase()
        : '';
    return createHash('sha256').update(email).digest('hex');
  },
});
```

El primero limita por IP y el segundo por email para evitar que alguien use el
endpoint como generador de correos hacia una víctima. Ruta:

```ts
authRouter.post(
  '/auth/forgot-password',
  passwordResetRequestRateLimit,
  passwordResetEmailRateLimit,
  asyncHandler(forgotPassword),
);
```

### `POST /auth/reset-password`

```ts
export async function resetPassword(
  token: string,
  password: string,
): Promise<void> {
  const tokenHash = createHash('sha256').update(token).digest('hex');

  // Chequeo barato antes de hashear la contraseña (scrypt es costoso).
  const existing = await pool.query(
    `SELECT 1
       FROM password_reset_tokens
      WHERE token_hash = $1
        AND used_at IS NULL
        AND expires_at > now()`,
    [tokenHash],
  );
  if (existing.rowCount === 0) {
    throw new AppError(
      'El enlace venció o ya fue usado. Pedí uno nuevo.',
      400,
      'INVALID_RESET_TOKEN',
    );
  }

  const passwordHash = await hashPassword(password);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // El UPDATE es la operación atómica de consumo: si dos pedidos usan el
    // mismo token, solo uno obtiene la fila.
    const claimed = await client.query<{ user_id: string }>(
      `UPDATE password_reset_tokens
          SET used_at = now()
        WHERE token_hash = $1
          AND used_at IS NULL
          AND expires_at > now()
        RETURNING user_id`,
      [tokenHash],
    );

    const row = claimed.rows[0];
    if (!row) {
      throw new AppError(
        'El enlace venció o ya fue usado. Pedí uno nuevo.',
        400,
        'INVALID_RESET_TOKEN',
      );
    }

    await client.query(
      'UPDATE users SET password_hash = $2 WHERE id = $1',
      [row.user_id, passwordHash],
    );

    await client.query(
      `UPDATE auth_sessions
          SET revoked_at = now()
        WHERE user_id = $1 AND revoked_at IS NULL`,
      [row.user_id],
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

Controller:

```ts
const resetPasswordSchema = z.object({
  token: z.string().min(32).max(128),
  password: passwordSchema,
});

export async function resetPasswordHandler(req: Request, res: Response) {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(
      firstIssueMessage(parsed.error, 'Datos de recuperación inválidos', 'password'),
      400,
    );
  }

  await resetPassword(parsed.data.token, parsed.data.password);
  return res.status(204).end();
}
```

Con rate limit:

```ts
authRouter.post(
  '/auth/reset-password',
  passwordResetRequestRateLimit,
  asyncHandler(resetPasswordHandler),
);
```

Por qué importa el orden: si se actualizara el usuario y después fallara el
`UPDATE` del token, un token usado podría reutilizarse. El `UPDATE ... RETURNING`
dentro de la transacción garantiza que el token se consume una sola vez y que
la contraseña y las revocaciones se confirman juntas.

### Swagger y documentación del back

- `/auth/forgot-password`: request `{ email }`, respuesta `202`, errores
  `400`, `429`, `503`.
- `/auth/reset-password`: request `{ token, password }`, respuesta `204`,
  errores `400`, `429`.
- Aclarar que el token viaja por correo, vence en 30 minutos y es de un solo
  uso.
- Actualizar `README.md` (sección de autenticación y variables de entorno) y
  `db/README.md` con la migración 010.
- No documentar el token en ejemplos de respuesta.

## Frontend (`latin-zumi-front/latin-zumi-react`)

### `src/services/authService.ts`

Agregar:

```ts
export class PasswordResetError extends Error {}

export async function requestPasswordReset(email: string): Promise<void> {
  let response: Response;
  try {
    response = await postJson('/auth/forgot-password', { email });
  } catch (error) {
    if (error instanceof ApiConnectionError) {
      throw new PasswordResetError(
        'No pudimos conectar con el servidor. Probá de nuevo.',
      );
    }
    throw error;
  }

  if (response.status === 429) {
    throw new PasswordResetError(
      'Pediste demasiados enlaces. Esperá unos minutos y probá de nuevo.',
    );
  }
  if (response.status === 503) {
    throw new PasswordResetError(
      'La recuperación no está disponible en este momento. Probá más tarde.',
    );
  }
  if (!response.ok) {
    throw new PasswordResetError('Revisá el email ingresado.');
  }
}

export async function resetPassword(
  token: string,
  password: string,
): Promise<void> {
  let response: Response;
  try {
    response = await postJson('/auth/reset-password', { token, password });
  } catch (error) {
    if (error instanceof ApiConnectionError) {
      throw new PasswordResetError(
        'No pudimos conectar con el servidor. Probá de nuevo.',
      );
    }
    throw error;
  }

  if (response.status === 204) return;
  if (response.status === 429) {
    throw new PasswordResetError(
      'Demasiados intentos. Esperá unos minutos y probá de nuevo.',
    );
  }
  if (response.status === 400) {
    throw new PasswordResetError(
      'El enlace venció o ya fue usado. Pedí uno nuevo.',
    );
  }
  throw new PasswordResetError(
    'No pudimos restablecer tu contraseña. Probá de nuevo.',
  );
}
```

Nota: `forgot-password` responde `202`; el código no lee el body porque el
mensaje exitoso es siempre el mismo, exista o no la cuenta.

### `/recuperar-contrasena`

Reemplazar el aviso `recoveryUnavailable` por el envío real:

```tsx
const [submitted, setSubmitted] = useState(false);

async function handleSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  const result = emailSchema.safeParse(email);
  if (!result.success) {
    setEmailError(result.error.issues[0]?.message ?? 'Ingresá un email válido.');
    return;
  }

  setEmailError('');
  setLoading(true);
  setFormError('');
  setSubmitted(false);

  try {
    await requestPasswordReset(result.data.trim().toLowerCase());
    setSubmitted(true);
  } catch (error) {
    setFormError(
      error instanceof PasswordResetError
        ? error.message
        : 'Ocurrió un error inesperado. Probá de nuevo.',
    );
  } finally {
    setLoading(false);
  }
}
```

Render:

- Éxito (`submitted`): mensaje genérico “Si el email está registrado, te
  enviamos un enlace para restablecer la contraseña. Revisá también el spam.”
  y un enlace a `/login`.
- Error: `form-error` bajo el campo.
- El botón queda con `loading` mientras se envía.
- No se navega automáticamente ni se dice si el email existe.

### `/restablecer-contrasena` (nueva)

Archivo nuevo: `src/pages/ResetPassword.tsx`, ruta en `src/App.tsx`:

```tsx
<Route path="/restablecer-contrasena" element={<ResetPassword />} />
```

Comportamiento:

1. Lee el token con `useSearchParams`.
2. Si falta el token, muestra un `ErrorState` con enlace a
   `/recuperar-contrasena` y no renderiza el formulario.
3. Si hay token, muestra dos campos: “Nueva contraseña” y “Repetí la
   contraseña”, con la misma validación de registro
   (`registerSchema.shape.password`) y una comprobación de igualdad.
4. Al enviar, llama `resetPassword(token, password)`.
5. En `204`, muestra una pantalla de éxito con “Ya podés ingresar con tu nueva
   contraseña” y un enlace a `/login`.
6. En `400`, muestra el mensaje del servicio y un enlace para pedir otro
   enlace.

Snippet del submit:

```tsx
const result = resetPasswordFormSchema.safeParse({ password, confirmPassword });
if (!result.success) {
  setFieldErrors(/* primer error por campo */);
  return;
}

try {
  await resetPassword(token, result.data.password);
  setSuccess(true);
} catch (error) {
  setFormError(
    error instanceof PasswordResetError
      ? error.message
      : 'No pudimos restablecer tu contraseña. Probá de nuevo.',
  );
}
```

El formulario no debe mostrar el token en pantalla, ni enviarlo a analytics, ni
guardarlo en `localStorage`.

### Estilos y README del front

- Reutilizar `auth-page`, `auth-card`, `form-error` y los estados existentes
  (`LoadingState`, `ErrorState`, `EmptyState`).
- Actualizar `README.md`: la recuperación ya está disponible, qué proveedor de
  email usa el back y que el enlace vence en 30 minutos.
- No cambiar `VITE_API_URL` ni `VITE_USE_MOCK`.

## Archivos afectados

### Backend

- `db/migrations/010_password_reset_tokens.sql` (nuevo)
- `db/scripts/init-db.ts`
- `db/README.md`
- `src/config/env.ts`
- `src/services/password-reset.service.ts` (nuevo)
- `src/services/email/email-provider.ts` (nuevo)
- `src/services/email/console-email-provider.ts` (nuevo)
- `src/services/email/resend-email-provider.ts` (nuevo)
- `src/controllers/auth.controller.ts`
- `src/routes/auth.route.ts`
- `src/middleware/loginRateLimit.ts`
- `src/config/swagger.ts`
- `src/tests/services/password-reset.service.test.ts` (nuevo)
- `src/tests/controllers/auth.controller.test.ts` (ampliar)
- `.env.example`
- `README.md`

### Frontend (`latin-zumi-front/latin-zumi-react`)

- `src/services/authService.ts`
- `src/pages/PasswordRecovery.tsx`
- `src/pages/ResetPassword.tsx` (nuevo)
- `src/App.tsx`
- `src/components/forms/schemas.ts` (schema del formulario de reset)
- `src/styles/pages/auth.css` (estados de éxito)
- `tests/components/forms/PasswordRecovery.test.tsx` (nuevo, opcional)
- `README.md`

## Pasos

1. Crear la migración 010 y agregarla a `init-db.ts`.
2. Agregar las variables de entorno y sus validaciones.
3. Implementar `EmailProvider` con `console` y `resend`.
4. Implementar `password-reset.service.ts` con los dos flujos.
5. Agregar controllers, rate limits y rutas.
6. Documentar en Swagger, README y `db/README.md`.
7. Conectar `/recuperar-contrasena` y crear `/restablecer-contrasena`.
8. Agregar tests y ejecutar `npm test`, `npm run build` y el flujo manual.

## Cómo probar

### Backend

- [ ] `npm run db:init` aplica 001–010 sobre una base vacía.
- [ ] `npm run db:init` dos veces seguidas no falla ni duplica la tabla.
- [ ] `psql` muestra `password_reset_tokens` con el índice parcial.
- [ ] `POST /auth/forgot-password` con email existente: `202`, fila nueva en
      la tabla y enlace en el log (provider `console`).
- [ ] `POST /auth/forgot-password` con email inexistente: `202` con el mismo
      body, sin filas nuevas.
- [ ] Email inválido: `400`.
- [ ] Sexto pedido en 15 minutos desde la misma IP: `429`.
- [ ] El token guardado no es el token recibido (se guarda SHA-256).
- [ ] `POST /auth/reset-password` con token válido y contraseña válida: `204`;
      `users.password_hash` cambió.
- [ ] El mismo token dos veces: el segundo intento responde `400` y no cambia
      la contraseña.
- [ ] Token vencido: `400`.
- [ ] Token inexistente o con formato inválido: `400`.
- [ ] Contraseña de 7 caracteres: `400`.
- [ ] Después del reset, el token de sesión anterior responde `401` en
      `GET /accounts`.
- [ ] El nuevo login funciona con la contraseña nueva y falla con la vieja.
- [ ] En producción con `EMAIL_PROVIDER=console`: `503 EMAIL_NOT_CONFIGURED`.
- [ ] `npm run build` y `npm test` pasan.

### Frontend

- [ ] `/recuperar-contrasena` envía el email y muestra el mensaje genérico.
- [ ] El mensaje es idéntico para un email existente y uno inexistente.
- [ ] `429` muestra el mensaje de espera.
- [ ] Un error de red muestra “No pudimos conectar con el servidor”.
- [ ] `/restablecer-contrasena?token=...` permite elegir y confirmar la nueva
      contraseña.
- [ ] Confirmación distinta: error de campo, sin llamada al back.
- [ ] Contraseña que no cumple la regla del front: error antes de llamar.
- [ ] Token vencido o usado: mensaje claro y enlace para pedir otro.
- [ ] `204`: pantalla de éxito con enlace a `/login`.
- [ ] La nueva contraseña funciona en el login.
- [ ] No hay llamadas a endpoints inexistentes ni el token aparece en la URL
      después de usarlo (se puede limpiar con `history.replaceState`).
- [ ] `npm run build` y `npm test` pasan.

## Riesgos / notas

- **Entregabilidad del correo:** Resend requiere verificar el dominio y
  configurar SPF/DKIM. Sin eso el correo puede caer en spam. El enlace debe
  apuntar al front (`PASSWORD_RESET_URL`), no al back.
- **Enumeración de cuentas:** el `202` y el mensaje son constantes. No agregar
  “email no encontrado” ni códigos distintos. El envío en segundo plano
  también evita diferencias evidentes de tiempo.
- **Token en logs:** el provider de consola imprime el enlace solo en
  desarrollo/test. En producción está prohibido usar `console`. No loguear el
  body de `reset-password`.
- **Un solo uso y concurrencia:** el `UPDATE ... RETURNING` es la garantía. No
  reemplazarlo por un `SELECT` seguido de `UPDATE`.
- **Revocación total:** después del reset se cierran todas las sesiones,
  incluida la del dispositivo actual si el usuario estaba logueado en otro
  lado. Es intencional.
- **Rate limit por proceso:** igual que el login (D9 = A). Con varias réplicas
  el límite deja de ser global.
- **Proveedor de email caído:** el pedido responde `202` igual y el fallo queda
  en el log. Si Resend está caído de forma sostenida, el usuario puede pedir
  otro enlace.
- **Contraseñas legacy:** la recuperación permite fijar una contraseña nueva
  que cumpla la regla; también sirve para salir del estado
  `password_change_required`. No envía el flag al front.
- **Longitud de contraseña:** el spec 025 menciona 15–128, pero
  `src/schemas/password.ts` define `PASSWORD_MIN_LENGTH = 8` y así lo usan el
  registro y el login hoy. Estos specs siguen el código. Si el equipo decide
  volver a 15, cambiar la constante y los formularios antes de implementar.
- **Migración en una transacción:** `init-db.ts` corre todas las migraciones
  juntas. Si 010 falla, se revierte todo el lote; no ejecutar dos `db:init` a la
  vez (D11 = B).
- **Número de migración:** el spec 030 (depósitos y cambio de moneda) preveía
  usar 010 para `exchange_quotes`, pero esa migración no existe todavía. Este
  spec toma 010 para los tokens de recuperación. Si 030 se implementa después,
  su migración debe ser la siguiente libre (011).
- **Datos personales:** el correo incluye el nombre del usuario. No incluir
  saldos, IDs de cuenta ni otra información sensible.

## Fuera de alcance

- Envío de correos de bienvenida, verificación de email o notificaciones.
- Recuperación por SMS o preguntas de seguridad.
- `GET /auth/reset-password/validate` para validar el token al abrir la página.
- Refresco automático de sesión.
- Cambio de email o de contraseña desde una sesión autenticada (spec 037).
- Proveedores de email distintos de Resend.
