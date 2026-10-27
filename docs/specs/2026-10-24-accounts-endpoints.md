# Spec: Rutas y capas de consulta de accounts

## Fecha
2026-10-24

## Orden de ejecución: 005

## Problema
El módulo `accounts` solo expone actualmente una consulta de saldo y necesita
quedar organizado como un flujo completo de lectura: las rutas deben conectar
handlers, los controllers deben encargarse únicamente de HTTP y los services
deben concentrar todas las consultas SQL. También falta una respuesta para
consultar los datos propios de una cuenta.

## Solución propuesta
Completar el módulo con dos endpoints de lectura:

- `GET /accounts/:id`: devuelve los datos de la cuenta (`id`, `user_id`,
  `currency`, `account_type`, `allow_negative`) y su saldo calculado.
- `GET /accounts/:id/balance`: conserva el contrato actual y devuelve solo el
  balance de la cuenta.

El controller validará el UUID, invocará al service y traducirá los casos de
cuenta inexistente a respuestas HTTP. El service expondrá funciones de lectura
que usarán consultas parametrizadas sobre `accounts` y `account_balances`; no
habrá SQL en controllers ni routes. Ambas rutas usarán `asyncHandler` y el
middleware de errores existente.

### Snippets propuestos

#### Routes: solo conexión de endpoints y handlers

```ts
export const accountsRouter = Router();

accountsRouter.get('/accounts/:id/balance', asyncHandler(getAccountBalance));
accountsRouter.get('/accounts/:id', asyncHandler(getAccount));
```

En la implementación, la ruta específica de `balance` se registra antes de la
ruta parametrizada `/accounts/:id` para evitar que `balance` se interprete como
el identificador de una cuenta.

#### Controller: validación y respuestas HTTP

```ts
export async function getAccount(req: Request, res: Response) {
  const parsedId = accountIdSchema.safeParse(req.params.id);
  if (!parsedId.success) {
    throw new AppError('ID de cuenta inválido', 400);
  }

  const account = await getAccountById(parsedId.data);
  if (!account) {
    throw new AppError('Cuenta no encontrada', 404);
  }

  return res.status(200).json({ data: account });
}
```

El controller de balance conservará el mismo patrón y contrato actual:

```ts
const balance = await getBalanceByAccountId(parsedId.data);
if (!balance) throw new AppError('Cuenta no encontrada', 404);

return res.status(200).json({ data: balance });
```

#### Service: SQL parametrizado y datos de cuenta

```ts
export async function getAccountById(
  accountId: string,
): Promise<Account | null> {
  const result = await pool.query<Account>(
    `SELECT a.id,
            a.user_id,
            RTRIM(a.currency) AS currency,
            a.account_type,
            a.allow_negative,
            COALESCE(b.balance, 0)::text AS balance
       FROM accounts a
       LEFT JOIN account_balances b
         ON b.account_id = a.id AND b.currency = a.currency
      WHERE a.id = $1`,
    [accountId],
  );

  return result.rows[0] ?? null;
}
```

La ruta no tendrá SQL, y el controller no importará ni usará `pool`.

## Archivos afectados
- src/controllers/accounts.controller.ts
- src/services/accounts.service.ts
- src/routes/accounts.route.ts
- src/config/swagger.ts (documentar el endpoint nuevo y su contrato)
- docs/specs/2026-10-24-accounts-endpoints.md

## Pasos
1. Definir el tipo de respuesta de cuenta y la consulta parametrizada que una
   la cuenta con su saldo, devolviendo saldo cero cuando no tenga movimientos.
2. Implementar en el service las funciones de consulta de cuenta y de balance,
   manteniendo todo el SQL dentro de `src/services/`.
3. Implementar los controllers para validar `req.params.id`, delegar al
   service y formar respuestas JSON/errores HTTP sin acceso al pool.
4. Registrar las rutas `GET /accounts/:id` y
   `GET /accounts/:id/balance` mediante `asyncHandler`.
5. Actualizar Swagger y verificar compilación y respuestas de éxito, UUID
   inválido y cuenta inexistente.

## Cómo probar
- [x] Ejecutar `npm run build` sin errores de TypeScript.
- [ ] Consultar `GET /accounts/10000000-0000-4000-8000-000000000001` y recibir
  `200` con la cuenta demo USD y saldo `125.00000000`.
- [ ] Consultar `GET /accounts/10000000-0000-4000-8000-000000000001/balance`
  y recibir el contrato actual con saldo `125.00000000` y moneda `USD`.
- [ ] Enviar un UUID inválido y recibir `400` con un mensaje de error.
- [ ] Consultar un UUID válido inexistente y recibir `404`.
- [ ] Confirmar que `/api-docs` documenta ambos endpoints.

## Riesgos / notas
- El alcance es de lectura; no se agregan creación, edición o eliminación de
  cuentas porque el esquema y el pedido actual no definen sus reglas de
  negocio, autorización ni payloads.
- Se mantiene la respuesta existente de `/accounts/:id/balance` para no romper
  consumidores actuales.
- Las respuestas de saldo seguirán serializando `NUMERIC` como texto para no
  perder precisión decimal.
- Se requiere PostgreSQL inicializado y con los seeds demo cargados para las
  pruebas de integración manuales.
