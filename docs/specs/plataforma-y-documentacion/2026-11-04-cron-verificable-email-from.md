# Spec: cron verificable y remitente de email

## Fecha
2026-11-04

## Orden de ejecución: 050

## Problema

El proceso de intereses existe en `POST /internal/accrue-interest`, pero no hay
un scheduler versionado ni una forma de dispararlo sin conocer el secreto. El
frontend no puede comprobar una respuesta `200` con `processed_days`.

Además, el default de `EMAIL_FROM` es `Latin Zumi latinzumi@proton.me`, un
formato sin `<...>` que Resend puede rechazar. El resto de la documentación usa
`Latin Zumi <no-reply@latinzumi.com>`.

## Solución propuesta

- Corregir el default de `EMAIL_FROM` en `src/config/env.ts`.
- Agregar `npm run interest:run`, un cliente HTTP que llama al endpoint interno,
  imprime `HTTP <status>` y el body, y falla si el status no es `200`.
- Agregar un workflow de GitHub Actions con `schedule` diario y
  `workflow_dispatch` para disparar el proceso desde la pestaña Actions.
- Documentar los secretos `BACKEND_URL` e `INTERNAL_CRON_SECRET`.

El endpoint y su autenticación no cambian. No se agrega un cron nativo de Render
porque `type: cron` no tiene plan gratuito; el workflow cumple la misma función
sin costo y sin modificar `render.yaml`.

### Cliente verificable

`scripts/run-interest.ts` lee `BACKEND_URL` e `INTERNAL_CRON_SECRET`, exige
`INTEREST_RUN_CONFIRM=yes` y hace un `POST` al endpoint. Imprime el status y el
JSON de respuesta; un status distinto de `200` termina con código 1.

```ts
const response = await fetch(`${baseUrl}/internal/accrue-interest`, {
  method: 'POST',
  headers: { 'X-Internal-Secret': secret },
});
console.log(`HTTP ${response.status}`);
console.log(await response.text());
if (!response.ok) process.exitCode = 1;
```

Quien lo ejecuta ve en el log, por ejemplo, `HTTP 200` y
`{"data":{"processed_days":1,"transactions":2}}`.

### Scheduler

El workflow corre a las 00:10 UTC y acepta ejecución manual. Usa los secretos
del repositorio y la misma confirmación:

```yaml
on:
  schedule:
    - cron: '10 0 * * *'
  workflow_dispatch:
```

Cada ejecución deja el log con el status y `processed_days`. No requiere acceso
al dashboard de Render para probarlo.

## Archivos afectados

- `src/config/env.ts`
- `src/scripts/run-interest.ts` (nuevo)
- `package.json`
- `.github/workflows/accrue-interest.yml` (nuevo)
- `README.md`
- `docs/specs/index-specs.md`

## Pasos

1. Cambiar el default de `EMAIL_FROM` al formato con display name y `<email>`.
2. Crear el cliente `interest:run` con validación de variables y confirmación.
3. Crear el workflow diario y manual.
4. Documentar secretos, comando local y respuesta esperada.

## Cómo probar

- [x] `npm test` pasa, incluido el default de `EMAIL_FROM`.
- [x] `npm run build` compila `src/scripts/run-interest.ts`.
- [ ] Ejecutar el workflow con `BACKEND_URL` e `INTERNAL_CRON_SECRET` y ver
      `HTTP 200` con `processed_days` en el log.
- [ ] Ejecutar `npm run interest:run` sin `INTEREST_RUN_CONFIRM=yes` y comprobar
      que no llama al endpoint.

## Riesgos / notas

- El workflow no se ejecuta hasta cargar los dos secretos del repositorio.
- Disparar el proceso paga intereses pendientes; `INTEREST_RUN_CONFIRM` evita
  ejecuciones accidentales.
- No se modifica `render.yaml` ni se crea un recurso pago.
