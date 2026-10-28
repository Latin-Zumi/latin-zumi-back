# Spec: registro transaccional con `POST /auth/register`

## Fecha

2026-10-27

## Orden de ejecución: 028

Depende de la migración 008 aplicada (spec 027) y del contrato de sesión,
`toAuthUser` y `createSessionForUser` (spec 026). Implementar antes del cambio
8 del spec 025, que consume este endpoint desde el front.

## Problema

El registro actual (`POST /users`) crea usuario, wallet y cuenta, pero no crea
una sesión y devuelve un contrato legado. El flujo nuevo necesita completar el
registro en una sola operación: usuario, wallet, cuenta inicial y sesión; si
cualquier paso falla, no debe quedar una creación parcial.

## Solución propuesta

Agregar `POST /auth/register` con payload `{ nombre, email, pais, password }`.
Validar los campos en el backend, normalizar el email a minúsculas, derivar la
moneda del país y responder `201 { token, user }`. Reutilizar
`createUserWithWallet` para crear las entidades y `createSessionForUser` y
`toAuthUser` del spec 026. Eliminar `/users` si ya no se usa y actualizar su respectiva parte en swagger.

### Contrato y validación

```ts
const registerSchema = z.object({
  nombre: z.string().trim().min(2).max(50).regex(NOMBRE_VALIDO),
  email: z.string().trim().email().max(254)
    .transform((email) => email.toLowerCase()),
  pais: z.enum(['Argentina', 'Colombia', 'Otro']),
  password: z.string().max(128).refine(isPasswordLongEnough),
});
```

El controller valida la solicitud antes de llamar al servicio; el mínimo de
contraseña es 15 caracteres, igual que el formulario. Nombre y país respetan
las reglas ya definidas por el contrato del spec 025. Una solicitud válida
responde `201` con `{ token, user }`, y `user` usa exactamente el shape público
del spec 026, sin secretos de autenticación.

### Creación atómica

```ts
const passwordHash = await hashPassword(input.password);
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const user = await createUserWithWallet(client, {
    ...input,
    passwordHash,
    monedaPreferida: currencyForCountry(input.pais),
  });
  const session = await createSessionForUser(user.id, { client });
  await client.query('COMMIT');
  return { token: session.token, user: toAuthUser(user) };
} catch (error) {
  await client.query('ROLLBACK');
  throw translateRegistrationConflict(error);
} finally {
  client.release();
}
```

El servicio calcula el hash antes de abrir la transacción. Dentro de ella
crea usuario, wallet, cuenta inicial y sesión; solo confirma cuando todas las
operaciones terminan. Cualquier error revierte las cuatro. Los conflictos de
email, incluida una diferencia solo de mayúsculas, se convierten en `409`.

`createUserWithWallet` reintenta hasta tres veces si el username generado a
partir del email ya existe; un conflicto de email no se reintenta. La wallet y
la cuenta `user` usan la moneda derivada: Argentina → `ARS`, Colombia → `COP`,
Otro → `USD`. Se aplica `registrationRateLimit` a la ruta.

### Compatibilidad del endpoint legado

`POST /users` conserva su request y respuesta actuales y no crea una sesión.
Swagger lo marca `deprecated: true` y el README señala a `/auth/register` como
el flujo nuevo. Cuando comparta la creación de usuario, el servicio adapta sus
datos al helper común sin alterar el shape legado.

## Archivos afectados

- `src/routes/auth.route.ts`
- `src/controllers/auth.controller.ts` y su prueba
- `src/services/auth.service.ts` y su prueba
- `src/services/users.service.ts` y su prueba
- `src/utils/country.ts` (nuevo)
- `src/config/swagger.ts`
- `README.md`
- `docs/specs/README.md`

## Pasos

1. Añadir la validación y el controller para `POST /auth/register`.
2. Implementar el servicio transaccional y el helper compartido de usuario,
   wallet y cuenta, con asignación de moneda y manejo de conflictos.
3. Conectar la ruta con rate limit; documentar la ruta nueva y eliminar `/users`
   si ya no se va a usar para nada.
4. Añadir pruebas de éxito, validación, conflictos, rollback y compatibilidad.

## Cómo probar

- [ ] Registro válido crea usuario, wallet, cuenta `user` y sesión; responde
      `201 { token, user }` con el shape público.
- [ ] Países Argentina, Colombia y Otro asignan `ARS`, `COP` y `USD`.
- [ ] Email duplicado, con cualquier combinación de mayúsculas, responde 409.
- [ ] Payload inválido responde 400; el rate limit responde 429.
- [ ] Un fallo al crear wallet, cuenta o sesión revierte todas las filas.
- [ ] `POST /users` conserva su contrato y no crea sesión; Swagger lo marca
      obsoleto.

## Riesgos / notas

- Requiere que `createSessionForUser` acepte el cliente de la transacción para
  que la sesión se confirme o revierta junto con el resto del registro.
- Los errores de email duplicado deben traducirse aquí a 409; no cambiar el
  comportamiento general del `errorHandler`.
- Este spec cubre el backend del cambio 6/F8. El consumo desde el front queda
  en el cambio 8 del spec 025.
