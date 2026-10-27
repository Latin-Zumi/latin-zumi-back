# Spec: Historial paginado de transactions

## Fecha
2026-10-26

## Orden de ejecución: 020

## Problema
La API solo permite consultar una transacción por ID. La app no puede mostrar
la actividad reciente del usuario sin resolver IDs por otra vía. Hace falta
definir cómo se pagina y filtra el historial, manteniendo el aislamiento entre
titulares.

## Solución propuesta
Agregar `GET /transactions`, protegido por autenticación, que lista las
transacciones visibles para el titular actual con sus asientos de cuentas
activas propias.

- Paginación por `page` (por defecto `1`) y `limit` (por defecto `20`, máximo
  `100`); ambos deben ser enteros positivos.
- Filtros opcionales `account_id` (UUID de una cuenta activa propia), `from` y
  `to` (fechas ISO 8601 inclusivas sobre `occurred_at`). Si se envían ambas
  fechas, `from` no puede ser posterior a `to`.
- Orden estable más reciente primero: `occurred_at DESC, id DESC`.
- Respuesta `{ data, meta }`, con `meta.page`, `meta.limit`, `meta.total` y
  `meta.totalPages`; `totalPages` es `0` cuando no hay resultados.
- Los registros y asientos internos o de cuentas ajenas no se exponen. Un
  filtro `account_id` no cambia la regla: los asientos devueltos incluyen las
  cuentas activas propias de la transacción, como en la consulta de detalle.
- Parámetros inválidos responden `400`; una cuenta inexistente, cerrada o ajena
  responde `404` con un mensaje genérico de cuenta no encontrada.

### Snippet: validación HTTP y delegación

```ts
const historyQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  account_id: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
}).refine(
  ({ from, to }) => !from || !to || new Date(from) <= new Date(to),
);

export async function getTransactions(req: Request, res: Response) {
  const parsed = historyQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new AppError('Filtros de historial inválidos', 400);

  const result = await getTransactionsByUserId(
    getAuthContext(req).userId,
    parsed.data,
  );
  return res.status(200).json(result);
}
```

El controller valida los parámetros de consulta, obtiene la identidad de la
sesión autenticada y delega la lectura al service. Un filtro mal formado o un
rango invertido produce `400`; si la consulta es válida, responde con los datos
y metadatos de paginación.

### Snippet: selección paginada y aislamiento por titular

```sql
WITH visible_transactions AS (
  SELECT DISTINCT t.id, t.idempotency_key, t.description, t.occurred_at
    FROM transactions t
    JOIN entries e ON e.transaction_id = t.id
    JOIN accounts a ON a.id = e.account_id
   WHERE a.user_id = $1
     AND a.closed_at IS NULL
     AND ($2::uuid IS NULL OR EXISTS (
       SELECT 1
         FROM entries selected
         JOIN accounts selected_account ON selected_account.id = selected.account_id
        WHERE selected.transaction_id = t.id
          AND selected.account_id = $2
          AND selected_account.user_id = $1
          AND selected_account.closed_at IS NULL
     ))
     AND ($3::timestamptz IS NULL OR t.occurred_at >= $3)
     AND ($4::timestamptz IS NULL OR t.occurred_at <= $4)
)
SELECT id, idempotency_key, description, occurred_at
  FROM visible_transactions
 ORDER BY occurred_at DESC, id DESC
 LIMIT $5 OFFSET $6;
```

El service ejecuta la consulta con parámetros SQL, contando por separado el
mismo conjunto filtrado para `meta.total`. La identidad del titular se exige
para que una transacción aparezca y para aceptar la cuenta filtrada; así no se
puede consultar actividad de otra persona cambiando `account_id`. En una
consulta posterior, el service carga los asientos de esos IDs limitándolos
también a cuentas activas del titular.

### Snippet: contrato de respuesta paginada

```json
{
  "data": [
    {
      "id": "30000000-0000-4000-8000-000000000101",
      "idempotency_key": "seed:portfolio:01:usd:movement-1",
      "description": "Movimiento demo USD 1",
      "occurred_at": "2026-02-01T12:00:00.000Z",
      "entries": [
        {
          "id": "2",
          "account_id": "10000000-0000-4000-8000-000000000001",
          "amount": "125.00000000",
          "direction": "credit",
          "currency": "USD",
          "created_at": "2026-02-01T12:00:00.000Z"
        }
      ]
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

El controller devuelve el formato JSON que consume la app: cada elemento
reutiliza el contrato de `GET /transactions/:id`, con importes como texto para
preservar precisión; `meta` permite solicitar páginas posteriores y conocer el
tamaño del resultado filtrado.

## Archivos afectados
- src/services/transactions.service.ts
- src/controllers/transactions.controller.ts
- src/routes/transactions.route.ts
- src/config/swagger.ts
- src/services/transactions.service.test.ts
- src/controllers/transactions.controller.test.ts
- docs/auditoria-estado-proyecto-y-deploy.md
- docs/specs/README.md
- docs/specs/2026-10-26-transactions-historial-paginado.md

## Pasos
1. Añadir al service la consulta paginada con filtros parametrizados, conteo
   total y carga de asientos visibles del titular.
2. Añadir al controller la validación de parámetros y delegación, incluyendo
   `400` para filtros inválidos y `404` genérico para cuentas no disponibles.
3. Registrar `GET /transactions` antes de `GET /transactions/:id` y mantener
   autenticación obligatoria.
4. Documentar parámetros, respuestas y errores en Swagger; actualizar la
   auditoría para indicar que el historial paginado está implementado.
5. Añadir pruebas focalizadas para filtros, paginación, aislamiento por
   titular y validación HTTP.

## Cómo probar
- [ ] `GET /transactions` sin filtros responde con la primera página de
  actividad del titular autenticado y metadatos.
- [ ] `page`, `limit`, `account_id`, `from` y `to` filtran y paginan según el
  contrato; `limit` no puede superar `100`.
- [ ] Fechas invertidas, UUID inválido y parámetros fuera de rango responden
  `400`.
- [ ] Una cuenta inexistente, cerrada o ajena responde `404` sin revelar si
  pertenece a otro titular.
- [ ] Ninguna transacción ni asiento de cuentas ajenas/inactivas aparece en la
  respuesta.
- [ ] Los importes se serializan como texto y el orden es estable ante empates
  de `occurred_at`.
- [ ] `GET /transactions` aparece documentado en `/api-docs`.
- [ ] `npm test` y `npm run build` terminan sin errores.

## Riesgos / notas
- La paginación usa offset y puede volverse menos eficiente en páginas muy
  profundas; el máximo de `limit` acota el tamaño de respuesta, no el offset.
- La cuenta activa se valida dentro del alcance del titular autenticado; no se
  filtra ni se revela la actividad interna del ledger.
- El filtro `to` es inclusivo. Para consultar un día completo, el cliente debe
  enviar el instante final deseado con su zona horaria.
