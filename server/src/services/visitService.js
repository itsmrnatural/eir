import { AppError, notFound } from '../errors.js';
import { stripUndefined } from '../util/http.js';

/** Visits come from Mongo; never leak the internal _id. */
export function toVisitDto(visit) {
  if (!visit) return visit;
  const { _id, ...rest } = visit;
  return rest;
}

export function createVisitService({ repos }) {
  /**
   * Visits store health_issue as the display label ("Fever"), while GET /meta/health-issues offers
   * {code,label}. For a non-custom issue we accept either the code or the label and always
   * store the label, so reports never split one issue into two buckets.
   */
  const matchListed = (list, value) => {
    const v = value.toLowerCase();
    return (
      list.find((i) => i.label === value) ??
      list.find((i) => i.code === value) ??
      list.find((i) => String(i.label).toLowerCase() === v)
    );
  };

  async function resolveIssueForCreate({ health_issue, health_issue_is_custom }) {
    if (health_issue_is_custom) return { health_issue, health_issue_is_custom: true };
    const match = matchListed(await repos.meta.listHealthIssues(), health_issue);
    if (!match) {
      throw new AppError(
        'VALIDATION_ERROR',
        'health_issue is not in the list of health issues; set health_issue_is_custom to true to record free text',
        { field: 'health_issue' },
      );
    }
    return { health_issue: match.label, health_issue_is_custom: false };
  }

  return {
    async create(input, user) {
      const patient = await repos.patients.findById(input.patient_id);
      if (!patient) throw notFound('Patient');

      const issue = await resolveIssueForCreate(input);
      const visit = await repos.visits.create({
        patient_id: input.patient_id,
        ...issue,
        remedy: input.remedy,
        recorded_by: user.user_id, // from the JWT, never from the client
        confirm_duplicate: input.confirm_duplicate === true,
        // date_time is deliberately not passed: the repository sets it (UTC, server clock).
      });
      return toVisitDto(visit);
    },

    async update(visit_id, patch, user) {
      const existing = await repos.visits.findById(visit_id);
      if (!existing) throw notFound('Visit');

      const changes = {};
      if (patch.health_issue !== undefined) {
        // Corrections may be free text; only normalise when it names a listed issue.
        const listed = matchListed(await repos.meta.listHealthIssues(), patch.health_issue);
        changes.health_issue = listed ? listed.label : patch.health_issue;
      }
      if (patch.remedy !== undefined) changes.remedy = patch.remedy;

      const updated = await repos.visits.update(visit_id, changes, user.user_id);
      return toVisitDto(updated ?? (await repos.visits.findById(visit_id)));
    },

    /** Admin only. from/to are YYYY-MM-DD (IST, inclusive) and are passed through untouched. */
    async history(patient_id, range) {
      const patient = await repos.patients.findById(patient_id);
      if (!patient) throw notFound('Patient');
      const items = (await repos.visits.listByPatient(patient_id, stripUndefined(range))).map(toVisitDto);
      return { patient, items, total: items.length };
    },
  };
}
