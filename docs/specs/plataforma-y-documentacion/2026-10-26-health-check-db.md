# Spec: Health check con disponibilidad de base de datos

## Fecha
2026-10-26

## Orden de ejecución: 018

## Problema
No existe una ruta de salud para que Railway compruebe el servicio. Un
chequeo que solo confirma que Express responde puede marcar la API disponible
aunque PostgreSQL esté desconectado y las rutas principales no puedan operar.

## Solución propuesta
Agregar `GET /health` como comprobación de proceso y `GET /health/ready` como
comprobación de disponibilidad que también consulta PostgreSQL. Railway deberá
usar `/health/ready`: devuelve `200` cuando la consulta mínima a DB funciona y
`503` si falla. Mantener `/health` independiente de DB permite distinguir un
proceso vivo de uno listo para recibir tráfico. La respuesta de error no
expondrá detalles de conexión ni secretos.

### Flujo 1: proceso vivo

```http
GET /health

HTTP/1.1 200 OK
Content-Type: application/json

{"status":"ok"}
```

El router de Express responde sin consultar PostgreSQL. El proveedor u otro
monitor obtiene `200` mientras el proceso HTTP atienda solicitudes; esto no
garantiza que las operaciones que requieren DB estén disponibles.

### Flujo 2: proceso listo y base de datos accesible

```ts
app.get('/health/ready', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ok', db: 'ok' });
  } catch {
    res.status(503).json({ status: 'error', db: 'unavailable' });
  }
});
```

Express ejecuta la ruta cuando Railway consulta el endpoint. `SELECT 1` pide
una conexión al pool y comprueba que PostgreSQL responde, sin leer tablas. Si
la consulta funciona retorna `200`; si no, retorna `503`, para que Railway
considere la instancia no lista. La respuesta omite el error interno para no
filtrar host, usuario, contraseña ni detalles del proveedor.

### Flujo 3: configuración del health check de Railway

```text
Health check path: /health/ready
Healthy response: HTTP 200
Unhealthy response: HTTP 503
```

La persona que configure Railway indicará `/health/ready` en el servicio. El
proveedor habilitará el enrutamiento cuando tanto la API como PostgreSQL estén
disponibles y dejará de considerarla lista si falla DB. Si se usa `/health`,
Railway comprobará únicamente que el proceso responde.

## Archivos afectados
- src/server.ts
- docs/specs/plataforma-y-documentacion/2026-10-26-health-check-db.md
- docs/specs/README.md
- README.md (instrucción de configuración para Railway, si corresponde)

## Pasos
1. Añadir las rutas de proceso vivo y readiness, usando el pool PostgreSQL
   existente para ejecutar `SELECT 1`.
2. Responder con estados HTTP diferenciados y mensajes genéricos que no
   filtren errores internos.
3. Documentar que Railway debe consultar `/health/ready`.
4. Comprobar respuestas con PostgreSQL accesible y no accesible, además del
   build del proyecto.

## Cómo probar
- [ ] `GET /health` responde `200` sin depender de PostgreSQL.
- [ ] `GET /health/ready` responde `200` cuando `SELECT 1` funciona.
- [ ] `GET /health/ready` responde `503` cuando la consulta a PostgreSQL falla.
- [x] La configuración documentada de Railway usa `/health/ready`.
- [x] `npm run build` finaliza correctamente.

## Riesgos / notas
- Usar readiness con DB implica que una falla temporal de PostgreSQL saca la
  instancia del tráfico aunque el proceso siga vivo; es el comportamiento
  buscado para no enviarle operaciones que requieren DB.
- Este chequeo valida conectividad y capacidad de ejecutar una consulta
  trivial. No valida migraciones, tablas, permisos de cada operación ni
  integridad de datos.
- Un check de DB por sondeo genera una consulta periódica adicional; es una
  operación pequeña y no modifica datos.
