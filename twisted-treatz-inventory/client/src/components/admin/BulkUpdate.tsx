import { useState, useRef } from "react";
import {
  exportAdjustmentsCsv,
  importAdjustments,
  type AdjustmentImportRow,
  type AdjustmentImportResult,
} from "../../api/adminClient";
import { parseCsv } from "../../lib/csv";

interface BulkUpdateProps {
  token: string;
}

// Typed confirmation kicks in when an import would zero out this many SKUs —
// a backstop against re-importing a blank/half-edited file.
const ZERO_CONFIRM_THRESHOLD = 20;

type Stage = "idle" | "preview" | "done";

export default function BulkUpdate({ token }: BulkUpdateProps) {
  const [stage, setStage] = useState<Stage>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [rows, setRows] = useState<AdjustmentImportRow[]>([]);
  const [preview, setPreview] = useState<AdjustmentImportResult | null>(null);
  const [result, setResult] = useState<AdjustmentImportResult | null>(null);
  const [zeroConfirm, setZeroConfirm] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  function resetToIdle() {
    setStage("idle");
    setRows([]);
    setPreview(null);
    setResult(null);
    setFileName("");
    setError(null);
    setZeroConfirm("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleDownload() {
    setBusy(true);
    setError(null);
    try {
      const { csv } = await exportAdjustmentsCsv(token);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `inventory-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setBusy(true);
    try {
      const text = await file.text();
      const table = parseCsv(text);
      if (table.length < 2) throw new Error("CSV has no data rows");

      const header = table[0].map((h) => h.trim().toLowerCase());
      const idCol = header.indexOf("id");
      const newQtyCol = header.indexOf("new_qty");
      const curQtyCol = header.indexOf("current_qty");
      const noteCol = header.indexOf("note");
      if (idCol === -1 || newQtyCol === -1) {
        throw new Error('CSV must include "id" and "new_qty" columns');
      }

      // Only rows where new_qty was filled in are submitted
      const parsed: AdjustmentImportRow[] = [];
      for (let i = 1; i < table.length; i++) {
        const cells = table[i];
        const rawNew = (cells[newQtyCol] ?? "").trim();
        if (rawNew === "") continue;
        const id = Number((cells[idCol] ?? "").trim());
        const newQty = Number(rawNew);
        const row: AdjustmentImportRow = { id, newQty };
        if (curQtyCol !== -1) {
          const c = Number((cells[curQtyCol] ?? "").trim());
          if (Number.isInteger(c)) row.csvQty = c;
        }
        if (noteCol !== -1) {
          const n = (cells[noteCol] ?? "").trim();
          if (n) row.note = n;
        }
        parsed.push(row);
      }

      if (parsed.length === 0) {
        throw new Error("No rows had a new_qty value — nothing to update");
      }

      setRows(parsed);
      const dry = await importAdjustments(token, parsed, true);
      setPreview(dry);
      setStage("preview");
      setZeroConfirm("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read file");
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
      const res = await importAdjustments(token, rows, false);
      setResult(res);
      setStage("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  const zeroed = preview?.summary.zeroed ?? 0;
  const needsZeroConfirm = zeroed >= ZERO_CONFIRM_THRESHOLD;
  const zeroConfirmed = !needsZeroConfirm || zeroConfirm.trim().toUpperCase() === "ZERO";
  const noChanges = (preview?.summary.changes ?? 0) === 0;

  return (
    <div className="max-w-4xl">
      {/* Intro */}
      <div className="mb-6 text-sm text-gray-600 leading-relaxed">
        Export the full inventory to a spreadsheet, edit the{" "}
        <span className="font-mono font-medium text-gray-800">new_qty</span> column
        for any products you want to change, then upload it back. Leave a row blank
        to skip it. Every change is recorded in the Activity Log with your name and
        timestamp.
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Step 1: Download */}
      <div className="mb-4 p-5 border border-gray-200 rounded-lg bg-white">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-medium text-gray-900">1. Download current inventory</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              A CSV snapshot of every active product and its current quantity.
            </p>
          </div>
          <button
            onClick={handleDownload}
            disabled={busy}
            className="shrink-0 px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            Download CSV
          </button>
        </div>
      </div>

      {/* Step 2: Upload */}
      <div className="p-5 border border-gray-200 rounded-lg bg-white">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-medium text-gray-900">2. Upload your edited file</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {fileName ? (
                <span className="font-mono text-gray-700">{fileName}</span>
              ) : (
                "We'll show you a preview before anything is saved."
              )}
            </p>
          </div>
          <label className="shrink-0 px-4 py-2 bg-gray-100 text-gray-700 border border-gray-300 rounded-md text-sm font-medium hover:bg-gray-200 cursor-pointer transition-colors">
            Choose file…
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFile}
              disabled={busy}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {/* Preview */}
      {stage === "preview" && preview && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Preview</h3>
            <button
              onClick={resetToIdle}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>

          {/* Summary chips */}
          <div className="flex flex-wrap gap-2 mb-4 text-sm">
            <Chip label={`${preview.summary.changes} changes`} tone="indigo" />
            {preview.summary.added > 0 && (
              <Chip label={`+${preview.summary.added} added`} tone="green" />
            )}
            {preview.summary.removed > 0 && (
              <Chip label={`−${preview.summary.removed} removed`} tone="red" />
            )}
            {preview.summary.unchanged > 0 && (
              <Chip label={`${preview.summary.unchanged} unchanged`} tone="gray" />
            )}
            {preview.summary.conflicts > 0 && (
              <Chip label={`${preview.summary.conflicts} conflicts`} tone="amber" />
            )}
            {zeroed > 0 && <Chip label={`${zeroed} set to 0`} tone="amber" />}
            {preview.summary.belowThreshold > 0 && (
              <Chip label={`${preview.summary.belowThreshold} low stock`} tone="amber" />
            )}
            {preview.summary.errors > 0 && (
              <Chip label={`${preview.summary.errors} errors`} tone="red" />
            )}
          </div>

          {preview.summary.conflicts > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-3">
              Conflict rows changed on the floor after you exported. Your value will
              overwrite the current count when applied.
            </p>
          )}

          {/* Applied table */}
          {preview.applied.length > 0 && (
            <div className="border border-gray-200 rounded-lg overflow-hidden mb-4 max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium text-gray-600">Product</th>
                    <th className="text-right px-4 py-2.5 font-medium text-gray-600">Before</th>
                    <th className="text-right px-4 py-2.5 font-medium text-gray-600">After</th>
                    <th className="text-right px-4 py-2.5 font-medium text-gray-600">Change</th>
                    <th className="text-left px-4 py-2.5 font-medium text-gray-600">Flags</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {preview.applied.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-900">{r.name}</td>
                      <td className="px-4 py-2 text-right font-mono text-gray-500">{r.qtyBefore}</td>
                      <td className="px-4 py-2 text-right font-mono text-gray-900 font-medium">{r.qtyAfter}</td>
                      <td
                        className={`px-4 py-2 text-right font-mono font-medium ${
                          r.delta > 0 ? "text-green-600" : "text-red-600"
                        }`}
                      >
                        {r.delta > 0 ? `+${r.delta}` : r.delta}
                      </td>
                      <td className="px-4 py-2 text-xs space-x-1">
                        {r.conflict && <span className="text-amber-700">conflict</span>}
                        {r.belowThreshold && <span className="text-amber-700">low</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Skipped rows */}
          {preview.skipped.length > 0 && (
            <div className="mb-4">
              <p className="text-sm font-medium text-gray-700 mb-1">
                Skipped rows ({preview.skipped.length})
              </p>
              <ul className="text-xs text-gray-500 space-y-0.5 max-h-32 overflow-y-auto">
                {preview.skipped.map((s, i) => (
                  <li key={i}>
                    Row {s.row}
                    {s.id != null ? ` (id ${s.id})` : ""}: {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Zeroing guard */}
          {needsZeroConfirm && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-700 mb-2">
                This will set <strong>{zeroed} products to zero</strong>. If that's
                intended, type <span className="font-mono font-bold">ZERO</span> to
                confirm.
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

          {/* Apply */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleApply}
              disabled={busy || noChanges || !zeroConfirmed}
              className="px-5 py-2.5 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {busy
                ? "Applying…"
                : noChanges
                  ? "No changes to apply"
                  : `Apply ${preview.summary.changes} changes`}
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
          <h3 className="font-semibold text-green-800 mb-1">Inventory updated</h3>
          <p className="text-sm text-green-700">
            Applied {result.summary.changes} changes (+{result.summary.added} /
            −{result.summary.removed}).
            {result.summary.errors > 0 &&
              ` ${result.summary.errors} rows were skipped.`}{" "}
            All changes are in the Activity Log.
          </p>
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
