import { Router } from 'express';
import { asyncHandler } from '../util/http.js';
import {
  idParams,
  nonStudentBody,
  patientPatchBody,
  phoneParams,
  rangeQuery,
  rfidParams,
  searchQuery,
} from '../validation/schemas.js';

export function patientsRouter({ services, auth, validate }) {
  const r = Router();

  // NOTE: the literal /by-rfid, /by-phone and /non-students routes must stay above /:id.

  r.get(
    '/by-rfid/:rfid_id',
    ...auth.staff,
    validate({ params: rfidParams }),
    asyncHandler(async (req, res) => {
      res.json(await services.patients.getByRfid(req.valid.params.rfid_id));
    }),
  );

  r.get(
    '/by-phone/:phone_no',
    ...auth.staff,
    validate({ params: phoneParams }),
    asyncHandler(async (req, res) => {
      res.json(await services.patients.getByPhone(req.valid.params.phone_no));
    }),
  );

  r.post(
    '/non-students',
    ...auth.staff,
    validate({ body: nonStudentBody }),
    asyncHandler(async (req, res) => {
      res.status(201).json(await services.patients.createNonStudent(req.valid.body));
    }),
  );

  r.get(
    '/',
    ...auth.staff,
    validate({ query: searchQuery }),
    asyncHandler(async (req, res) => {
      const { q, limit } = req.valid.query;
      res.json(await services.patients.search(q, limit));
    }),
  );

  r.get(
    '/:id/history',
    ...auth.admin,
    validate({ params: idParams, query: rangeQuery }),
    asyncHandler(async (req, res) => {
      const { from, to } = req.valid.query;
      res.json(await services.visits.history(req.valid.params.id, { from, to }));
    }),
  );

  r.get(
    '/:id',
    ...auth.staff,
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      res.json(await services.patients.getById(req.valid.params.id));
    }),
  );

  r.patch(
    '/:id',
    ...auth.staff,
    validate({ params: idParams, body: patientPatchBody }),
    asyncHandler(async (req, res) => {
      res.json(await services.patients.update(req.valid.params.id, req.valid.body, req.user));
    }),
  );

  return r;
}
