//centralizar errores

import { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/AppError.js";

interface ExtendedError extends Error {
  type?: string;
  code?: string;
}

export function errorHandler(
  err: ExtendedError,
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const pathname = req.originalUrl.split("?")[0];

  let status = 500;
  let code = err.code ?? "ERROR";

  if (err instanceof AppError) {
    status = err.statusCode;
    code = err.code;
  } else if (err.type === "entity.parse.failed") {
    status = 400;
    code = "INVALID_JSON";
  } else if (err.type === "entity.too.large") {
    status = 413;
    code = "PAYLOAD_TOO_LARGE";
  } else if (err.code === "23505") {
    status = 400;
    code = "DUPLICATE_VALUE";
  } else if (err.code === "23503") {
    status = 400;
    code = "INVALID_REFERENCE";
  }

  if (status >= 500) {
    console.error(`[${status}] ${req.method} ${pathname}`, err);
  } else {
    console.warn(`[${status}] ${code} ${req.method} ${pathname}`);
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ code: err.code, message: err.message });
  }

  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ code: 'INVALID_JSON', message: "JSON inválido en el body" });
  }

  if (err.type === "entity.too.large") {
    return res.status(413).json({
      code: 'PAYLOAD_TOO_LARGE',
      message: "El cuerpo de la solicitud supera el límite permitido de 100 KB",
    });
  }

  if (err.code === "23505") {
    return res.status(400).json({ code: 'DUPLICATE_VALUE', message: "El valor ya existe (violación de unicidad)" });
  }

  if (err.code === "23503") {
    return res.status(400).json({ code: 'INVALID_REFERENCE', message: "Referencia inválida (foreign key)" });
  }

  res.status(500).json({ code: 'INTERNAL_ERROR', message: "Error interno del servidor" });
}
