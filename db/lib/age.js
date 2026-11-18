// age is never stored as a current value.
//   students:     full years since dob
//   non-students: age_at_registration + full years since registered_on  (estimated)
// The SQL view patient_with_age implements the same rule with AGE(); keep them in sync.
import { istDateString } from './time.js';

/** Full years from 'YYYY-MM-DD' to 'YYYY-MM-DD' (birthday-style; never below 0). */
export function fullYearsBetween(fromYmd, toYmd) {
  const [fy, fm, fd] = fromYmd.split('-').map(Number);
  const [ty, tm, td] = toYmd.split('-').map(Number);
  let years = ty - fy;
  if (tm < fm || (tm === fm && td < fd)) years -= 1;
  return Math.max(years, 0);
}

/**
 * @param {{patient_type:string, dob?:string, age_at_registration?:number, registered_on?:string}} p
 * @param {Date} at  instant at which to evaluate (its IST calendar day is used)
 * @returns {{age:number, age_is_estimated:boolean}}
 */
export function computeAge(p, at) {
  const today = istDateString(at);
  if (p.patient_type === 'STUDENT') {
    return { age: fullYearsBetween(p.dob, today), age_is_estimated: false };
  }
  return {
    age: p.age_at_registration + fullYearsBetween(p.registered_on, today),
    age_is_estimated: true,
  };
}
