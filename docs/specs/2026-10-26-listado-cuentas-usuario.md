# Spec: Listado de cuentas del usuario

## Fecha
2026-10-26

## Orden de ejecución: 019

## Problema
La API solo permite consultar una cuenta cuando el cliente ya conoce su ID.
Esto impide que una aplicación descubra las cuentas y monedas activas del
usuario autenticado, especialmente cuando una wallet contiene saldos en más de
una moneda. El cliente no debería tener que conservar IDs de registro para
encontrar sus cuentas.

## Solución propuesta
Añadir `GET /accounts`, protegido por la sesión Bearer existente. La ruta lista
las cuentas `user` activas del titular autenticado, incluye los campos de
cuenta ya devueltos por `GET /accounts/:id` y calcula el saldo de cada cuenta
desde `account_balances`. No recibe un `user_id` ni IDs de cuenta como filtros,
para que la identidad y el alcance provengan exclusivamente de la sesión.

```http
GET /accounts
Authorization: Bearer <access_token>
```

El cliente autenticado solicita sus cuentas sin enviar identificadores de
usuario o cuenta. El middleware identifica al titular; la respuesta contiene
solo las cuentas que le pertenecen.

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
 WHERE a.user_id = $1
   AND a.account_type = 'user'
   AND a.closed_at IS NULL
 ORDER BY RTRIM(a.currency), a.id;
```

El servicio de cuentas ejecuta la consulta usando como `$1` el `userId` de la
sesión. Así excluye cuentas de otros titulares, cuentas internas y cuentas
cerradas; las cuentas sin movimientos aparecen con saldo `"0"`. El orden
determinista facilita que el cliente presente la lista de forma estable.

```json
{
  "data": [
    {
      "id": "10000000-0000-4000-8000-000000000001",
      "user_id": "20000000-0000-4000-8000-000000000001",
      "currency": "USD",
      "account_type": "user",
      "allow_negative": false,
      "balance": "325.00000000"
    },
    {
      "id": "10000000-0000-4000-8000-000000000002",
      "user_id": "20000000-0000-4000-8000-000000000001",
      "currency": "EUR",
      "account_type": "user",
      "allow_negative": false,
      "balance": "0"
    }
  ]
}
```

El controlador responde `200` con `{ "data": [...] }`; cada elemento conserva
el contrato del detalle existente y representa una cuenta activa. Si no hay
cuentas activas para el titular, `data` es un arreglo vacío. La ruta requiere
autenticación y devuelve `401` si falta una sesión válida.

## Archivos afectados
- src/routes/accounts.route.ts
- src/controllers/accounts.controller.ts
- src/services/accounts.service.ts
- src/config/swagger.ts
- README.md
- docs/auditoria-estado-proyecto-y-deploy.md
- tests o pruebas de integración de la API
- docs/specs/README.md
- docs/specs/2026-10-26-listado-cuentas-usuario.md

## Pasos
1. Añadir una consulta de servicio que liste solo las cuentas `user` activas
   del titular e incluya el saldo de cada una.
2. Añadir `GET /accounts` antes de la ruta dinámica `/accounts/:id` y
   protegerla con `requireAuth`.
3. Implementar la respuesta `{ data: Account[] }` usando el contexto de
   autenticación, sin aceptar un ID de usuario desde el cliente.
4. Documentar el contrato, la autenticación y las respuestas en Swagger;
   actualizar README y la auditoría para reflejar la capacidad implementada.
5. Probar aislamiento entre titulares, exclusión de cuentas cerradas e
   internas, saldos y respuesta vacía, además del build y la suite de pruebas.

## Cómo probar
- [ ] `GET /accounts` sin sesión válida responde `401`.
- [ ] Con una sesión válida, `GET /accounts` devuelve todas y solo las cuentas
  `user` activas del titular, sin requerir IDs previamente almacenados.
- [ ] Cada cuenta incluye su moneda y saldo como texto; una cuenta sin
  movimientos presenta saldo `"0"`.
- [ ] Cuentas de otros titulares, internas o cerradas no aparecen; si no hay
  cuentas activas, `data` es `[]`.
- [x] Swagger y README describen el nuevo contrato, y la suite de pruebas y
  `npm run build` pasan.

## Riesgos / notas
- Se elige `GET /accounts` en vez de añadir también `GET /wallet`; un solo
  contrato evita mantener dos rutas equivalentes.
- El listado no pagina: el modelo limita las cuentas activas a una por moneda
  admitida para cada wallet, por lo que actualmente hay como máximo cuatro.
- Los IDs se siguen devolviendo para las operaciones que los requieren, pero
  el cliente ya no tiene que persistirlos para descubrir las cuentas.
