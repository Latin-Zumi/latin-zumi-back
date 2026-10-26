# Spec: Congruencia de seeds y datos de prueba

## Fecha
2026-10-26

## Problema
Los datos de ejemplo están repartidos entre las migraciones `001_ledger.sql` y
`002_users.sql`, el seed `001_demo_data.sql` y ejemplos de Swagger. La
migración crea una cuenta con un UUID que Swagger asocia a Ana Pérez, mientras
que el seed crea una identidad `demo-user`; por tanto, los ejemplos pueden
sugerir una relación titular/cuenta que no corresponde a los datos sembrados.
El seed actual crea una identidad, dos cuentas de usuario (USD y COP), dos
cuentas internas y solo dos transacciones.

Además, el alta acepta cualquier código de moneda de tres letras y las tablas
solo exigen `CHAR(3)`. Esto no limita el sistema a las cuatro monedas que se
usarán en estas pruebas: USD, COP, ARS y EUR.

## Solución propuesta
Auditar UUID, titulares, monedas, cuentas, transacciones y entries de las
migraciones, seeds y Swagger. Alinear los ejemplos publicados con identidades
seeded y conservar UUID distintos y estables por entidad.

Fijar las monedas admitidas en `USD`, `COP`, `ARS` y `EUR`: validar el alta,
restringir las monedas de cuentas y entries en PostgreSQL y reflejar el enum en
Swagger. Añadir una migración incremental para bases existentes y mantener las
restricciones equivalentes en el esquema inicial.

Ampliar el seed idempotente hasta seis cuentas de usuario, al menos una en cada
moneda, con tres transacciones por cuenta como conjunto inicial (18 o más en
total). Cada transacción tendrá entries de contrapartida balanceadas en su
moneda; se usarán cuentas internas separadas por moneda. Las claves de
idempotencia e IDs serán estables. Actualizar Swagger y `db/README.md` para
referenciar los registros y saldos reales.

No se cambiará el contrato HTTP ni se fingirá que existe un endpoint de
escritura de transacciones: los movimientos nuevos se cargan por SQL para
probar el ledger. La validación desde cero se hará en una base de desarrollo
dedicada; no se borrarán datos de una base compartida o de producción.

### Ejemplo de transacción seeded

Cada movimiento de depósito inserta su cabecera y dos entries dentro de una
transacción SQL. El seed usará IDs/keys distintos para cada movimiento y cuenta;
este fragmento muestra la forma de un movimiento COP:

```sql
WITH tx AS (
  INSERT INTO transactions (id, idempotency_key, description, occurred_at)
  VALUES (
    '30000000-0000-4000-8000-000000000010',
    'seed:ana:cop:deposit-1',
    'Depósito demo COP 1',
    '2026-02-01T12:00:00Z'
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id
)
INSERT INTO entries (transaction_id, account_id, amount, direction, currency)
SELECT tx.id, movement.account_id, movement.amount, movement.direction, 'COP'
FROM tx
CROSS JOIN (VALUES
  ('10000000-0000-4000-8000-000000000020'::uuid, 25000.00::numeric, 'debit'),
  ('10000000-0000-4000-8000-000000000010'::uuid, 25000.00::numeric, 'credit')
) AS movement(account_id, amount, direction);
```

El asiento `debit` va a la cuenta interna COP y el `credit` a la cuenta de
usuario COP. Para ARS, USD y EUR se usarán cuentas internas y montos de su
respectiva moneda. No habrá conversión entre monedas en una misma transacción.

### Consulta para revisar cobertura por cuenta

```sql
SELECT a.id AS account_id,
       u.username,
       RTRIM(a.currency) AS currency,
       COUNT(DISTINCT e.transaction_id) AS transaction_count,
       COALESCE(SUM(CASE WHEN e.direction = 'credit' THEN e.amount
                         ELSE -e.amount END), 0)::text AS balance
FROM accounts a
JOIN users u ON u.id = a.user_id
LEFT JOIN entries e ON e.account_id = a.id
WHERE a.account_type = 'user'
GROUP BY a.id, u.username, a.currency
ORDER BY a.currency, u.username;
```

## Archivos afectados
- db/migrations/001_ledger.sql
- db/migrations/002_users.sql
- db/migrations/003_auth_sessions.sql
- db/migrations/004_supported_currencies.sql
- db/seeds/001_demo_data.sql
- db/scripts/init-db.ts
- db/README.md
- README.md
- src/controllers/users.controller.ts
- src/config/swagger.ts
- docs/specs/2026-10-26-congruencia-seeds-cuentas.md

## Pasos
1. Comparar UUIDs, claves foráneas, restricciones, monedas y movimientos de
   migraciones y seeds con todos los ejemplos Swagger y README; identificar
   cada discrepancia y preservar IDs que ya puedan existir en una base usada.
2. Alinear los IDs de Ana Pérez, la identidad demo, sus cuentas y transacciones.
   Ningún UUID se reutiliza entre entidades y ninguna cuenta queda asociada a
   un usuario inexistente.
3. Limitar validación y esquema a `USD`, `COP`, `ARS`, `EUR`; aplicar el cambio
   tanto al esquema nuevo como a bases existentes, y documentar el enum en
   Swagger. Mantener consistencia entre `accounts.currency` y `entries.currency`.
4. Completar el seed con seis cuentas de usuario como mínimo, cubriendo las
   cuatro monedas, y al menos tres transacciones balanceadas por cuenta. Usar
   claves estables, cuentas internas por moneda y asientos enlazados a la cuenta
   correcta.
5. Corregir Swagger, README y consultas de comprobación para que titular, UUID,
   moneda, transacciones y balances correspondan a los datos seeded.
6. Inicializar y sembrar una base de desarrollo limpia; repetir la carga para
   comprobar idempotencia y consultar cuentas, balances y entries.

## Cómo probar
- [ ] Migraciones, seeds, README y Swagger no presentan asociaciones de UUID o
  monedas contradictorias.
- [ ] Un código distinto de `USD`, `COP`, `ARS` y `EUR` se rechaza al registrar
  usuario y al insertar cuenta o entry.
- [ ] `npm run db:init` y `npm run db:seed` terminan correctamente en una base
  de desarrollo limpia y en una base de desarrollo con el esquema previo.
- [ ] Hay al menos seis cuentas de usuario, las cuatro monedas están
  representadas y cada cuenta participa en al menos tres transacciones.
- [ ] Todas las transacciones seeded tienen débitos y créditos iguales por
  moneda, y ningún entry está en una moneda distinta de la cuenta afectada.
- [ ] Ejecutar `npm run db:seed` por segunda vez no duplica usuarios, cuentas,
  transacciones ni entries.
- [ ] Consultas de balance y transacción confirman saldos y entries esperados;
  los ejemplos Swagger y `db/README.md` coinciden con esos datos.
- [ ] `npm run build` compila la validación de moneda y Swagger.

## Riesgos / notas
- UUID ya existentes pueden identificar usuarios reales o tener referencias;
  no se reasignarán a otra persona. Si hay incompatibilidad en una base
  persistente, se preservarán sus filas y se añadirá la corrección compatible.
- La restricción de moneda no debe permitir que `entries.currency` difiera de
  la moneda de su cuenta; el esquema actual no impone esa igualdad.
- `entries` es append-only. La validación desde cero se hace en una base de
  desarrollo dedicada y no borrando datos compartidos.
- Las cuentas demo no tendrán credenciales utilizables ni podrán iniciar
  sesión por accidente; sirven para probar lecturas y el ledger.
- El endpoint de transacciones es de lectura. Los movimientos del seed no
  implican que la API permita registrar depósitos o transferencias.
