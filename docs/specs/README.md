# Spec Docs — Guía rápida

## ¿Qué es un spec doc?

Un **spec doc** es un archivo de texto que describe **qué** cambio se va a hacer antes de hacerlo: qué problema resuelve, qué se modifica, cómo se prueba y qué archivos se tocan. Sirve como contrato entre tú y la IA.

En vez de pedirle cosas sueltas al agente, le pedimos que **primero escriba el spec** y que **después lo implemente**.

## ¿Por qué usarlo?

- El equipo sabe **qué cambió y por qué**, sin leer todo el diff.
- El agente comete **menos errores** porque piensa antes de codear.
- Queda un **historial ordenado** de cambios en el repo.
- Es fácil **revisar** el plan sin revisar 500 líneas de código.

## Regla del equipo

> **Cada cambio que haga la IA debe generar un archivo en `docs/specs/`.**

## Estructura de carpetas

```
docs/
└── specs/
    ├── 2025-01-15-login-google.md
    ├── 2025-01-16-fix-carrito.md
    └── ...
```

**Nombre del archivo:** `YYYY-MM-DD-titulo-corto.md`

## Plantilla del spec

Pídele a la IA que **cree este archivo antes de tocar código**:

```markdown
# Spec: <título corto>

## Fecha
YYYY-MM-DD

## Orden de ejecución: 

## Problema
¿Qué hay que resolver? ¿Por qué?

## Solución propuesta
¿Cómo se va a resolver? (a alto nivel)

## Archivos afectados
- src/...
- tests/...

## Pasos
1. ...
2. ...

## Cómo probar
- [ ] Caso 1
- [ ] Caso 2

## Riesgos / notas
- ...
```

## Cómo pedírselo al agente (prompt)

Copia esto en el chat del IDE:

```
Vas a hacer el siguiente cambio: <describe el cambio>.

Antes de escribir código:
1. Crea un archivo en docs/specs/ con nombre YYYY-MM-DD-titulo-corto.md
   usando la plantilla de docs/specs/_plantilla.md.
2. Asigna el siguiente número correlativo de ejecución consultando el índice
   "Orden de ejecución de los specs" de docs/specs/README.md. Inclúyelo en el
   spec como `Orden de ejecución: NNN` y añade el nuevo spec al final del índice.
   No reutilices números ya asignados, aunque un spec esté archivado o superado.
3. El spec debe incluir snippets representativos de código para cada flujo o
   comportamiento principal que cambie. Después de cada snippet, explica en
   lenguaje claro qué ocurre, quién lo ejecuta y qué resultado produce. Usa el
   lenguaje correspondiente (SQL, TypeScript, JSON, etc.); los snippets deben
   aclarar el comportamiento y no ser código de relleno.
4. Muéstrame el spec para que lo apruebe.
5. Cuando lo apruebe, implementa el cambio.
6. Al final, marca los checkboxes de "Cómo probar" que se cumplan.
```

## Orden de ejecución de los specs

El número de orden es un identificador permanente del lugar del spec en la
secuencia de trabajo; no es la fecha del archivo ni el estado actual de la
implementación. Se reconstruyó el orden histórico usando las fechas, las
dependencias descritas en los propios specs y `git log` (cuando el historial
está disponible). Los specs posteriores de una misma área se ejecutan después
de sus fundamentos. Los nuevos specs reciben el siguiente número libre.

| Orden | Spec | Relación / nota |
|---:|---|---|
| 001 | [Esquema SQL ledger append-only](./2026-10-21-ledger-append-only.md) | Base de datos requerida por los demás flujos. |
| 002 | [Seeds de datos para probar la DB](./2026-10-23-seeds-db.md) | Requiere el esquema del ledger. |
| 003 | [Ruta de consulta de saldo del ledger](./2026-10-24-ledger-balance-route.md) | Primer flujo HTTP de lectura, sobre esquema y seeds. |
| 004 | [Documentación Swagger de la API](./2026-10-24-swagger-api-docs.md) | Documenta la ruta de saldo existente. |
| 005 | [Rutas y capas de consulta de accounts](./2026-10-24-accounts-endpoints.md) | Amplía la consulta con el detalle de cuenta. |
| 006 | [Ejemplos reales de accounts en Swagger](./2026-10-24-swagger-account-examples.md) | Depende de los endpoints y de los IDs de seeds. |
| 007 | [Reducir duplicación en el flujo de accounts](./2026-10-25-redundancia-flujo-accounts.md) | Refactoriza el flujo de lectura ya establecido. |
| 008 | [Alinear Swagger UI de accounts](./2026-10-25-swagger-accounts-alineacion.md) | Alinea la documentación con los contratos de accounts. |
| 009 | [Consultar detalle de transactions](./2026-10-25-transactions-read-endpoint.md) | Añade lectura del historial del ledger. |
| 010 | [Registro de usuario y billetera](./2026-10-26-registro-usuario-billetera.md) | Añade identidad y creación de cuenta. |
| 011 | [Autenticación y acceso por titular](./2026-10-26-autenticacion-y-acceso-por-titular.md) | Protege las lecturas y requiere usuarios registrados. |
| 012 | [Revisión de prácticas para una wallet virtual](./2026-10-26-revision-practicas-wallet.md) | Revisión/hoja de ruta; no implementa cambios. Su contenido evalúa el estado previo a las decisiones de wallet siguientes. |
| 013 | [Congruencia de seeds y datos de prueba](./2026-10-26-congruencia-seeds-cuentas.md) | Alinea datos de DB, seeds y ejemplos para las pruebas. |
| 014 | [Cuenta única de liquidación por usuario](./2026-10-26-wallet-unica-multimoneda.md) | Define una sola cuenta user y la moneda de liquidación. |
| 015 | [Conversión de ingresos a la moneda de la wallet](./2026-10-26-conversion-tasas-exchange-rate.md) | Depende de la decisión de cuenta única y su moneda de liquidación. |
| 016 | [Ingresos convertidos a la moneda principal de la wallet](./2026-10-26-ingresos-multimoneda-wallet.md) | Evolución posterior del modelo de wallet; revisar junto con 014–015 porque amplía el modelo a saldos secundarios. |
| 017 | [Auditoría de estado del proyecto y preparación para deploy](./2026-10-26-auditoria-estado-y-deploy.md) | Inventario de endpoints, brechas funcionales y checklist verificable de preparación para despliegue. |
| 018 | [Health check con disponibilidad de base de datos](./2026-10-26-health-check-db.md) | Separa proceso vivo de readiness y comprueba PostgreSQL para configurar Railway. |
| 019 | [Listado de cuentas del usuario](./2026-10-26-listado-cuentas-usuario.md) | Permite descubrir las cuentas activas y sus saldos mediante la sesión autenticada. |
| 020 | [Historial paginado de transactions](./2026-10-26-transactions-historial-paginado.md) | Añade actividad reciente con paginación, filtros y aislamiento por titular. |
| 021 | [Retiro desde cuenta](./2026-10-26-retiro-cuenta.md) | Registra retiros autenticados con saldo suficiente, serialización por wallet e idempotencia. |
| 022 | [Configuración de Neon para Codex](./2026-10-27-configuracion-neon-codex.md) | Verifica la skill existente y configura el MCP oficial de Neon mediante OAuth para Codex. |
| 023 | [Conectar el backend a Neon](./2026-10-27-conexion-backend-neon.md) | Hace que el pool de PostgreSQL use `DATABASE_URL` de Neon, manteniendo el modo local con `DB_*`. |
| 024 | [Revisión completa del proyecto](./2026-10-27-revision-completa-proyecto.md) | Auditoría estática de arquitectura, endpoints, seguridad, base de datos y documentación; actualiza el estado real del proyecto. |
| 025 | [Mínimo funcional de autenticación](./2026-10-27-minimo-funcional-auth-front-back.md) | Cambios 4, 6 y 8: migración 008, `POST /auth/register` y front contra el contrato mínimo. Depende del spec 026 para el login. |
| 026 | [Contrato de sesión y login `{ token, user }`](./2026-10-27-contrato-sesion-login.md) | Implementa D1: `toAuthUser`, `createSessionForUser` y login `{ token, user }`. Requiere la migración 008 del spec 025. |

Los órdenes 014–016 reflejan la secuencia documental del historial, no una
afirmación de que sus diseños sean todos compatibles entre sí. Antes de
implementar cambios de wallet, comprobar si un spec posterior reemplaza o
extiende la decisión anterior y actualizar esta nota si el equipo decide otro
orden. No renumerar los identificadores ya publicados.

## Flujo resumido

1. **Pides** el cambio.
2. **La IA crea** `docs/specs/YYYY-MM-DD-*.md`.
3. **Revisas** el spec (no el código todavía).
4. **Apruebas** → la IA implementa.
5. **Commit** incluye el código **y** el spec.

## Reglas

- ❌ No mergear cambios sin su spec.
- ❌ No editar specs ya cerrados (crea uno nuevo).
- ✅ Spec corto: si pasa de 1 página, divide el cambio.
- ✅ Un spec = un cambio.

---

Dudas → hablamos en el canal del equipo.
