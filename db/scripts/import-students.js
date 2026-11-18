#!/usr/bin/env node
// Usage: node scripts/import-students.js <students.csv> [--dry-run] [--allow-missing-rfid]
// Exit code: 0 = every row fine, 2 = some rows rejected (the good ones were still imported), 1 = fatal error.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { connectAll } from '../lib/connect.js';
import { importStudents, formatReport } from '../lib/import-students.js';

async function main(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const files = argv.filter((a) => !a.startsWith('--'));
  if (files.length !== 1 || flags.has('--help')) {
    console.error('Usage: node scripts/import-students.js <students.csv> [--dry-run] [--allow-missing-rfid]');
    return 1;
  }
  const csvText = readFileSync(files[0], 'utf8');
  const conn = await connectAll();
  try {
    const summary = await importStudents({
      repos: conn.repos, csvText, dryRun: flags.has('--dry-run'), allowMissingRfid: flags.has('--allow-missing-rfid'),
    });
    console.log(formatReport(summary));
    return summary.rejected.length > 0 ? 2 : 0;
  } finally {
    await conn.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => { console.error(`error: ${err.message}`); process.exitCode = 1; });
}
