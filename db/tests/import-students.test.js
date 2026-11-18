import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importStudents, formatReport } from '../lib/import-students.js';
import { createInMemoryRepositories } from '../index.js';
import { createUser } from '../lib/create-user.js';

const NOW = new Date('2026-11-17T06:00:00Z');
const fresh = () => createInMemoryRepositories({ clock: () => NOW });
const HEADER = 'roll_no,name,dob,sex,rfid_id,branch_code,batch_year,program\n';

describe('import-students', () => {
  test('the sample CSV: good rows imported, bad rows reported with row numbers', async () => {
    const repos = fresh();
    const csvText = readFileSync(new URL('../seed/students.sample.csv', import.meta.url), 'utf8');
    const s = await importStudents({ repos, csvText, now: NOW });
    assert.equal(s.total_rows, 10);
    assert.equal(s.created, 6);
    assert.deepEqual(s.rejected.map((r) => [r.row, r.roll_no]), [[7, '251210804'], [8, '251210805'], [9, '251999801'], [10, '25121080']]);
    assert.match(s.rejected[0].reason, /not a real date/);
    assert.match(s.rejected[1].reason, /duplicate rfid_id in file \(first seen at row 2\)/);
    assert.match(s.rejected[2].reason, /branch code "999".*not in the branch table/);
    assert.match(s.rejected[3].reason, /9 digits/);
    const echo = (await repos.patients.search('Sample, Echo'))[0];
    assert.equal(echo.name, 'Sample, Echo');
    const bravo = await repos.patients.findByRfid('SAMPLE0002');
    assert.equal(bravo.roll_no, '251210802');
    assert.deepEqual([bravo.batch_year, bravo.program, bravo.branch_code], [2025, 'UG', '210']);
    const delta = await repos.patients.findByRfid('SAMPLE0004');
    assert.deepEqual([delta.batch_year, delta.program, delta.branch_code], [2024, 'PG', '221']);
    assert.match(formatReport(s), /row 9 \(251999801\)/);
  });

  test('is idempotent and never modifies existing students', async () => {
    const repos = fresh();
    const csvText = HEADER + '251210001,Ann One,2006-01-01,F,AA01,,,\n251210002,Bob Two,2006-02-02,M,AA02,,,\n';
    const first = await importStudents({ repos, csvText, now: NOW });
    assert.equal(first.created, 2);
    const second = await importStudents({ repos, csvText, now: NOW });
    assert.deepEqual([second.created, second.already_present, second.rejected.length, second.differs.length], [0, 2, 0, 0]);
    const changed = HEADER + '251210001,Ann Renamed,2006-01-01,F,AA99,,,\n';
    const third = await importStudents({ repos, csvText: changed, now: NOW });
    assert.equal(third.created, 0);
    assert.deepEqual(third.differs[0].diffs.map((d) => d.field), ['name', 'rfid_id']);
    assert.equal((await repos.patients.findByRfid('AA01')).name, 'Ann One', 'existing data untouched');
  });

  test('dry run writes nothing; rfid owned by another student is rejected', async () => {
    const repos = fresh();
    await importStudents({ repos, csvText: HEADER + '251210001,Ann One,2006-01-01,F,AA01,,,\n', now: NOW });
    const csvText = HEADER + '251210003,Cy Three,2006-03-03,M,AA03,,,\n251210004,Di Four,2006-04-04,F,AA01,,,\n';
    const dry = await importStudents({ repos, csvText, dryRun: true, now: NOW });
    assert.deepEqual([dry.would_create, dry.created, dry.rejected.length], [1, 0, 1]);
    assert.match(dry.rejected[0].reason, /already assigned to roll_no 251210001/);
    assert.deepEqual(await repos.patients.search('Cy Three'), []);
  });

  test('validation: sex words, missing rfid, overrides, future batch, missing columns', async () => {
    const repos = fresh();
    const csvText = HEADER
      + '251210011,Eve,2006-01-01,female,E1,,,\n'          // sex word accepted
      + '251210012,Fay,2006-01-01,X,E2,,,\n'               // bad sex
      + '251210013,Gus,2006-01-01,M,,,,\n'                 // no rfid
      + '251210014,Hal,2006-01-01,M,E4,,2035,\n'            // implausible batch override
      + '251210015,Ivy,2006-01-01,M,E5,,,PHD\n'             // bad program override
      + '999999999,Jon,2006-01-01,M,E6,220,2020,PG\n'       // unparsable roll_no, but all three overrides given
      + '251770016,Kim,2006-01-01,F,E7,220,,\n';            // branch override only: batch/program from the roll no
    const s = await importStudents({ repos, csvText, now: NOW });
    assert.equal(s.created, 3);
    assert.deepEqual(s.rejected.map((r) => r.row), [3, 4, 5, 6]);
    assert.match(s.rejected[1].reason, /rfid_id is empty/);
    const jon = await repos.patients.findByRfid('E6');
    assert.deepEqual([jon.batch_year, jon.program, jon.branch_code], [2020, 'PG', '220']);
    const kim = await repos.patients.findByRfid('E7');
    assert.deepEqual([kim.batch_year, kim.program, kim.branch_code], [2025, 'UG', '220']);
    const noCard = await importStudents({ repos, csvText: HEADER + '251210013,Gus,2006-01-01,M,,,,\n', allowMissingRfid: true, now: NOW });
    assert.equal(noCard.created, 1);
    await assert.rejects(importStudents({ repos, csvText: 'roll_no,name\n1,x\n', now: NOW }), /missing required column/);
  });
});

describe('create-user', () => {
  test('hashes through the injected hasher and enforces the rules', async () => {
    const repos = fresh();
    const hash = async (pw) => `$2b$10$${'x'.repeat(53)}`.replace('x', pw[0]);
    const u = await createUser({ repos, username: 'nurse1', role: 'STAFF', password: 'longenough', hash });
    assert.deepEqual([u.username, u.role], ['nurse1', 'STAFF']);
    assert.match((await repos.users.findByUsername('nurse1')).password_hash, /^\$2b\$10\$l/);
    await assert.rejects(createUser({ repos, username: 'x', role: 'STAFF', password: 'short', hash }), { code: 'VALIDATION_ERROR' });
    await assert.rejects(createUser({ repos, username: 'nurse2', role: 'DOCTOR', password: 'longenough', hash }), { code: 'VALIDATION_ERROR' });
  });
});
