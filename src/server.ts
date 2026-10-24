import express from "express";
import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "./middleware/errorHandler.js";
import { AppError } from "./utils/AppError.js";
import { accountsRouter } from "./routes/accounts.route.js";
import legacyAccountsRouter from "./routes/accounts.routes.js";
import transactionsRouter from "./routes/transactions.routes.js";
import swaggerUi from "swagger-ui-express";
import { openApiSpec } from "./config/swagger.js";

export const app = express();

app.use(express.json());

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));

app.use(accountsRouter);
app.use("/accounts", legacyAccountsRouter);
app.use("/transactions", transactionsRouter);

app.use((_req: Request, _res: Response, next: NextFunction) => {
  next(new AppError("Ruta no encontrada", 404));
});

app.use(errorHandler);
