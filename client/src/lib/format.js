export const SEX_OPTIONS = [
  { value: 'M', label: 'Male' },
  { value: 'F', label: 'Female' },
  { value: 'Other', label: 'Other' },
];
export const DESIGNATION_OPTIONS = [
  { value: 'STAFF', label: 'Staff' },
  { value: 'FACULTY', label: 'Faculty' },
  { value: 'WORKER', label: 'Worker' },
  { value: 'OTHER', label: 'Other' },
];
export const SEX_LABEL = Object.fromEntries(SEX_OPTIONS.map((o) => [o.value, o.label]));
export const DESIGNATION_LABEL = Object.fromEntries(DESIGNATION_OPTIONS.map((o) => [o.value, o.label]));

/** Age with "(approx.)" whenever the server says it is estimated (non-students). */
export function formatAge(p) {
  if (p?.age == null) return '—';
  return p.age_is_estimated ? `${p.age} (approx.)` : String(p.age);
}

export function branchLabel(p) {
  if (p.branch_name) return p.branch_code ? `${p.branch_name} (${p.branch_code})` : p.branch_name;
  return p.branch_code ?? '—';
}

export const slug = (s) =>
  String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'patient';
