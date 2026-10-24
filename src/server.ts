// Este módulo crea y configura la aplicación de Express
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { errorHandler } from './middleware/errorHandler.js';
import { AppError } from './utils/AppError.js';
import { accountsRouter } from './routes/accounts.route.js';

export const app = express();

app.use(express.json());

app.use(accountsRouter);

app.use((_req: Request, _res: Response, next: NextFunction) => {
    next(new AppError('Ruta no encontrada', 404));
});

app.use(errorHandler);
