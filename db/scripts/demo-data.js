#!/usr/bin/env node
// Prints handy values from the synthetic dataset for demos and UI work (no database needed):
//   node scripts/demo-data.js [--end YYYY-MM-DD]
// The same values exist in the database after `npm run seed:reset` and in createInMemoryRepositories({ withSeedData: true }).
import { generateDataset } from '../seed/generate.js';
import { istDateString } from '../lib/time.js';

const i = process.argv.indexOf('--end');
const d = generateDataset({ end: i >= 0 ? process.argv[i + 1] : istDateString(new Date()) });
const byPhone = new Map();
for (const n of d.nonStudents) byPhone.set(n.phone_no, [...(byPhone.get(n.phone_no) ?? []), n.name]);
const phones = [...byPhone.entries()];

console.log('Dev logins (development only): admin / admin123 (ADMIN)   staff / staff123 (STAFF)\n');
console.log('Tap these cards (active tags):');
for (const s of d.students.slice(0, 5)) console.log(`  ${s.rfid_tags.at(-1).rfid_id}  ${s.name}  (${s.roll_no}, ${s.program}, branch ${s.branch_code})`);
const old = d.students.find((s) => s.rfid_tags.length > 1);
console.log(`\nDeactivated card (expect "card inactive"): ${old.rfid_tags.find((t) => !t.is_active).rfid_id}`);
console.log('Unregistered card (expect "Card not registered, contact admin"): SYN00000000');
console.log('\nPhones:');
console.log(`  one person : ${phones.find(([, n]) => n.length === 1)[0]}`);
console.log(`  five people (limit reached, 6th must be refused): ${phones.find(([, n]) => n.length === 5)[0]}`);
console.log(`  two people : ${phones.find(([, n]) => n.length === 2)[0]}`);
console.log(`\nVisit window: ${d.window.from} .. ${d.window.to}, ${d.visits.length} visits, ${d.students.length} students, ${d.nonStudents.length} non-students`);
