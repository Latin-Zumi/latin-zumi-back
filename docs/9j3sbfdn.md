---
title: "Pedido front para integrar back"
created: 2026-10-29 09:24
tags: code proyectoFM5
---

# Lo que cambió:

1. Login: manda { identifier, password }, como pide el backend.
Sesión: antes de guardarla se valida que la respuesta tenga { token, user }.
Mensajes de error: salen del status HTTP: 400, 401, 409, 429, y error de red o 5xx.
Logout: llama a POST /auth/logout y borra la sesión local siempre, aunque falle la red.

2. Saldos: vienen de GET /accounts y se muestran también los saldos en "0".
Con 401 se cierra la sesión y te manda a /login.
Con 403 se muestra el mensaje sin cerrar la sesión.
Ids: pasan a ser string (UUID), y Balance ahora tiene account_id y wallet_id.
Contraseña del registro: de 15 a 128 caracteres. En el login solo se exige un máximo de 128.

3. Flags nuevas en src/config/features.ts:
GOOGLE_AUTH_ENABLED = false: oculta el botón de Google y la ruta /completar-perfil. Los componentes siguen en el código para cuando el backend lo implemente.

4. TRANSACTIONS_ENABLED, que vale lo mismo que VITE_USE_MOCK: con la API real no se piden movimientos y no aparecen Depositar, Cambiar ni Transferir, porque esos endpoints todavía no existen. En modo mock todo sigue como antes.
.env.example: ahora trae VITE_USE_MOCK=false.
Spec: 2026-10-28-Minimo-funcional-API-real.md.

## Probado

- Cómo lo probé: no hay backend corriendo en tu máquina, así que levanté la app en modo API real y simulé las respuestas del contrato del documento.

- Registro: con una contraseña de 8 caracteres la rechaza sin llamar al backend. Con una válida, POST /auth/register lleva al Dashboard con “COP 0”.
- Lo gout: llama a POST /auth/logout con el token y lleva a /login.
- Login: con contraseña incorrecta muestra “Email o contraseña incorrectos.” Con la correcta manda identifier.
- Errores: 403, 401, 429 y la caída del servidor se comportan como pide el documento.
- Modo mock: login, saldos, depósito y logout siguen andando.

## Dos decisiones que tomé:

- Mensaje de contraseña: el documento pide “La contraseña debe tener entre 15 y 128 caracteres”. Dejé el mensaje genérico que ustedes eligieron, y la lista de requisitos muestra “Entre 15 y 128 caracteres (faltan N)”.
- Mayúscula y carácter especial: el backend no los exige, pero los dejé porque los había pedido tu equipo. Si los quieren sacar, es un cambio en getPasswordRequirements.

## Falta para cerrar el mínimo:

> Lado backend:

commitear y desplegar sus cambios;
cargar CORS_ORIGINS con http://localhost:5173 y el dominio de Vercel.
Lado Vercel:
poner VITE_USE_MOCK=false y VITE_API_URL con la URL pública del backend;
hacer redeploy.
Prueba final: con eso listo, probar el flujo completo contra el backend real. Es el único ítem de la spec que quedó sin marcar.

Si querés seguir usando el mock en local: tu .env todavía tiene VITE_USE_MOCK=true. Las cuentas de prueba siguen funcionando para el login, pero para registrar una cuenta nueva ahora hace falta una contraseña de 15 caracteres o más.
