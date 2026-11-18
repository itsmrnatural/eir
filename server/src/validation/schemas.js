import { z } from 'zod';
import { isRealDate, todayIST } from '../util/dates.js';

/* ---------- reusable fields ---------- */

const SINGLE_LINE = /^[^\u0000-\u001F\u007F]*$/;
const MULTI_LINE = /^[^\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]*$/; // allows \t \n \r

/** Phone numbers: strip all whitespace and a leading +91, then require exactly 10 digits. */
export const normalizePhone = (s) => {
  const t = s.replace(/\s+/g, '');
  return t.startsWith('+91') ? t.slice(3) : t;
};

const text = (max, { multiline = false } = {}) =>
  z
    .string()
    .trim()
    .min(1, 'must not be empty')
    .max(max, `must be at most ${max} characters`)
    .regex(multiline ? MULTI_LINE : SINGLE_LINE, 'contains invalid characters');

export const nameField = text(200);
export const sexField = z.enum(['M', 'F', 'Other']);
export const designationField = z.enum(['STAFF', 'FACULTY', 'WORKER', 'OTHER']);
export const ageField = z.number().int().min(0).max(120);
export const phoneField = z
  .string()
  .transform(normalizePhone)
  .pipe(z.string().regex(/^\d{10}$/, 'must be a 10-digit phone number'));
export const dobField = z
  .string()
  .refine(isRealDate, 'must be a valid date in YYYY-MM-DD format')
  .refine((s) => s >= '1900-01-01' && s <= todayIST(), 'must be between 1900-01-01 and today');
export const uuidField = z.string().uuid('must be a UUID');
const ymdField = z.string().refine(isRealDate, 'must be a valid date in YYYY-MM-DD format');
const limitField = (def, max = 100) => z.coerce.number().int().min(1).max(max).default(def);

const nonEmptyObject = (o) => Object.keys(o).length > 0;
const rangeOrdered = (v) => !v.from || !v.to || v.from <= v.to;
const withRangeCheck = (schema) =>
  schema.refine(rangeOrdered, { message: 'from must not be after to', path: ['from'] });
const rangeShape = { from: ymdField.optional(), to: ymdField.optional() };

/* ---------- params ---------- */

export const idParams = z.object({ id: uuidField });
export const rfidParams = z.object({ rfid_id: z.string().trim().min(1).max(64) });
export const phoneParams = z.object({ phone_no: phoneField });

/* ---------- bodies (strict: unknown keys such as date_time, recorded_by, roll_no,
   rfid_id, patient_type are rejected with VALIDATION_ERROR) ---------- */

export const loginBody = z
  .object({
    username: z.string().trim().min(1).max(100),
    password: z.string().min(1).max(200),
  })
  .strict();

export const nonStudentBody = z
  .object({
    name: nameField,
    age: ageField,
    sex: sexField,
    phone_no: phoneField,
    designation: designationField,
  })
  .strict();

export const patientPatchBody = z
  .object({
    name: nameField.optional(),
    sex: sexField.optional(),
    dob: dobField.optional(),
    age: ageField.optional(),
    phone_no: phoneField.optional(),
    designation: designationField.optional(),
  })
  .strict()
  .refine(nonEmptyObject, 'at least one field is required');

export const visitCreateBody = z
  .object({
    patient_id: uuidField,
    health_issue: text(200, { multiline: true }),
    health_issue_is_custom: z.boolean(),
    remedy: text(500, { multiline: true }),
    confirm_duplicate: z.boolean().optional(),
  })
  .strict();

export const visitPatchBody = z
  .object({
    health_issue: text(200, { multiline: true }).optional(),
    remedy: text(500, { multiline: true }).optional(),
  })
  .strict()
  .refine(nonEmptyObject, 'at least one field is required');

/* ---------- queries (unknown query params are ignored) ---------- */

export const searchQuery = z.object({
  q: z.string().trim().min(1, 'must not be empty').max(100),
  limit: limitField(20),
});

export const rangeQuery = withRangeCheck(z.object(rangeShape));
export const limitedRangeQuery = withRangeCheck(z.object({ ...rangeShape, limit: limitField(10) }));
export const overTimeQuery = withRangeCheck(
  z.object({ ...rangeShape, bucket: z.enum(['day', 'week', 'month']).default('day') }),
);
