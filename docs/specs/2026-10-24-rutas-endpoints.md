@'
# Especificación: rutas y endpoints del ledger

Fecha: 2026-10-24

## Objetivo
Exponer endpoints para consultar cuentas, saldos y transacciones del sistema.

## Cuentas

- `GET /accounts`
  Consulta las cuentas registradas.

- `GET /accounts/:id/balance`
  Consulta el saldo de una cuenta identificada por su UUID.
  El identificador debe validarse antes de ejecutar la consulta.

## Transacciones

- `GET /transactions`
  Consulta las transacciones recientes.

- `GET /transactions/:id`
  Consulta una transacción específica junto con sus asientos asociados.

## Manejo de errores

Las rutas deben utilizar el manejador de errores existente.
Los identificadores inválidos y los recursos inexistentes deben gestionarse
mediante las respuestas de error correspondientes.

## Alcance

Esta especificación documenta los endpoints implementados en esta tarea.
No implica que la base de datos compartida esté desplegada o disponible.
'@ | Set-Content -Encoding utf8 docs/specs/2026-10-24-rutas-endpoints.md