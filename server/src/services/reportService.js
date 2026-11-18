/** Thin pass-throughs: the aggregation lives in the repositories. */
export function createReportService({ repos }) {
  return {
    commonIssues: ({ from, to, limit }) => repos.reports.commonIssues({ from, to, limit }),
    peakHours: ({ from, to }) => repos.reports.peakHours({ from, to }),
    frequentVisitors: ({ from, to, limit }) => repos.reports.frequentVisitors({ from, to, limit }),
    visitsByBranch: ({ from, to }) => repos.reports.visitsByBranch({ from, to }),
    visitsByBatch: ({ from, to }) => repos.reports.visitsByBatch({ from, to }),
    visitsOverTime: ({ from, to, bucket }) => repos.reports.visitsOverTime({ from, to, bucket }),
  };
}
