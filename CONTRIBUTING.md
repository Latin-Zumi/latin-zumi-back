# Contribuir a Latin Zumi · Backend

API Node.js + TypeScript + Express + PostgreSQL. Este documento describe el
flujo mínimo para que un cambio sea aceptable. La arquitectura y los contratos
vigentes están en el [README](./README.md) y en [`docs/specs/`](./docs/specs/).

## Requisitos

- Node.js 24 LTS. `package.json` fija `engines.node: ">=24 <25"` y `.nvmrc`
  contiene `24`.
- PostgreSQL local o una rama de Neon.
- `npm ci` para instalar exactamente lo que declara `package-lock.json`.

## Puesta en marcha

```sh
npm ci
cp .env.example .env    # completar DATABASE_URL o los campos DB_*
npm run db:init
npm run db:seed         # solo en desarrollo: crea datos demo
npm run build && npm start
```

No hay script de servidor en modo watch. Para desarrollo se puede usar
`npx tsx src/index.ts`, pero el build de `tsc` sigue siendo la referencia.

## Flujo de ramas

- `main` es la rama desplegable; `dev` integra el trabajo en curso.
- Las ramas de trabajo usan prefijo por tipo: `feat/...`, `fix/...`, `chore/...`
  o `docs/...`.
- Los cambios entran por Pull Request hacia `dev`. No hacer push directo a
  `main`.
- Mensajes de commit en formato `tipo(alcance): descripción`, por ejemplo
  `feat(auth): add google login` o `fix(cors): allow PATCH`.

## Specs

Todo cambio funcional requiere un spec nuevo en `docs/specs/`.

1. Copiar [`docs/specs/_plantilla.md`](./docs/specs/_plantilla.md).
2. Nombrarlo `YYYY-MM-DD-titulo-corto.md` dentro de la carpeta temática
   (`autenticacion/`, `cuentas-y-wallet/`, `ledger-y-transacciones/`,
   `plataforma-y-documentacion/`).
3. Registrarlo en [`docs/specs/index-specs.md`](./docs/specs/index-specs.md)
   con el siguiente número de orden.
4. No renumerar ni reescribir specs ya publicados. Si una decisión cambia, se
   agrega un spec nuevo que la reemplace o una errata explícita.

## Estilo de código

- TypeScript estricto, módulos ESM. Los imports relativos llevan extensión
  `.js` (`import { pool } from '../config/db.js'`).
- 2 espacios, comillas simples, punto y coma al final de cada sentencia.
- Nombres de archivos en `kebab-case` (`wallet-transactions.service.ts`).
- Comentarios, mensajes de error y documentación en español.
- Mantener la separación `route → middleware → controller → service → PostgreSQL`:
  las rutas no llevan SQL y los controllers no acceden al pool.
- Las consultas SQL siempre son parametrizadas.
- Los montos se manipulan con `utils/decimal.ts`; no usar aritmética de punto
  flotante para dinero.

No hay ESLint ni Prettier configurados. Mientras no se agreguen, respetar el
estilo del archivo que se edita y evitar líneas excesivamente largas.

## Pruebas

```sh
npm test        # vitest run, descubre src/tests/**/*.test.ts
npm run build   # typecheck + emisión a dist/
```

- Los tests viven en `src/tests/` replicando la estructura de `src/`.
- Todo flujo que mueva dinero debe incluir tests de idempotencia, saldo
  insuficiente y aislamiento entre usuarios.
- Los tests actuales mockean el pool con `vi.mock`. Las pruebas de integración
  contra PostgreSQL real todavía son deuda pendiente.
- No dar por buena una suite si `node_modules` está incompleto: ejecutar
  `npm ci` antes.

## Documentación

- Si cambia un contrato HTTP, actualizar en el mismo PR: el controlador,
  `src/config/swagger.ts` y la sección correspondiente del `README.md`.
- `docs/auditoria-estado-proyecto-y-deploy.md` y `docs/tareas.md` reflejan el
  estado real; no marcar un checkbox sin haber ejecutado la verificación.
- Las credenciales van al gestor de secretos del entorno. Nunca commitear
  `.env`, `.env.production` ni claves de proveedores.

## Checklist del Pull Request

- [ ] `npm ci` ejecutado y `npm run build` pasa sin errores.
- [ ] `npm test` pasa completo.
- [ ] El cambio funcional tiene su spec registrado en el índice.
- [ ] Swagger y README actualizados si cambió un contrato.
- [ ] Sin secretos, credenciales ni archivos `.env` en el diff.
- [ ] Sin migraciones nuevas sin numeración consecutiva en `db/migrations/`.
- [ ] `docs/tareas.md` actualizado solo con verificaciones realmente ejecutadas.
