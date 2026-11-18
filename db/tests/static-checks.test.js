// Cheap static checks on the files that cannot be executed without PostgreSQL / MongoDB:
// they keep the SQL, the Mongo init script and the pipelines aligned with the contract.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BRANCHES } from '../lib/reference-data.js';
import * as P from '../repositories/pg-mongo/pipelines.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const sql = read('../schema.sql');
const init = read('../mongo/init.js');

describe('schema.sql', () => {
  test('creates every table, the view and the triggers', () => {
    for (const t of ['branch', 'patient', 'student', 'non_student', 'student_rfid', 'users', 'audit_log']) {
      assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${t} \\(`), t);
    }
    assert.match(sql, /CREATE OR REPLACE VIEW patient_with_age/);
    assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS student_rfid_one_active\s+ON student_rfid \(roll_no\) WHERE is_active/);
    assert.match(sql, /gin_trgm_ops/);
    assert.match(sql, /ERRCODE = 'HC001'/);
    assert.match(sql, /ERRCODE = 'HC002'/);
    assert.match(sql, /Asia\/Kolkata/);
  });
  test('seeds exactly the known branches from seed/branches.json', () => {
    for (const b of BRANCHES.known) assert.ok(sql.includes(`(${b.branch_id}, '${b.branch_code}', '${b.branch_name}')`), b.branch_code);
    assert.equal((sql.replace(/--[^\n]*/g, '').match(/\(\d+, '\d{3}', '/g) ?? []).length, BRANCHES.known.length);
  });
  test('style: keywords upper-case, no lower-case select/from/where outside comments', () => {
    const code = sql.replace(/--[^\n]*/g, '').replace(/'[^']*'/g, "''");
    assert.doesNotMatch(code, /\b(select|from|where|join|create table|insert into)\b/);
  });
});

describe('mongo/init.js', () => {
  test('creates the validator and all indexes', () => {
    for (const k of ['visit_id', 'patient_id', 'patient_type', 'snapshot', 'date_time', 'health_issue', 'health_issue_is_custom', 'remedy', 'recorded_by', 'created_at', 'updated_at']) {
      assert.match(init, new RegExp(`\\b${k}\\b`), k);
    }
    for (const idx of ["{ visit_id: 1 }, { unique: true", '{ patient_id: 1, date_time: -1 }', '{ date_time: 1 }', '{ health_issue: 1 }', "{ 'snapshot.branch_id': 1 }", "{ 'snapshot.batch_year': 1 }"]) {
      assert.ok(init.includes(idx), idx);
    }
    assert.match(init, /\$jsonSchema/);
    assert.match(init, /getSiblingDB\('health_centre'\)/);
  });
});

describe('report pipelines', () => {
  const range = { start: new Date('2026-01-01T00:00:00Z'), endExclusive: new Date('2026-02-01T00:00:00Z') };
  const all = {
    commonIssues: P.commonIssues(range, 5), visitsOverTime: P.visitsOverTime(range, 'week'), peakHours: P.peakHours(range),
    frequentVisitors: P.frequentVisitors(range, 5), visitsByBranch: P.visitsByBranch(range), visitsByBatch: P.visitsByBatch(range),
  };
  test('every pipeline starts with the date $match so the date_time index is used', () => {
    for (const [name, pl] of Object.entries(all)) assert.deepEqual(Object.keys(pl[0]), ['$match'], name);
    assert.deepEqual(P.matchRange({ start: null, endExclusive: null }), []);
  });
  test('date grouping always names the Asia/Kolkata timezone', () => {
    assert.match(JSON.stringify(all.peakHours), /"timezone":"Asia\/Kolkata"/);
    const trunc = JSON.stringify(all.visitsOverTime);
    assert.equal((trunc.match(/Asia\/Kolkata/g) ?? []).length, 2);
    assert.match(trunc, /"startOfWeek":"monday"/);
    assert.doesNotMatch(JSON.stringify(P.visitsOverTime(range, 'day')), /startOfWeek/);
  });
  test('output field names match the response shapes', () => {
    const last = (pl) => Object.keys(pl.at(-1).$project ?? pl.at(-2).$project).sort();
    assert.deepEqual(last(all.commonIssues), ['_id', 'count', 'health_issue']);
    assert.deepEqual(last(all.frequentVisitors), ['_id', 'count', 'name', 'patient_id', 'patient_type']);
    assert.deepEqual(last(all.visitsByBranch), ['_id', 'branch_id', 'branch_name', 'count']);
    assert.deepEqual(last(all.visitsByBatch), ['_id', 'batch_year', 'count']);
  });
  test('reports read only the visits collection fields (snapshot), never another database', () => {
    assert.doesNotMatch(JSON.stringify(all), /\$lookup/);
  });
});
