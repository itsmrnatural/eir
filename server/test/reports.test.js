import { describe, it, expect, vi } from 'vitest';
import { buildHarness, expectError } from './helpers.js';

async function withVisits(h) {
  const v = (patient_id, health_issue, extra = {}) =>
    h.api('staff').post('/visits').send({
      patient_id, health_issue, health_issue_is_custom: false, remedy: 'Rest', confirm_duplicate: true, ...extra,
    });
  const [common, other] = h.issues.map((i) => i.label);
  await v(h.student.patient_id, common);
  await v(h.student.patient_id, common);
  await v(h.student2.patient_id, other);
}

describe('GET /reports/*  (ADMIN only)', () => {
  it('common-issues returns [{health_issue,count}]', async () => {
    const h = await buildHarness();
    await withVisits(h);
    const res = await h.api('admin').get('/reports/common-issues');
    expect(res.status).toBe(200);
    expect(res.body[0]).toEqual({ health_issue: h.issues[0].label, count: 2 });
  });

  it('peak-hours returns [{hour 0-23,count}]', async () => {
    const h = await buildHarness();
    await withVisits(h);
    const res = await h.api('admin').get('/reports/peak-hours');
    expect(res.status).toBe(200);
    expect(res.body.reduce((n, r) => n + r.count, 0)).toBe(3);
    for (const r of res.body) {
      expect(Number.isInteger(r.hour) && r.hour >= 0 && r.hour <= 23).toBe(true);
    }
  });

  it('frequent-visitors returns [{patient_id,name,patient_type,count}]', async () => {
    const h = await buildHarness();
    await withVisits(h);
    const res = await h.api('admin').get('/reports/frequent-visitors?limit=1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ patient_id: h.student.patient_id, name: 'Test Student One', patient_type: 'STUDENT', count: 2 }]);
  });

  it('visits-by-branch and visits-by-batch', async () => {
    const h = await buildHarness();
    await withVisits(h);
    const branch = await h.api('admin').get('/reports/visits-by-branch');
    expect(branch.status).toBe(200);
    expect(branch.body.find((r) => r.branch_id === h.cseBranchId)).toMatchObject({ count: 3 });
    const batch = await h.api('admin').get('/reports/visits-by-batch');
    expect(batch.status).toBe(200);
    expect(batch.body.find((r) => r.batch_year === 2025)).toMatchObject({ count: 2 });
    expect(batch.body.find((r) => r.batch_year === 2024)).toMatchObject({ count: 1 });
  });

  it('visits-over-time returns [{bucket,count}] and defaults to day', async () => {
    const h = await buildHarness();
    await withVisits(h);
    const spy = vi.spyOn(h.repos.reports, 'visitsOverTime');
    const res = await h.api('admin').get('/reports/visits-over-time');
    expect(res.status).toBe(200);
    expect(res.body.reduce((n, r) => n + r.count, 0)).toBe(3);
    expect(typeof res.body[0].bucket).toBe('string');
    expect(spy.mock.calls[0][0].bucket).toBe('day');
  });

  it('passes validated from/to/limit/bucket through to the repositories (dates stay YYYY-MM-DD)', async () => {
    const h = await buildHarness();
    const common = vi.spyOn(h.repos.reports, 'commonIssues');
    const over = vi.spyOn(h.repos.reports, 'visitsOverTime');
    await h.api('admin').get('/reports/common-issues?from=2026-01-01&to=2026-01-31&limit=5');
    await h.api('admin').get('/reports/common-issues');
    await h.api('admin').get('/reports/visits-over-time?from=2026-01-01&to=2026-03-31&bucket=month');
    expect(common.mock.calls[0][0]).toEqual({ from: '2026-01-01', to: '2026-01-31', limit: 5 });
    expect(common.mock.calls[1][0]).toEqual({ limit: 10 });
    expect(over.mock.calls[0][0]).toEqual({ from: '2026-01-01', to: '2026-03-31', bucket: 'month' });
  });

  it.each([
    '/reports/common-issues?limit=0',
    '/reports/common-issues?limit=1000',
    '/reports/frequent-visitors?limit=abc',
    '/reports/visits-over-time?bucket=year',
    '/reports/peak-hours?from=2026-02-30',
    '/reports/visits-by-branch?from=2026-02-01&to=2026-01-01',
    '/reports/visits-by-batch?to=yesterday',
  ])('400 VALIDATION_ERROR for %s', async (path) => {
    const h = await buildHarness();
    expectError(await h.api('admin').get(path), 400, 'VALIDATION_ERROR');
  });
});

describe('GET /meta/*', () => {
  it('lists branches and health issues for STAFF and ADMIN', async () => {
    const h = await buildHarness();
    for (const who of ['staff', 'admin']) {
      const branches = await h.api(who).get('/meta/branches');
      expect(branches.status).toBe(200);
      expect(branches.body.find((b) => b.branch_code === '210')).toMatchObject({ branch_name: 'Computer Science and Engineering' });
      for (const b of branches.body) expect(Object.keys(b).sort()).toEqual(['branch_code', 'branch_id', 'branch_name']);

      const issues = await h.api(who).get('/meta/health-issues');
      expect(issues.status).toBe(200);
      expect(issues.body.length).toBeGreaterThan(0);
      for (const i of issues.body) expect(Object.keys(i).sort()).toEqual(['code', 'label']);
    }
  });

  it('requires authentication', async () => {
    const h = await buildHarness();
    expectError(await h.api(null).get('/meta/branches'), 401, 'UNAUTHENTICATED');
    expectError(await h.api(null).get('/meta/health-issues'), 401, 'UNAUTHENTICATED');
  });
});
