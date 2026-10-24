import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { errorHandler } from './middleware/errorHandler.js';
import { AppError } from './utils/AppError.js';
import accountsRouter from './routes/accounts.routes.js';
import transactionsRouter from './routes/transactions.routes.js';

export const app = express();

app.use(express.json());

app.use('/accounts', accountsRouter);
app.use('/transactions', transactionsRouter);

app.use((_req: Request, _res: Response, next: NextFunction) => {
  next(new AppError('Ruta no encontrada', 404));
});

app.use(errorHandler);