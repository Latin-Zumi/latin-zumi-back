# Spec: Auditoría de estado del proyecto y preparación para deploy

## Fecha
2026-10-26

## Orden de ejecución: 017

## Problema
El proyecto tiene endpoints, migraciones, configuración y guías de ejecución,
pero no existe una lista única y comprobable que indique qué ofrece hoy la
API, qué operaciones faltan según el flujo de wallet documentado y qué pasos
faltan para desplegarla. Esto dificulta decidir si el backend está listo para
integrarse o publicarse.

## Solución propuesta
Crear una auditoría documental del estado actual, basada en el código y las
guías del repositorio. La auditoría incluirá: inventario de endpoints con
método, autenticación y propósito; brechas funcionales clasificadas como
confirmadas o dependientes de requisitos de producto; verificación local de
build, pruebas y base de datos; y una checklist de despliegue con variables,
migraciones, proceso de arranque, health check, TLS, secretos, logging y
proveedor aún por decidir. No se declarará que una ruta “falta” sin relacionar
esa conclusión con una necesidad explícita del producto.

### Flujo 1: inventario y brechas de API

```text
POST /users
POST /auth/login
POST /auth/change-password
POST /auth/logout
GET  /accounts/:id
GET  /accounts/:id/balance
POST /accounts/:id/incoming
GET  /transactions/:id
GET  /api-docs
```

Este inventario se contrastará con routes, controllers y OpenAPI. La persona
que haga la auditoría confirmará qué operaciones existen y qué acceso exigen;
el resultado será una tabla que separa rutas implementadas de capacidades
todavía no cubiertas. Retiros y transferencias, por ejemplo, solo se marcarán
como pendientes si están dentro del alcance del producto.

### Flujo 2: comprobación local reproducible

```sh
npm ci
npm run build
npm test
```

Quien prepare el deploy ejecutará estos comandos desde la raíz. `npm ci`
instala las dependencias del lockfile, `build` comprueba la compilación
TypeScript y `test` reporta el estado de las pruebas existentes. La auditoría
registrará el resultado real de cada comando; no asumirá que compilar equivale
a tener cobertura funcional.

### Flujo 3: configuración y arranque de producción

```dotenv
NODE_ENV=production
PORT=3000
DB_HOST=...
DB_PORT=5432
DB_NAME=...
DB_USER=...
DB_PASSWORD=...
```

El operador del entorno configurará estas variables en el gestor de secretos
del proveedor y no subirá credenciales al repositorio. La aplicación valida
las variables requeridas al iniciar y escucha en `PORT`; la auditoría
comprobará si el proveedor puede ejecutar el comando de build y `npm start`,
conectar a PostgreSQL y aplicar migraciones antes de recibir tráfico.

### Flujo 4: disponibilidad operativa

```http
GET /health
HTTP/1.1 200 OK
Content-Type: application/json

{"status":"ok"}
```

La auditoría verificará si existe una ruta de salud apta para el health check
del proveedor. Si no existe, se documentará como brecha técnica para
implementar con aprobación posterior; el ejemplo define el contrato esperado,
no afirma que la ruta esté disponible hoy. El resultado de la checklist
separará comprobaciones locales de requisitos que solo pueden validarse en el
entorno elegido.

## Archivos afectados
- docs/specs/2026-10-26-auditoria-estado-y-deploy.md
- docs/specs/README.md
- README.md (resultado de auditoría, si se aprueba su publicación ahí)

## Pasos
1. Revisar routes, controllers, OpenAPI y documentación para enumerar los
   endpoints presentes y sus controles de acceso.
2. Relacionar capacidades faltantes con requisitos ya expresados; dejar como
   decisiones pendientes las que requieran definición de producto.
3. Revisar scripts, variables de entorno, migraciones, conexión a PostgreSQL,
   build, pruebas y comando de arranque para preparar una checklist de deploy.
4. Ejecutar las comprobaciones locales y registrar resultados observados,
   distinguiéndolos de verificaciones que requieren un proveedor real.
5. Documentar riesgos, bloqueos y próximos pasos sin desplegar ni modificar
   configuración de servicios externos.

## Cómo probar
- [x] Confirmar el inventario de rutas contra los archivos `src/routes/` y la
  especificación OpenAPI.
- [x] Ejecutar `npm ci`, `npm run build` y `npm test`, y registrar sus
  resultados.
- [x] Verificar el procedimiento de migraciones y configuración contra
  `db/README.md` y `.env.example`.
- [ ] Validar health check, TLS, secretos y arranque en un proveedor de deploy
  elegido.

## Riesgos / notas
- La necesidad de retiros, transferencias, recuperación de contraseña, CORS,
  administración u otros endpoints depende del alcance funcional; no se
  inventarán como requisitos confirmados.
- Railway se toma como proveedor tentativo para la checklist; no se crea ni
  configura un servicio y no se publican secretos. Los detalles de red,
  dominio, TLS, backups, observabilidad y costos deben confirmarse en ese
  entorno.
- La revisión de seguridad previa ya documenta riesgos del modelo; esta
  auditoría debe enlazar hallazgos relacionados en lugar de duplicar sus
  recomendaciones.
