# Spec: Registro de usuario y billetera

## Fecha
2026-10-26

## Orden de ejecución: 010

## Problema
El modelo actual permite consultar cuentas del ledger, pero no registra
usuarios ni permite crear una billetera. `accounts.user_id` no tiene una tabla
de usuarios asociada y la API no recibe username ni otros datos de registro.
Por eso no existe un flujo para vincular de forma segura la identidad de una
persona con su cuenta.

## Solución propuesta
Agregar un endpoint `POST /users` que reciba `username`, `email`, `password` y
la moneda inicial de la billetera (`currency`, inicialmente `COP` si no se
envía). El registro creará el usuario y una cuenta de tipo `user` asociada,
con `allow_negative` en `false` y saldo inicial cero. El username y el email
serán únicos; la contraseña se almacenará únicamente como hash y nunca se
devolverá en la respuesta.

El esquema agregará una tabla `users` y relacionará `accounts.user_id` con
ella. La respuesta incluirá los datos públicos del usuario y la billetera
creada. No se modificarán `transactions` ni `entries`: abrir una billetera no
es un movimiento contable y el saldo cero se deriva del ledger existente.
Este alcance no incluye inicio de sesión, autenticación, verificación de
identidad ni depósitos.

### Snippets propuestos

#### Solicitud y respuesta

```http
POST /users
Content-Type: application/json
```

```json
{
  "username": "ana.perez",
  "email": "ana@example.com",
  "password": "una-clave-segura",
  "currency": "COP"
}
```

`currency` puede omitirse y entonces se usará `COP`. La contraseña solo se
acepta en la solicitud para derivar su hash.

```json
{
  "data": {
    "user": {
      "id": "20000000-0000-4000-8000-000000000003",
      "username": "ana.perez",
      "email": "ana@example.com"
    },
    "account": {
      "id": "10000000-0000-4000-8000-000000000003",
      "user_id": "20000000-0000-4000-8000-000000000003",
      "currency": "COP",
      "account_type": "user",
      "allow_negative": false,
      "balance": "0"
    }
  }
}
```

#### Esquema SQL

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE accounts
    ADD CONSTRAINT accounts_user_id_fk
    FOREIGN KEY (user_id) REFERENCES users (id);
```

El snippet muestra el cambio lógico; se ajustará a la migración inicial del
proyecto, que actualmente crea el esquema desde cero.

#### Hash de contraseña con `scrypt` de Node.js

```ts
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derivedKey.toString('hex')}`;
}
```

Este formato guarda algoritmo, salt aleatorio y resultado derivado, sin
requerir una dependencia adicional ni guardar la contraseña original.

#### Creación atómica de usuario y cuenta

```ts
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const user = await client.query(
    `INSERT INTO users (username, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, username, email`,
    [username, email, passwordHash],
  );
  const account = await client.query(
    `INSERT INTO accounts (user_id, currency, account_type, allow_negative)
     VALUES ($1, $2, 'user', false)
     RETURNING id, user_id, RTRIM(currency) AS currency,
               account_type, allow_negative`,
    [user.rows[0].id, currency],
  );
  await client.query('COMMIT');
  // La respuesta agrega balance: '0'; la vista no tiene fila hasta el primer asiento.
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

El controller validará el payload antes de llamar al service. El service
traducirá conflictos de unicidad de username/email a un error `409`; cualquier
fallo antes del `COMMIT` revierte ambas inserciones.

## Archivos afectados
- db/migrations/001_ledger.sql
- db/migrations/002_users.sql
- db/seeds/001_demo_data.sql
- db/scripts/init-db.ts
- src/routes/users.route.ts
- src/controllers/users.controller.ts
- src/services/users.service.ts
- src/server.ts
- src/config/swagger.ts
- README.md
- db/README.md
- docs/specs/autenticacion/2026-10-26-registro-usuario-billetera.md

## Pasos
1. Crear la tabla `users` con identificador, username único, email único,
   hash de contraseña y fecha de creación; añadir la clave foránea desde
   `accounts.user_id`, incluyendo una migración incremental para bases que ya
   tengan el esquema anterior.
2. Validar el payload del registro, incluyendo username, email, contraseña y
   moneda de tres letras, con `COP` como moneda predeterminada.
3. Implementar `POST /users` en una transacción SQL que inserte usuario y
   cuenta para evitar registros parciales; asignar valores seguros por defecto
   a la cuenta.
4. Responder con `201`, los datos públicos del usuario y la billetera, sin
   incluir el hash de contraseña; manejar conflictos de username/email y
   errores de validación.
5. Documentar el endpoint y sus respuestas en Swagger y README; conservar sin
   cambios los endpoints actuales de consulta de cuentas y transacciones.

## Cómo probar
- [x] Ejecutar `npm run build` sin errores de TypeScript.
- [ ] Registrar un usuario y comprobar que la respuesta `201` incluye su
  username y la cuenta asociada con saldo cero.
- [ ] Comprobar en la base que la contraseña quedó almacenada como hash y que
  la respuesta no expone ni la contraseña ni su hash.
- [ ] Comprobar que username o email duplicados no crean una segunda cuenta y
  devuelven un conflicto claro.
- [x] En una base con el esquema anterior, ejecutar `npm run db:init` y luego
  `npm run db:seed` sin error de tabla `users` inexistente.
- [ ] Comprobar que un payload inválido devuelve `400` y no deja usuario ni
  cuenta creados parcialmente.
- [ ] Confirmar que las consultas existentes de account balance y transactions
  siguen respondiendo con sus contratos actuales.
- [x] Confirmar que Swagger y README documentan el nuevo registro.

## Riesgos / notas
- La migración incremental deja sin validar las referencias `user_id` antiguas
  que no tengan fila en `users`, pero exige referencias válidas para nuevas
  cuentas y actualizaciones.
- El hash debe usar una función adecuada para contraseñas y parámetros seguros;
  no se almacenará texto plano.
- El endpoint de registro será público mientras no exista autenticación y
  autorización en el proyecto.
- El alcance es un registro básico para el prototipo. Requisitos regulatorios
  de verificación de identidad, recuperación de acceso y controles antifraude
  quedan fuera de este cambio.
