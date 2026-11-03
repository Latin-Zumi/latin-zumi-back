import { Router } from 'express';
import { asyncHandler } from '../handlers/asyncHandler.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { getAuthContext } from '../middleware/requireAuth.js';
import { getAdminMetrics, getAdminSettings, getAdminUser, getSettingsHistory, listAdminUsers, patchAdminSettings, setAdminUserState } from '../services/admin.service.js';

export const adminRouter = Router();
adminRouter.use('/admin', asyncHandler(requireAuth), asyncHandler(async(req,res,next)=>requireAdmin(req,res,next)));
adminRouter.get('/admin/metrics', asyncHandler(async(req,res)=>res.json({data:await getAdminMetrics(req.query.period)})));
adminRouter.get('/admin/settings', asyncHandler(async(_req,res)=>res.json({data:await getAdminSettings()})));
adminRouter.patch('/admin/settings', asyncHandler(async(req,res)=>res.json({data:await patchAdminSettings(getAuthContext(req).userId,req.body ?? {})})));
adminRouter.get('/admin/settings/history', asyncHandler(async(req,res)=>res.json({data:await getSettingsHistory(req.query)})));
adminRouter.get('/admin/users', asyncHandler(async(req,res)=>res.json({data:await listAdminUsers(req.query)})));
adminRouter.get('/admin/users/:id', asyncHandler(async(req,res)=>res.json({data:await getAdminUser(String(req.params.id))})));
adminRouter.patch('/admin/users/:id', asyncHandler(async(req,res)=>res.json({data:{user:await setAdminUserState(String(req.params.id),req.body?.estado,getAuthContext(req).userId)}})));
