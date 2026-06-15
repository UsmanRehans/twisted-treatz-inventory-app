// Minimal RFC-4180 CSV parser — enough for the bulk-adjustment round trip
// (server-generated export, edited in Excel/Sheets, re-uploaded). Handles
// quoted fields, embedded commas/quotes/newlines, a UTF-8 BOM, and CRLF.
// We avoid a dependency because the only CSV the app touches is its own.
export function parseCsv(text: string): string[][] {
  // Strip a leading BOM if present
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++; // consume the escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      // Close the field/row; swallow the \n of a \r\n pair
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }

  // Flush the trailing field/row (file may not end in a newline)
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop fully-blank rows (trailing newline, stray empty lines)
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}
