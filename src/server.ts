// Este módulo crea y configura la aplicación de Express
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { errorHandler } from './middleware/error-handler.js';
import { AppError } from './utils/AppError.js';

export const app = express();

app.use(express.json());

// Aquí irán los routers a medida que los vayas creando:
// app.use(walletsRouter);
// app.use(transactionsRouter);

app.use((_req: Request, _res: Response, next: NextFunction) => {
    next(new AppError('Ruta no encontrada', 404));
});

app.use(errorHandler);
