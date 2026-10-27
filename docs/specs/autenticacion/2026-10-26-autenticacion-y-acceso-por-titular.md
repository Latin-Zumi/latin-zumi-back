# Spec: Autenticación y acceso por titular

## Fecha
2026-10-26

## Orden de ejecución: 011

## Problema
Los endpoints `GET /accounts/:id`, `GET /accounts/:id/balance` y
`GET /transactions/:id` aceptan un UUID sin autenticar al solicitante ni
comprobar que el recurso le pertenezca. Las respuestas pueden revelar saldos,
identificadores, descripciones e información de los asientos de otras
personas. Actualmente tampoco hay login, logout ni sesiones revocables.

## Solución propuesta
Agregar sesiones opacas de servidor para esta API: `POST /auth/login` valida
username/email y contraseña, emite un token aleatorio Bearer y guarda en la
base únicamente su hash SHA-256, vencimiento y revocación. `POST /auth/logout`
revoca el token actual. Un middleware autentica cada solicitud protegida y
adjunta el `userId` verificado al request. Los services reciben ese `userId`
y limitan las consultas en SQL al titular; no se confiará en un `user_id`
proporcionado por el cliente.

Las respuestas para cuentas propias conservarán su contrato. La lectura de
una transacción se convertirá en una vista de actividad del titular: solo
devuelve sus propios asientos y no expone `idempotency_key` ni asientos de
cuentas internas u otros usuarios. Un ID inexistente y uno ajeno responderán
igual (`404`) para no confirmar la existencia del recurso.

### Snippets propuestos

#### Login y envío del token

```http
POST /auth/login
Content-Type: application/json
```

```json
{
  "identifier": "ana.perez",
  "password": "una-frase-de-acceso-larga"
}
```

Respuesta `200`:

```json
{
  "data": {
    "access_token": "<token-aleatorio-de-un-solo-secreto>",
    "token_type": "Bearer",
    "expires_at": "2026-10-26T19:00:00.000Z",
    "password_change_required": false
  }
}
```

El cliente envía el token como `Authorization: Bearer <access_token>`. El
token debe generarse con CSPRNG (por ejemplo, 32 bytes aleatorios); el valor
en claro se devuelve una vez y no se guarda ni se escribe en logs. La sesión
inicial tendrá vencimiento absoluto de una hora y logout la revocará en el
servidor. No se incluye renovación automática de token en este alcance. Si el
login detecta una contraseña legada menor a 15 caracteres, devolverá
`password_change_required: true` y la sesión no podrá consultar datos hasta
actualizarla.

#### Cambio de contraseña legado

```http
POST /auth/change-password
Authorization: Bearer <access_token>
Content-Type: application/json
```

```json
{
  "current_password": "clave-anterior",
  "new_password": "una-frase-de-acceso-de-quince-o-mas"
}
```

El cambio vuelve a validar la contraseña actual, guarda un hash scrypt nuevo
versionado y revoca las demás sesiones del usuario. El token actual se
conserva y se quita su indicador `password_change_required`.

#### Tabla de sesiones

```sql
CREATE TABLE auth_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    password_change_required BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT auth_sessions_expiration_after_creation
        CHECK (expires_at > created_at)
);

CREATE INDEX auth_sessions_user_active_idx
    ON auth_sessions (user_id, expires_at)
    WHERE revoked_at IS NULL;
```

La migración incremental será `003_auth_sessions.sql`. Se actualizará
`db:init` para aplicarla después de las migraciones actuales.

#### Middleware de autenticación

```ts
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = readBearerToken(req.headers.authorization);
  if (!token) throw new AppError('Autenticación requerida', 401);

  const session = await findActiveSessionByHash(sha256(token));
  if (!session) throw new AppError('Sesión inválida o vencida', 401);

  const allowedWhileChangingPassword = [
    '/auth/change-password',
    '/auth/logout',
  ].includes(req.path);
  if (session.password_change_required && !allowedWhileChangingPassword) {
    throw new AppError('Debes actualizar tu contraseña', 403);
  }
  req.auth = { userId: session.user_id };
  next();
}
```

El hash rápido SHA-256 se usa solo para el token aleatorio de alta entropía;
las contraseñas siguen usando una función lenta de derivación.

#### Limitar intentos de login

```ts
export const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});
```

El límite mostrado es por IP para el alcance de una instancia. Si se despliega
más de una instancia, se configurará un store compartido; el store en memoria
por sí solo no coordina límites entre servidores.

#### Proteger rutas y filtrar cuentas en el service

```ts
accountsRouter.get(
  '/accounts/:id',
  asyncHandler(requireAuth),
  asyncHandler(getAccount),
);
```

```sql
SELECT a.id,
       a.user_id,
       RTRIM(a.currency) AS currency,
       a.account_type,
       a.allow_negative,
       COALESCE(b.balance, 0)::text AS balance
  FROM accounts a
  LEFT JOIN account_balances b
    ON b.account_id = a.id AND b.currency = a.currency
 WHERE a.id = $1
   AND a.user_id = $2;
```

El controller toma `$2` de `req.auth.userId`, establecido por el middleware,
nunca del body o query string. `getBalanceByAccountId` reutilizará la lectura
de cuenta autorizada.

#### Transacción visible solo para su titular

```sql
SELECT t.id, t.description, t.occurred_at
  FROM transactions t
 WHERE t.id = $1
   AND EXISTS (
       SELECT 1
         FROM entries e
         JOIN accounts a ON a.id = e.account_id
        WHERE e.transaction_id = t.id
          AND a.user_id = $2
   );

SELECT e.id::text AS id, e.account_id, e.amount::text AS amount,
       e.direction, RTRIM(e.currency) AS currency, e.created_at
  FROM entries e
  JOIN accounts a ON a.id = e.account_id
 WHERE e.transaction_id = $1
   AND a.user_id = $2
 ORDER BY e.id;
```

La respuesta no incluye otros usuarios, cuentas internas ni la clave de
idempotencia. El endpoint representa la actividad propia del titular, no una
vista global del asiento doble.

### Aspectos relacionados necesarios para hacerlo bien

- **Formato de hash y verificación:** los hashes actuales tienen formato
  `scrypt$salt$derivedKey` y se generaron con los defaults de Node. El login
  debe poder verificar ese formato para no bloquear usuarios ya registrados.
  En una autenticación correcta, se re-hashará al formato versionado con coste
  explícito recomendado para producción (`N=2^17`, `r=8`, `p=1`, sujeto a
  benchmark y límite de memoria configurado). Las nuevas contraseñas tendrán
  mínimo de 15 caracteres y máximo de 128, aceptando espacios y Unicode sin
  reglas de composición. Si un usuario legado inicia sesión con menos de 15
  caracteres, su sesión solo podrá cambiar la contraseña; al actualizarla se
  re-hashará el valor y se revocarán sus otras sesiones.
- **Rate limit del login:** limitar intentos por IP y por identificador
  normalizado, con respuesta genérica `401` para identificador o contraseña
  incorrectos. Una función lenta de password hashing sin limitación abre una
  vía de consumo de CPU/memoria.
- **Transporte y almacenamiento del cliente:** solo usar estos tokens sobre
  HTTPS en entornos desplegados y no guardarlos en URLs o logs. Para cliente
  browser, decidir almacenamiento antes de producción; no guardar bearer
  tokens en `localStorage`. Si se decide cookie HttpOnly, Secure y SameSite,
  habrá que añadir protección CSRF y actualizar los ejemplos HTTP.
- **Pruebas necesarias:** escenarios de dos titulares, token inválido/vencido,
  logout, recurso ajeno, sesión revocada y compatibilidad con hashes
  existentes. La prueba de transacción debe confirmar que no devuelve los
  asientos de otras cuentas.

## Archivos afectados
- db/migrations/003_auth_sessions.sql
- db/scripts/init-db.ts
- src/types/express.d.ts
- src/routes/auth.route.ts
- src/routes/accounts.route.ts
- src/routes/transactions.route.ts
- src/controllers/auth.controller.ts
- src/controllers/users.controller.ts
- src/controllers/accounts.controller.ts
- src/controllers/transactions.controller.ts
- src/services/auth.service.ts
- src/utils/password.ts
- src/services/accounts.service.ts
- src/services/transactions.service.ts
- src/middleware/requireAuth.ts
- src/middleware/loginRateLimit.ts
- package.json
- package-lock.json
- src/config/swagger.ts
- README.md
- docs/specs/autenticacion/2026-10-26-autenticacion-y-acceso-por-titular.md

## Pasos
1. Agregar `auth_sessions` con hash único de token, vencimiento, revocación e
   índice para sesiones activas; extender el inicializador para aplicar la
   migración incremental.
2. Crear login, cambio de contraseña y logout con token Bearer opaco,
   respuestas genéricas para credenciales incorrectas, vencimiento del lado
   servidor, limitación de intentos y revocación.
3. Implementar `requireAuth` y el tipo `req.auth`; proteger las tres rutas de
   lectura y mantener público únicamente el registro/login.
4. Cambiar services para exigir `userId`; devolver cuenta/saldo solo si el
   `user_id` coincide y filtrar transacciones/asientos al titular.
5. Retirar `idempotency_key` de la respuesta pública de transacciones y
   documentar contratos, códigos `401`/`404` y requisito Bearer en Swagger y
   README.
6. Mantener compatibilidad de verificación con hashes scrypt existentes,
   versionar el nuevo formato/coste, exigir actualización de contraseñas
   legadas menores a 15 caracteres y agregar limitación de intentos de login.

## Cómo probar
- [x] `npm run build` compila el middleware, controllers y services.
- [x] `npm run db:init` aplica la migración `003_auth_sessions.sql`.
- [ ] Un usuario puede iniciar sesión y recibe un Bearer token válido; una
  contraseña o usuario incorrectos reciben el mismo `401` genérico.
- [ ] Sin token, con token malformado, vencido o revocado, las tres rutas de
  lectura responden `401`.
- [ ] Con token válido, el dueño puede consultar cuenta y saldo; otro usuario
  recibe `404` para ese UUID.
- [ ] La consulta de transacción devuelve solo asientos propios y no incluye
  `idempotency_key` ni asientos de otras cuentas.
- [ ] Logout revoca el token y su uso posterior recibe `401`.
- [ ] Usuarios con hash legado inician sesión, pero no acceden a datos hasta
  cambiar la contraseña; ese cambio revoca sus otras sesiones.
- [ ] El login verifica un hash scrypt legado y permite actualizarlo al formato
  nuevo después de autenticación exitosa.
- [ ] Los intentos repetidos de login quedan limitados sin revelar si existe
  el username/email.
- [x] Swagger/README documentan Bearer, login/logout y respuestas de error.

## Riesgos / notas
- Este spec elige tokens Bearer opacos con estado en PostgreSQL para permitir
  revocación inmediata y mantener bajo el número de dependencias. Si el
  frontend es una aplicación browser, debe decidirse cookie HttpOnly versus
  BFF antes de implementar el transporte.
- La duración de una hora se propone para el primer alcance; una estrategia de
  refresh/rotación queda fuera y requeriría otro spec.
- Las filas antiguas de `accounts.user_id` que quedaron huérfanas por el FK
  legacy `NOT VALID` no podrán autenticarse como dueño hasta asignarlas a un
  `users.id` válido.
- El hash seed `seed-only-not-for-authentication` no es credencial de login y
  la cuenta demo no debe habilitarse como usuario autenticable.
- Antes de producción se requiere desplegar TLS, limitar login a nivel
  distribuido si hay varias instancias y no registrar tokens ni contraseñas.
- Referencias consultadas: [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html),
  [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html),
  [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html),
  [OWASP REST Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html).
- El limitador de ejemplo usa [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit);
  su documentación advierte que el store en memoria no comparte contadores
  entre procesos/servidores.
- Los parámetros citados para password hashing se contrastan con
  [Node.js 24 Crypto](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback),
  [NIST SP 800-63B-4](https://csrc.nist.gov/pubs/sp/800/63/B/4/final) y la
  guía de contraseñas de OWASP enlazada arriba.
