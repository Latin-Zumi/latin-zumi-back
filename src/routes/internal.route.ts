import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { env } from '../config/env.js';
import { asyncHandler } from '../handlers/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { accrueInterest } from '../services/interest.service.js';

export const internalRouter = Router();
internalRouter.post('/internal/accrue-interest', asyncHandler(async(req,res)=>{
  const expected=env.INTERNAL_CRON_SECRET ?? '';
  const received=String(req.header('X-Internal-Secret') ?? '');
  const a=Buffer.from(expected), b=Buffer.from(received);
  if (!expected || a.length!==b.length || !timingSafeEqual(a,b)) throw new AppError('No autorizado',401,'UNAUTHORIZED');
  res.json({data:await accrueInterest()});
}));
