# Índice de specs

## Orden de ejecución de los specs

El número de orden es un identificador permanente del lugar del spec en la
secuencia de trabajo; no es la fecha del archivo ni el estado actual de la
implementación. Se reconstruyó el orden histórico usando las fechas, las
dependencias descritas en los propios specs y `git log` (cuando el historial
está disponible). Los specs posteriores de una misma área se ejecutan después
de sus fundamentos. Los nuevos specs reciben el siguiente número libre.

| Orden | Spec | Relación / nota |
|---:|---|---|
| 001 | [Esquema SQL ledger append-only](./ledger-y-transacciones/2026-10-21-ledger-append-only.md) | Base de datos requerida por los demás flujos. |
| 002 | [Seeds de datos para probar la DB](./ledger-y-transacciones/2026-10-23-seeds-db.md) | Requiere el esquema del ledger. |
| 003 | [Ruta de consulta de saldo del ledger](./ledger-y-transacciones/2026-10-24-ledger-balance-route.md) | Primer flujo HTTP de lectura, sobre esquema y seeds. |
| 004 | [Documentación Swagger de la API](./plataforma-y-documentacion/2026-10-24-swagger-api-docs.md) | Documenta la ruta de saldo existente. |
| 005 | [Rutas y capas de consulta de accounts](./cuentas-y-wallet/2026-10-24-accounts-endpoints.md) | Amplía la consulta con el detalle de cuenta. |
| 006 | [Ejemplos reales de accounts en Swagger](./cuentas-y-wallet/2026-10-24-swagger-account-examples.md) | Depende de los endpoints y de los IDs de seeds. |
| 007 | [Reducir duplicación en el flujo de accounts](./cuentas-y-wallet/2026-10-25-redundancia-flujo-accounts.md) | Refactoriza el flujo de lectura ya establecido. |
| 008 | [Alinear Swagger UI de accounts](./cuentas-y-wallet/2026-10-25-swagger-accounts-alineacion.md) | Alinea la documentación con los contratos de accounts. |
| 009 | [Consultar detalle de transactions](./ledger-y-transacciones/2026-10-25-transactions-read-endpoint.md) | Añade lectura del historial del ledger. |
| 010 | [Registro de usuario y billetera](./autenticacion/2026-10-26-registro-usuario-billetera.md) | Añade identidad y creación de cuenta. |
| 011 | [Autenticación y acceso por titular](./autenticacion/2026-10-26-autenticacion-y-acceso-por-titular.md) | Protege las lecturas y requiere usuarios registrados. |
| 012 | [Revisión de prácticas para una wallet virtual](./cuentas-y-wallet/2026-10-26-revision-practicas-wallet.md) | Revisión/hoja de ruta; no implementa cambios. Su contenido evalúa el estado previo a las decisiones de wallet siguientes. |
| 013 | [Congruencia de seeds y datos de prueba](./ledger-y-transacciones/2026-10-26-congruencia-seeds-cuentas.md) | Alinea datos de DB, seeds y ejemplos para las pruebas. |
| 014 | [Cuenta única de liquidación por usuario](./cuentas-y-wallet/2026-10-26-wallet-unica-multimoneda.md) | Define una sola cuenta user y la moneda de liquidación. |
| 015 | [Conversión de ingresos a la moneda de la wallet](./cuentas-y-wallet/2026-10-26-conversion-tasas-exchange-rate.md) | Depende de la decisión de cuenta única y su moneda de liquidación. |
| 016 | [Ingresos convertidos a la moneda principal de la wallet](./cuentas-y-wallet/2026-10-26-ingresos-multimoneda-wallet.md) | Evolución posterior del modelo de wallet; revisar junto con 014–015 porque amplía el modelo a saldos secundarios. |
| 017 | [Auditoría de estado del proyecto y preparación para deploy](./plataforma-y-documentacion/2026-10-26-auditoria-estado-y-deploy.md) | Inventario de endpoints, brechas funcionales y checklist verificable de preparación para despliegue. |
| 018 | [Health check con disponibilidad de base de datos](./plataforma-y-documentacion/2026-10-26-health-check-db.md) | Separa proceso vivo de readiness y comprueba PostgreSQL para configurar Railway. |
| 019 | [Listado de cuentas del usuario](./cuentas-y-wallet/2026-10-26-listado-cuentas-usuario.md) | Permite descubrir las cuentas activas y sus saldos mediante la sesión autenticada. |
| 020 | [Historial paginado de transactions](./ledger-y-transacciones/2026-10-26-transactions-historial-paginado.md) | Añade actividad reciente con paginación, filtros y aislamiento por titular. |
| 021 | [Retiro desde cuenta](./cuentas-y-wallet/2026-10-26-retiro-cuenta.md) | Registra retiros autenticados con saldo suficiente, serialización por wallet e idempotencia. |
| 022 | [Configuración de Neon para Codex](./plataforma-y-documentacion/2026-10-27-configuracion-neon-codex.md) | Verifica la skill existente y configura el MCP oficial de Neon mediante OAuth para Codex. |
| 023 | [Conectar el backend a Neon](./plataforma-y-documentacion/2026-10-27-conexion-backend-neon.md) | Hace que el pool de PostgreSQL use `DATABASE_URL` de Neon, manteniendo el modo local con `DB_*`. |
| 024 | [Revisión completa del proyecto](./plataforma-y-documentacion/2026-10-27-revision-completa-proyecto.md) | Auditoría estática de arquitectura, endpoints, seguridad, base de datos y documentación; actualiza el estado real del proyecto. |
| 025 | [Mínimo funcional de autenticación](./autenticacion/2026-10-27-minimo-funcional-auth-front-back.md) | Cambios 4, 6 y 8: migración 008, `POST /auth/register` y front contra el contrato mínimo. Depende del spec 026 para el login. | 
| 026 | [Contrato de sesión y login `{ token, user }`](./autenticacion/2026-10-27-contrato-sesion-login.md) | Implementa D1: `toAuthUser`, `createSessionForUser` y login `{ token, user }`. Requiere la migración 008 del spec 025. | 
| 027 | [Migración 008 de perfil y acceso Google](./autenticacion/2026-10-27-migracion-008-perfil-acceso-google.md) | Aplica al inicializador y documenta la migración de perfil, roles y método de acceso; completa los datos de perfil de los seeds demo. |
| 028 | [Registro transaccional con `POST /auth/register`](./autenticacion/2026-10-27-registro-auth-register-f8.md) | Extrae el cambio 6/F8 del spec 025: crea usuario, wallet, cuenta y sesión en una transacción; conserva `/users` legado. Depende de los specs 026 y 027. |
| 029 | [Transferencias entre usuarios y actividad de la wallet (backend)](./cuentas-y-wallet/2026-10-27-transferencias-y-actividad-wallet.md) | Etapa 1 del contrato de transacciones: transferencias con conversión a la moneda principal del receptor, lookup de destinatario y feed. Mantiene `GET /accounts` para saldos y agrega `transactions.type` (migración 009). La adaptación del front está en `~/.opencode/plan/2026-10-27-Transferencias-y-actividad-wallet-front.md`. |
| 030 | [Depósitos y cambio de moneda](./cuentas-y-wallet/2026-10-27-depositos-y-cambio-de-moneda.md) | Etapa 2: `POST /wallet/deposits`, cotización y ejecución de cambios con `exchange_quotes` (migración 011; el spec original decía 010, renumerada en el spec 039). Depende del spec 029. |
| 031 | [Cierre del mínimo funcional del backend](./plataforma-y-documentacion/2026-10-28-minimo-funcional-backend.md) | Cierra brechas backend, añade Blueprint para Render y contempla Neon como PostgreSQL; CORS y credenciales se configuran en el entorno para habilitar la integración con el frontend. |
| 032 | [Cierre de la integración frontend-backend en Render](./plataforma-y-documentacion/2026-10-29-cierre-integracion-frontend-render.md) | Ajusta el Blueprint al plan gratuito, documenta CORS para localhost y Vercel, permite `Idempotency-Key` y añade `wallet_id` al saldo. Depende del contrato del informe `docs/9j3sbfdn.md` y de los specs 029–031. |
| 033 | [Configuración de entorno y lectura de dotenv](./plataforma-y-documentacion/2026-10-29-configuracion-env-y-lectura-dotenv.md) | Quitar el `import 'dotenv/config';` duplicado de los dos scripts de `db/`. `src/config/env.ts` se mantiene sin cambios funcionales como el único módulo que carga el archivo `.env`, lee `process.env`, valida y exporta `env`. Los scripts obtienen la configuración mediante `getClientConfig()`, que depende de `env`. |
| 034 | [Archivos .env por escenario](./plataforma-y-documentacion/2026-10-29-archivos-env-escenarios.md) | Crear un archivo `.env` por escenario con el contenido definido en el plan y ajustar el `.gitignore` para que ningún archivo de entorno quede versionado, conservando `.env.example` como plantilla versionada. |
| 035 | [Reorganización de tests en `src/tests`](./plataforma-y-documentacion/2026-10-29-reorganizacion-tests-src.md) | Mueve los 16 tests a `src/tests/` agrupados por el módulo que prueban (`AppError` queda en `utils/`), actualiza imports, mocks e imports dinámicos, y limita el descubrimiento de Vitest a la nueva carpeta. |
| 036 | [Recuperación de contraseña entre front y back](./autenticacion/2026-10-29-recuperacion-contrasena.md) | Conecta `/recuperar-contrasena` con `POST /auth/forgot-password` y `POST /auth/reset-password`, tokens de un uso y proveedor de email. Depende de los specs 025–028. |
| 037 | [Pantalla de cambio de contraseña y fin del bloqueo por 403](./autenticacion/2026-10-29-cambio-contrasena-front.md) | Agrega `password_change_required` al login, la ruta protegida `/cambiar-contrasena` y códigos de error del cambio. Revisa una decisión del spec 026. |
| 038 | [Acceso con Google y completar perfil](./autenticacion/2026-10-29-acceso-google-y-perfil.md) | Implementa `POST /auth/google` con Firebase Admin y `PATCH /users/me`; enciende la bandera del front. Depende de la migración 008 y del spec 037. |
| 039 | [Depósitos y cambios de moneda (implementación)](./cuentas-y-wallet/2026-10-29-depositos-y-cambios-implementacion.md) | Implementa las tres rutas que el front ya llama: `POST /wallet/deposits`, `GET /wallet/exchange/quote` y `POST /wallet/exchanges`. Reutiliza `recordIncomingConversion`, agrega `exchange_quotes` (migración 011) y completa el feed. Ajusta el front: `TRANSACTIONS_ENABLED`, normalización de `balances` y códigos de error. Ejecuta el spec 030 sin editarlo. |
| 040 | [Script de desarrollo con recarga automática](./plataforma-y-documentacion/2026-10-30-script-desarrollo-watch.md) | Agrega `npm run dev` con `tsx watch src/index.ts` y documenta el flujo de desarrollo frente a la validación con `npm run build && npm start`. |
| 041 | [Actualizar Swagger con la estructura actual](./plataforma-y-documentacion/2026-10-30-swagger-estructura-actual.md) | Alinea `src/config/swagger.ts` con los routers montados: corrige `/accounts/{id}/incoming`, agrega `tags`/`servers`, usa `ErrorResponse` y documenta los filtros de actividad. |

Los órdenes 014–016 reflejan la secuencia documental del historial, no una
afirmación de que sus diseños sean todos compatibles entre sí. Antes de
implementar cambios de wallet, comprobar si un spec posterior reemplaza o
extiende la decisión anterior y actualizar esta nota si el equipo decide otro
orden. No renumerar los identificadores ya publicados.

