import { createAuthService } from './authService.js';
import { createPatientService } from './patientService.js';
import { createVisitService } from './visitService.js';
import { createReportService } from './reportService.js';
import { createMetaService } from './metaService.js';
import { createExportService } from './exportService.js';

/** Services talk only to the repository interface and the pure FHIR mapper. */
export function createServices({ repos, config, fhir }) {
  return {
    auth: createAuthService({ repos, config }),
    patients: createPatientService({ repos }),
    visits: createVisitService({ repos }),
    reports: createReportService({ repos }),
    meta: createMetaService({ repos }),
    exports: createExportService({ repos, fhir }),
  };
}
