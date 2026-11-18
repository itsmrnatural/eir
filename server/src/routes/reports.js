import { Router } from 'express';
import { asyncHandler } from '../util/http.js';
import { limitedRangeQuery, overTimeQuery, rangeQuery } from '../validation/schemas.js';

export function reportsRouter({ services, auth, validate }) {
  const r = Router();
  const route = (path, schema, fn) =>
    r.get(
      path,
      ...auth.admin,
      validate({ query: schema }),
      asyncHandler(async (req, res) => {
        res.json(await fn(req.valid.query));
      }),
    );

  route('/common-issues', limitedRangeQuery, (q) => services.reports.commonIssues(q));
  route('/peak-hours', rangeQuery, (q) => services.reports.peakHours(q));
  route('/frequent-visitors', limitedRangeQuery, (q) => services.reports.frequentVisitors(q));
  route('/visits-by-branch', rangeQuery, (q) => services.reports.visitsByBranch(q));
  route('/visits-by-batch', rangeQuery, (q) => services.reports.visitsByBatch(q));
  route('/visits-over-time', overTimeQuery, (q) => services.reports.visitsOverTime(q));

  return r;
}
