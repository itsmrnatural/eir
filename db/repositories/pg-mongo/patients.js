import { AppError } from '../../lib/errors.js';
import { isUuid, normalizePhone, normalizeRfid } from '../../lib/ids.js';
import {
  validateNewStudent, validateNewNonStudent, validatePatientPatch, checkLimit,
} from '../../lib/validation.js';
import { toPatientView, todayIst } from '../../lib/domain.js';
import { withTx, mapPgError, escapeLike } from './pg-helpers.js';

// One column list, one view: patient_with_age (schema.sql) does the joins and computes age.
// DATE columns are cast to TEXT so the pg driver never turns them into JS Dates (timezone bugs).
const VIEW_COLS = `v.patient_id, v.patient_type, v.name, v.sex, v.dob::TEXT AS dob, v.age, v.age_is_estimated,
  v.age_at_registration, v.registered_on::TEXT AS registered_on, v.roll_no, v.batch_year, v.program,
  v.branch_id, v.branch_code, v.branch_name, v.phone_no, v.designation, v.rfid_id`;
const SELECT_VIEW = `SELECT ${VIEW_COLS} FROM patient_with_age v`;

const readView = async (db, patientId) => {
  const res = await db.query(`${SELECT_VIEW} WHERE v.patient_id = $1`, [patientId]);
  return res.rows[0] ? toPatientView(res.rows[0]) : null;
};

/** RFID tap: one round trip. $1 = normalised rfid_id. Exported so scripts/explain.js can EXPLAIN the real statement. */
export const FIND_BY_RFID_SQL = `SELECT r.is_active, ${VIEW_COLS}
           FROM student_rfid r
           LEFT JOIN patient_with_age v ON v.roll_no = r.roll_no
          WHERE r.rfid_id = $1`;

/** Desk search. $1 = %text%  $2 = %phone digits%  $3 = text  $4 = text%  $5 = limit */
export const SEARCH_SQL = `${SELECT_VIEW}
          WHERE v.patient_id IN (
                  SELECT p.patient_id FROM patient p WHERE LOWER(p.name) LIKE $1
                  UNION
                  SELECT s.patient_id FROM student s WHERE LOWER(s.roll_no) LIKE $1
                  UNION
                  SELECT n.patient_id FROM non_student n WHERE n.phone_no LIKE $2
                )
          ORDER BY (LOWER(v.name) = $3) DESC, (LOWER(v.name) LIKE $4) DESC, v.name
          LIMIT $5`;

export function createPatientsRepo({ pgPool, clock }) {
  const guard = async (fn) => { try { return await fn(); } catch (err) { throw mapPgError(err); } };

  return {
    findByRfid: (rfid_id) => guard(async () => {
      const key = normalizeRfid(rfid_id);
      // One round trip: the tag row decides NOT_FOUND / INACTIVE, the view row is the answer.
      const res = await pgPool.query(FIND_BY_RFID_SQL, [key]);
      if (res.rows.length === 0) throw new AppError('RFID_NOT_FOUND', 'Card not registered, contact admin', { rfid_id: key });
      if (!res.rows[0].is_active) throw new AppError('RFID_INACTIVE', 'This card has been deactivated, contact admin', { rfid_id: key });
      return toPatientView(res.rows[0]);
    }),

    findByPhone: (phone_no) => guard(async () => {
      const phone = normalizePhone(phone_no);
      const res = await pgPool.query(`${SELECT_VIEW} WHERE v.phone_no = $1 ORDER BY v.name LIMIT 5`, [phone]);
      return res.rows.map(toPatientView);
    }),

    findById: (patient_id) => guard(async () => (isUuid(patient_id) ? readView(pgPool, patient_id.toLowerCase()) : null)),

    search: (q, { limit = 20 } = {}) => guard(async () => {
      const n = checkLimit(limit, 20, 100);
      const text = typeof q === 'string' ? q.trim().toLowerCase() : '';
      if (!text) return [];
      const phoneQ = text.replace(/[\s\-().]/g, '');
      // Three index-friendly sub-selects (trigram GIN indexes) instead of one OR across joined tables.
      const res = await pgPool.query(SEARCH_SQL, [`%${escapeLike(text)}%`, phoneQ ? `%${escapeLike(phoneQ)}%` : null, text, `${escapeLike(text)}%`, n]);
      return res.rows.map(toPatientView);
    }),

    // Used by the import script and tests only (there is no API endpoint).
    createStudent: (input) => guard(async () => {
      const v = validateNewStudent(input, todayIst(clock()));
      return withTx(pgPool, async (c) => {
        const ins = await c.query(
          `INSERT INTO patient (name, dob, sex, patient_type, registered_on)
           VALUES ($1, $2, $3, 'STUDENT', $4) RETURNING patient_id`,
          [v.name, v.dob, v.sex, todayIst(clock())],
        );
        const id = ins.rows[0].patient_id;
        await c.query(
          `INSERT INTO student (patient_id, roll_no, batch_year, program, branch_id) VALUES ($1, $2, $3, $4, $5)`,
          [id, v.roll_no, v.batch_year, v.program, v.branch_id],
        );
        if (v.rfid_id) {
          await c.query(`INSERT INTO student_rfid (rfid_id, roll_no, is_active) VALUES ($1, $2, TRUE)`, [v.rfid_id, v.roll_no]);
        }
        return readView(c, id);
      });
    }),

    createNonStudent: (input) => guard(async () => {
      const v = validateNewNonStudent(input);
      return withTx(pgPool, async (c) => {
        const ins = await c.query(
          `INSERT INTO patient (name, age_at_registration, sex, patient_type, registered_on)
           VALUES ($1, $2, $3, 'NON_STUDENT', $4) RETURNING patient_id`,
          [v.name, v.age, v.sex, todayIst(clock())],
        );
        const id = ins.rows[0].patient_id;
        await c.query(`INSERT INTO non_student (patient_id, phone_no, designation) VALUES ($1, $2, $3)`, [id, v.phone_no, v.designation]);
        return readView(c, id); // the 5-per-phone / duplicate-name triggers fire at COMMIT (deferred)
      });
    }),

    update: (patient_id, patch, actor_user_id) => guard(async () => {
      if (!isUuid(patient_id)) throw new AppError('NOT_FOUND', 'Patient not found', { patient_id });
      const id = patient_id.toLowerCase();
      return withTx(pgPool, async (c) => {
        const locked = await c.query('SELECT patient_type FROM patient WHERE patient_id = $1 FOR UPDATE', [id]);
        if (locked.rows.length === 0) throw new AppError('NOT_FOUND', 'Patient not found', { patient_id });
        const now = clock();
        const p = validatePatientPatch(patch, locked.rows[0].patient_type, todayIst(now));
        const before = await readView(c, id);

        const sets = [];
        const params = [];
        const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
        if ('name' in p) add('name', p.name);
        if ('sex' in p) add('sex', p.sex);
        if ('dob' in p) add('dob', p.dob);
        if ('age' in p) { add('age_at_registration', p.age); add('registered_on', todayIst(now)); }
        if (sets.length > 0) {
          params.push(id);
          await c.query(`UPDATE patient SET ${sets.join(', ')} WHERE patient_id = $${params.length}`, params);
        }

        const nsSets = [];
        const nsParams = [];
        if ('phone_no' in p) { nsParams.push(p.phone_no); nsSets.push(`phone_no = $${nsParams.length}`); }
        if ('designation' in p) { nsParams.push(p.designation); nsSets.push(`designation = $${nsParams.length}`); }
        if (nsSets.length > 0) {
          nsParams.push(id);
          await c.query(`UPDATE non_student SET ${nsSets.join(', ')} WHERE patient_id = $${nsParams.length}`, nsParams);
        }

        const after = await readView(c, id);
        if (JSON.stringify(before) === JSON.stringify(after)) return before; // nothing changed: no audit row
        await c.query(
          `INSERT INTO audit_log (actor_user_id, entity, entity_id, action, before, after)
           VALUES ($1, 'patient', $2, 'UPDATE', $3::JSONB, $4::JSONB)`,
          [actor_user_id ?? null, id, JSON.stringify(before), JSON.stringify(after)],
        );
        return after;
      });
    }),
  };
}

