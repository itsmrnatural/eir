import { randomUUID } from 'node:crypto';
import { AppError } from '../../lib/errors.js';
import { validateVisitCreate, validateVisitPatch } from '../../lib/validation.js';
import { buildVisitDoc, isDuplicateVisit } from '../../lib/domain.js';
import { dateRangeUtc } from '../../lib/time.js';
import { healthIssueLabels } from '../../lib/reference-data.js';
import { mapPgError } from './pg-helpers.js';

const NO_ID = { projection: { _id: 0 } };

function dateFilter(range) {
  const cond = {};
  if (range.start) cond.$gte = range.start;
  if (range.endExclusive) cond.$lt = range.endExclusive;
  return Object.keys(cond).length > 0 ? { date_time: cond } : {};
}

const mongoFailure = (err) => (err instanceof AppError ? err : Object.assign(
  new AppError('INTERNAL', 'Could not save the visit', { mongo_code: err.code }), { cause: err },
));

export function createVisitsRepo({ pgPool, visitsCol, patients, clock, windowMin, fetchViews }) {
  const labels = healthIssueLabels();
  const findById = async (visit_id) => (typeof visit_id === 'string' ? visitsCol.findOne({ visit_id }, NO_ID) : null);

  return {
    async create(input) {
      const v = validateVisitCreate(input, labels);
      const view = await patients.findById(v.patient_id);
      if (!view) throw new AppError('NOT_FOUND', 'Patient not found', { patient_id: v.patient_id });
      const now = clock();
      try {
        if (!v.confirm_duplicate) {
          // Uses the { patient_id: 1, date_time: -1 } index: newest visit of this patient only.
          const last = await visitsCol.find({ patient_id: v.patient_id }, { projection: { _id: 0, date_time: 1 } })
            .sort({ date_time: -1 }).limit(1).next();
          if (last && isDuplicateVisit(last.date_time, now, windowMin)) {
            throw new AppError('DUPLICATE_VISIT_WARNING', 'This patient already has a visit in the last few minutes', {
              last_visit_at: last.date_time.toISOString(),
            });
          }
        }
        const doc = buildVisitDoc({ visitId: randomUUID(), view, input: v, now });
        await visitsCol.insertOne({ ...doc }); // insertOne adds _id to the object it is given, so hand it a copy
        return doc;
      } catch (err) {
        throw mongoFailure(err);
      }
    },

    findById,

    /**
     * Admin correction. The change lives in MongoDB but the audit row lives in PostgreSQL, and there is no
     * distributed transaction between them, so the order is: open PG tx -> insert audit row -> update Mongo
     * -> COMMIT. If Mongo fails the audit row is rolled back; if COMMIT fails Mongo is put back. An edit
     * can therefore never exist without its audit row.
     */
    async update(visit_id, patch, actor_user_id) {
      const before = await findById(visit_id);
      if (!before) throw new AppError('NOT_FOUND', 'Visit not found', { visit_id });
      const p = validateVisitPatch(patch, labels);
      const changed = Object.keys(p).some((k) => p[k] !== before[k]);
      if (!changed) return before;
      const set = { ...p, updated_at: clock() };

      const client = await pgPool.connect();
      let mongoApplied = false;
      try {
        await client.query('BEGIN');
        const after = { ...before, ...set };
        await client.query(
          `INSERT INTO audit_log (actor_user_id, entity, entity_id, action, before, after)
           VALUES ($1, 'visit', $2, 'UPDATE', $3::JSONB, $4::JSONB)`,
          [actor_user_id ?? null, visit_id, JSON.stringify(before), JSON.stringify(after)],
        );
        const updated = await visitsCol.findOneAndUpdate({ visit_id }, { $set: set }, { returnDocument: 'after', ...NO_ID });
        if (!updated) throw new AppError('NOT_FOUND', 'Visit not found', { visit_id });
        mongoApplied = true;
        await client.query('COMMIT');
        return updated;
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch { /* already closed */ }
        if (mongoApplied) {
          const restore = {};
          for (const k of Object.keys(set)) restore[k] = before[k];
          await visitsCol.updateOne({ visit_id }, { $set: restore });
        }
        throw err instanceof AppError ? err : mapPgError(err);
      } finally {
        client.release();
      }
    },

    async listByPatient(patient_id, { from, to } = {}) {
      const range = dateRangeUtc({ from, to });
      return visitsCol.find({ patient_id, ...dateFilter(range) }, NO_ID).sort({ date_time: -1 }).toArray();
    },

    /** -> [{ patient: PatientView, visits: Visit[] }], one entry per patient, visits oldest first. */
    async listForExport({ from, to } = {}) {
      const range = dateRangeUtc({ from, to });
      const docs = await visitsCol.find(dateFilter(range), NO_ID).sort({ date_time: 1 }).toArray();
      const byPatient = new Map();
      for (const d of docs) {
        if (!byPatient.has(d.patient_id)) byPatient.set(d.patient_id, []);
        byPatient.get(d.patient_id).push(d);
      }
      const views = await fetchViews([...byPatient.keys()]); // one SQL round trip: no cross-database join, just app-side stitching
      return views
        .map((patient) => ({ patient, visits: byPatient.get(patient.patient_id) }))
        .sort((a, b) => a.patient.name.localeCompare(b.patient.name) || a.patient.patient_id.localeCompare(b.patient.patient_id));
    },
  };
}
