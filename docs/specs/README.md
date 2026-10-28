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

> **Cada cambio que haga la IA debe generar un archivo en `docs/specs/<tema>`.**

## Organización de carpetas

Hay dos formas prácticas de organizar los specs:

1. **Por tema (adoptada):** `autenticacion/`, `cuentas-y-wallet/`, `ledger-y-transacciones/` y `plataforma-y-documentacion/`. Facilita encontrar decisiones relacionadas aunque sean de fechas distintas.
2. **Por fecha:** `YYYY/MM/` o `YYYY/` y luego los archivos fechados. Conserva la secuencia temporal a simple vista, pero separa specs del mismo tema.

Se usa la organización por tema porque este repositorio ya tiene varios cambios relacionados en autenticación, wallet y ledger. El orden histórico se conserva en [`index-specs.md`](./index-specs.md).

```text
docs/specs/
├── README.md
├── index-specs.md
├── _plantilla.md
├── autenticacion/
├── cuentas-y-wallet/
├── ledger-y-transacciones/
└── plataforma-y-documentacion/
```

**Nombre del archivo:** `YYYY-MM-DD-titulo-corto.md`, dentro de la carpeta temática correspondiente.

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
Antes de escribir código:
1. Crea el archivo YYYY-MM-DD-titulo-corto.md en la subcarpeta temática
   correspondiente de docs/specs/, usando docs/specs/_plantilla.md.
2. Asigna el siguiente número correlativo de ejecución consultando el índice
   "Orden de ejecución de los specs" de docs/specs/index-specs.md. Inclúyelo en el
   spec como `Orden de ejecución: NNN` y añade el nuevo spec al final de
   docs/specs/index-specs.md, con el enlace a su subcarpeta.
   No reutilices números ya asignados, aunque un spec esté archivado o superado.
3. El spec debe incluir snippets representativos de código para cada flujo o
   comportamiento principal que cambie. Después de cada snippet, explica en
   lenguaje claro qué ocurre, quién lo ejecuta y qué resultado produce. Usa el
   lenguaje correspondiente (SQL, TypeScript, JSON, etc.); los snippets deben
   aclarar el comportamiento y no ser código de relleno.
4. Muéstrame el spec para que lo apruebe.
5. Cuando lo apruebe, implementa el cambio.
6. Al final, marca los checkboxes de "Cómo probar" que se cumplan.

Vas a hacer el siguiente cambio:


```

## Índice de ejecución

La secuencia histórica y sus relaciones están en [`index-specs.md`](./index-specs.md). Los nuevos specs reciben el siguiente número libre; no renumerar identificadores publicados.

## Flujo resumido

1. **Pides** el cambio.
2. **La IA crea** `docs/specs/<tema>/YYYY-MM-DD-*.md`.
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
