import { Router } from 'express';
import { asyncHandler } from '../util/http.js';
import { idParams, rangeQuery } from '../validation/schemas.js';

const FHIR_JSON = 'application/fhir+json';

export function exportRouter({ services, auth, validate }) {
  const r = Router();

  r.get(
    '/fhir/patients/:id',
    ...auth.admin,
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const bundle = await services.exports.patientBundle(req.valid.params.id);
      res.type(FHIR_JSON).json(bundle);
    }),
  );

  r.get(
    '/fhir/bulk',
    ...auth.admin,
    validate({ query: rangeQuery }),
    asyncHandler(async (req, res) => {
      const { from, to } = req.valid.query;
      res.type(FHIR_JSON).json(await services.exports.bulkBundle({ from, to }));
    }),
  );

  return r;
}
