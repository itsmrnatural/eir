#!/usr/bin/env node
// Usage: node scripts/relink-rfid.js <roll_no> <new_rfid_id> [--actor <username>]
import { pathToFileURL } from 'node:url';
import { connectAll } from '../lib/connect.js';
import { relinkRfid } from '../lib/relink-rfid.js';

async function main(argv) {
  const actorAt = argv.indexOf('--actor');
  const actor = actorAt >= 0 ? argv[actorAt + 1] : null;
  const rest = argv.filter((a, i) => !a.startsWith('--') && i !== actorAt + 1);
  const [roll_no, new_rfid_id] = rest;
  if (!roll_no || !new_rfid_id) { console.error('Usage: node scripts/relink-rfid.js <roll_no> <new_rfid_id> [--actor <username>]'); return 1; }
  const conn = await connectAll({ needMongo: false });
  try {
    const r = await relinkRfid(conn.pgPool, { roll_no, new_rfid_id, actor_username: actor });
    console.log(r.changed ? `roll_no ${roll_no}: ${r.old_rfid_id ?? '(no tag)'} deactivated, ${r.new_rfid_id} active` : `roll_no ${roll_no}: ${r.new_rfid_id} is already the active tag, nothing changed`);
    return 0;
  } finally {
    await conn.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { console.error(`error: ${e.message}`); process.exitCode = 1; });
}
