/**
 * Import point for the pure FHIR mapper: patientToFhir, visitToFhirResources,
 * buildPatientBundle, buildBulkBundle. The implementation lives in fhir/.
 * Path is relative to this file: server/src/adapters -> repository root -> fhir/.
 */
export * from '../../../fhir/index.js';
