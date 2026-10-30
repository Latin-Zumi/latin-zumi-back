# Base de datos

Esta guía concentra todo lo relacionado con la persistencia PostgreSQL del
backend: modelo contable, configuración, migración, seeds y consultas de
verificación.

## Conceptos del ledger

### ¿Qué es un asiento?

Un **asiento** es un registro individual que representa cómo una operación
afecta a una cuenta. En este proyecto, cada asiento corresponde a una fila de
la tabla `entries` y contiene la cuenta afectada (`account_id`), el importe
(`amount`), la moneda (`currency`) y la dirección (`direction`), que puede ser
`debit` o `credit`.

Un asiento no es una cuenta ni una transacción completa. Una **transacción** es
el conjunto de asientos que describe una operación completa. Por ejemplo, un
depósito de `125.00 USD` en una cuenta de usuario se representa con dos
asientos dentro de una misma transacción:

| Cuenta | Dirección | Importe | Efecto en el saldo |
| --- | --- | ---: | ---: |
| Cuenta externa | `debit` | `125.00 USD` | `-125.00` |
| Cuenta del usuario | `credit` | `125.00 USD` | `+125.00` |

La suma de los asientos debe quedar balanceada por moneda: el total debitado y
el total acreditado deben ser iguales. El saldo se calcula a partir de los
asientos confirmados, en lugar de guardar un número que se modifica
directamente.

### ¿Qué significa ledger append-only?

`Append-only` significa **solo agregar**. Los registros nuevos se pueden
añadir al ledger, pero los asientos históricos no se editan ni se borran. Si
se comete un error, se registra un nuevo asiento de corrección o reversión en
lugar de cambiar el asiento original.

En este proyecto, PostgreSQL protege esa regla sobre `entries`: las
operaciones de `UPDATE` y `DELETE` no modifican los asientos existentes. La
vista `account_balances` vuelve a calcular los saldos desde el historial y un
trigger diferido evita confirmar una transacción cuyos débitos y créditos no
estén balanceados.

### ¿Por qué se recomienda para movimientos de dinero?

Este enfoque se recomienda especialmente para wallets, pagos y otros sistemas
financieros porque conserva un historial auditable, permite reconstruir cómo
se obtuvo un saldo, evita perder evidencia al sobrescribir movimientos y
facilita investigar errores, reclamos o posibles fraudes.

No significa que todos los datos deban ser inmutables ni que el sistema sea
automáticamente seguro: la inmutabilidad se aplica aquí a los movimientos
contables. El costo es que una corrección requiere registrar movimientos
adicionales y consultar un historial potencialmente más grande. Ese costo suele
ser preferible a perder trazabilidad en un sistema donde el saldo representa
dinero.

## Configuración

El backend necesita Node.js, npm y PostgreSQL. Crea una base de datos y un
usuario con permisos para crear el esquema y cargar los datos demo.

Desde la raíz del proyecto, copia `.env.example` como `.env`:

```sh
cp .env.example .env
```

Configura `DATABASE_URL` con la URL entregada por tu proveedor PostgreSQL. La
URL tiene prioridad sobre cualquier valor `DB_*`. Para conexiones con TLS,
`sslmode=verify-full` es el modo recomendado: valida el certificado y el
hostname. En la versión 2.x de `pg-connection-string` usada por `pg` 8 en este
proyecto, `sslmode=require` actualmente se interpreta como `verify-full`; la
aplicación lo normaliza explícitamente a ese modo. No se desactiva la
validación del certificado.

La aplicación admite estos valores de `sslmode`:

| `sslmode` | Efecto |
| --- | --- |
| `verify-full` | Exige TLS y valida certificado y hostname; recomendado para proveedores remotos. |
| `require` | Se normaliza a `verify-full` en esta aplicación, conservando el comportamiento verificado del parser actual. |
| `disable` | Desactiva TLS; úsalo solo en entornos locales o redes de confianza. |

Otros modos (`allow`, `prefer`, `verify-ca`, `no-verify`) se rechazan para
evitar resultados ambiguos o configuraciones que no validen el hostname. Si se
incluye `ssl=true` o `ssl=1` sin `sslmode`, el parser TLS de Node conserva la
validación estándar del certificado; `ssl=false` y `ssl=0` desactivan TLS y son
solo apropiados para entornos locales. No combines valores `ssl` y `sslmode`
contradictorios. `uselibpqcompat=true` también se rechaza porque puede debilitar
la validación TLS.

Si tu proveedor requiere una CA privada, configura su certificado CA oficial
con `sslrootcert` y `sslmode=verify-full`. No agregues certificados de origen
desconocido. Esta documentación describe la configuración disponible; no
confirma una conexión probada con Neon ni con otro proveedor remoto.

Si no usas una URL, configura estos campos para PostgreSQL local:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=<base_local>
DB_USER=<usuario_local>
DB_PASSWORD=<contraseña_local>
```

No guardes una URL con credenciales en Git. Usa `.env` local o el gestor de
secretos de tu plataforma. Si `DATABASE_URL` y `DB_*` están definidos a la vez,
`DATABASE_URL` tiene prioridad. No se incluyen credenciales reales en el
repositorio.

| Variable | Descripción | Valor predeterminado |
| --- | --- | --- |
| `DATABASE_URL` | URL completa de conexión PostgreSQL; tiene prioridad sobre `DB_*` | — |
| `DB_HOST` | Host de PostgreSQL local, requerido junto con los demás campos `DB_*` si no hay URL | — |
| `DB_PORT` | Puerto de PostgreSQL | `5432` |
| `DB_NAME` | Nombre de la base de datos local | — |
| `DB_USER` | Usuario de PostgreSQL local | — |
| `DB_PASSWORD` | Contraseña de PostgreSQL local | — |
| `DB_MAX` | Máximo de conexiones del pool | `20` |
| `DB_IDLE_TIMEOUT_MILLIS` | Tiempo máximo que una conexión inactiva permanece en el pool (ms) | `30000` |
| `DB_CONNECTION_TIMEOUT_MILLIS` | Tiempo máximo para establecer una conexión, tanto con `Client` como con `Pool` (ms) | `2000` |
| `EXCHANGE_RATE_TIMEOUT_MS` | Timeout por proveedor de tasas | `3000` |
| `EXCHANGE_RATE_MAX_AGE_HOURS` | Antigüedad máxima aceptada para tasas | `24` |
| `PORT` | Puerto HTTP de Express | `3000` |
| `EMAIL_PROVIDER` | Proveedor de envío de correos para la recuperación de contraseña: `console` o `resend` | `console` |
| `RESEND_API_KEY` | API key de Resend; requerida con `EMAIL_PROVIDER=resend` | — |
| `EMAIL_FROM` | Remitente del correo de recuperación | `Latin Zumi <no-reply@latinzumi.com>` |
| `PASSWORD_RESET_URL` | URL del frontend donde se construye el enlace de recuperación | `http://localhost:5173/restablecer-contrasena` |
| `PASSWORD_RESET_TTL_MINUTES` | Validez del token de recuperación en minutos | `30` |

## Inicializar el esquema

La aplicación, el pool y los scripts `db:init` y `db:seed` usan la misma
configuración: prefieren `DATABASE_URL` y, si no está definida, usan los campos
`DB_*` para PostgreSQL local. Con cualquiera de las dos configuraciones en
`.env`, ejecuta:

```sh
npm run db:init
```

`db:init` crea el esquema inicial cuando la base está vacía y aplica las
migraciones incrementales pendientes cuando ya existe. La migración
[`migrations/001_ledger.sql`](./migrations/001_ledger.sql) crea el ledger y
[`migrations/002_users.sql`](./migrations/002_users.sql) agrega usuarios y la
relación con las cuentas. [`migrations/003_auth_sessions.sql`](./migrations/003_auth_sessions.sql)
agrega sesiones de autenticación. El esquema también incluye la vista
`account_balances`, las restricciones de balance, el trigger diferido y las
reglas que impiden modificar o eliminar asientos. La migración
[`migrations/004_supported_currencies.sql`](./migrations/004_supported_currencies.sql)
limita las nuevas cuentas y entries a USD, COP, ARS y EUR y exige que la moneda
de cada entry coincida con la de su cuenta. En bases existentes, las
restricciones se agregan como `NOT VALID`: preservan filas históricas y se
aplican a filas nuevas. [`migrations/005_single_user_account.sql`](./migrations/005_single_user_account.sql)
consolida el saldo activo inicial por usuario. Las migraciones
[`006_wallet_container.sql`](./migrations/006_wallet_container.sql) y
[`007_currency_conversions.sql`](./migrations/007_currency_conversions.sql)
crean el contenedor lógico de wallet, enlazan las cuentas existentes sin
cambiar IDs ni entries, permiten una cuenta activa por moneda y almacenan el
detalle auditable de cada ingreso convertido. La migración
[`008_google_auth_profile.sql`](./migrations/008_google_auth_profile.sql)
agrega el perfil (`nombre`, `pais`, `moneda_preferida`, `foto_url`), los roles
y el estado del usuario, deja `password_hash` nullable para usuarios solo-Google
y agrega los checks de país, moneda, estado y método de acceso, además de los
índices únicos de `google_uid` y de email sin distinguir mayúsculas. La migración
[`010_password_reset_tokens.sql`](./migrations/010_password_reset_tokens.sql)
crea la tabla `password_reset_tokens` con el hash SHA-256 del token, su
vencimiento, la marca de uso y el índice parcial de tokens activos por usuario;
la consumen los endpoints públicos `POST /auth/forgot-password` y
`POST /auth/reset-password`. La migración
[`011_exchange_quotes.sql`](./migrations/011_exchange_quotes.sql) crea la tabla
`exchange_quotes` con la tasa y el importe fijados para un cambio de moneda, su
vencimiento a los 60 segundos y el consumo asociado a la transacción del cambio.

## Cargar datos de demostración

Con el esquema inicializado, ejecuta:

```sh
npm run db:seed
```

El ejecutor aplica en orden alfabético los archivos `.sql` de `seeds/` dentro
de una transacción. Los seeds incluidos crean una wallet por usuario con
cuentas de saldo por moneda, distribuidas entre USD, COP, ARS y EUR, con tres movimientos por cuenta y
entries balanceadas. También completan `nombre`, `pais` y `moneda_preferida`
para que el contrato de sesión sea coherente. Se pueden ejecutar varias veces:
conservan los registros existentes y no duplican los movimientos demo.
Las identidades sembradas usan valores de hash que no sirven para iniciar
sesión; crea un usuario desde `POST /users` para probar autenticación.

Para revisar los saldos:

```sql
SELECT account_id, currency, balance
FROM account_balances
ORDER BY currency, account_id;
```

En una base limpia, los saldos demo esperados en las cuentas de usuario son:
cuenta `...0001`, `200.00 USD`; `...0005`, `170000.00 ARS`; `...0006`,
`155.00 EUR`; `...0007`, `125.00 USD`; y `...0008`, `230000.00 COP`. Las
cuentas externas tienen los valores negativos correspondientes.

En una base existente, la cuenta activa existente define la moneda principal
de la wallet. Si el seed agrega otra cuenta user en otra moneda, queda como un
saldo secundario dentro de esa misma wallet; no se convierten ni fusionan sus
saldos. Por eso los UUIDs y saldos pueden diferir entre una base limpia y una
base histórica sin que existan huérfanos.

## Archivos de base de datos

```text
db/
├── migrations/001_ledger.sql  esquema y reglas del ledger
├── migrations/002_users.sql   usuarios y relación con cuentas
├── migrations/003_auth_sessions.sql sesiones revocables
├── migrations/004_supported_currencies.sql monedas admitidas e integridad
├── migrations/005_single_user_account.sql una cuenta user activa por usuario
├── migrations/006_wallet_container.sql wallet lógica y saldos por moneda
├── migrations/007_currency_conversions.sql auditoría de conversiones
├── migrations/008_google_auth_profile.sql perfil, roles y acceso Google
├── migrations/010_password_reset_tokens.sql tokens de recuperación de contraseña
├── migrations/011_exchange_quotes.sql cotizaciones de cambio y consumo
├── seeds/001_demo_data.sql    cuentas únicas y movimientos demo
├── scripts/init-db.ts         ejecuta esquema/migraciones
└── scripts/seed-db.ts         ejecuta los seeds en orden
```

Los comandos deben ejecutarse desde la raíz del repositorio. La inicialización
del esquema se ejecuta dentro de una transacción. En una base existente,
`npm run db:init` omite la creación inicial y aplica las migraciones
incrementales `002_users.sql`, `003_auth_sessions.sql`,
`004_supported_currencies.sql`, `005_single_user_account.sql`,
`006_wallet_container.sql`, `007_currency_conversions.sql`,
`008_google_auth_profile.sql`, `010_password_reset_tokens.sql` y
`011_exchange_quotes.sql`; después puedes
ejecutar `npm run db:seed`.
