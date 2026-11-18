#!/usr/bin/env node
// Prints query plans for the RFID lookup, the desk search and every report pipeline.
// Run it after seeding (npm run seed:reset):
//   docker compose run --rm db-tools node scripts/explain.js | tee explain-output.txt
// PostgreSQL: EXPLAIN (ANALYZE, BUFFERS) of the RFID-tap lookup and of the desk search, each twice - as the
//   planner chooses, and with enable_seqscan = off (on a few hundred rows the planner may legitimately prefer a
//   sequential scan; the second run shows the index exists and is usable).
// MongoDB: explain('executionStats') of every report pipeline and of the duplicate-visit lookup.
import { pathToFileURL } from 'node:url';
import { connectAll } from '../lib/connect.js';
import { FIND_BY_RFID_SQL, SEARCH_SQL } from '../repositories/pg-mongo/patients.js';
import * as P from '../repositories/pg-mongo/pipelines.js';
import { dateRangeUtc, istDateString, addDaysYmd } from '../lib/time.js';

const findKey = (node, key) => {
  if (node && typeof node === 'object') {
    if (key in node) return node[key];
    for (const v of Object.values(node)) { const hit = findKey(v, key); if (hit !== undefined) return hit; }
  }
  return undefined;
};

function stageChain(plan) {
  const out = [];
  for (let n = plan; n; n = n.inputStage ?? n.queryPlan ?? n.inputStages?.[0]) {
    out.push(n.indexName ? `${n.stage}(${n.indexName})` : n.stage);
  }
  return out.join(' <- ');
}

async function pgExplain(client, title, sql, args) {
  for (const forced of [false, true]) {
    await client.query(`SET enable_seqscan = ${forced ? 'off' : 'on'}`);
    await client.query(`PREPARE q AS ${sql}`);
    const res = await client.query(`EXPLAIN (ANALYZE, BUFFERS) EXECUTE q(${args})`);
    await client.query('DEALLOCATE q');
    console.log(`\n### ${title}${forced ? '  [enable_seqscan = off]' : ''}`);
    console.log(res.rows.map((r) => r['QUERY PLAN']).join('\n'));
  }
  await client.query('SET enable_seqscan = on');
}

async function mongoExplain(title, explainPromise) {
  const ex = await explainPromise;
  const plan = findKey(ex, 'winningPlan');
  const stats = findKey(ex, 'executionStats');
  console.log(`\n### ${title}`);
  console.log(`plan: ${plan ? stageChain(plan) : '(see raw explain)'}`);
  if (stats) console.log(`docs examined: ${stats.totalDocsExamined}, keys examined: ${stats.totalKeysExamined}, returned: ${stats.nReturned}, time: ${stats.executionTimeMillis} ms`);
}

async function main() {
  const conn = await connectAll();
  try {
    const client = await conn.pgPool.connect();
    try {
      const tag = (await client.query('SELECT rfid_id FROM student_rfid WHERE is_active ORDER BY rfid_id LIMIT 1 OFFSET 150')).rows[0]?.rfid_id;
      if (!tag) throw new Error('no RFID tags found - run `npm run seed:reset` first');
      console.log(`# EXPLAIN output, generated ${new Date().toISOString()}`);
      console.log(`postgres rows: patient=${(await client.query('SELECT COUNT(*) AS n FROM patient')).rows[0].n}, student_rfid=${(await client.query('SELECT COUNT(*) AS n FROM student_rfid')).rows[0].n}`);
      await pgExplain(client, 'RFID tap (patients.findByRfid)', FIND_BY_RFID_SQL, `'${tag}'`);
      await pgExplain(client, "Desk search for '90000' (patients.search)", SEARCH_SQL, `'%90000%', '%90000%', '90000', '90000%', 20`);
    } finally { client.release(); }

    const col = conn.mongoDb.collection('visits');
    console.log(`\nmongo rows: visits=${await col.countDocuments({})}`);
    const to = istDateString(new Date());
    const range = dateRangeUtc({ from: addDaysYmd(to, -30), to });
    const sample = await col.findOne({}, { projection: { patient_id: 1 } });
    await mongoExplain('duplicate-visit check: newest visit of one patient', col.find({ patient_id: sample.patient_id }).sort({ date_time: -1 }).limit(1).explain('executionStats'));
    const reports = {
      'report commonIssues (last 30 days)': P.commonIssues(range, 10),
      'report peakHours (last 30 days)': P.peakHours(range),
      'report visitsOverTime day (last 30 days)': P.visitsOverTime(range, 'day'),
      'report frequentVisitors (last 30 days)': P.frequentVisitors(range, 10),
      'report visitsByBranch (last 30 days)': P.visitsByBranch(range),
      'report visitsByBatch (last 30 days)': P.visitsByBatch(range),
      'report commonIssues (all time)': P.commonIssues(dateRangeUtc({}), 10),
    };
    for (const [title, pipeline] of Object.entries(reports)) await mongoExplain(title, col.aggregate(pipeline).explain('executionStats'));
  } finally {
    await conn.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(`error: ${e.message}`); process.exitCode = 1; });
