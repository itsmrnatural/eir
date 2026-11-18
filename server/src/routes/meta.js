import { Router } from 'express';
import { asyncHandler } from '../util/http.js';

export function metaRouter({ services, auth }) {
  const r = Router();
  r.get('/branches', ...auth.staff, asyncHandler(async (_req, res) => res.json(await services.meta.listBranches())));
  r.get(
    '/health-issues',
    ...auth.staff,
    asyncHandler(async (_req, res) => res.json(await services.meta.listHealthIssues())),
  );
  return r;
}
