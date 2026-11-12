import { useRef, useState, type ReactNode } from "react";
import {
  exportGroupingCsv,
  importGrouping,
  type GroupingGroupMeta,
  type GroupingImportResult,
  type GroupingImportRow,
} from "../../api/adminClient";
import { downloadCsvFile } from "../../lib/csv";
import { parseGroupingSheet } from "../../lib/sheet";

// ─── Grouping sheet round-trip ───────────────────────────────────────
// Download the sheet, set each product's Group / Variation (and mark
// discontinued), upload it back. Upload always previews first (dry run);
// nothing is saved until Apply. `children` render on the left of the
// button row so the caller can put its own view controls there.

interface GroupingSheetProps {
  token: string;
  onChanged: () => void;
  children?: ReactNode;
}

export default function GroupingSheet({ token, onChanged, children }: GroupingSheetProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<GroupingImportResult | null>(null);
  const [pendingPayload, setPendingPayload] = useState<{
    rows: GroupingImportRow[];
    groups: GroupingGroupMeta[];
  } | null>(null);
  const [applyResult, setApplyResult] = useState<GroupingImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleDownload() {
    setBusy(true);
    setError(null);
    try {
      const { csv } = await exportGroupingCsv(token);
      downloadCsvFile(csv, `grouping-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not download the grouping sheet");
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    setApplyResult(null);
    try {
      const { rows, groups } = await parseGroupingSheet(file);
      if (rows.length === 0) throw new Error("No usable rows found in the sheet");
      const result = await importGrouping(token, rows, groups, true);
      setPreview(result);
      setPendingPayload({ rows, groups });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the grouping sheet");
      setPreview(null);
      setPendingPayload(null);
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleApply() {
    if (!pendingPayload) return;
    setBusy(true);
    setError(null);
    try {
      const result = await importGrouping(token, pendingPayload.rows, pendingPayload.groups, false);
      setApplyResult(result);
      setPreview(null);
      setPendingPayload(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  const totalPlanned = preview
    ? preview.summary.grouped +
      preview.summary.ungrouped +
      preview.summary.categoryChanges +
      preview.summary.deactivations +
      preview.labelChanges.length
    : 0;

  return (
    <div className="mb-4">
      <div className="flex items-center gap-3 flex-wrap">
        {children}
        <div className="flex gap-2 ml-auto">
          <button
            onClick={handleDownload}
            disabled={busy}
            title="Download the Grouping sheet (CSV) — set each product's Group and Variation, then upload it back"
            className="px-3 py-1.5 bg-white text-gray-700 border border-gray-300 text-sm font-medium rounded-md hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
          >
            Download Grouping Sheet
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className="px-3 py-1.5 bg-white text-indigo-700 border border-indigo-300 text-sm font-medium rounded-md hover:bg-indigo-50 disabled:opacity-50 whitespace-nowrap"
          >
            {busy ? "Working…" : "Upload Grouping Sheet"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
        </div>
      </div>

      {error && (
        <div className="mt-3 px-4 py-2.5 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          {error}
        </div>
      )}

      {applyResult && (
        <div className="mt-3 px-4 py-3 bg-green-50 border border-green-200 rounded-md text-sm text-green-800">
          Grouping applied: {applyResult.summary.grouped} grouped,{" "}
          {applyResult.summary.ungrouped} ungrouped, {applyResult.summary.newGroups} new groups,{" "}
          {applyResult.summary.deactivations} discontinued
          {applyResult.groupsDeleted > 0 && `, ${applyResult.groupsDeleted} empty groups removed`}
          {applyResult.summary.failed > 0 && (
            <span className="text-red-700"> — {applyResult.summary.failed} rows failed</span>
          )}
        </div>
      )}

      {preview && (
        <div className="mt-3 p-4 border border-gray-200 rounded-lg bg-white">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Grouping preview — nothing saved yet</h3>
            <button
              onClick={() => {
                setPreview(null);
                setPendingPayload(null);
              }}
              className="text-sm text-gray-500 hover:text-gray-800"
            >
              Cancel
            </button>
          </div>
          <div className="flex flex-wrap gap-2 mb-3 text-xs">
            <span className="px-2 py-1 rounded-full bg-indigo-50 text-indigo-700">
              {preview.summary.grouped} grouped
            </span>
            <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-700">
              {preview.summary.ungrouped} ungrouped
            </span>
            <span className="px-2 py-1 rounded-full bg-green-50 text-green-700">
              {preview.summary.newGroups} new groups
            </span>
            <span className="px-2 py-1 rounded-full bg-amber-50 text-amber-700">
              {preview.summary.categoryChanges} category changes
            </span>
            <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-700">
              {preview.summary.unchanged} unchanged
            </span>
            {preview.summary.errors > 0 && (
              <span className="px-2 py-1 rounded-full bg-red-50 text-red-700">
                {preview.summary.errors} skipped rows
              </span>
            )}
          </div>

          {preview.deactivations.length > 0 && (
            <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-md text-sm text-red-800">
              <strong>{preview.deactivations.length} products will be discontinued</strong>{" "}
              (hidden from the app; stock is not changed):
              <ul className="mt-1 list-disc list-inside">
                {preview.deactivations.map((d) => (
                  <li key={d.id}>
                    {d.item}
                    {d.qtyOnHand > 0 && <strong> — still has {d.qtyOnHand} on hand</strong>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preview.groupChanges.length > 0 && (
            <div className="mb-3 max-h-56 overflow-y-auto border border-gray-100 rounded">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-gray-600">Product</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-600">Group</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-600">Variation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {preview.groupChanges.map((c) => (
                    <tr key={c.id}>
                      <td className="px-3 py-1.5 text-gray-900">{c.item}</td>
                      <td className="px-3 py-1.5 text-gray-600">
                        {c.fromGroup ?? "—"} → {c.toGroup ?? "—"}
                      </td>
                      <td className="px-3 py-1.5 text-gray-600">
                        {c.fromVariant ?? "—"} → {c.toVariant ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {preview.skipped.length > 0 && (
            <p className="mb-3 text-xs text-amber-700">
              Skipped: {preview.skipped.map((s) => `${s.id ?? `row ${s.row}`} (${s.reason})`).join(", ")}
            </p>
          )}

          <button
            onClick={handleApply}
            disabled={busy || totalPlanned === 0}
            className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 disabled:opacity-50"
          >
            {busy ? "Applying…" : `Apply — ${totalPlanned} changes`}
          </button>
        </div>
      )}
    </div>
  );
}
