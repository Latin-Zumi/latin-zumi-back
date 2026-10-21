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
2. Muéstrame el spec para que lo apruebe.
3. Cuando lo apruebe, implementa el cambio.
4. Al final, marca los checkboxes de "Cómo probar" que se cumplan.
```

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
