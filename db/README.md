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

Configura estas variables:

| Variable | Descripción | Valor predeterminado |
| --- | --- | --- |
| `DB_HOST` | Host de PostgreSQL | — |
| `DB_PORT` | Puerto de PostgreSQL | `5432` |
| `DB_NAME` | Nombre de la base de datos | — |
| `DB_USER` | Usuario de PostgreSQL | — |
| `DB_PASSWORD` | Contraseña de PostgreSQL | — |
| `DB_MAX` | Máximo de conexiones del pool | `20` |
| `PORT` | Puerto HTTP de Express | `3000` |

## Inicializar el esquema

Configura `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` y `DB_PASSWORD` en el
archivo `.env`, y ejecuta:

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
aplican a filas nuevas.

## Cargar datos de demostración

Con el esquema inicializado, ejecuta:

```sh
npm run db:seed
```

El ejecutor aplica en orden alfabético los archivos `.sql` de `seeds/` dentro
de una transacción. Los seeds incluidos crean seis cuentas de usuario,
distribuidas entre USD, COP, ARS y EUR, con tres movimientos por cuenta y
entries balanceadas. Las dos cuentas históricas del usuario demo conservan
también sus transacciones anteriores. Se pueden ejecutar varias veces:
conservan los registros existentes y no duplican los movimientos demo.
Las identidades sembradas usan valores de hash que no sirven para iniciar
sesión; crea un usuario desde `POST /users` para probar autenticación.

Para revisar los saldos:

```sql
SELECT account_id, currency, balance
FROM account_balances
ORDER BY currency, account_id;
```

Los saldos demo esperados en las cuentas de usuario son: cuenta `...0001`,
`325.00 USD`; `...0003`, `1100000.00 COP`; `...0005`, `170000.00 ARS`;
`...0006`, `155.00 EUR`; `...0007`, `125.00 USD`; y `...0008`,
`230000.00 COP`. Las cuentas externas tienen los valores negativos
correspondientes. Si Ana ya tenía una cuenta COP con otro UUID antes de cargar
estos seeds, se conserva ese ID y se le agregan tres movimientos COP; en una
base limpia no se crea esa cuenta adicional.

## Archivos de base de datos

```text
db/
├── migrations/001_ledger.sql  esquema y reglas del ledger
├── migrations/002_users.sql   usuarios y relación con cuentas
├── migrations/003_auth_sessions.sql sesiones revocables
├── migrations/004_supported_currencies.sql monedas admitidas e integridad
├── seeds/001_demo_data.sql    seis cuentas y movimientos demo
├── scripts/init-db.ts         ejecuta esquema/migraciones
└── scripts/seed-db.ts         ejecuta los seeds en orden
```

Los comandos deben ejecutarse desde la raíz del repositorio. La inicialización
del esquema se ejecuta dentro de una transacción. En una base existente,
`npm run db:init` omite la creación inicial y aplica las migraciones
incrementales `002_users.sql`, `003_auth_sessions.sql` y
`004_supported_currencies.sql`; después puedes ejecutar `npm run db:seed`.
