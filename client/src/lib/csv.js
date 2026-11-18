/** Quote every cell; neutralise spreadsheet formulas typed into free-text fields (CSV injection). */
export function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** @param {{header:string, value:(row:any)=>any}[]} columns @param {any[]} rows */
export function toCsv(columns, rows) {
  const head = columns.map((c) => csvCell(c.header)).join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(c.value(r))).join(','));
  return `${[head, ...body].join('\r\n')}\r\n`;
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** BOM first so Excel opens it as UTF-8. */
export function downloadCsv(filename, text) {
  downloadBlob(filename, new Blob([`\uFEFF${text}`], { type: 'text/csv;charset=utf-8' }));
}
