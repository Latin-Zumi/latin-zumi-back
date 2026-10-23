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
  console.log(err);

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "JSON inválido en el body" });
  }

  if (err.code === "23505") {
    return res
      .status(400)
      .json({ error: "El valor ya existe (violación de unicidad)" });
  }

  if (err.code === "23503") {
    return res.status(400).json({ error: "Referencia inválida (foreign key)" });
  }

  res.status(500).json({ error: "Error interno del servidor" });
}