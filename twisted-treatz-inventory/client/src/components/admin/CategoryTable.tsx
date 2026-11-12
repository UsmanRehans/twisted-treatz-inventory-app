import { Fragment, useMemo, useState, type ReactNode } from "react";
import type { AdminProduct } from "../../api/adminClient";

// ─── One category's table ────────────────────────────────────────────
// Collapsible section with its own sort state. Rows are either a single
// product or a flavor group (Jelly Beans → 37 flavors) that expands into
// its variants. Default order is priority: high risk first, then the
// emptiest shelves. Clicking a column header re-sorts just this table.

export type CategoryRow =
  | { kind: "group"; key: string; name: string; variantLabel: string; products: AdminProduct[] }
  | { kind: "single"; key: string; product: AdminProduct };

type SortField =
  | "priority"
  | "name"
  | "brand"
  | "unit"
  | "packSize"
  | "qty"
  | "threshold"
  | "status";

type Status = "out" | "low" | "ok" | "inactive";
const STATUS_RANK: Record<Status, number> = { out: 0, low: 1, ok: 2, inactive: 3 };

export function formatPackSize(product: AdminProduct): string | null {
  if (product.packSize === null) return null;
  const size = Number(product.packSize);
  if (isNaN(size)) return null;
  return product.uom ? `${size} ${product.uom}` : String(size);
}

function productStatus(p: AdminProduct): Status {
  if (!p.active) return "inactive";
  if (p.currentQty === 0) return "out";
  if (p.currentQty <= p.alertThreshold) return "low";
  return "ok";
}

// Worst-of across the products; a group is inactive only if all are.
function worstStatus(products: AdminProduct[]): Status {
  const active = products.filter((p) => p.active);
  if (active.length === 0) return "inactive";
  return active.map(productStatus).sort((a, b) => STATUS_RANK[a] - STATUS_RANK[b])[0];
}

export function StatusBadge({ status }: { status: Status }) {
  const styles: Record<Status, string> = {
    out: "bg-red-100 text-red-700",
    low: "bg-orange-100 text-orange-700",
    ok: "bg-green-100 text-green-700",
    inactive: "bg-gray-200 text-gray-600",
  };
  const labels: Record<Status, string> = { out: "Out", low: "Low", ok: "OK", inactive: "Inactive" };
  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

export function HighRiskPill() {
  return (
    <span className="ml-2 inline-block px-2 py-0.5 text-xs font-semibold rounded-full bg-red-600 text-white align-middle whitespace-nowrap">
      High risk
    </span>
  );
}

function rowProducts(r: CategoryRow): AdminProduct[] {
  return r.kind === "group" ? r.products : [r.product];
}

function rowName(r: CategoryRow): string {
  return r.kind === "group" ? r.name : r.product.name;
}

// One value when every product agrees, otherwise null (shown as "Mixed").
function common<T>(products: AdminProduct[], pick: (p: AdminProduct) => T): T | null {
  const first = pick(products[0]);
  return products.every((p) => pick(p) === first) ? first : null;
}

type SortValue = string | number;

function sortValue(products: AdminProduct[], name: string, field: SortField): SortValue {
  switch (field) {
    case "name":
      return name.toLowerCase();
    case "brand":
      return (common(products, (p) => p.brand ?? "") ?? "~mixed").toLowerCase();
    case "unit":
      return (common(products, (p) => p.purchaseUnit) ?? "~mixed").toLowerCase();
    case "packSize": {
      const sizes = products.map((p) => Number(p.packSize)).filter((n) => !isNaN(n) && n > 0);
      return sizes.length ? Math.min(...sizes) : Number.MAX_SAFE_INTEGER;
    }
    case "qty":
      return products.reduce((n, p) => n + p.currentQty, 0);
    case "threshold":
      return Math.min(...products.map((p) => p.alertThreshold));
    case "status":
      return STATUS_RANK[worstStatus(products)];
    case "priority":
      return 0;
  }
}

// Priority order: high risk first, then lowest stock, then the alphabet.
function comparePriority(a: AdminProduct[], aName: string, b: AdminProduct[], bName: string) {
  const risk = Number(b.some((p) => p.highRisk)) - Number(a.some((p) => p.highRisk));
  if (risk !== 0) return risk;
  const qa = a.reduce((n, p) => n + p.currentQty, 0);
  const qb = b.reduce((n, p) => n + p.currentQty, 0);
  if (qa !== qb) return qa - qb;
  return aName.localeCompare(bName);
}

function makeComparator<T>(
  field: SortField,
  asc: boolean,
  products: (t: T) => AdminProduct[],
  name: (t: T) => string,
) {
  return (a: T, b: T) => {
    if (field !== "priority") {
      const va = sortValue(products(a), name(a), field);
      const vb = sortValue(products(b), name(b), field);
      const diff =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb));
      if (diff !== 0) return asc ? diff : -diff;
    }
    return comparePriority(products(a), name(a), products(b), name(b));
  };
}

const variantName = (p: AdminProduct) => p.variant ?? p.name;

interface CategoryTableProps {
  category: string;
  rows: CategoryRow[];
  collapsed: boolean;
  onToggle: () => void;
  // While searching, matched groups open themselves so the hit is visible.
  forceOpenGroups: boolean;
  renderThreshold: (p: AdminProduct) => ReactNode;
  renderActions: (p: AdminProduct) => ReactNode;
}

// Unit is the least useful column, so it drops out below xl (1280px) to
// keep the table from scrolling sideways on tablets and small laptops.
const COLUMNS: { field: SortField; label: string; align: "left" | "right" | "center"; hideBelowXl?: boolean }[] = [
  { field: "name", label: "Product Name", align: "left" },
  { field: "brand", label: "Brand", align: "left" },
  { field: "unit", label: "Unit", align: "left", hideBelowXl: true },
  { field: "packSize", label: "Pack Size", align: "left" },
  { field: "qty", label: "Qty", align: "right" },
  { field: "threshold", label: "Threshold", align: "right" },
  { field: "status", label: "Status", align: "center" },
];

const ALIGN = { left: "text-left", right: "text-right", center: "text-center" } as const;
const MUTED_DASH = <span className="text-gray-300">—</span>;

export default function CategoryTable({
  category,
  rows,
  collapsed,
  onToggle,
  forceOpenGroups,
  renderThreshold,
  renderActions,
}: CategoryTableProps) {
  const [sortField, setSortField] = useState<SortField>("priority");
  const [asc, setAsc] = useState(true);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  const sortedRows = useMemo(
    () => rows.slice().sort(makeComparator<CategoryRow>(sortField, asc, rowProducts, rowName)),
    [rows, sortField, asc],
  );
  const sortVariants = useMemo(
    () => makeComparator<AdminProduct>(sortField, asc, (p) => [p], variantName),
    [sortField, asc],
  );

  const all = rows.flatMap(rowProducts);
  const highRiskCount = all.filter((p) => p.highRisk).length;
  const outCount = all.filter((p) => productStatus(p) === "out").length;
  const lowCount = all.filter((p) => productStatus(p) === "low").length;

  function handleSort(field: SortField) {
    if (sortField === field) setAsc((v) => !v);
    else {
      setSortField(field);
      setAsc(true);
    }
  }

  function toggleGroup(key: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div id={`cat-${category}`} className="border border-gray-200 rounded-lg overflow-hidden bg-white scroll-mt-4">
      {/* Section header — click to collapse/expand */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 sm:px-4 py-3 bg-gray-50 hover:bg-gray-100 cursor-pointer select-none"
      >
        <span className="text-gray-500 w-4">{collapsed ? "▸" : "▾"}</span>
        <h3 className="font-semibold text-gray-900">{category}</h3>
        <span className="text-xs text-gray-500">
          {rows.length} {rows.length === 1 ? "item" : "items"}
          {all.length !== rows.length && ` · ${all.length} products`}
        </span>
        <div className="flex flex-wrap gap-1.5 ml-auto items-center">
          {highRiskCount > 0 && (
            <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-red-600 text-white">
              {highRiskCount} high risk
            </span>
          )}
          {outCount > 0 && (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700">
              {outCount} out
            </span>
          )}
          {lowCount > 0 && (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-orange-100 text-orange-700">
              {lowCount} low
            </span>
          )}
          {sortField !== "priority" && !collapsed && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSortField("priority");
                setAsc(true);
              }}
              className="hidden lg:inline ml-2 text-xs text-indigo-600 hover:text-indigo-800 hover:underline"
              title="Back to high risk first, then lowest stock"
            >
              Reset sort
            </button>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="lg:hidden border-t border-gray-200">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
            <label htmlFor={`sort-${category}`} className="text-xs text-gray-500">
              Sort
            </label>
            <select
              id={`sort-${category}`}
              value={sortField}
              onChange={(e) => {
                setSortField(e.target.value as SortField);
                setAsc(true);
              }}
              className="flex-1 min-w-0 px-2 py-1.5 border border-gray-300 rounded-md bg-white text-gray-900"
            >
              <option value="priority">Priority (high risk first)</option>
              {COLUMNS.map((c) => (
                <option key={c.field} value={c.field}>
                  {c.label}
                </option>
              ))}
            </select>
            {sortField !== "priority" && (
              <button
                onClick={() => setAsc((v) => !v)}
                aria-label={asc ? "Sorted ascending — tap to reverse" : "Sorted descending — tap to reverse"}
                className="w-10 h-10 flex items-center justify-center border border-gray-300 rounded-md text-gray-600"
              >
                {asc ? "▲" : "▼"}
              </button>
            )}
          </div>
          <ul className="divide-y divide-gray-100">
            {sortedRows.map((row) => {
              if (row.kind === "single") {
                return (
                  <ProductCard
                    key={row.key}
                    product={row.product}
                    label={row.product.name}
                    indent={false}
                    renderThreshold={renderThreshold}
                    renderActions={renderActions}
                  />
                );
              }
              const isOpen = forceOpenGroups || openGroups.has(row.key);
              const ps = row.products;
              const brand = common(ps, (p) => p.brand);
              const label = row.variantLabel.toLowerCase();
              return (
                <li key={row.key}>
                  <button
                    onClick={() => toggleGroup(row.key)}
                    aria-expanded={isOpen}
                    className="w-full text-left flex items-start gap-2 px-3 py-3"
                  >
                    <span className="text-gray-400 w-4 pt-0.5">{isOpen ? "▾" : "▸"}</span>
                    <span className="flex-1 min-w-0">
                      <span className="font-medium text-gray-900">{row.name}</span>
                      {ps.some((p) => p.highRisk) && <HighRiskPill />}
                      <span className="block text-xs text-gray-500 mt-0.5">
                        {ps.length} {label}
                        {ps.length === 1 ? "" : "s"}
                        {brand === null ? " · Mixed brands" : brand ? ` · ${brand}` : ""}
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className="font-mono text-lg leading-none text-gray-900">
                        {ps.reduce((n, p) => n + p.currentQty, 0)}
                      </span>
                      <StatusBadge status={worstStatus(ps)} />
                    </span>
                  </button>
                  {isOpen && (
                    <ul className="bg-gray-50/60 divide-y divide-gray-100 border-t border-gray-100">
                      {ps
                        .slice()
                        .sort(sortVariants)
                        .map((p) => (
                          <ProductCard
                            key={`${row.key}-${p.id}`}
                            product={p}
                            label={variantName(p)}
                            indent
                            renderThreshold={renderThreshold}
                            renderActions={renderActions}
                          />
                        ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {!collapsed && (
        <div className="hidden lg:block overflow-x-auto border-t border-gray-200">
        {/* Fixed layout keeps columns aligned across every category table;
            the min width stops the name column collapsing on narrow screens. */}
        <table className="w-full min-w-[720px] text-sm table-fixed">
          <colgroup>
            <col className="w-8" />
            <col />
            <col className="w-32 xl:w-36" />
            <col className="hidden xl:table-column xl:w-24" />
            <col className="w-20 xl:w-24" />
            <col className="w-16 xl:w-20" />
            <col className="w-24" />
            <col className="w-20 xl:w-24" />
            <col className="w-28 xl:w-32" />
          </colgroup>
          <thead className="border-b border-gray-200">
            <tr>
              <th />
              {COLUMNS.map((c) => (
                <th
                  key={c.field}
                  onClick={() => handleSort(c.field)}
                  className={`${ALIGN[c.align]} ${c.hideBelowXl ? "hidden xl:table-cell" : ""} px-4 py-2.5 font-medium text-gray-600 cursor-pointer hover:text-gray-900 select-none whitespace-nowrap`}
                  title={`Sort ${category} by ${c.label.toLowerCase()}`}
                >
                  {c.label}
                  <span className="text-gray-400">
                    {sortField === c.field ? (asc ? " ▲" : " ▼") : ""}
                  </span>
                </th>
              ))}
              <th className="text-center px-4 py-2.5 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sortedRows.map((row) => {
              if (row.kind === "single") {
                return <ProductRow key={row.key} product={row.product} label={row.product.name} indent={false} renderThreshold={renderThreshold} renderActions={renderActions} />;
              }
              const isOpen = forceOpenGroups || openGroups.has(row.key);
              const ps = row.products;
              const brand = common(ps, (p) => p.brand);
              const unit = common(ps, (p) => p.purchaseUnit);
              const pack = common(ps, (p) => formatPackSize(p));
              const minT = Math.min(...ps.map((p) => p.alertThreshold));
              const maxT = Math.max(...ps.map((p) => p.alertThreshold));
              const label = row.variantLabel.toLowerCase();
              return (
                <Fragment key={row.key}>
                  <tr
                    onClick={() => toggleGroup(row.key)}
                    className="hover:bg-gray-50 cursor-pointer select-none"
                    title={isOpen ? "Hide flavors" : "Show flavors"}
                  >
                    <td className="pl-4 py-2.5 text-gray-400">{isOpen ? "▾" : "▸"}</td>
                    <td className="px-4 py-2.5 text-gray-900 font-medium">
                      {row.name}
                      <span className="ml-2 text-xs font-normal text-gray-500">
                        {ps.length} {label}
                        {ps.length === 1 ? "" : "s"}
                      </span>
                      {ps.some((p) => p.highRisk) && <HighRiskPill />}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 truncate">
                      {brand === null ? <span className="text-gray-400">Mixed</span> : brand || MUTED_DASH}
                    </td>
                    <td className="hidden xl:table-cell px-4 py-2.5 text-gray-600 truncate">
                      {unit ?? <span className="text-gray-400">Mixed</span>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 truncate">{pack ?? MUTED_DASH}</td>
                    <td className="px-4 py-2.5 text-right text-gray-900 font-mono">
                      {ps.reduce((n, p) => n + p.currentQty, 0)}
                    </td>
                    <td className="pl-4 pr-6 py-2.5 text-right text-gray-500 font-mono">
                      {minT === maxT ? minT : `${minT}–${maxT}`}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <StatusBadge status={worstStatus(ps)} />
                    </td>
                    <td />
                  </tr>
                  {isOpen &&
                    ps
                      .slice()
                      .sort(sortVariants)
                      .map((p) => (
                        <ProductRow
                          key={`${row.key}-${p.id}`}
                          product={p}
                          label={variantName(p)}
                          indent
                          renderThreshold={renderThreshold}
                          renderActions={renderActions}
                        />
                      ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}

function ProductRow({
  product,
  label,
  indent,
  renderThreshold,
  renderActions,
}: {
  product: AdminProduct;
  label: string;
  indent: boolean;
  renderThreshold: (p: AdminProduct) => ReactNode;
  renderActions: (p: AdminProduct) => ReactNode;
}) {
  return (
    <tr
      className={`hover:bg-gray-50 transition-colors ${indent ? "bg-gray-50/60" : ""} ${
        product.active ? "" : "opacity-50"
      }`}
    >
      <td />
      <td className={`px-4 py-2.5 ${indent ? "pl-8 text-gray-700" : "text-gray-900 font-medium"}`}>
        {label}
        {product.highRisk && <HighRiskPill />}
      </td>
      <td className="px-4 py-2.5 text-gray-600 truncate">{product.brand ?? MUTED_DASH}</td>
      <td className="hidden xl:table-cell px-4 py-2.5 text-gray-600 truncate">{product.purchaseUnit}</td>
      <td className="px-4 py-2.5 text-gray-600 truncate">{formatPackSize(product) ?? MUTED_DASH}</td>
      <td className="px-4 py-2.5 text-right text-gray-900 font-mono">{product.currentQty}</td>
      <td className="px-4 py-2.5 text-right">{renderThreshold(product)}</td>
      <td className="px-4 py-2.5 text-center">
        <StatusBadge status={productStatus(product)} />
      </td>
      <td className="px-4 py-2.5 text-center whitespace-nowrap">{renderActions(product)}</td>
    </tr>
  );
}

// Phone layout: name and details on the left, qty + status on the right,
// threshold and actions on a third line.
function ProductCard({
  product,
  label,
  indent,
  renderThreshold,
  renderActions,
}: {
  product: AdminProduct;
  label: string;
  indent: boolean;
  renderThreshold: (p: AdminProduct) => ReactNode;
  renderActions: (p: AdminProduct) => ReactNode;
}) {
  const details = [product.brand, formatPackSize(product), product.purchaseUnit].filter(Boolean);
  return (
    <li className={`py-3 pr-3 ${indent ? "pl-12" : "pl-9"} ${product.active ? "" : "opacity-50"}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <span className={indent ? "text-gray-700" : "font-medium text-gray-900"}>{label}</span>
          {product.highRisk && <HighRiskPill />}
          {details.length > 0 && (
            <div className="text-xs text-gray-500 mt-0.5">{details.join(" · ")}</div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className="font-mono text-lg leading-none text-gray-900">{product.currentQty}</span>
          <StatusBadge status={productStatus(product)} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 mt-1.5 text-xs text-gray-500">
        <span className="flex items-center gap-1">Alert at {renderThreshold(product)}</span>
        <span className="whitespace-nowrap">{renderActions(product)}</span>
      </div>
    </li>
  );
}
