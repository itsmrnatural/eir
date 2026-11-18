/** @param {{columns:{header:string, value:(row:any)=>any, align?:'right', className?:string}[], rows:any[], caption?:string}} props */
export default function DataTable({ columns, rows, caption }) {
  const cls = (c) => [c.align === 'right' ? 'num' : '', c.className ?? ''].join(' ').trim() || undefined;
  return (
    <div className="table-wrap">
      <table>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.header} scope="col" className={cls(c)}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key ?? r.visit_id ?? r.patient_id ?? i}>
              {columns.map((c) => (
                <td key={c.header} className={cls(c)}>{c.value(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
