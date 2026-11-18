import { Router } from 'express';
import { asyncHandler } from '../util/http.js';
import { idParams, visitCreateBody, visitPatchBody } from '../validation/schemas.js';

// No delete route: visits are never deleted, and there are no other verbs.
export function visitsRouter({ services, auth, validate }) {
  const r = Router();

  r.post(
    '/',
    ...auth.staff,
    validate({ body: visitCreateBody }),
    asyncHandler(async (req, res) => {
      res.status(201).json(await services.visits.create(req.valid.body, req.user));
    }),
  );

  r.patch(
    '/:id',
    ...auth.admin,
    validate({ params: idParams, body: visitPatchBody }),
    asyncHandler(async (req, res) => {
      res.json(await services.visits.update(req.valid.params.id, req.valid.body, req.user));
    }),
  );

  return r;
}
