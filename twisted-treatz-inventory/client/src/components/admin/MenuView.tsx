import { Fragment, useMemo, useRef, useState } from "react";
import {
  exportGroupingCsv,
  importGrouping,
  type AdminProduct,
  type GroupingGroupMeta,
  type GroupingImportResult,
  type GroupingImportRow,
} from "../../api/adminClient";
import { downloadCsvFile } from "../../lib/csv";
import { parseGroupingSheet } from "../../lib/sheet";

// ─── Menu view ───────────────────────────────────────────────────────
// Hani's menu: the same products the All Products table shows, folded so
// every flavor/size of one item is a single line ("Jelly Beans — 37
// flavors") under its category. Read-only — editing stays in All Products;
// grouping itself is maintained through the Grouping sheet round-trip.

interface MenuViewProps {
  token: string;
  products: AdminProduct[];
  loading: boolean;
  onChanged: () => void;
}

type MenuItem =
  | { kind: "group"; key: string; name: string; variantLabel: string; variants: AdminProduct[] }
  | { kind: "single"; key: string; product: AdminProduct };

function itemName(i: MenuItem): string {
  return i.kind === "group" ? i.name : i.product.name;
}

// Worst-of across the item's products: Out beats Low beats OK.
function itemStatus(products: AdminProduct[]): "out" | "low" | "ok" {
  let status: "out" | "low" | "ok" = "ok";
  for (const p of products) {
    if (p.currentQty === 0) return "out";
    if (p.currentQty <= p.alertThreshold) status = "low";
  }
  return status;
}

function StatusBadge({ status }: { status: "out" | "low" | "ok" }) {
  const styles = {
    out: "bg-red-100 text-red-700",
    low: "bg-orange-100 text-orange-700",
    ok: "bg-green-100 text-green-700",
  } as const;
  const labels = { out: "Out", low: "Low", ok: "OK" } as const;
  return (
    <span
      className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}

export default function MenuView({ token, products, loading, onChanged }: MenuViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<GroupingImportResult | null>(null);
  const [pendingPayload, setPendingPayload] = useState<{
    rows: GroupingImportRow[];
    groups: GroupingGroupMeta[];
  } | null>(null);
  const [applyResult, setApplyResult] = useState<GroupingImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fold the (already filtered) product list into menu items per category.
  const sections = useMemo(() => {
    const groups = new Map<
      number,
      { name: string; variantLabel: string; variants: AdminProduct[] }
    >();
    const singles: AdminProduct[] = [];
    for (const p of products) {
      if (p.group) {
        const g = groups.get(p.group.id);
        if (g) g.variants.push(p);
        else
          groups.set(p.group.id, {
            name: p.group.name,
            variantLabel: p.group.variantLabel,
            variants: [p],
          });
      } else {
        singles.push(p);
      }
    }

    const byCategory = new Map<string, MenuItem[]>();
    const push = (category: string, item: MenuItem) => {
      const list = byCategory.get(category);
      if (list) list.push(item);
      else byCategory.set(category, [item]);
    };
    for (const [id, g] of groups) {
      // After an import every variant shares the group's category; before
      // one, the first variant's category is as good a home as any.
      push(g.variants[0].category, {
        kind: "group",
        key: `g${id}`,
        name: g.name,
        variantLabel: g.variantLabel,
        variants: g.variants,
      });
    }
    for (const p of singles) {
      push(p.category, { kind: "single", key: `p${p.id}`, product: p });
    }

    return [...byCategory.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, items]) => ({
        category,
        items: items.sort((a, b) => itemName(a).localeCompare(itemName(b))),
      }));
  }, [products]);

  const hasGroups = useMemo(() => products.some((p) => p.group), [products]);
  const itemCount = sections.reduce((n, s) => n + s.items.length, 0);

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

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
    <div>
      {error && (
        <div className="mb-3 px-4 py-2.5 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="text-sm text-gray-600">
          {loading
            ? "Loading..."
            : `${itemCount} items (${products.length} products with flavors folded in)`}
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleDownload}
            disabled={busy}
            title="Download the Grouping sheet (CSV) — set each product's Group and Variation, then upload it back"
            className="px-4 py-2 bg-white text-gray-700 border border-gray-300 text-sm font-medium rounded-md hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
          >
            Download Grouping Sheet
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
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

      {applyResult && (
        <div className="mb-4 px-4 py-3 bg-green-50 border border-green-200 rounded-md text-sm text-green-800">
          Grouping applied: {applyResult.summary.grouped} grouped,{" "}
          {applyResult.summary.ungrouped} ungrouped, {applyResult.summary.newGroups} new groups,{" "}
          {applyResult.summary.deactivations} discontinued
          {applyResult.groupsDeleted > 0 && `, ${applyResult.groupsDeleted} empty groups removed`}
          {applyResult.summary.failed > 0 && (
            <span className="text-red-700"> — {applyResult.summary.failed} rows failed</span>
          )}
        </div>
      )}

      {/* Import preview */}
      {preview && (
        <div className="mb-4 p-4 border border-gray-200 rounded-lg bg-white">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Preview — nothing saved yet</h3>
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
                    {d.qtyOnHand > 0 && (
                      <strong> — still has {d.qtyOnHand} on hand</strong>
                    )}
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

      {/* Menu */}
      {loading ? (
        <div className="text-center text-gray-500 py-8">Loading products...</div>
      ) : !hasGroups && !preview ? (
        <div className="border border-dashed border-gray-300 rounded-lg p-8 text-center text-gray-500 text-sm">
          No menu yet — download the Grouping sheet, fill the Group and Variation columns
          (or use the one Hani already has), and upload it back. Flavors fold under one
          item; stock stays counted per flavor.
        </div>
      ) : (
        <div className="space-y-6">
          {sections.map((section) => (
            <div key={section.category}>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                {section.category}
              </h3>
              <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-gray-100">
                    {section.items.map((item) => {
                      if (item.kind === "single") {
                        const p = item.product;
                        return (
                          <tr key={item.key} className="hover:bg-gray-50">
                            <td className="px-4 py-2.5 text-gray-900 font-medium w-6" />
                            <td className="px-4 py-2.5 text-gray-900 font-medium">{p.name}</td>
                            <td className="px-4 py-2.5 text-gray-400 text-xs" />
                            <td className="px-4 py-2.5 text-right text-gray-900 font-mono w-24">
                              {p.currentQty}
                            </td>
                            <td className="px-4 py-2.5 text-center w-20">
                              <StatusBadge status={itemStatus([p])} />
                            </td>
                          </tr>
                        );
                      }
                      const isOpen = expanded.has(item.key);
                      const totalQty = item.variants.reduce((n, v) => n + v.currentQty, 0);
                      const label = item.variantLabel.toLowerCase();
                      return (
                        <Fragment key={item.key}>
                          <tr
                            onClick={() => toggle(item.key)}
                            className="hover:bg-gray-50 cursor-pointer select-none"
                          >
                            <td className="px-4 py-2.5 text-gray-400 w-6">
                              {isOpen ? "▾" : "▸"}
                            </td>
                            <td className="px-4 py-2.5 text-gray-900 font-medium">{item.name}</td>
                            <td className="px-4 py-2.5 text-gray-500 text-xs">
                              {item.variants.length} {label}
                              {item.variants.length === 1 ? "" : "s"}
                            </td>
                            <td className="px-4 py-2.5 text-right text-gray-900 font-mono w-24">
                              {totalQty}
                            </td>
                            <td className="px-4 py-2.5 text-center w-20">
                              <StatusBadge status={itemStatus(item.variants)} />
                            </td>
                          </tr>
                          {isOpen &&
                            item.variants
                              .slice()
                              .sort((a, b) => (a.variant ?? a.name).localeCompare(b.variant ?? b.name))
                              .map((v) => (
                                <tr key={`${item.key}-${v.id}`} className="bg-gray-50/60">
                                  <td className="w-6" />
                                  <td className="px-4 py-2 pl-10 text-gray-700">
                                    {v.variant ?? v.name}
                                  </td>
                                  <td className="px-4 py-2 text-gray-400 text-xs">
                                    threshold {v.alertThreshold}
                                  </td>
                                  <td className="px-4 py-2 text-right text-gray-700 font-mono w-24">
                                    {v.currentQty}
                                  </td>
                                  <td className="px-4 py-2 text-center w-20">
                                    <StatusBadge status={itemStatus([v])} />
                                  </td>
                                </tr>
                              ))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
