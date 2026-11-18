// Bulk student import (logic only; the CLI is scripts/import-students.js).
// Talks to the database exclusively through the repository interface, so it runs against the
// in-memory repositories in tests and against PostgreSQL in real life.
//
// CSV columns: roll_no,name,dob,sex,rfid_id   (+ optional overrides: branch_code,batch_year,program)
// Rules
//   * branch/batch/program are filled by the roll-number parser (lib/rollno.js); an override column wins
//   * a bad row is rejected with its spreadsheet row number and a reason; good rows are still imported
//   * idempotent: a roll_no that already exists is never modified (differences are reported as warnings)
import { AppError } from './errors.js';
import { parseCsvRecords } from './csv.js';
import { parseRollNo, RollNoError } from './rollno.js';
import { parseYmd, istParts } from './time.js';
import { normalizeRfid, assertWritableRfid } from './ids.js';
import { PROGRAMS } from './validation.js';

export const REQUIRED_COLUMNS = ['roll_no', 'name', 'dob', 'sex', 'rfid_id'];
const SEX_WORDS = { m: 'M', male: 'M', f: 'F', female: 'F', other: 'Other', o: 'Other' };

export async function importStudents({ repos, csvText, dryRun = false, allowMissingRfid = false, now = new Date() }) {
  const { header, records } = parseCsvRecords(csvText);
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) throw new Error(`CSV is missing required column(s): ${missing.join(', ')} (found: ${header.join(', ') || 'none'})`);

  const branches = await repos.meta.listBranches();
  const branchByCode = new Map(branches.map((b) => [b.branch_code, b]));
  const maxBatchYear = istParts(now).year + 1;

  const summary = {
    dry_run: dryRun, total_rows: records.length, created: 0, would_create: 0, already_present: 0,
    differs: [], rejected: [],
  };
  const seenRoll = new Map();
  const seenRfid = new Map();

  for (const { line, values: v, extraCells } of records) {
    const reject = (reason) => summary.rejected.push({ row: line, roll_no: v.roll_no || '', reason });
    try {
      if (extraCells) { reject('row has more cells than the header (unquoted comma?)'); continue; }
      const roll_no = v.roll_no;
      if (!roll_no) { reject('roll_no is empty'); continue; }
      if (seenRoll.has(roll_no)) { reject(`duplicate roll_no in file (first seen at row ${seenRoll.get(roll_no)})`); continue; }
      seenRoll.set(roll_no, line);

      const name = v.name.replace(/\s+/g, ' ');
      if (!name) { reject('name is empty'); continue; }
      if (!parseYmd(v.dob)) { reject(`dob "${v.dob}" is not a real date in YYYY-MM-DD format`); continue; }
      const sex = SEX_WORDS[v.sex.toLowerCase()];
      if (!sex) { reject(`sex "${v.sex}" must be M, F or Other`); continue; }

      let rfid_id = null;
      if (v.rfid_id) {
        rfid_id = normalizeRfid(v.rfid_id);
        try { assertWritableRfid(rfid_id); } catch (e) { reject(e.message); continue; }
        if (seenRfid.has(rfid_id)) { reject(`duplicate rfid_id in file (first seen at row ${seenRfid.get(rfid_id)})`); continue; }
        seenRfid.set(rfid_id, line);
      } else if (!allowMissingRfid) {
        reject('rfid_id is empty (use --allow-missing-rfid to import students without a card)'); continue;
      }

      // --- branch / batch / program: parser first, explicit override columns win ---------------------
      const overrideBranch = v.branch_code || '';
      if (overrideBranch && !branchByCode.has(overrideBranch)) { reject(`branch_code override "${overrideBranch}" is not in the branch table`); continue; }
      let parsed = {};
      let parseError = null;
      try {
        parsed = parseRollNo(roll_no, { branchCodes: branchByCode.keys(), skipBranchCheck: Boolean(overrideBranch) });
      } catch (e) {
        if (!(e instanceof RollNoError)) throw e;
        parseError = e;
      }
      const branch_code = overrideBranch || parsed.branch_code;
      const batch_year = v.batch_year ? Number(v.batch_year) : parsed.batch_year;
      const program = v.program ? v.program.toUpperCase() : parsed.program;
      if (!branch_code || !batch_year || !program) { reject(parseError ? parseError.message : 'cannot determine branch, batch and program'); continue; }
      if (!Number.isInteger(batch_year) || batch_year < 1990 || batch_year > maxBatchYear) { reject(`batch_year ${v.batch_year || batch_year} is not a plausible admission year`); continue; }
      if (!PROGRAMS.includes(program)) { reject(`program "${v.program}" must be UG or PG`); continue; }
      const branch_id = branchByCode.get(branch_code).branch_id;

      // --- idempotency ---------------------------------------------------------------------------------
      const hit = (await repos.patients.search(roll_no, { limit: 50 })).find((p) => p.roll_no === roll_no);
      if (hit) {
        summary.already_present += 1;
        const diffs = [];
        const cmp = (field, csv, db) => { if (String(csv ?? '') !== String(db ?? '')) diffs.push({ field, csv, db }); };
        cmp('name', name, hit.name); cmp('dob', v.dob, hit.dob); cmp('sex', sex, hit.sex);
        cmp('batch_year', batch_year, hit.batch_year); cmp('program', program, hit.program);
        cmp('branch_id', branch_id, hit.branch_id);
        if (rfid_id) cmp('rfid_id', rfid_id, hit.rfid_id); // a changed card is a relink-rfid job, not an import
        if (diffs.length > 0) summary.differs.push({ row: line, roll_no, diffs });
        continue;
      }

      if (rfid_id) {
        try {
          const owner = await repos.patients.findByRfid(rfid_id);
          reject(`rfid_id ${rfid_id} is already assigned to roll_no ${owner.roll_no}`); continue;
        } catch (e) {
          if (e.code === 'RFID_INACTIVE') { reject(`rfid_id ${rfid_id} exists in the database as a deactivated card of another student`); continue; }
          if (e.code !== 'RFID_NOT_FOUND') throw e;
        }
      }

      if (dryRun) { summary.would_create += 1; continue; }
      await repos.patients.createStudent({ name, dob: v.dob, sex, roll_no, batch_year, program, branch_id, rfid_id });
      summary.created += 1;
    } catch (e) {
      if (e instanceof AppError) reject(`${e.code}: ${e.message}`);
      else throw e;
    }
  }
  return summary;
}

export function formatReport(s) {
  const out = [];
  out.push(s.dry_run ? 'DRY RUN - nothing was written' : 'Import finished');
  out.push(`  rows read        : ${s.total_rows}`);
  out.push(s.dry_run ? `  would create     : ${s.would_create}` : `  created          : ${s.created}`);
  out.push(`  already present  : ${s.already_present} (never modified)`);
  out.push(`  rejected         : ${s.rejected.length}`);
  if (s.differs.length > 0) {
    out.push('', 'Warnings - existing students that differ from the file (left unchanged):');
    for (const d of s.differs) out.push(`  row ${d.row} ${d.roll_no}: ${d.diffs.map((x) => `${x.field} file="${x.csv}" db="${x.db}"`).join('; ')}`);
  }
  if (s.rejected.length > 0) {
    out.push('', 'Rejected rows:');
    for (const r of s.rejected) out.push(`  row ${r.row}${r.roll_no ? ` (${r.roll_no})` : ''}: ${r.reason}`);
  }
  return out.join('\n');
}
