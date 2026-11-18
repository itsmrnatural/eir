import { useQuery } from '@tanstack/react-query';
import DataTable from '../../components/DataTable.jsx';
import { Empty, ErrorBox, Loading } from '../../components/States.jsx';

/**
 * One report: fetch, then loading / error / empty / chart + an optional collapsible data table.
 * `chart(data)` renders the main view; `columns` (optional) add a "Show data table" disclosure.
 * `table` instead makes the table itself the main view (e.g. frequent visitors).
 */
export default function ReportCard({ title, queryKey, fetcher, enabled, chart, columns, table, controls, rows }) {
  const q = useQuery({ queryKey: ['reports', ...queryKey], queryFn: fetcher, enabled });
  const data = q.data;
  const tableRows = data ? (rows ? rows(data) : data) : [];

  let body;
  if (!enabled) body = <Empty>Choose a valid date range to see this report.</Empty>;
  else if (q.isLoading) body = <Loading />;
  else if (q.isError) body = <ErrorBox error={q.error} onRetry={q.refetch} />;
  else if (!data?.length) body = <Empty>No visits in this date range.</Empty>;
  else if (table) body = <DataTable columns={table} rows={tableRows} caption={title} />;
  else
    body = (
      <>
        {chart(data)}
        {columns && (
          <details className="data-disclosure">
            <summary>Show data table</summary>
            <DataTable columns={columns} rows={tableRows} caption={title} />
          </details>
        )}
      </>
    );

  return (
    <section className="card report" aria-label={title} aria-busy={q.isFetching}>
      <header>
        <h2>{title}</h2>
        {controls}
      </header>
      {body}
    </section>
  );
}
