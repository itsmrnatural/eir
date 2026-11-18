// Minimal RFC-4180 CSV reader (quotes, escaped quotes, CRLF, BOM, quoted newlines).
// Returns records with the 1-based line number the record STARTS on, so import reports
// match the row numbers a spreadsheet shows (header is row 1).

export function parseCsv(text) {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;
  let touched = false; // saw any content in the current row

  const endField = () => { row.push(field); field = ''; };
  const endRow = () => {
    endField();
    if (touched || row.length > 1 || row[0] !== '') rows.push({ line: rowLine, cells: row });
    row = []; touched = false;
  };

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else {
        if (ch === '\n') line += 1;
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true; touched = true;
    } else if (ch === ',') {
      endField(); touched = true;
    } else if (ch === '\r') {
      if (src[i + 1] === '\n') i += 1;
      endRow(); line += 1; rowLine = line;
    } else if (ch === '\n') {
      endRow(); line += 1; rowLine = line;
    } else {
      field += ch; touched = true;
    }
  }
  if (inQuotes) throw new Error(`CSV ends inside a quoted field that started near line ${rowLine}`);
  if (touched || field !== '' || row.length > 0) endRow();
  return rows;
}

/** @returns {{header: string[], records: {line:number, values: Record<string,string>}[]}} */
export function parseCsvRecords(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) return { header: [], records: [] };
  const header = rows[0].cells.map((h) => h.trim().toLowerCase());
  const records = rows.slice(1).map(({ line, cells }) => {
    const values = {};
    header.forEach((h, idx) => { values[h] = (cells[idx] ?? '').trim(); });
    return { line, values, extraCells: cells.length > header.length };
  });
  return { header, records };
}
