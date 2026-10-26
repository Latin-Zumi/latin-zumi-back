// Este módulo crea y configura la aplicación de Express
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { errorHandler } from './middleware/errorHandler.js';
import { AppError } from './utils/AppError.js';
import { accountsRouter } from './routes/accounts.route.js';
import { transactionsRouter } from './routes/transactions.route.js';
import { usersRouter } from './routes/users.route.js';
import { authRouter } from './routes/auth.route.js';
import swaggerUi from 'swagger-ui-express';
import { openApiSpec } from './config/swagger.js';

export const app = express();

app.use(express.json());

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

app.use(accountsRouter);
app.use(transactionsRouter);
app.use(usersRouter);
app.use(authRouter);

app.use((_req: Request, _res: Response, next: NextFunction) => {
  next(new AppError('Ruta no encontrada', 404));
});

app.use(errorHandler);
