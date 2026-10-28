// Este módulo crea y configura la aplicación de Express
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { errorHandler } from './middleware/errorHandler.js';
import { AppError } from './utils/AppError.js';
import { accountsRouter } from './routes/accounts.route.js';
import { transactionsRouter } from './routes/transactions.route.js';
import { usersRouter } from './routes/users.route.js';
import { authRouter } from './routes/auth.route.js';
import { walletRouter } from './routes/wallet.route.js';
import swaggerUi from 'swagger-ui-express';
import { openApiSpec } from './config/swagger.js';
import { pool } from './config/db.js';
import { corsMiddleware } from './config/cors.js';

export const app = express();

app.use(corsMiddleware);
app.use(express.json());

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/health/ready', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ok', db: 'ok' });
  } catch {
    res.status(503).json({ status: 'error', db: 'unavailable' });
  }
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

app.use(accountsRouter);
app.use(transactionsRouter);
app.use(usersRouter);
app.use(walletRouter);
app.use(authRouter);

app.use((_req: Request, _res: Response, next: NextFunction) => {
  next(new AppError('Ruta no encontrada', 404));
});

app.use(errorHandler);
