// Replace a student's RFID card: deactivate the current tag, activate the new one, write an audit row.
// Tag changes are deliberately a script (rfid_id is not patchable through the API).
import { AppError } from './errors.js';
import { normalizeRfid, assertWritableRfid } from './ids.js';
import { withTx, mapPgError } from '../repositories/pg-mongo/pg-helpers.js';

export async function relinkRfid(pgPool, { roll_no, new_rfid_id, actor_username = null }) {
  const tag = assertWritableRfid(normalizeRfid(new_rfid_id), 'new_rfid_id');
  try {
    return await withTx(pgPool, async (c) => {
      const stu = await c.query('SELECT s.patient_id FROM student s WHERE s.roll_no = $1', [roll_no]);
      if (stu.rows.length === 0) throw new AppError('NOT_FOUND', `no student with roll_no ${roll_no}`, { roll_no });

      let actor = null;
      if (actor_username) {
        const u = await c.query('SELECT user_id FROM users WHERE username = $1', [actor_username]);
        if (u.rows.length === 0) throw new AppError('NOT_FOUND', `no user ${actor_username}`, { actor_username });
        actor = u.rows[0].user_id;
      }

      const existing = await c.query('SELECT roll_no, is_active FROM student_rfid WHERE rfid_id = $1 FOR UPDATE', [tag]);
      if (existing.rows.length > 0 && existing.rows[0].roll_no !== roll_no) {
        throw new AppError('DUPLICATE_PATIENT', `tag ${tag} already belongs to roll_no ${existing.rows[0].roll_no}`, { rfid_id: tag });
      }
      const current = await c.query('SELECT rfid_id FROM student_rfid WHERE roll_no = $1 AND is_active FOR UPDATE', [roll_no]);
      const old = current.rows[0]?.rfid_id ?? null;
      if (old === tag) return { changed: false, old_rfid_id: old, new_rfid_id: tag };

      // deactivate first: the partial unique index allows only one active tag per student
      await c.query('UPDATE student_rfid SET is_active = FALSE WHERE roll_no = $1 AND is_active', [roll_no]);
      if (existing.rows.length > 0) await c.query('UPDATE student_rfid SET is_active = TRUE WHERE rfid_id = $1', [tag]);
      else await c.query('INSERT INTO student_rfid (rfid_id, roll_no, is_active) VALUES ($1, $2, TRUE)', [tag, roll_no]);

      await c.query(
        `INSERT INTO audit_log (actor_user_id, entity, entity_id, action, before, after)
         VALUES ($1, 'student_rfid', $2, 'RELINK', $3::JSONB, $4::JSONB)`,
        [actor, roll_no, JSON.stringify({ rfid_id: old }), JSON.stringify({ rfid_id: tag })],
      );
      return { changed: true, old_rfid_id: old, new_rfid_id: tag };
    });
  } catch (err) {
    throw mapPgError(err);
  }
}
