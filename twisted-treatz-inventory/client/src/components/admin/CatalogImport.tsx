import { useState, useRef } from "react";
import {
  importCatalog,
  type CatalogImportRow,
  type CatalogImportResult,
} from "../../api/adminClient";
import { parseInventorySheet } from "../../lib/sheet";

interface CatalogImportProps {
  token: string;
}

// Typed confirmation when an import would zero out this many products — the
// same backstop the Bulk Update screen uses against a blank/half-filled file.
const ZERO_CONFIRM_THRESHOLD = 20;

type Stage = "idle" | "preview" | "done";

export default function CatalogImport({ token }: CatalogImportProps) {
  const [stage, setStage] = useState<Stage>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<CatalogImportRow[]>([]);
  const [preview, setPreview] = useState<CatalogImportResult | null>(null);
  const [result, setResult] = useState<CatalogImportResult | null>(null);
  const [missingCols, setMissingCols] = useState<string[]>([]);
  const [zeroConfirm, setZeroConfirm] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  function resetToIdle() {
    setStage("idle");
    setRows([]);
    setPreview(null);
    setResult(null);
    setFileName("");
    setError(null);
    setMissingCols([]);
    setZeroConfirm("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setBusy(true);
    try {
      const { rows: parsed, missingColumns, totalRows } = await parseInventorySheet(file);
      if (totalRows === 0) throw new Error("No item rows found in the sheet");
      setRows(parsed);
      setMissingCols(missingColumns);
      const dry = await importCatalog(token, parsed, true);
      setPreview(dry);
      setStage("preview");
      setZeroConfirm("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the file");
      setFileName("");
    } finally {
      setBusy(false);
    }
  }

  async function handleApply() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const res = await importCatalog(token, rows, false);
      setResult(res);
      setStage("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  const s = preview?.summary;
  const zeroed = s?.zeroed ?? 0;
  const needsZeroConfirm = zeroed >= ZERO_CONFIRM_THRESHOLD;
  const zeroConfirmed = !needsZeroConfirm || zeroConfirm.trim().toUpperCase() === "ZERO";
  const nothingToDo = (s?.creates ?? 0) === 0 && (s?.updates ?? 0) === 0;

  return (
    <div className="max-w-4xl">
      <div className="mb-6 text-sm text-gray-600 leading-relaxed">
        Upload Hani's inventory sheet (<span className="font-mono">.xlsx</span> or{" "}
        <span className="font-mono">.csv</span>) with columns{" "}
        <span className="font-mono text-gray-800">Item, Category, Qty, Pack Size, UOM, Brand</span>.
        We match by item name: products we already have are updated, new ones are
        created, and the counted Qty is recorded in the Activity Log. A blank Qty
        is treated as 0 and flagged. Nothing is saved until you review the preview.
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Upload */}
      <div className="p-5 border border-gray-200 rounded-lg bg-white">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-medium text-gray-900">Upload inventory sheet</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {fileName ? (
                <span className="font-mono text-gray-700">{fileName}</span>
              ) : (
                "We'll show a full preview before anything is saved."
              )}
            </p>
          </div>
          <label className="shrink-0 px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 cursor-pointer transition-colors">
            Choose file…
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={handleFile}
              disabled={busy}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {/* Preview */}
      {stage === "preview" && preview && s && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Preview</h3>
            <button onClick={resetToIdle} className="text-sm text-gray-500 hover:text-gray-700">
              Cancel
            </button>
          </div>

          {missingCols.length > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-3">
              The sheet had no <strong>{missingCols.join(", ")}</strong> column — those
              fields are left blank and flagged for you to fill in the admin panel.
            </p>
          )}

          <div className="flex flex-wrap gap-2 mb-4 text-sm">
            <Chip label={`${s.creates} new products`} tone="green" />
            <Chip label={`${s.updates} updated`} tone="indigo" />
            {s.qtyChanges > 0 && <Chip label={`${s.qtyChanges} qty changes`} tone="indigo" />}
            {s.brandsToCreate > 0 && <Chip label={`${s.brandsToCreate} new brands`} tone="green" />}
            {s.unchanged > 0 && <Chip label={`${s.unchanged} unchanged`} tone="gray" />}
            {zeroed > 0 && <Chip label={`${zeroed} set to 0`} tone="amber" />}
            {s.flagged > 0 && <Chip label={`${s.flagged} flagged (blank cells)`} tone="amber" />}
            {s.errors > 0 && <Chip label={`${s.errors} skipped`} tone="red" />}
          </div>

          {/* New products */}
          {preview.creates.length > 0 && (
            <PreviewTable
              title={`New products (${preview.creates.length})`}
              head={["Item", "Category", "Brand", "Pack", "UOM", "Qty"]}
              rows={preview.creates.map((c) => [
                c.item,
                c.category ?? "—",
                c.brand ?? "—",
                c.packSize ?? "—",
                c.uom ?? "—",
                c.qty,
              ])}
            />
          )}

          {/* Updates */}
          {preview.updates.length > 0 && (
            <PreviewTable
              title={`Updated products (${preview.updates.length})`}
              head={["Item", "Changes", "Qty before", "Qty after"]}
              rows={preview.updates.map((u) => [
                u.item,
                Object.keys(u.changes).join(", ") || (u.qtyDelta !== 0 ? "qty" : "—"),
                u.qtyBefore,
                u.qtyAfter,
              ])}
            />
          )}

          {/* Flagged (blank cells → ask Hani) */}
          {preview.flagged.length > 0 && (
            <div className="mb-4">
              <p className="text-sm font-medium text-amber-800 mb-1">
                Flagged — blank cells for Hani to fill in the admin panel ({preview.flagged.length})
              </p>
              <ul className="text-xs text-gray-600 space-y-0.5 max-h-40 overflow-y-auto border border-amber-200 rounded-md p-2 bg-amber-50/40">
                {preview.flagged.map((f, i) => (
                  <li key={i}>
                    <span className="font-medium text-gray-800">{f.item}</span> — missing{" "}
                    {f.missing.join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Skipped */}
          {preview.skipped.length > 0 && (
            <div className="mb-4">
              <p className="text-sm font-medium text-gray-700 mb-1">
                Skipped rows ({preview.skipped.length})
              </p>
              <ul className="text-xs text-gray-500 space-y-0.5 max-h-32 overflow-y-auto">
                {preview.skipped.map((sk, i) => (
                  <li key={i}>
                    Row {sk.row}
                    {sk.item ? ` (${sk.item})` : ""}: {sk.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {needsZeroConfirm && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-700 mb-2">
                This will set <strong>{zeroed} products to zero</strong>. If that's
                intended, type <span className="font-mono font-bold">ZERO</span> to confirm.
              </p>
              <input
                type="text"
                value={zeroConfirm}
                onChange={(e) => setZeroConfirm(e.target.value)}
                placeholder="Type ZERO"
                className="px-3 py-2 border border-red-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-400 text-gray-900"
              />
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={handleApply}
              disabled={busy || nothingToDo || !zeroConfirmed}
              className="px-5 py-2.5 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {busy
                ? "Applying…"
                : nothingToDo
                  ? "Nothing to import"
                  : `Apply — ${s.creates} new, ${s.updates} updated`}
            </button>
            <button
              onClick={resetToIdle}
              disabled={busy}
              className="px-4 py-2.5 text-gray-600 text-sm hover:text-gray-900"
            >
              Start over
            </button>
          </div>
        </div>
      )}

      {/* Done */}
      {stage === "done" && result && (
        <div className="mt-6 p-5 border border-green-200 bg-green-50 rounded-lg">
          <h3 className="font-semibold text-green-800 mb-1">Catalog imported</h3>
          <p className="text-sm text-green-700">
            Created {result.summary.creates - result.applyFailures.filter((f) => f.reason.includes("created")).length}{" "}
            products, updated{" "}
            {result.summary.updates - result.applyFailures.filter((f) => f.reason.includes("updated")).length}.
            {result.summary.brandsToCreate > 0 && ` Added ${result.summary.brandsToCreate} brands.`}
            {result.summary.flagged > 0 &&
              ` ${result.summary.flagged} items have blank cells to fill in the admin panel.`}
            {result.summary.errors > 0 && ` ${result.summary.errors} rows were skipped.`}{" "}
            All quantity changes are in the Activity Log.
          </p>
          {result.applyFailures.length > 0 && (
            <div className="mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm font-medium text-red-700 mb-1">
                {result.applyFailures.length} rows failed to save — re-upload to retry these:
              </p>
              <ul className="text-xs text-red-600 space-y-0.5 max-h-32 overflow-y-auto">
                {result.applyFailures.map((f, i) => (
                  <li key={i}>
                    {f.item}: {f.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button
            onClick={resetToIdle}
            className="mt-3 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-50"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}

function PreviewTable({
  title,
  head,
  rows,
}: {
  title: string;
  head: string[];
  rows: (string | number | null)[][];
}) {
  return (
    <div className="mb-4">
      <p className="text-sm font-medium text-gray-700 mb-1">{title}</p>
      <div className="border border-gray-200 rounded-lg overflow-hidden max-h-80 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
            <tr>
              {head.map((h) => (
                <th key={h} className="text-left px-3 py-2 font-medium text-gray-600">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-gray-50">
                {r.map((c, j) => (
                  <td key={j} className="px-3 py-1.5 text-gray-800">
                    {c ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Chip({
  label,
  tone,
}: {
  label: string;
  tone: "indigo" | "green" | "red" | "amber" | "gray";
}) {
  const tones: Record<string, string> = {
    indigo: "bg-indigo-50 text-indigo-700 border-indigo-200",
    green: "bg-green-50 text-green-700 border-green-200",
    red: "bg-red-50 text-red-700 border-red-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    gray: "bg-gray-100 text-gray-600 border-gray-200",
  };
  return (
    <span className={`px-2.5 py-1 rounded-full border text-xs font-medium ${tones[tone]}`}>
      {label}
    </span>
  );
}
