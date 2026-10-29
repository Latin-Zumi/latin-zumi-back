# Spec: Configuración de Neon para Codex

## Fecha
2026-10-27

## Orden de ejecución: 022

## Problema
El proyecto necesita que Codex pueda consultar las herramientas de Neon y usar sus instrucciones oficiales. La skill de Neon ya está disponible en el entorno mediante el plugin instalado, pero no había conexión MCP configurada para Codex.

## Solución propuesta
Conservar la skill existente y configurar el MCP oficial de Neon para Codex mediante OAuth. OAuth guarda solo la URL del servidor en la configuración de Codex; la autenticación se solicita cuando se use el MCP. No se requiere añadir credenciales al repositorio ni modificar dependencias de la aplicación.

```bash
neon --version
neon skills status
```

Estos comandos los ejecuta quien prepara el entorno. El primero confirma que está disponible el CLI de Neon; el segundo comprueba skills gestionadas por el CLI en el proyecto. La skill `neon` ya está disponible en el entorno mediante el plugin, aunque no figura en el lock de skills del proyecto.

```bash
neon mcp --oauth --agent codex -y
```

Este comando lo ejecuta quien configura Codex. Registra el servidor MCP oficial `https://mcp.neon.tech/mcp` en la configuración global de Codex usando OAuth. Codex solicita autenticación al usar el servidor; el comando no guarda una clave API en el repositorio.

## Archivos afectados
- docs/specs/plataforma-y-documentacion/2026-10-27-configuracion-neon-codex.md
- docs/specs/README.md
- ~/.codex/config.toml (configuración global de Codex, fuera del repositorio)

## Pasos
1. Comprobar la disponibilidad del CLI y de la skill de Neon.
2. Registrar el MCP oficial de Neon en Codex usando OAuth.
3. Verificar que Codex reconoce el MCP y que el proyecto no contiene claves de Neon.

## Cómo probar
- [x] `neon --version` informa la versión instalada del CLI.
- [x] La configuración MCP confirma `codex installed` y muestra la URL oficial de Neon; solicita autenticación al primer uso.
- [x] La skill `neon` está disponible en el entorno mediante el plugin existente.

## Riesgos / notas
- La carpeta `.codex` del proyecto está montada como solo lectura; por eso el MCP se registró en la configuración global de Codex.
- `neon skills status` no encuentra skills en el lock local. La skill disponible proviene del plugin del entorno y se conservó sin duplicarla.
- La descarga de la skill oficial se realizó desde `https://neon.com/.well-known/agent-skills/neon/SKILL.md` y se siguieron sus instrucciones de instalación.
