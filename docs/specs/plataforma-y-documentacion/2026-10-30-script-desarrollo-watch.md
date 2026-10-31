# Spec: Script de desarrollo con recarga automática

## Fecha
2026-10-30

## Orden de ejecución:
040

## Problema
El proyecto no tenía un comando de desarrollo. Para levantar la API había que
compilar con `npm run build` y ejecutar `npm start`, o invocar manualmente
`npx tsx src/index.ts` y reiniciar el proceso en cada cambio. Eso alargaba el
ciclo de edición y dejaba el modo watch sin documentar.

## Solución propuesta
Agregar `npm run dev` como `tsx watch src/index.ts`. `tsx` ya es dependencia del
proyecto (lo usan `db:init` y `db:seed`) y ejecuta TypeScript resolviendo los
imports `.js` del código fuente, así que no necesita `dist/` ni un build previo.
El proceso se reinicia solo al guardar archivos.

## Archivos afectados
- `package.json`: nuevo script `dev`.
- `README.md`: sección «Ejecutar la aplicación».
- `CONTRIBUTING.md`: puesta en marcha y validación de producción.
- `docs/auditoria-estado-proyecto-y-deploy.md`: nota de desarrollo local.
- `docs/tareas.md`: tarea marcada.
- `docs/specs/index-specs.md`: alta de este spec.

## Pasos
1. Agregar `"dev": "tsx watch src/index.ts"` a `scripts` en `package.json`.
2. Documentar `npm run dev` como comando de desarrollo y mantener
   `npm run build && npm start` como validación de producción.
3. Verificar arranque y reinicio automático.

## Cómo probar
- [x] `npm run dev` levanta el servidor y `GET /health` responde `200`.
- [x] Guardar un archivo de `src/` reinicia el proceso sin detener el comando.
- [ ] Confirmar en una máquina limpia tras `npm ci`.

## Riesgos / notas
- `tsx watch` no emite `dist/`; para validar el artefacto real usar
  `npm run build && npm start`.
- `tsx` está en `dependencies`, no en `devDependencies`. El script funciona en
  cualquier entorno, pero no debe usarse como `startCommand` del despliegue.
- El modo watch no recarga cambios en `.env`: hay que reiniciar el proceso.
