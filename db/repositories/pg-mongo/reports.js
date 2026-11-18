import { dateRangeUtc } from '../../lib/time.js';
import { checkLimit, checkBucket } from '../../lib/validation.js';
import * as P from './pipelines.js';

// Only buckets and hours that have visits are returned; the client pads peak hours to 24 bars.
export function createReportsRepo({ visitsCol }) {
  const run = (pipeline) => visitsCol.aggregate(pipeline).toArray();
  // async so validation errors surface as rejections, like the in-memory repositories.
  return {
    commonIssues: async ({ from, to, limit } = {}) => run(P.commonIssues(dateRangeUtc({ from, to }), checkLimit(limit, 10, 100))),

    visitsOverTime: async ({ from, to, bucket } = {}) => run(P.visitsOverTime(dateRangeUtc({ from, to }), checkBucket(bucket))),

    peakHours: async ({ from, to } = {}) => run(P.peakHours(dateRangeUtc({ from, to }))),

    frequentVisitors: async ({ from, to, limit } = {}) => run(P.frequentVisitors(dateRangeUtc({ from, to }), checkLimit(limit, 10, 100))),
    visitsByBranch: async ({ from, to } = {}) => run(P.visitsByBranch(dateRangeUtc({ from, to }))),
    visitsByBatch: async ({ from, to } = {}) => run(P.visitsByBatch(dateRangeUtc({ from, to }))),
  };
}
