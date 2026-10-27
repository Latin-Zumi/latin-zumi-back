# Spec: migración 008 de perfil y acceso Google

## Fecha

2026-10-27

## Orden de ejecución: 027

## Problema

El modelo `users` necesita almacenar los campos públicos que consume el
contrato de sesión y permitir usuarios que en el futuro se autentiquen solo
con Google. La migración 008 definida como parte del mínimo de autenticación
(spec 025) debe quedar aplicada por `db:init`, y los datos demo creados después
de migrar deben incluir un perfil coherente.

## Solución propuesta

Agregar `008_google_auth_profile.sql` después de la migración 007. La migración
añade perfil, moneda preferida, roles y estado; normaliza los usuarios ya
existentes; permite `password_hash` nulo si hay un `google_uid`; y crea los
índices de unicidad necesarios.

Antes de normalizar emails y crear el índice case-insensitive, aborta si ya hay
emails que solo difieren en mayúsculas:

```sql
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM users
         GROUP BY lower(email)
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Hay emails duplicados ignorando mayúsculas; resolvelos antes de aplicar 008';
    END IF;
END;
$$;

UPDATE users SET email = lower(email) WHERE email <> lower(email);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx
    ON users (lower(email));
```

Este bloque lo ejecuta `db:init` dentro de la transacción de inicialización.
Si existen duplicados, la transacción falla sin dejar la migración aplicada;
si no, normaliza los emails y evita duplicados futuros sin distinguir
mayúsculas.

La restricción de método de acceso permite contraseña o identidad Google:

```sql
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'users_access_method_check'
           AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_access_method_check
            CHECK (password_hash IS NOT NULL OR google_uid IS NOT NULL);
    END IF;
END;
$$;
```

La ejecuta PostgreSQL al aplicar la migración. Los usuarios existentes
conservan acceso por contraseña; una cuenta nueva puede omitirla si registra
un `google_uid`. La migración completa incluye además restricciones para país,
moneda y estado, índice único parcial de `google_uid`, y backfill de nombre y
moneda preferida.

El inicializador aplica 008 después de 007:

```ts
const googleAuthProfileMigration = await readFile(
  new URL('../migrations/008_google_auth_profile.sql', import.meta.url),
  'utf8',
);
await client.query(googleAuthProfileMigration);
```

Lo ejecuta `npm run db:init` dentro de la transacción común, de modo que las
bases vacías y existentes terminen con el mismo esquema. El seed demo incluye
`nombre`, `pais` y `moneda_preferida` en sus usuarios para poblar las columnas
que ahora requiere el contrato público.

## Archivos afectados

- `db/migrations/008_google_auth_profile.sql`
- `db/scripts/init-db.ts`
- `db/seeds/001_demo_data.sql`
- `db/README.md`
- `docs/specs/README.md`
- `docs/specs/autenticacion/2026-10-27-migracion-008-perfil-acceso-google.md`

## Pasos

1. Crear columnas del perfil, roles y estado, con backfill de usuarios existentes.
2. Normalizar emails después de detectar duplicados y añadir índices únicos.
3. Hacer nullable `password_hash` y exigir al menos un método de acceso.
4. Aplicar 008 desde `db:init` después de 007.
5. Completar los perfiles de usuarios demo y documentar el esquema.

## Cómo probar

- [ ] `npm run db:init` aplica 008 en una base nueva y una existente.
- [ ] La migración aborta con duplicados de email que difieren solo en mayúsculas.
- [ ] Un usuario con contraseña y un usuario Google-only satisfacen el check de acceso.
- [ ] El índice rechaza emails duplicados ignorando mayúsculas y `google_uid` duplicados.
- [ ] `npm run db:seed` conserva sus datos idempotentes y deja perfiles demo completos.

## Riesgos / notas

- Resolver manualmente emails duplicados case-insensitive antes de aplicar 008;
  la migración aborta intencionalmente para no decidir qué identidad conservar.
- El backfill de `moneda_preferida` usa la moneda primaria de la wallet y
  conserva `USD` como fallback para usuarios sin wallet.
- Este spec documenta la parte de esquema y datos del spec 025. No implementa
  login Google ni el flujo HTTP de registro.
- Los cambios de `DATABASE_URL` en scripts de DB pertenecen al spec 023 y no
  forman parte del alcance de este spec.
