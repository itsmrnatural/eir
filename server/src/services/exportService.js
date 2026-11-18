import { notFound } from '../errors.js';
import { stripUndefined } from '../util/http.js';
import { toVisitDto } from './visitService.js';

/**
 * `fhir` is the pure mapper (patientToFhir, visitToFhirResources, buildPatientBundle,
 * buildBulkBundle). No database access happens inside it; we fetch, it maps.
 */
export function createExportService({ repos, fhir }) {
  /**
   * visits.listForExport()'s return shape is not fixed by the contract. We accept either
   *   A) [{ patient: PatientView, visits: Visit[] }]            (used as is)
   *   B) Visit[]  (flat)  -> grouped by patient_id, PatientView loaded via patients.findById
   * and always hand buildBulkBundle() entries of shape A.
   */
  async function toEntries(rows) {
    if (rows.length === 0) return [];
    if (rows[0] && typeof rows[0] === 'object' && 'patient' in rows[0]) {
      return rows.map((r) => ({ patient: r.patient, visits: (r.visits ?? []).map(toVisitDto) }));
    }
    const byPatient = new Map();
    for (const v of rows) {
      if (!byPatient.has(v.patient_id)) byPatient.set(v.patient_id, []);
      byPatient.get(v.patient_id).push(toVisitDto(v));
    }
    return Promise.all(
      [...byPatient.entries()].map(async ([patient_id, visits]) => {
        const patient = await repos.patients.findById(patient_id);
        // Silently dropping a visit from a medical export would be worse than failing loudly.
        if (!patient) throw new Error(`FHIR export: visit refers to unknown patient ${patient_id}`);
        return { patient, visits };
      }),
    );
  }

  return {
    async patientBundle(patient_id) {
      const patient = await repos.patients.findById(patient_id);
      if (!patient) throw notFound('Patient');
      const visits = (await repos.visits.listByPatient(patient_id)).map(toVisitDto);
      return fhir.buildPatientBundle(patient, visits);
    },

    async bulkBundle(range) {
      const rows = await repos.visits.listForExport(stripUndefined(range));
      return fhir.buildBulkBundle(await toEntries(rows));
    },
  };
}
