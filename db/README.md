# Base de datos

## Inicializar el esquema

Configura `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` y `DB_PASSWORD` en el
archivo `.env`, y ejecuta:

```sh
npm run db:init
```

## Cargar datos de demostración

Con el esquema inicializado, ejecuta:

```sh
npm run db:seed
```

El ejecutor aplica en orden alfabético los archivos `.sql` de `db/seeds/` dentro
de una transacción. Los seeds incluidos crean cuentas demo USD y COP y una
transacción balanceada por moneda. Se pueden ejecutar varias veces: conservan
los registros existentes y no duplican los datos de demostración.

Para revisar los saldos:

```sql
SELECT account_id, currency, balance
FROM account_balances
ORDER BY currency, account_id;
```

Los saldos demo esperados son `125.00 USD` y `500000.00 COP` en las cuentas de
usuario, con los valores negativos correspondientes en las cuentas externas.
