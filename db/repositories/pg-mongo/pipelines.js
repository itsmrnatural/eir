// MongoDB aggregation pipelines for the admin reports.
//
// Why these run on Mongo alone: every visit carries a denormalised `snapshot` of the patient,
// so no report needs a join with PostgreSQL.
//
// Conventions used by every pipeline below
//   $match  first    -> lets MongoDB use the { date_time: 1 } index to cut the working set
//   timezone "Asia/Kolkata" on every date operator -> "peak hour" and "day" mean IST, not UTC
//   $project last    -> rename the _id produced by $group into the field names the API promises
import { IST_TZ } from '../../lib/time.js';

/** Optional { date_time: { $gte, $lt } } filter. `range` is the half-open UTC range from dateRangeUtc(). */
export function matchRange({ start, endExclusive }) {
  const cond = {};
  if (start) cond.$gte = start;
  if (endExclusive) cond.$lt = endExclusive;
  return Object.keys(cond).length > 0 ? [{ $match: { date_time: cond } }] : [];
}

/** Most common health issues -> [{ health_issue, count }] */
export function commonIssues(range, limit) {
  return [
    ...matchRange(range),
    { $group: { _id: '$health_issue', count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } }, // ties: alphabetical, so the output is stable
    { $limit: limit },
    { $project: { _id: 0, health_issue: '$_id', count: 1 } },
  ];
}

/**
 * Visits per day / week / month -> [{ bucket, count }]
 * $dateTrunc rounds each timestamp down to the start of its IST day/week/month; weeks start on Monday.
 * Labels: day = 'YYYY-MM-DD', week = 'YYYY-MM-DD' of that Monday, month = 'YYYY-MM'.
 * Only buckets that have visits are returned: no zero-filling.
 */
export function visitsOverTime(range, bucket) {
  const trunc = { date: '$date_time', unit: bucket, timezone: IST_TZ };
  if (bucket === 'week') trunc.startOfWeek = 'monday';
  const format = bucket === 'month' ? '%Y-%m' : '%Y-%m-%d';
  return [
    ...matchRange(range),
    { $group: { _id: { $dateTrunc: trunc }, count: { $sum: 1 } } },
    { $project: { _id: 0, bucket: { $dateToString: { format, date: '$_id', timezone: IST_TZ } }, count: 1 } },
    { $sort: { bucket: 1 } },
  ];
}

/** Visits by hour of day in IST (0-23) -> [{ hour, count }] hours with visits only (the client pads to 24). */
export function peakHours(range) {
  return [
    ...matchRange(range),
    { $group: { _id: { $hour: { date: '$date_time', timezone: IST_TZ } }, count: { $sum: 1 } } },
    { $project: { _id: 0, hour: '$_id', count: 1 } },
    { $sort: { hour: 1 } },
  ];
}

/**
 * Most frequent visitors -> [{ patient_id, name, patient_type, count }]
 * Sorting newest-first before $group means $first picks the name from the patient's most recent visit.
 */
export function frequentVisitors(range, limit) {
  return [
    ...matchRange(range),
    { $sort: { date_time: -1 } },
    { $group: { _id: '$patient_id', name: { $first: '$snapshot.name' }, patient_type: { $first: '$patient_type' }, count: { $sum: 1 } } },
    { $sort: { count: -1, name: 1 } },
    { $limit: limit },
    { $project: { _id: 0, patient_id: '$_id', name: 1, patient_type: 1, count: 1 } },
  ];
}

/** Visits by branch (students only - non-students have no branch) -> [{ branch_id, branch_name, count }] */
export function visitsByBranch(range) {
  return [
    ...matchRange(range),
    { $match: { patient_type: 'STUDENT' } },
    { $sort: { date_time: -1 } },
    { $group: { _id: '$snapshot.branch_id', branch_name: { $first: '$snapshot.branch_name' }, count: { $sum: 1 } } },
    { $sort: { count: -1, branch_name: 1 } },
    { $project: { _id: 0, branch_id: '$_id', branch_name: 1, count: 1 } },
  ];
}

/** Visits by admission batch (students only) -> [{ batch_year, count }] oldest batch first */
export function visitsByBatch(range) {
  return [
    ...matchRange(range),
    { $match: { patient_type: 'STUDENT' } },
    { $group: { _id: '$snapshot.batch_year', count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, batch_year: '$_id', count: 1 } },
  ];
}
