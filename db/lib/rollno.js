// Roll number layout:  YY P BBB SSS   (e.g. 25 1 210 001)
//   YY  = 2-digit admission year        -> batch_year = 2000 + YY
//   P   = program digit                 -> PROGRAM_BY_DIGIT (keep this mapping in one place)
//   BBB = 3-digit branch code           -> must exist in the branch table; unknown codes are an error, never guessed
//   SSS = 3-digit serial
// This file is the only place in the repo that parses roll numbers.
import { BRANCHES } from './reference-data.js';

export const PROGRAM_BY_DIGIT = Object.freeze({ 1: 'UG', 2: 'PG' });
export const BATCH_YEAR_BASE = 2000;
export const ROLL_NO_RE = /^(\d{2})(\d)(\d{3})(\d{3})$/;

/** Codes accepted when the caller does not pass the live list from the branch table. */
export const DEFAULT_BRANCH_CODES = [...BRANCHES.known, ...BRANCHES.synthetic].map((b) => b.branch_code);

export class RollNoError extends Error {
  /** @param {'BAD_FORMAT'|'UNKNOWN_PROGRAM'|'UNKNOWN_BRANCH'} reason */
  constructor(reason, message) {
    super(message);
    this.name = 'RollNoError';
    this.reason = reason;
  }
}

/**
 * @param {string} rollNo
 * @param {{branchCodes?: Iterable<string>, skipBranchCheck?: boolean}} [opts]
 *   branchCodes: pass the codes from the branch table in real use.
 *   skipBranchCheck: for callers that pass an explicit branch_code (e.g. the import CSV column).
 * @returns {{batch_year:number, program:'UG'|'PG', branch_code:string, serial:string}}
 */
export function parseRollNo(rollNo, { branchCodes = DEFAULT_BRANCH_CODES, skipBranchCheck = false } = {}) {
  const raw = typeof rollNo === 'string' ? rollNo.trim() : '';
  const m = ROLL_NO_RE.exec(raw);
  if (!m) {
    throw new RollNoError('BAD_FORMAT', `roll number "${raw}" does not match YY P BBB SSS (9 digits)`);
  }
  const [, yy, programDigit, branchCode, serial] = m;
  const program = PROGRAM_BY_DIGIT[Number(programDigit)];
  if (!program) {
    throw new RollNoError('UNKNOWN_PROGRAM', `program digit "${programDigit}" in roll number ${raw} is not mapped (known: ${Object.keys(PROGRAM_BY_DIGIT).join(', ')})`);
  }
  if (!skipBranchCheck && !new Set(branchCodes).has(branchCode)) {
    throw new RollNoError('UNKNOWN_BRANCH', `branch code "${branchCode}" in roll number ${raw} is not in the branch table; add the branch first`);
  }
  return { batch_year: BATCH_YEAR_BASE + Number(yy), program, branch_code: branchCode, serial };
}

/** Inverse of the program mapping (used by the synthetic generator only). */
export const programDigit = (program) => {
  const hit = Object.entries(PROGRAM_BY_DIGIT).find(([, v]) => v === program);
  if (!hit) throw new Error(`unknown program ${program}`);
  return hit[0];
};
