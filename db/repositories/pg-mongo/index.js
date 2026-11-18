// PostgreSQL (identity) + MongoDB (visits) implementation of the repository interface.
// The caller owns the connections:  createRepositories({ pgPool, mongoDb })
//   pgPool  - a `pg` Pool (anything with .query() and .connect())
//   mongoDb - a MongoDB driver `Db` for database health_centre
// Optional test-only options: { clock: () => Date, duplicateWindowMin }.
import { duplicateWindowMin as resolveWindow } from '../../lib/domain.js';
import { createPatientsRepo } from './patients.js';
import { createVisitsRepo } from './visits.js';
import { createReportsRepo } from './reports.js';
import { createUsersRepo, createMetaRepo } from './users-meta.js';
import { toPatientView } from '../../lib/domain.js';

export const VISITS_COLLECTION = 'visits';

export function createRepositories({ pgPool, mongoDb, clock = () => new Date(), duplicateWindowMin } = {}) {
  if (!pgPool || typeof pgPool.query !== 'function' || typeof pgPool.connect !== 'function') {
    throw new TypeError('createRepositories: pgPool must be a pg Pool');
  }
  if (!mongoDb || typeof mongoDb.collection !== 'function') {
    throw new TypeError('createRepositories: mongoDb must be a MongoDB Db');
  }
  const visitsCol = mongoDb.collection(VISITS_COLLECTION);
  const patients = createPatientsRepo({ pgPool, clock });

  // Bulk lookup for FHIR export: all views in one query.
  const fetchViews = async (ids) => {
    if (ids.length === 0) return [];
    const res = await pgPool.query(
      `SELECT v.patient_id, v.patient_type, v.name, v.sex, v.dob::TEXT AS dob, v.age, v.age_is_estimated,
              v.age_at_registration, v.registered_on::TEXT AS registered_on, v.roll_no, v.batch_year, v.program,
              v.branch_id, v.branch_code, v.branch_name, v.phone_no, v.designation, v.rfid_id
         FROM patient_with_age v
        WHERE v.patient_id = ANY($1::UUID[])`,
      [ids],
    );
    return res.rows.map(toPatientView);
  };

  return {
    patients,
    visits: createVisitsRepo({ pgPool, visitsCol, patients, clock, windowMin: resolveWindow(duplicateWindowMin), fetchViews }),
    reports: createReportsRepo({ visitsCol }),
    users: createUsersRepo({ pgPool }),
    meta: createMetaRepo({ pgPool }),
  };
}
