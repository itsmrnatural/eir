#!/usr/bin/env node
// Usage: node scripts/create-user.js <username> <ADMIN|STAFF> [--password-stdin]
// Prompts for the password (hidden). With --password-stdin the first line of stdin is the password, which is
// what you need under `docker compose exec -T` / `run -T` where there is no terminal.
import readline from 'node:readline/promises';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { connectAll } from '../lib/connect.js';
import { createUser } from '../lib/create-user.js';

async function readHidden(prompt) {
  let muted = false;
  const out = new Writable({ write(chunk, enc, cb) { if (!muted) process.stdout.write(chunk, enc); cb(); } });
  const rl = readline.createInterface({ input: process.stdin, output: out, terminal: true });
  const pending = rl.question(prompt); // the prompt is written synchronously, before we mute
  muted = true;
  const answer = await pending;
  rl.close();
  process.stdout.write('\n');
  return answer;
}

async function readStdinLine() {
  const rl = readline.createInterface({ input: process.stdin });
  for await (const line of rl) { rl.close(); return line; }
  return '';
}

async function main(argv) {
  const stdin = argv.includes('--password-stdin');
  const [username, role] = argv.filter((a) => !a.startsWith('--'));
  if (!username || !role) { console.error('Usage: node scripts/create-user.js <username> <ADMIN|STAFF> [--password-stdin]'); return 1; }
  let password;
  if (stdin) {
    password = await readStdinLine();
  } else {
    if (!process.stdin.isTTY) { console.error('No terminal available: pass --password-stdin and pipe the password in.'); return 1; }
    password = await readHidden('Password: ');
    const again = await readHidden('Repeat password: ');
    if (password !== again) { console.error('Passwords do not match.'); return 1; }
  }
  const conn = await connectAll({ needMongo: false });
  try {
    const { createUsersRepoOnly } = await import('../lib/users-only.js');
    const user = await createUser({ repos: createUsersRepoOnly(conn.pgPool), username, role: role.toUpperCase(), password });
    console.log(`created user ${user.username} (id ${user.user_id}, role ${user.role})`);
    return 0;
  } finally {
    await conn.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { console.error(`error: ${e.message}`); process.exitCode = 1; });
}
