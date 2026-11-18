import { AppError, notFound } from '../errors.js';

/** Business rule from the contract: at most 5 registered people per phone number. */
export const MAX_PEOPLE_PER_PHONE = 5;

// Same comparison as the DB rule (phone_no, lower(name)) must be unique.
const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();

const NOT_EDITABLE = {
  STUDENT: ['age', 'phone_no', 'designation'],
  NON_STUDENT: ['dob'],
};

/**
 * Friendly, deterministic pre-checks for the phone rules. The database trigger and unique index
 * remain the authority; if two requests race, its error is mapped to the same codes by the
 * central error handler.
 */
function assertPhoneAllows(others, name, { checkLimit }) {
  if (others.some((p) => sameName(p.name, name))) {
    throw new AppError('DUPLICATE_PATIENT', 'A person with this name is already registered under this phone number');
  }
  if (checkLimit && others.length >= MAX_PEOPLE_PER_PHONE) {
    throw new AppError(
      'PHONE_LIMIT_REACHED',
      `A phone number can have at most ${MAX_PEOPLE_PER_PHONE} registered people`,
      { limit: MAX_PEOPLE_PER_PHONE },
    );
  }
}

export function createPatientService({ repos }) {
  const requirePatient = async (id) => {
    const patient = await repos.patients.findById(id);
    if (!patient) throw notFound('Patient');
    return patient;
  };

  return {
    /** Throws RFID_NOT_FOUND / RFID_INACTIVE (from the repository). */
    getByRfid: (rfid_id) => repos.patients.findByRfid(rfid_id),

    async getByPhone(phone_no) {
      const items = await repos.patients.findByPhone(phone_no);
      return { items, total: items.length };
    },

    async createNonStudent(input) {
      const existing = await repos.patients.findByPhone(input.phone_no);
      assertPhoneAllows(existing, input.name, { checkLimit: true });
      const { name, age, sex, phone_no, designation } = input;
      return repos.patients.createNonStudent({ name, age, sex, phone_no, designation });
    },

    async search(q, limit) {
      const items = await repos.patients.search(q, { limit });
      return { items, total: items.length };
    },

    getById: requirePatient,

    async update(id, patch, actor) {
      const current = await requirePatient(id);

      const notEditable = NOT_EDITABLE[current.patient_type].filter((k) => k in patch);
      if (notEditable.length) {
        throw new AppError(
          'VALIDATION_ERROR',
          `${notEditable.join(', ')} cannot be edited for a ${current.patient_type === 'STUDENT' ? 'student' : 'non-student'}`,
          { fields: notEditable },
        );
      }

      if (current.patient_type === 'NON_STUDENT' && ('phone_no' in patch || 'name' in patch)) {
        const phone = patch.phone_no ?? current.phone_no;
        const name = patch.name ?? current.name;
        const others = (await repos.patients.findByPhone(phone)).filter((p) => p.patient_id !== id);
        assertPhoneAllows(others, name, { checkLimit: phone !== current.phone_no });
      }

      return repos.patients.update(id, patch, actor.user_id);
    },
  };
}
