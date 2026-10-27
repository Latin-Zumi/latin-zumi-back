import { NextFunction, Request, RequestHandler, Response } from "express";

type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

export const asyncHandler =
  (fn: AsyncRequestHandler): RequestHandler =>
    (req, res, next) => {
      Promise.resolve(fn(req, res, next)).catch(next);
    };
