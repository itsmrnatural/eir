import { useState } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../api/index.js';
import ExportFhirButton from '../components/ExportFhirButton.jsx';
import { HBar, TimeLine, VBar } from '../features/reports/charts.jsx';
import RangePicker from '../features/reports/RangePicker.jsx';
import ReportCard from '../features/reports/ReportCard.jsx';
import { addDays, rangeError, todayIST } from '../lib/datetime.js';

const pad = (h) => String(h).padStart(2, '0');
/** The API returns only hours that have visits; the chart always shows all 24. */
const fillHours = (rows) => {
  const byHour = new Map(rows.map((r) => [r.hour, r.count]));
  return Array.from({ length: 24 }, (_, h) => ({ hour: h, label: pad(h), count: byHour.get(h) ?? 0 }));
};

export default function ReportsPage() {
  const [from, setFrom] = useState(() => addDays(todayIST(), -29));
  const [to, setTo] = useState(() => todayIST());
  const [bucket, setBucket] = useState('day');

  const problem = rangeError(from, to) || (!from || !to ? 'Choose both dates.' : null);
  const enabled = !problem;
  const range = { from, to };

  return (
    <div className="page reports-page">
      <div className="page-head">
        <h1>Reports</h1>
        <ExportFhirButton
          label="Export all visits (FHIR bulk)"
          filename={`fhir-bulk_${from}_${to}.json`}
          fetcher={() => api.exportFhirBulk(range)}
          disabled={!enabled}
        />
      </div>
      <RangePicker from={from} to={to} error={problem} onChange={(f, t) => { setFrom(f); setTo(t); }} />
      <p className="hint">Dates are in Asia/Kolkata, both ends included. Peak hours are grouped by Kolkata time.</p>

      <div className="report-grid">
        <ReportCard
          title="Most common health issues"
          queryKey={['common-issues', from, to]}
          enabled={enabled}
          fetcher={() => api.reports.commonIssues({ ...range, limit: 10 })}
          chart={(d) => <HBar data={d} nameKey="health_issue" valueKey="count" label="Visits by health issue" />}
          columns={[
            { header: 'Health issue', value: (r) => r.health_issue },
            { header: 'Visits', value: (r) => r.count, align: 'right' },
          ]}
        />

        <ReportCard
          title="Peak hours"
          queryKey={['peak-hours', from, to]}
          enabled={enabled}
          fetcher={() => api.reports.peakHours(range)}
          chart={(d) => <VBar data={fillHours(d)} nameKey="label" valueKey="count" label="Visits by hour of day, 24-hour clock" />}
          rows={fillHours}
          columns={[
            { header: 'Hour (IST)', value: (r) => `${pad(r.hour)}:00 to ${pad(r.hour)}:59` },
            { header: 'Visits', value: (r) => r.count, align: 'right' },
          ]}
        />

        <ReportCard
          title="Visits over time"
          queryKey={['over-time', from, to, bucket]}
          enabled={enabled}
          fetcher={() => api.reports.visitsOverTime({ ...range, bucket })}
          controls={
            <label className="inline">
              Group by
              <select value={bucket} onChange={(e) => setBucket(e.target.value)}>
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
              </select>
            </label>
          }
          chart={(d) => <TimeLine data={d} nameKey="bucket" valueKey="count" label={`Visits per ${bucket}`} />}
          columns={[
            { header: bucket[0].toUpperCase() + bucket.slice(1), value: (r) => r.bucket },
            { header: 'Visits', value: (r) => r.count, align: 'right' },
          ]}
        />

        <ReportCard
          title="Visits by branch"
          queryKey={['by-branch', from, to]}
          enabled={enabled}
          fetcher={() => api.reports.visitsByBranch(range)}
          chart={(d) => <HBar data={d} nameKey="branch_name" valueKey="count" label="Student visits by branch" />}
          columns={[
            { header: 'Branch', value: (r) => r.branch_name },
            { header: 'Visits', value: (r) => r.count, align: 'right' },
          ]}
        />

        <ReportCard
          title="Visits by admission batch"
          queryKey={['by-batch', from, to]}
          enabled={enabled}
          fetcher={() => api.reports.visitsByBatch(range)}
          chart={(d) => <VBar data={d.map((r) => ({ ...r, label: String(r.batch_year) }))} nameKey="label" valueKey="count" label="Student visits by admission year" />}
          columns={[
            { header: 'Admission year', value: (r) => r.batch_year },
            { header: 'Visits', value: (r) => r.count, align: 'right' },
          ]}
        />

        <ReportCard
          title="Most frequent visitors"
          queryKey={['frequent', from, to]}
          enabled={enabled}
          fetcher={() => api.reports.frequentVisitors({ ...range, limit: 10 })}
          table={[
            { header: 'Name', value: (r) => <Link to={`/patients/${r.patient_id}`}>{r.name}</Link> },
            { header: 'Type', value: (r) => (r.patient_type === 'STUDENT' ? 'Student' : 'Non-student') },
            { header: 'Visits', value: (r) => r.count, align: 'right' },
          ]}
        />
      </div>
    </div>
  );
}
