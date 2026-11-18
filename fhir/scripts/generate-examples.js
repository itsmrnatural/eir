// Regenerates fhir/examples/*.json from the synthetic fixtures, then checks them with the structural checker.
//   node scripts/generate-examples.js
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildPatientBundle, buildBulkBundle } from '../index.js';
import { validateBundle } from '../tests/r4-structural.js';
import { student, nonStudent, other, studentVisits, nonStudentVisits, otherVisits } from '../tests/fixtures.js';

const out = new URL('../examples/', import.meta.url);
mkdirSync(out, { recursive: true });
const files = {
  'patient-student-bundle.json': buildPatientBundle(student, studentVisits),
  'patient-non-student-bundle.json': buildPatientBundle(nonStudent, nonStudentVisits),
  'bulk-bundle.json': buildBulkBundle([
    { patient: student, visits: studentVisits }, { patient: nonStudent, visits: nonStudentVisits }, { patient: other, visits: otherVisits },
  ]),
};
let bad = 0;
for (const [name, bundle] of Object.entries(files)) {
  const issues = validateBundle(bundle);
  if (issues.length > 0) { bad += 1; console.error(`${name}: ${issues.length} issue(s)\n  ${issues.join('\n  ')}`); }
  writeFileSync(new URL(name, out), `${JSON.stringify(bundle, null, 2)}\n`);
  console.log(`wrote examples/${name} (${bundle.entry.length} entries, structural check: ${issues.length === 0 ? 'clean' : 'ISSUES'})`);
}
process.exitCode = bad > 0 ? 1 : 0;
