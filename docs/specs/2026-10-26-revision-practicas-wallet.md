# Spec: Revisión de prácticas para una wallet virtual

## Fecha
2026-10-26

## Orden de ejecución: 012

## Problema
Se necesita una revisión del modelo de cuentas, el flujo entre routes,
controllers y services, el manejo de errores y las prácticas aplicables a una
wallet virtual, para distinguir los fundamentos que ya están bien de las
mejoras necesarias antes de ampliar o exponer el sistema.

## Solución propuesta
Documentar una revisión estática del estado actual y una hoja de ruta por
prioridad. Esta revisión no cambia código ni fija decisiones de producto
pendientes, como si una wallet puede contener varias monedas. Tomar como
referencia documentación vigente de OWASP, NIST, Express, Node.js, PostgreSQL
y el estándar HTTP RFC 9457, sin presentar esas referencias como una
certificación ni como una evaluación legal/regulatoria.

### Flujo actual de datos

Las cuatro operaciones HTTP tienen esta ruta:

```text
route → asyncHandler → controller → service → PostgreSQL
```

- `GET /accounts/:id` y `GET /accounts/:id/balance` validan UUID en el
  controller, llaman a `accounts.service` y traducen ausencia a `404`.
- `GET /transactions/:id` hace lo mismo con `transactions.service`; el service
  consulta cabecera y asientos con consultas parametrizadas.
- `POST /users` valida el body, calcula el hash de contraseña, y delega el
  registro a `users.service`, que crea usuario y cuenta en una transacción.
- Todas las rutas usan `asyncHandler`; el error handler está montado después
  de las rutas y del handler de `404`. El parser JSON está antes de las rutas,
  así que sus errores también llegan al error handler.
- No hay SQL en routes ni controllers. `Express 5` ya reenvía rechazos de
  Promise a `next`, por lo que `asyncHandler` es redundante en esta versión,
  pero su uso uniforme no es un defecto.

### Fundamentos que conviene conservar

- `accounts`, `transactions` y `entries` son conceptos separados.
- El balance se calcula desde `entries` y se devuelve como texto decimal, sin
  convertirlo a `number` de JavaScript.
- El modelo usa débitos y créditos, claves foráneas, importes positivos,
  transacciones balanceadas y evita editar o borrar asientos existentes.
- El registro crea usuario y cuenta atómicamente; los endpoints de lectura
  usan parámetros SQL.
- La clave de idempotencia ya existe en `transactions`, como base útil para
  implementar operaciones de escritura seguras.

No se recomienda reescribir la arquitectura por capas ni reemplazar el ledger
actual solo por estilo.

### Aspectos que requieren atención antes de manejar fondos reales

1. **Autenticación y autorización de titular — prioridad inmediata antes de
   exponer datos.** No existe login, sesión/token ni middleware de autorización.
   Los endpoints de cuenta y transacción aceptan cualquier UUID y responden
   sin comprobar quién hace la consulta. Un UUID difícil de adivinar no
   reemplaza una autorización por objeto. La respuesta de transacción expone
   también `idempotency_key`, descripción, importes y cuentas de sus asientos.
   Definir autenticación y filtrar cada consulta por el usuario autenticado.

2. **Hash de contraseña — prioridad inmediata antes de aceptar usuarios de
   producción.** El registro usa `scrypt` sin opciones explícitas. Node.js usa
   por defecto `N=16384`, `r=8`, `p=1` y `maxmem=32 MiB`; la guía de OWASP
   recomienda como mínimo para scrypt `N=2^17`, `r=8`, `p=1`, o Argon2id con
   parámetros mínimos publicados. El formato almacenado no conserva parámetros
   de coste. Elegir y medir parámetros en el hardware de despliegue, elevar el
   límite de memoria de forma consciente, almacenar algoritmo y parámetros en
   un formato versionable y añadir verificación de contraseña antes de
   implementar login. El registro hoy acepta ocho caracteres mínimos; NIST
   SP 800-63B-4 pide 15 para contraseña de factor único, pide permitir al
   menos 64 y recomienda listas de contraseñas comunes/comprometidas y
   throttling. Es una referencia útil para este proyecto, no una obligación
   automáticamente aplicable fuera del contexto definido por NIST.

3. **Integridad entre cuenta y asiento — prioridad antes de escribir
   transacciones.** `entries.currency` no tiene una restricción que obligue a
   coincidir con `accounts.currency`. El trigger balancea por moneda de la
   transacción, pero permite que una cuenta COP tenga un asiento USD; la vista
   guardaría ese saldo bajo USD y la consulta de la cuenta COP no lo sumaría.
   Añadir integridad compuesta en la base para cuenta y moneda. Además, `user`
   puede tener `user_id` nulo aunque la relación sea nullable para cuentas
   internas; definir una restricción de propiedad por tipo de cuenta.

4. **Saldo disponible y movimientos — prioridad antes de retiros o
   transferencias.** `allow_negative` se almacena pero ninguna regla actual la
   hace cumplir. No hay endpoints para depósitos, retiros o transferencias.
   Al implementarlos, calcular/verificar el saldo dentro de la transacción que
   inserta todos los asientos, proteger concurrencia con bloqueo o una
   estrategia equivalente, aplicar idempotencia en la escritura y registrar
   reversiones como asientos compensatorios. No aceptar un saldo enviado por
   el cliente.

5. **Monedas y precisión — decisión necesaria al ampliar cuentas.** El API
   acepta cualquier cadena de tres letras como moneda. Definir monedas
   permitidas y su precisión (`COP`, `USD`, futuras monedas o activos
   fraccionables) en una fuente validada; conservar valores decimales exactos
   y no usar punto flotante para dinero.

6. **Límites y endurecimiento HTTP — prioridad antes de exponer el registro.**
   `express.json()` no configura un límite de tamaño; no hay rate limit para
   registro ni controles de consumo. Configurar un límite de body, límites por
   IP/cuenta en flujos sensibles y una política TLS para el despliegue. Revisar
   cabeceras como Helmet en el entorno web. `console.log(err)` imprime errores
   crudos; cambiarlo por logging estructurado con sanitización, sin contraseña,
   hash, tokens, credenciales ni datos personales innecesarios. El error
   handler debería delegar a Express si `res.headersSent` ya es true.

7. **Migraciones y pruebas — prioridad de mantenimiento.** `db:init` detecta
   existencia de `accounts` y entonces aplica solo `002_users.sql`; no tiene
   tabla/versionado de migraciones para descubrir futuras migraciones. El
   esquema inicial y `002_users.sql` repiten la definición de `users`; el FK
   incremental queda `NOT VALID`, así que referencias históricas huérfanas
   siguen sin comprobarse. Consolidar una estrategia de migraciones versionada
   y plan para reparar/validar esos datos. `npm test` es actualmente un
   placeholder aunque hay un archivo `node:test`; agregar pruebas de registro,
   rollback, errores HTTP, integridad moneda-cuenta, autorización e
   idempotencia cuando se implementen esos flujos.

8. **Documentación — mejora pequeña.** El README no enumera
   `GET /transactions/:id` y sus párrafos iniciales aún describen el proyecto
   solo como API de lectura de cuentas/saldos. Alinear esa descripción con el
   registro y la consulta de transacciones actuales evitará que los ejemplos
   queden incompletos.

### Decisión sobre una o varias cuentas por usuario

La restricción actual `UNIQUE (user_id, currency, account_type)` permite a un
usuario tener una cuenta `user` por moneda: por ejemplo, una COP y una USD.
El endpoint de registro actual crea solo la moneda solicitada; no existe hoy un
endpoint para abrir otras monedas.

Si el requisito fuera una única cuenta de una sola moneda por usuario, se
podría restringir `account_type = 'user'` a una fila por `user_id`, pero eso
impediría cuentas separadas por moneda. Si el concepto de producto es una
única wallet con varias monedas, el diseño más claro es una wallet por usuario
y subcuentas/saldos por moneda bajo esa wallet. No implementar ninguna de esas
opciones hasta decidir qué significa "una billetera" para el producto.

### Versiones consultadas

- En el entorno de revisión: Node.js `v24.21.0`, npm `12.2.0`.
- Dependencias instaladas según `npm ls --depth=0`: Express `5.3.0`, pg
  `8.23.1`, Zod `4.6.7`, TypeScript `7.0.2`, Vitest `5.0.5`.
- No hay `engines` en `package.json` ni archivo `.nvmrc`.
- A la fecha de esta revisión, la línea 24 es LTS y Node.js publicó `24.22.1`
  el 21 de octubre de 2026 como actualización de seguridad. Fijar la versión
  LTS y actualizar el entorno desplegado al patch vigente.

### Referencias oficiales consultadas

- [OWASP ASVS 5.0.0](https://asvs.owasp.org/) — estándar de requisitos de
  verificación de seguridad para aplicaciones web y servicios.
- [OWASP API Security Top 10 2023](https://api-security.owasp.org/editions/2023/en/0x11-t10/)
  — riesgos de autorización por objeto, autenticación, consumo de recursos y
  flujos sensibles de API.
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
  — elección y parámetros de algoritmos para passwords.
- [OWASP Transaction Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html)
  — autorización de operaciones sensibles y confirmación de sus datos.
- [Express 5 Error Handling](https://expressjs.com/en/guide/error-handling/)
  y [Express Production Security](https://expressjs.com/en/advanced/best-practice-security/).
- [Node.js 24 Crypto](https://nodejs.org/docs/latest-v24.x/api/crypto.html)
  — defaults y límites de `scrypt`.
- [NIST SP 800-63B-4](https://csrc.nist.gov/pubs/sp/800/63/B/4/final), final
  julio de 2025, y [texto completo, sección 3.1.1.2](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-63b-4.pdf).
  Es guía de identidad digital para el contexto que define NIST; se cita como
  referencia técnica, no como obligación legal de este proyecto.
- [PostgreSQL 18: Constraints](https://www.postgresql.org/docs/18/ddl-constraints.html)
  y [Transaction Isolation](https://www.postgresql.org/docs/18/transaction-iso.html).
- [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html), estándar HTTP para
  detalles de error interoperables. El formato `{ error }` actual es simple y
  funcional; migrarlo es opcional mientras no se necesite interoperabilidad.
- [Node.js releases](https://nodejs.org/en/about/previous-releases/) — estado
  y soporte de líneas Node.

## Archivos afectados
- docs/specs/2026-10-26-revision-practicas-wallet.md

## Pasos
1. Inspeccionar routes, controllers, services, middleware, configuración,
   migraciones, seeds y documentación sin editar implementación.
2. Contrastar los hallazgos con referencias oficiales vigentes y las versiones
   instaladas en el proyecto.
3. Registrar fundamentos correctos, brechas de prioridad y decisiones de
   producto pendientes en este spec.
4. No implementar recomendaciones hasta que se prioricen y aprueben.

## Cómo probar
- [x] Revisar estáticamente las cuatro operaciones y confirmar el flujo de
  errores a través de `asyncHandler` y el error handler final.
- [x] Revisar el esquema, el ledger, la configuración, los seeds, la
  documentación y los scripts de base de datos.
- [x] Consultar las versiones instaladas y referencias oficiales actuales.
- [ ] Ejecutar una revisión de seguridad dinámica o una prueba de penetración.
- [ ] Definir requisitos de identidad, regulación y operación según el modelo
  de negocio y la jurisdicción antes de custodiar dinero real.

## Riesgos / notas
- La aplicación actual es un prototipo de registro y lectura de un ledger, no
  una wallet lista para custodiar o transferir dinero real.
- La estructura por capas y el ledger tienen buenas bases; no se propone
  refactorizar por estilo.
- La prioridad de autenticación/autorización depende de que los endpoints se
  expongan fuera del entorno de desarrollo, pero es requisito antes de
  mostrar datos personales o financieros a usuarios.
- No se revisó cumplimiento legal o regulatorio colombiano ni se afirma que
  aplique una licencia específica; depende del modelo operativo.
