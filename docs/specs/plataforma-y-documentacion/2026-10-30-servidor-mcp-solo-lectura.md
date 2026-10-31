# Spec: servidor MCP de solo lectura

## Fecha
2026-10-30

## Orden de ejecución: 042

## Estado
Implementado y verificado en la rama `feat/mcp-server`.

## Problema

LATIN ZUMI tiene endpoints autenticados para consultar perfiles, cuentas,
saldos y movimientos, pero no ofrece esas capacidades mediante Model Context
Protocol (MCP). Se necesita un punto de integración para agentes que preserve
la sesión existente y el aislamiento por titular, sin exponer operaciones que
modifiquen información financiera.

## Solución propuesta

### Alcance

La primera versión expondrá exactamente estas cinco herramientas, todas de
solo lectura:

1. `get_my_profile`
2. `list_my_accounts`
3. `get_my_account_balance`
4. `list_my_wallet_activity`
5. `get_my_transaction`

No se registrarán herramientas de cotización, transferencias, depósitos,
retiros, cambios de moneda, registro/login, recuperación de contraseñas ni
actualización de perfil. La cotización queda fuera de esta etapa aunque no
mueva saldos: crea un registro temporal y consulta un proveedor externo.

### Transporte y autenticación

- Integrar Streamable HTTP en Express en un único endpoint `/mcp`, usando las
  APIs v2 oficiales `createMcpHandler` y `toNodeHandler`. No se añadirá un
  proceso stdio ni un listener separado.
- Usar el handler sin estado recomendado por SDK v2 (sin `MCP-Session-Id`
  persistente). Cada solicitud HTTP atraviesa `requireAuth`; la fábrica
  request-scoped cierra sobre la identidad autenticada de esa solicitud. No
  se almacena contexto de usuario en singletons, variables globales, mapas
  compartidos ni sesiones MCP.
- Delimitar la autenticación con `McpAuthProvider`: el adaptador de producción
  usa `requireAuth` y `getAuthContext`; la factoría de router permite inyectar
  un proveedor para pruebas o futura conexión interna. Si el proveedor no
  puede autenticar o no produce un contexto, la solicitud falla cerrada con
  `401`; nunca hay modo anónimo.
- El cliente enviará `Authorization: Bearer <sesión LATIN ZUMI>` en cada
  solicitud al endpoint. `requireAuth` valida en PostgreSQL el hash contra una
  sesión vigente y revocable; los callbacks reciben `userId` únicamente de
  `getAuthContext(req)`. La autenticación del handshake, la consulta de
  herramientas y cada llamada se valida de nuevo.
- Se conservan las respuestas actuales: `401` si falta o no es válida la
  sesión; `403` cuando `passwordChangeRequired` bloquea `/mcp`. No se crea
  OAuth ni se intercambian credenciales. Los clientes que no puedan adjuntar
  el bearer token no podrán usar este endpoint en esta etapa; compatibilidad
  OAuth requiere otra propuesta y aprobación.
- Validar explícitamente cualquier `Origin` presente contra
  `env.CORS_ORIGINS` para evitar DNS rebinding; solicitudes nativas sin
  `Origin` son aceptables. El CORS existente no basta por sí solo: no rechaza
  necesariamente la solicitud aunque no agregue headers CORS.
- Este modo evita afinidad de sesiones entre procesos y que un `userId` quede
  asociado a una conexión persistente. El SDK procesa initialize/notifications/
  list/call en modo sin estado, verificado con el cliente oficial en pruebas
  locales.

```ts
router.all('/mcp', authProvider.authenticate, validateMcpOrigin, async (req, res) => {
  const userId = authProvider.getAuthenticatedUserId(req);
  const handler = createMcpHandler(() => createMcpServer(userId));
  const nodeHandler = toNodeHandler(handler);
  const requestWithoutBackendAuth = Object.create(req);
  Object.defineProperty(requestWithoutBackendAuth, 'auth', { value: undefined });
  try {
    await nodeHandler(requestWithoutBackendAuth, res, req.body);
  } finally {
    await handler.close();
  }
});
```

La ruta autentica antes de crear el handler y la fábrica queda ligada al
`userId` obtenido del proveedor, nunca de argumentos MCP. Se crea un handler
por solicitud HTTP y se le pasa el body ya parseado por Express. El adaptador
SDK traduce el protocolo Streamable HTTP y sus respuestas; no se usarán streams
SSE de servidor ni notificaciones para esta API de solo lectura.

`router.all('/mcp')` permite que los métodos dirigidos al endpoint pasen por la
autenticación y lleguen al adaptador; no significa que la aplicación admita
cualquier método HTTP. El handler del SDK determina la respuesta del
transporte. En la configuración sin estado actual, los requests JSON-RPC se
envían mediante `POST`; `GET` y `DELETE` no establecen streams ni sesiones y
se rechazan con `405 Method Not Allowed`. Otros métodos no soportados, como
`PUT` y `PATCH`, también reciben `405`. Las pruebas de ruta verifican el
comportamiento efectivo del SDK instalado.

Los tests de transporte incluyen un handshake con `protocolVersion:
"2025-11-25"`. Esa cadena identifica una versión del protocolo, no una versión
del paquete. El servidor y cliente de tests usan el SDK oficial v2
`@modelcontextprotocol/server` y `@modelcontextprotocol/client` **2.4.0**,
cuyo soporte v2 corresponde a la especificación **2026-07-28** e incluye
compatibilidad de protocolo según negociación. Por lo tanto, los tests con el
valor explícito `2025-11-25` ejercitan compatibilidad con esa revisión; no
significan que el SDK instalado sea una versión 2025.

Express parsea JSON con un máximo explícito de **100 KB** mediante
`express.json({ limit: '100kb' })`. El parser es global, por lo que el límite
también aplica a las demás rutas que reciben JSON. Los cuerpos que superen el
límite responden HTTP `413` con el formato de error existente; el JSON mal
formado conserva HTTP `400`.

El rate limiter permite **60 solicitudes por minuto por IP y por proceso**.
Utiliza el store en memoria predeterminado: los contadores no se comparten
entre procesos o instancias y se reinician al reiniciar el proceso. En una
instalación con varias instancias, la cuota efectiva puede multiplicarse por
la cantidad de instancias y depende de cómo se distribuya el tráfico. Si se
requiere una cuota global consistente, deberá configurarse posteriormente un
store compartido; no forma parte de esta implementación.

### SDK y compatibilidad

Usar los paquetes oficiales divididos v2, fijados exactamente a las versiones
vigentes comprobadas al 2026-10-30:

- `@modelcontextprotocol/server` **2.4.0**, runtime declarado `node >=20`,
  dependiente de Zod 4 y `@modelcontextprotocol/core` 2.4.0.
- `@modelcontextprotocol/node` **2.1.2**, runtime declarado `node >=20`,
  peer `@modelcontextprotocol/server ^2.4.0`; proporciona
  `toNodeHandler` para Express/Node.
- `@modelcontextprotocol/client` **2.4.0** como dependencia de desarrollo
  para probar el servidor con cliente oficial en proceso, sin conexión externa.

El proyecto usa Node `>=24 <25`, TypeScript `^7.0.2`, Express `^5.3.0`,
Zod `^4.6.7`, ESM y `NodeNext`. Los metadatos oficiales de los paquetes
declaran Node >=20 y Zod 4; la documentación oficial enseña
`createMcpHandler`, `McpServer`, `toNodeHandler`, Streamable HTTP y Express.
La compatibilidad efectiva con TypeScript 7 se comprobó ejecutando el build
estricto en Node 24.22.2. No se requiere `@modelcontextprotocol/express`: el backend
conserva su app Express/CORS y requiere validación Origin con su allowlist.

Referencias consultadas:

- [Registry npm de @modelcontextprotocol/server 2.4.0](https://registry.npmjs.org/@modelcontextprotocol/server/2.4.0)
- [Registry npm de @modelcontextprotocol/node 2.1.2](https://registry.npmjs.org/@modelcontextprotocol/node/2.1.2)
- [Registry npm de @modelcontextprotocol/client 2.4.0](https://registry.npmjs.org/@modelcontextprotocol/client/2.4.0)
- [SDK TypeScript de MCP](https://github.com/modelcontextprotocol/typescript-sdk)
- [Guía oficial del SDK v2 para Express](https://ts.sdk.modelcontextprotocol.io/v2/serving/express.md)
- [Guía oficial del SDK v2 para HTTP](https://ts.sdk.modelcontextprotocol.io/v2/serving/http.md)
- [Guía oficial de pruebas del SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/testing.md)
- [Especificación MCP 2026-07-28: transportes Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [Especificación MCP 2025-11-25: transportes](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), revisión utilizada por el handshake explícito de las pruebas de ruta
- [Especificación MCP: autorización HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)

El paquete monolítico `@modelcontextprotocol/sdk` 1.32.2 ya no es la elección
actual: el README oficial deriva a la generación v2 distribuida en paquetes
separados. Las versiones fijadas son las últimas observadas en los tags npm
`latest`; también deben quedar fijadas en el lockfile.

### Registro de herramientas y servicios

Registrar únicamente cinco tools mediante `McpServer.registerTool`. Sus
esquemas Zod serán estrictos: no aceptar propiedades adicionales, en particular
`userId`. Las herramientas sin argumentos reciben un objeto vacío. El
controlador MCP delegará en servicios del backend; no contendrá SQL ni lógica
financiera.

- `get_my_profile`: servicio nuevo `getMyProfile(userId)`, con consulta
  parametrizada y selección explícita de campos de perfil. No reutilizar
  `findUserByEmail`, ya que su propósito es buscar otra persona.
- `list_my_accounts`: `getAccountsByUserId(userId)` de
  `accounts.service.ts`.
- `get_my_account_balance`: `getBalanceByAccountId(accountId, userId)` de
  `accounts.service.ts`.
- `list_my_wallet_activity`: `listWalletTransactions({ userId, ...filters })`
  de `wallet-transactions.service.ts`, con una proyección MCP que elimina los
  campos de contraparte.
- `get_my_transaction`: `getTransactionById(transactionId, userId)` de
  `transactions.service.ts`, con una proyección MCP que excluye
  `idempotency_key` y retiene solamente asientos de cuentas propias que el
  servicio ya limita al titular.

```ts
server.registerTool(
  'get_my_account_balance',
  { inputSchema: z.object({ account_id: z.string().uuid() }).strict() },
  async ({ account_id }) => {
    const balance = await getBalanceByAccountId(account_id, userId);
    if (!balance) throw resourceNotFound();
    return toMcpResult({ account_id, ...balance });
  },
);
```

El esquema rechaza UUIDs inválidos y argumentos extra; `userId` procede del
contexto cerrado sobre la solicitud autenticada. El servicio también requiere
la identidad del titular, por lo que un ID de cuenta ajena se trata como no
encontrado.

### Contratos de tools

Todos los resultados se serializarán con DTOs de allowlist. No se devolverán
filas PostgreSQL ni objetos completos de servicios sin filtrar.

| Tool | Parámetros | Resultado MCP propuesto | Permiso / efecto |
|---|---|---|---|
| `get_my_profile` | Ninguno. | `{ profile: { nombre, email, pais, moneda_preferida, foto_url } }`; `pais` y `foto_url` pueden ser `null`. No incluir roles, estado, contraseña/hash ni credenciales. | Sesión válida del propio titular. Solo lectura. |
| `list_my_accounts` | Ninguno. | `{ items: [{ id, currency, balance }] }`; moneda y saldo como texto/código ya normalizado. | Sesión válida; cuentas user activas del titular. Solo lectura. |
| `get_my_account_balance` | `account_id`: UUID. | `{ account_id, currency, balance }`; saldo decimal como texto. | Sesión válida y propiedad comprobada por el servicio. Solo lectura. |
| `list_my_wallet_activity` | Opcionales: `page` entero positivo (default 1), `limit` entero de 1 a 100 (default 20), `type` en `deposit`, `transfer_sent`, `transfer_received`, `withdrawal`, `exchange`, `currency` en `USD`, `COP`, `ARS`, `EUR`, `from` y `to` como datetime ISO 8601 con offset. | `{ items: [{ id, type, status, currency, amount, created_at, exchange }], page, limit, total, totalPages }`. No incluir `counterparty`, description ni email/nombre de terceros. `exchange` solo contiene moneda, monto y tasa de destino. | Sesión válida; actividad propia; paginación limitada. Solo lectura. |
| `get_my_transaction` | `transaction_id`: UUID. | `{ transaction: { id, occurred_at, entries: [{ amount, direction, currency, created_at }] } }`. Excluir `description`, `idempotency_key`, cuentas internas y asientos ajenos. | Sesión válida; transacción visible para el titular según servicio. Solo lectura. |

Para filtros de actividad, rechazar fechas mal formadas, rangos `from > to`,
páginas/desplazamientos no representables como enteros seguros y propiedades
extra. Los defaults y límites no deberán ampliar los establecidos por el
endpoint actual.

### Errores

- Sesión ausente, inválida, vencida o revocada: HTTP `401` usando
  `requireAuth`; sesión con cambio de contraseña requerido: HTTP `403`.
- `Origin` no permitido: HTTP `403`; límite de tasa excedido: HTTP `429`.
- Argumentos inválidos: error de parámetros MCP/JSON-RPC sin ejecutar el
  servicio.
- Cuenta, perfil o transacción inexistente o ajena: error genérico de recurso
  no encontrado; no distinguir propiedad de inexistencia.
- Errores operacionales conocidos: mensaje estable y seguro, sin SQL, stack,
  token, email de terceros ni detalles de infraestructura.
- Errores inesperados: error MCP genérico; no se serializan mensajes internos,
  SQL, cabeceras de autorización ni argumentos sensibles. Los errores de
  transporte que llegan al middleware HTTP conservan su manejo centralizado.
  No convertir fallos a resultados exitosos.

### Seguridad y privacidad

- Validar nuevamente la sesión en cada solicitud HTTP, inclusive initialize y
  herramientas; nunca aceptar un `userId` del cliente.
- Contexto de identidad inmutable y request-scoped; ningún estado global mutable
  de usuario. Las llamadas concurrentes de distintos usuarios deben crear
  servidores/callbacks independientes.
- Mantener autorización por titular en servicios. Un UUID conocido no concede
  acceso a una cuenta ni transacción ajena.
- Aplicar listas permitidas a respuestas. En particular, el servicio de
  actividad existente puede incluir emails/nombres de contrapartes y la
  consulta del ledger incluye `idempotency_key`; ambos campos se excluyen del
  resultado MCP.
- No exponer secretos, tokens de sesión, hashes, contraseñas, credenciales de
  proveedores ni filas de cuentas internas.
- No implementar SQL arbitrario ni parámetros que permitan elegir columnas,
  tablas o identificadores de usuario.
- Mantener el endpoint con límite de tasa y límite de cuerpo razonable; no
  registrar el bearer token. Las consultas continúan siendo únicamente
  selectivas y parametrizadas.
- No añadir herramientas de escritura: las cinco callbacks no deben insertar,
  actualizar ni eliminar datos; tampoco deben ejecutar servicios que cambien
  ledger o consulten tasas externas.

### Archivos implementados

- `package.json` y `package-lock.json`.
- `src/server.ts` y nuevos módulos bajo `src/mcp/`.
- Nuevo método de lectura de perfil en `src/services/users.service.ts`.
- Pruebas bajo `src/tests/` para middleware/transport, tools y servicio de
  perfil, siguiendo la estructura existente.
- Documentación operativa de `/mcp` en `README.md`.

### Criterios de aceptación

- El cliente MCP completa initialize y puede listar las cinco herramientas
  usando Streamable HTTP sin estado; no hay tools adicionales en la lista.
- Cada solicitud requiere una sesión LATIN ZUMI válida y obedece `401`/`403`
  de `requireAuth`; no hay OAuth ni intercambio de tokens.
- Ninguna herramienta acepta `userId`, y el titular siempre procede del
  contexto autenticado.
- Los servicios mantienen aislamiento por titular; respuestas no contienen
  información privada de terceros, secretos, hashes, tokens o claves de
  idempotencia.
- Las solicitudes concurrentes autenticadas como usuarios distintos no
  comparten identidad ni datos.
- Todas las herramientas son solo de lectura y no alteran balances, ledger,
  perfil ni otros datos de negocio.
- Zod valida todas las entradas y la actividad limita `limit` a 100.
- `npm run build` y la suite completa pasan con las dependencias fijadas.

## Archivos entregados

- `docs/specs/plataforma-y-documentacion/2026-10-30-servidor-mcp-solo-lectura.md`
- `docs/specs/index-specs.md`
- `package.json`, `package-lock.json`, `README.md`, `src/server.ts`
- `src/mcp/auth.ts`, `src/mcp/router.ts`, `src/mcp/tools.ts`
- `src/services/users.service.ts`
- `src/tests/mcp/server.test.ts`, `src/tests/routes/mcp.route.test.ts` y
  `src/tests/services/users.service.test.ts`

## Etapas completadas

1. Añadidos los paquetes MCP v2 oficiales con versiones fijadas y validado el
   build TypeScript NodeNext.
2. Integrado Streamable HTTP sin estado en Express, con `McpAuthProvider`,
   `requireAuth`, validación de Origin y contexto por solicitud.
3. Implementada la consulta de perfil y registradas las cinco tools sobre
   servicios de lectura existentes.
4. Aplicadas proyecciones allowlist, validaciones Zod estrictas, paginación
   máxima de 100 y mensajes de error genéricos.
5. Añadidas pruebas en proceso con el cliente oficial, sesiones simuladas,
   aislamiento, concurrencia, autenticación, privacidad y validación; no se
   usaron credenciales externas ni base de datos real.
6. Documentada la configuración operativa en `README.md`.

## Cómo probar

- [x] Una sesión válida puede inicializar MCP, listar exactamente cinco tools
  y ejecutar lecturas válidas.
- [x] Sin bearer token, y con tokens inválidos, expirados o revocados, toda
  solicitud MCP protegida responde `401`; `passwordChangeRequired` responde
  `403`.
- [x] Dos usuarios reciben solamente su propio perfil, cuentas, saldos y
  transacciones; un UUID ajeno y uno inexistente producen el mismo error
  genérico.
- [x] Llamadas concurrentes para dos usuarios nunca cruzan su identidad ni sus
  respuestas.
- [x] UUIDs, fechas, monedas, montos de paginación, límites y propiedades extra
  inválidos fallan antes de llamar a servicios.
- [x] Las respuestas no incluyen bearer tokens, hashes, contraseñas,
  idempotency keys, emails/nombres de contrapartes ni cuentas internas.
- [x] El cliente oficial `@modelcontextprotocol/client` valida en proceso el
  handshake Streamable HTTP sin estado, lista tools y completa llamadas, sin
  establecer conexión de red a un cliente externo.
- [x] La lista de tools coincide exactamente con los cinco nombres aprobados.
- [x] Tests de contrato/servicio comprueban que no se invoca ninguna operación
  financiera, `INSERT`, `UPDATE` o `DELETE`; las consultas de estas tools son
  de lectura.
- [x] El build estricto TypeScript y la suite completa pasan; no se requieren
  migraciones.

## Riesgos / notas

- La auditoría de dependencias reportó vulnerabilidades preexistentes en el
  árbol de `neon@8.13.2`: dos moderadas para `@hono/node-server@2.0.4`
  (transitiva) y una baja para `diff@5.2.0` (transitiva). `neon` es
  dependencia directa. Estos paquetes y versiones ya estaban presentes en
  `dev`; no fueron añadidos por el servidor MCP. Los avisos reportados se
  refieren a `serveStatic`, WebSocket y parsing de patches; no se identificó
  uso directo de esas funciones en las tools MCP. Es deuda técnica del árbol
  general del backend y no se actualizaron paquetes ni se aplicó una solución
  automática. Cualquier remediación debe evaluarse separadamente, en especial
  porque la propuesta de npm implica un cambio major de Neon.
- Algunos clientes MCP esperan OAuth o no permiten enviar un bearer
  preexistente. No se debe resolver mediante un token puente, parámetro URL,
  query string, cookie nueva ni OAuth improvisado; evaluar esos clientes en
  integración y presentar otra propuesta si hace falta.
- La especificación MCP de autorización HTTP está basada en OAuth. Esta
  implementación reutiliza autenticación bearer propia de LATIN ZUMI y no
  afirma compatibilidad con el flujo OAuth MCP.
- Los paquetes v2 2.4.0/2.1.2 declaran Node >=20 y Zod 4; el build estricto
  del proyecto es la comprobación de la combinación exacta con TypeScript 7.
- Listar movimientos reutiliza un servicio que devuelve contrapartes para la
  aplicación web; el DTO MCP las filtra con una allowlist.
- El servidor no ofrecerá estado MCP persistente, suscripciones ni streams de
  eventos. Si un cliente o requisito futuro los necesita, revisar este diseño
  de identidad y concurrencia antes de habilitarlos.
- No crear credenciales reales ni modificar `.env` o `.env.production`. La
  implementación usa la sesión de LATIN ZUMI existente y la interfaz de
  autenticación queda reemplazable para la conexión interna futura.
- No ejecutar migraciones, seeds ni consultas a bases reales. Las pruebas usan
  servicios simulados y el cliente MCP oficial en proceso.
- Antes de producción, ejecutar pruebas de integración de sesiones y
  titularidad contra PostgreSQL aislado y desechable: hash de token,
  expiración/revocación, `passwordChangeRequired`, acceso a recursos propios
  frente a recursos ajenos/inexistentes y solicitudes concurrentes de dos
  usuarios. La infraestructura debe ser una instancia de pruebas separada,
  inicializada con el esquema de test y datos sintéticos, sin credenciales ni
  conexión a bases de producción; estas pruebas no se ejecutan como parte de
  la suite simulada actual.
