import { AppError } from '../../lib/errors.js';

/** Run fn(client) inside BEGIN/COMMIT on one pooled connection; roll back on any error. */
export async function withTx(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection may already be gone */ }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Translate PostgreSQL errors into contract errors. The custom SQLSTATEs HC001/HC002 are raised by
 * the triggers in schema.sql. Anything unrecognised becomes INTERNAL without leaking SQL text.
 */
export function mapPgError(err) {
  if (err instanceof AppError) return err;
  const detail = { constraint: err.constraint, table: err.table };
  switch (err.code) {
    case 'HC001':
      return new AppError('PHONE_LIMIT_REACHED', 'At most 5 patients can be registered under one phone number', {});
    case 'HC002':
      return new AppError('DUPLICATE_PATIENT', 'This phone number already has a patient with that name', {});
    case '23505': { // unique_violation
      if (err.constraint === 'student_roll_no_key') return new AppError('DUPLICATE_PATIENT', 'A student with this roll number already exists', { field: 'roll_no' });
      if (err.constraint === 'student_rfid_pkey' || err.constraint === 'student_rfid_one_active') {
        return new AppError('DUPLICATE_PATIENT', 'This RFID tag is already assigned', { field: 'rfid_id' });
      }
      if (err.constraint === 'users_username_key') return new AppError('VALIDATION_ERROR', 'username already exists', { field: 'username' });
      return new AppError('DUPLICATE_PATIENT', 'Duplicate record', detail);
    }
    case '23503': // foreign_key_violation
      if (err.constraint === 'student_branch_id_fkey') return new AppError('VALIDATION_ERROR', 'branch_id does not exist', { field: 'branch_id' });
      return new AppError('VALIDATION_ERROR', 'Referenced record does not exist', detail);
    case '23514': // check_violation
      return new AppError('VALIDATION_ERROR', 'A value violates a database check constraint', detail);
    case '22P02': // invalid_text_representation (e.g. malformed uuid)
      return new AppError('VALIDATION_ERROR', 'A value has an invalid format', {});
    default: {
      const wrapped = new AppError('INTERNAL', 'Database error', { pg_code: err.code });
      wrapped.cause = err;
      return wrapped;
    }
  }
}

export const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
