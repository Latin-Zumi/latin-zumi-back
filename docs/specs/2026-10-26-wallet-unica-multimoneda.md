# Spec: Cuenta única de liquidación por usuario

## Fecha
2026-10-26

## Problema
El esquema actual permite una cuenta `user` por usuario y moneda porque la
unicidad es `(user_id, currency, account_type)`. Esto obliga a pensar en una
cuenta diferente para cada moneda, aunque la decisión de producto es que cada
usuario tenga una sola wallet fácil de entender.

## Solución propuesta
Usar una sola cuenta `user` por usuario. La moneda de esa cuenta será la
moneda de liquidación elegida por el usuario, por ejemplo USD. Esa será la
única cuenta que el usuario verá y cuyo saldo podrá consultar.

Si llega dinero en EUR, COP o ARS, el sistema no lo guardará como un saldo
separado del usuario: lo convertirá a la moneda de liquidación y acreditará
únicamente el resultado en su cuenta USD. La operación de conversión, tasa,
fecha, fuente, redondeo y posibles comisiones quedará registrada para
auditoría en el spec de conversión.

El ledger puede seguir teniendo cuentas internas `external`, `treasury` o
`fee` en distintas monedas. Esas cuentas no son wallets adicionales para el
usuario; permiten balancear correctamente la entrada original y la conversión
sin mezclar EUR, COP, ARS y USD en un mismo saldo.

La base deberá:

- garantizar como máximo una cuenta `user` por `user_id`;
- usar `accounts.currency` como moneda de liquidación de esa wallet;
- conservar `entries.currency` igual a la moneda de la cuenta afectada;
- conservar cuentas, entries e IDs históricos sin borrarlos;
- definir una migración explícita para usuarios existentes que tengan más de
  una cuenta, sin fusionar importes de distintas monedas automáticamente.

El endpoint de wallet devolverá una sola cuenta y un solo saldo:

```json
{
  "data": {
    "account_id": "...",
    "currency": "USD",
    "balance": "325.00"
  }
}
```

Este spec no define el proveedor ni el algoritmo de conversión; esa tarea está
en [el spec de conversión al recibir fondos](./2026-10-26-conversion-tasas-exchange-rate.md).

## Archivos afectados
- db/migrations/005_single_user_account.sql
- db/scripts/init-db.ts
- db/seeds/001_demo_data.sql
- src/routes/accounts.route.ts
- src/controllers/accounts.controller.ts
- src/services/accounts.service.ts
- src/controllers/users.controller.ts
- src/services/users.service.ts
- src/config/swagger.ts
- README.md
- db/README.md
- tests/ o src/**/*.test.ts
- package.json
- docs/specs/2026-10-26-wallet-unica-multimoneda.md

## Pasos
1. Confirmar la moneda predeterminada y si el usuario puede cambiarla antes
   de recibir fondos.
2. Crear una restricción que permita una sola cuenta `user` por usuario.
3. Adaptar el registro para crear una sola cuenta con moneda de liquidación.
4. Definir migración para usuarios existentes con varias cuentas, preservando
   el historial y evitando conversiones implícitas.
5. Adaptar los endpoints para devolver una sola cuenta y saldo.
6. Actualizar seeds, Swagger y documentación.
7. Añadir pruebas de unicidad, autorización, precisión e integridad por moneda.

## Cómo probar
- [ ] Un usuario nuevo obtiene una sola cuenta `user` con su moneda de
  liquidación.
- [ ] Una segunda creación de cuenta `user` para el mismo usuario es rechazada.
- [ ] La consulta de wallet devuelve un único saldo y una única moneda.
- [ ] No se pueden insertar entries con moneda distinta a la cuenta user.
- [ ] El ledger sigue permitiendo cuentas internas en distintas monedas y
  balancea cada moneda por separado.
- [ ] La migración no borra ni modifica entries históricos.
- [ ] Un usuario no puede consultar la cuenta de otro usuario.
- [ ] Los seeds son idempotentes, Swagger refleja el contrato y el build pasa.

## Riesgos / notas
- Esta decisión simplifica mucho la experiencia del usuario, pero cada
  ingreso en moneda extranjera se convierte realmente; ya no se conserva un
  saldo disponible en la moneda original.
- La conversión debe ser una operación contable con tasa fijada y no solo una
  multiplicación al mostrar datos.
- Para usuarios existentes con varias cuentas no es seguro escoger una y
  eliminar las demás. Se requiere una política explícita de conversión,
  cierre o conservación histórica.
