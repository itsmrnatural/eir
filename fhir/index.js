// Public entry point of the fhir package.
//   import { buildPatientBundle, buildBulkBundle } from '../fhir/index.js';
// No dependencies, no database access.
export {
  patientToFhir, visitToFhirResources, buildPatientBundle, buildBulkBundle,
  FhirMappingError, ROLL_NO_SYSTEM, ACT_CODE_SYSTEM,
} from './src/mapper.js';
export const FHIR_CONTENT_TYPE = 'application/fhir+json';
