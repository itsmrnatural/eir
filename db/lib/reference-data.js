// Static reference data shipped with the repo (read with fs so it works on Node 20 and 22
// without JSON import assertions).
import { readFileSync } from 'node:fs';

const load = (name) => JSON.parse(readFileSync(new URL(`../seed/${name}`, import.meta.url), 'utf8'));

/** { known: [...], synthetic: [...] } of {branch_id, branch_code, branch_name} */
export const BRANCHES = load('branches.json');
/** [{code, label, snomed_ct}] — snomed_ct is null everywhere: no code could be verified offline. */
export const HEALTH_ISSUES = load('health-issues.json');

export const publicHealthIssues = () => HEALTH_ISSUES.map(({ code, label }) => ({ code, label }));
export const healthIssueLabels = () => new Set(HEALTH_ISSUES.map((h) => h.label));
