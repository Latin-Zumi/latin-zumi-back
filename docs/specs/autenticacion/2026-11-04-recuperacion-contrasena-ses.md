# Spec: recuperación de contraseña con Amazon SES
## Fecha
2026-11-04
## Orden de ejecución
**052.** Registrado al final de `docs/specs/index-specs.md`. No reutilizar
números ya asignados.
## Alcance
- Sustituir Resend por Amazon SES (SDK v3, `@aws-sdk/client-sesv2`) en el
  correo de recuperación de contraseña.
- Ajustar variables de entorno, remitente, TTL a 1 hora y correo HTML + texto.
- Mantener intactos login, registro, hash de contraseñas y contrato HTTP.
- Fuera de alcance: frontend, endpoints nuevos, migración nueva y otros
  proveedores.
## Causa raíz / estado actual
El flujo ya existe desde el spec 036: `POST /auth/forgot-password` y
`POST /auth/reset-password`, tabla `password_reset_tokens` (migración 010),
token hasheado con SHA-256, vencimiento, marca de uso y consumo atómico. El
único proveedor real es Resend (`src/services/email/resend-email-provider.ts`).
La causa del cambio es el proveedor de correo, no el flujo de tokens.

Decisiones de compatibilidad: se conservan las rutas `/auth/...` y el campo
`password` porque el frontend actual depende de ellas; el enlace usa
`/restablecer-contrasena`, ruta real del front; el TTL pasa de 30 a 60 minutos.
## Cambio propuesto

### Variables de entorno
`src/config/env.ts` y `.env.example` incorporan `EMAIL_PROVIDER=ses`,
`AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
`SES_FROM_EMAIL=Latin Zumi <no-reply@latinzumi.com>`,
`FRONTEND_URL=http://localhost:5173` y `PASSWORD_RESET_TTL_MINUTES=60`.

En el esquema Zod, `EMAIL_PROVIDER` pasa a `z.enum(['console', 'ses'])`,
`SES_FROM_EMAIL` reemplaza a `EMAIL_FROM`, `FRONTEND_URL` reemplaza a
`PASSWORD_RESET_URL` y el TTL usa `.default(60)`. Una regla cruzada exige
`AWS_REGION`, `AWS_ACCESS_KEY_ID` y `AWS_SECRET_ACCESS_KEY` cuando
`EMAIL_PROVIDER=ses`; si falta alguna, el arranque falla con un mensaje que
nombra las tres. Quién lo ejecuta: el arranque del backend. Resultado:
credenciales incompletas no pasan de la validación de entorno.

### Esquema de base de datos
No hace falta migración nueva: la 010 ya guarda solo el hash, la expiración y
la marca de uso.

```sql
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    requested_ip TEXT
);
```

Quién lo ejecuta: `npm run db:init` (ya aplicado en bases existentes).
Resultado: el TTL de 60 minutos se calcula en la aplicación al insertar
`expires_at`; no requiere `ALTER TABLE`. Este spec no ejecuta la migración.

### Servicio de correo
Archivo nuevo `src/services/email/ses-email-provider.ts`. El cliente SES se
crea una vez en el factory y se inyecta para poder testearlo.

```ts
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

const command = new SendEmailCommand({
  FromEmailAddress: this.from,
  Destination: { ToAddresses: [message.to] },
  Content: {
    Simple: {
      Subject: { Data: 'Restablecé tu contraseña de Latin Zumi', Charset: 'UTF-8' },
      Body: {
        Html: { Data: buildResetEmailHtml(message), Charset: 'UTF-8' },
        Text: { Data: buildResetEmailText(message), Charset: 'UTF-8' },
      },
    },
  },
});

try {
  const { MessageId } = await this.client.send(command);
  return MessageId;
} catch (error) {
  const name = error instanceof Error ? error.name : 'UnknownError';
  const status = (error as { $metadata?: { httpStatusCode?: number } })
    .$metadata?.httpStatusCode;
  throw new Error(`SES SendEmail falló: ${name}${status ? ` (HTTP ${status})` : ''}`);
}
```

Quién lo ejecuta: `requestPasswordReset`, después de guardar el token.
Resultado: SES encola el correo y devuelve `MessageId`; asunto y cuerpos en
español. `FromEmailAddress`, `Destination` y `Content.Simple` corresponden a la
API `SendEmail` de SES v2. El `catch` reduce el error a nombre y estado HTTP,
sin token, enlace ni cuerpo; `requestPasswordReset` lo escribe en el log. Las
excepciones documentadas son `AccountSuspendedException`,
`BadRequestException`, `LimitExceededException`,
`MailFromDomainNotVerifiedException`, `MessageRejected`, `NotFoundException`,
`SendingPausedException` y `TooManyRequestsException`.

El factory (`src/services/email/email-provider.ts`) crea el `SESv2Client` con
`region: env.AWS_REGION` y las credenciales `AWS_*`, y devuelve
`new SesEmailProvider(client, env.SES_FROM_EMAIL)` cuando `EMAIL_PROVIDER=ses`.
Con `console` mantiene el modo local y, en producción, el `503
EMAIL_NOT_CONFIGURED`.

### Enlace y TTL
`src/services/password-reset.service.ts`:

```ts
const resetUrl = new URL(
  'restablecer-contrasena',
  `${env.FRONTEND_URL.replace(/\/+$/, '')}/`,
);
resetUrl.searchParams.set('token', token);

void provider
  .sendPasswordReset({
    to: user.email,
    nombre: user.nombre,
    resetUrl: resetUrl.toString(),
    expiresInMinutes: env.PASSWORD_RESET_TTL_MINUTES,
  })
  .catch((error: unknown) => {
    console.error(
      'No se pudo enviar el email de recuperación',
      error instanceof Error ? error.message : error,
    );
  });
```

Quién lo ejecuta: `forgot-password`. Resultado: el enlace apunta a
`<FRONTEND_URL>/restablecer-contrasena?token=<token>`; el correo muestra la
vigencia real (60 minutos). `PasswordResetEmail` incorpora
`expiresInMinutes: number` para que HTML y texto no se desincronicen si cambia
la configuración. El token en claro nunca se guarda ni se registra.
## Criterios de aceptación
- `EMAIL_PROVIDER=ses` envía por SES v2 con HTML y texto plano.
- Remitente, región y credenciales salen de `SES_FROM_EMAIL` y `AWS_*`.
- Con `ses` y variables AWS incompletas, el arranque falla claramente.
- El enlace usa `FRONTEND_URL` y el TTL por defecto es 60 minutos.
- `forgot-password` responde `202` con el mismo body exista o no el email.
- Un fallo de SES se registra en el log sin cambiar la respuesta ni exponer
  detalles al cliente.
- `reset-password` valida hash, expiración y uso único, reutiliza
  `hashPassword` y responde `204`.
- La única dependencia nueva es `@aws-sdk/client-sesv2`.
- `.env` sigue ignorado por Git; `.env.example` no contiene valores reales.
## Tests
- `src/tests/services/email/ses-email-provider.test.ts` (nuevo): parámetros de
  `SendEmailCommand` y error del SDK sin filtrar el enlace.
- `src/tests/config/env.test.ts`: default de `SES_FROM_EMAIL`, TTL 60 y rechazo
  de `ses` sin credenciales.
- `src/tests/services/password-reset.service.test.ts`: mock de entorno, TTL y
  enlace construido con `FRONTEND_URL`.
- `npm test` y `npm run build`.
## Archivos afectados
- `package.json`, `package-lock.json` (solo `@aws-sdk/client-sesv2`)
- `src/config/env.ts`, `src/config/swagger.ts`
- `src/services/email/` (`email-provider.ts`, `ses-email-provider.ts` nuevo,
  `resend-email-provider.ts` eliminado)
- `src/services/password-reset.service.ts`
- `src/tests/` (`config/env.test.ts`, `services/password-reset.service.test.ts`,
  `services/email/ses-email-provider.test.ts` nuevo)
- `.env.example`, `render.yaml`, `README.md`, `db/README.md`
## Pasos
1. Aprobar este spec.
2. Pedir confirmación e instalar `@aws-sdk/client-sesv2`.
3. Implementar el proveedor SES y el factory.
4. Ajustar entorno, enlace, TTL, tests y documentación.
5. Ejecutar `npm test` y `npm run build`.
6. Verificar manualmente en AWS y probar los endpoints.
## Cómo probar
- [x] `npm run build` compila y `npm test` pasa.
- [x] `EMAIL_PROVIDER=console` imprime el enlace en el log.
- [ ] `EMAIL_PROVIDER=ses` con remitente y destinatario verificados envía el
      correo y no registra el token.
- [ ] `forgot-password` con email existente e inexistente devuelve el mismo
      `202` y el mismo body.
- [ ] El enlace abre `<FRONTEND_URL>/restablecer-contrasena?token=...`; el token
      vence a los 60 minutos y no se puede reutilizar.
- [ ] Un fallo de SES deja el error en el log y el cliente recibe `202`.
- [ ] `reset-password` cambia la contraseña, revoca sesiones y responde `204`.
## Riesgos / notas
- **Sandbox:** solo envía a identidades verificadas; el estado es por región.
  Verificar remitente y destinatario para probar; pedir salida para producción.
- **IAM:** la credencial necesita `ses:SendEmail` y `ses:SendRawEmail` sobre la
  identidad remitente.
- **Credenciales estáticas:** `AWS_ACCESS_KEY_ID` y `AWS_SECRET_ACCESS_KEY` por
  pedido explícito; rotarlas y no versionarlas.
- **Remitente no verificado:** SES devuelve `MessageRejected` o
  `MailFromDomainNotVerifiedException`; el cliente sigue viendo `202`.
- **Envío en segundo plano:** el fallo se registra después de responder para no
  revelar por tiempos si la cuenta existe. `.env` ya está ignorado.
- **Migración:** no se ejecuta ningún comando de base en este spec.
