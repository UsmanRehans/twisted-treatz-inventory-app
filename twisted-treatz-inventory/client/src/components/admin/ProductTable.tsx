import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  fetchAdminProducts,
  fetchAdminCategories,
  fetchBrands,
  updateProduct,
  exportCatalogCsv,
} from "../../api/adminClient";
import type { AdminProduct, Brand } from "../../api/adminClient";
import { downloadCsvFile } from "../../lib/csv";
import AddProductModal from "./AddProductModal";
import EditProductModal from "./EditProductModal";
import CategoryTable, { type CategoryRow } from "./CategoryTable";
import GroupingSheet from "./GroupingSheet";

interface ProductTableProps {
  token: string;
}

// View preferences are per-browser conveniences; storage can be blocked
// (private window), so every access is guarded and defaults still work.
const COLLAPSED_KEY = "tt.products.collapsedCategories";
const GROUP_KEY = "tt.products.groupFlavors";

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore — preference just won't persist
  }
}

export default function ProductTable({ token }: ProductTableProps) {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [brandId, setBrandId] = useState<string>("All");
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [savingId, setSavingId] = useState<number | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<AdminProduct | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [highRiskOnly, setHighRiskOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(readStored<string[]>(COLLAPSED_KEY, [])),
  );
  const [groupFlavors, setGroupFlavors] = useState<boolean>(() => readStored(GROUP_KEY, true));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => writeStored(COLLAPSED_KEY, [...collapsed]), [collapsed]);
  useEffect(() => writeStored(GROUP_KEY, groupFlavors), [groupFlavors]);

  // Same sheet as the Product Sheet tab (download-only here — uploads live
  // on that tab with the preview): every active product, ready to bulk-edit.
  async function handleDownloadSheet() {
    setExporting(true);
    setExportError(null);
    try {
      const { csv } = await exportCatalogCsv(token);
      downloadCsvFile(csv, `catalog-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Could not download the sheet");
    } finally {
      setExporting(false);
    }
  }

  const loadProducts = useCallback(() => {
    setLoading(true);
    fetchAdminProducts(token, {
      category,
      brandId: brandId !== "All" ? Number(brandId) : undefined,
      search,
      sort: "name",
      order: "asc",
      includeInactive: showInactive,
    })
      .then(setProducts)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token, category, brandId, search, showInactive]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const loadCategories = useCallback(() => {
    fetchAdminCategories(token).then(setCategories).catch(console.error);
  }, [token]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  const loadBrands = useCallback(() => {
    fetchBrands(token).then(setBrands).catch(console.error);
  }, [token]);

  useEffect(() => {
    loadBrands();
  }, [loadBrands]);

  useEffect(() => {
    if (editingId !== null && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  function startEdit(product: AdminProduct) {
    setEditingId(product.id);
    setEditValue(String(product.alertThreshold));
  }

  async function saveThreshold(productId: number) {
    const threshold = parseInt(editValue, 10);
    if (isNaN(threshold) || threshold < 0) {
      setEditingId(null);
      return;
    }

    setSavingId(productId);
    try {
      const updated = await updateProduct(token, productId, {
        alertThreshold: threshold,
      });
      setProducts((prev) => prev.map((p) => (p.id === productId ? updated : p)));
    } catch (err) {
      console.error("Failed to update threshold:", err);
    } finally {
      setEditingId(null);
      setSavingId(null);
    }
  }

  function handleSaved(updated: AdminProduct) {
    if (!updated.active && !showInactive) {
      // Deactivated while the inactive filter is off — drop it from view.
      setProducts((prev) => prev.filter((p) => p.id !== updated.id));
    } else {
      setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    }
  }

  // One table per category. With "Group flavors" on, products sharing a
  // group fold into one expandable row; the high-risk filter keeps only
  // flagged products (a group shows just its flagged flavors).
  const sections = useMemo(() => {
    const visible = highRiskOnly ? products.filter((p) => p.highRisk) : products;
    const byCategory = new Map<string, CategoryRow[]>();
    const push = (cat: string, row: CategoryRow) => {
      const list = byCategory.get(cat);
      if (list) list.push(row);
      else byCategory.set(cat, [row]);
    };

    const groups = new Map<number, { name: string; variantLabel: string; products: AdminProduct[] }>();
    for (const p of visible) {
      if (groupFlavors && p.group) {
        const g = groups.get(p.group.id);
        if (g) g.products.push(p);
        else
          groups.set(p.group.id, {
            name: p.group.name,
            variantLabel: p.group.variantLabel,
            products: [p],
          });
      } else {
        push(p.category, { kind: "single", key: `p${p.id}`, product: p });
      }
    }
    for (const [id, g] of groups) {
      // A group with one visible member reads better as a plain row.
      if (g.products.length === 1) {
        const p = g.products[0];
        push(p.category, { kind: "single", key: `p${p.id}`, product: p });
      } else {
        // After an import every variant shares the group's category.
        push(g.products[0].category, { kind: "group", key: `g${id}`, ...g });
      }
    }

    return [...byCategory.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cat, rows]) => ({ category: cat, rows }));
  }, [products, highRiskOnly, groupFlavors]);

  const allCollapsed = sections.length > 0 && sections.every((s) => collapsed.has(s.category));
  const productCount = sections.reduce(
    (n, s) => n + s.rows.reduce((m, r) => m + (r.kind === "group" ? r.products.length : 1), 0),
    0,
  );

  function toggleCategory(cat: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  function renderThreshold(product: AdminProduct) {
    if (editingId === product.id) {
      return (
        <input
          ref={inputRef}
          type="number"
          min="0"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={() => saveThreshold(product.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveThreshold(product.id);
            if (e.key === "Escape") setEditingId(null);
          }}
          className="w-16 px-2 py-1 border border-indigo-400 rounded text-right text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
          disabled={savingId === product.id}
        />
      );
    }
    return (
      <button
        onClick={() => startEdit(product)}
        className="font-mono text-gray-700 hover:text-indigo-600 hover:bg-indigo-50 px-2 py-0.5 rounded cursor-pointer transition-colors"
        title="Click to edit threshold"
      >
        {product.alertThreshold}
      </button>
    );
  }

  function renderActions(product: AdminProduct) {
    return (
      <>
        <button
          onClick={() => setEditingProduct(product)}
          className="text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 px-2 py-1 rounded text-sm transition-colors"
          title="Edit product details"
        >
          Edit
        </button>
        {!product.active && (
          <button
            onClick={async () => {
              try {
                const updated = await updateProduct(token, product.id, { active: true });
                handleSaved(updated);
              } catch (err) {
                console.error("Failed to reactivate:", err);
              }
            }}
            className="ml-1 text-green-700 hover:bg-green-50 px-2 py-1 rounded text-sm transition-colors"
            title="Reactivate product"
          >
            Reactivate
          </button>
        )}
      </>
    );
  }

  return (
    <div>
      {exportError && (
        <div className="mb-3 px-4 py-2.5 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          {exportError}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-3">
        <input
          type="text"
          placeholder="Search products..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
        >
          <option value="All">All Categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={brandId}
          onChange={(e) => setBrandId(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
        >
          <option value="All">All Brands</option>
          {brands.map((b) => (
            <option key={b.id} value={String(b.id)}>
              {b.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 bg-white cursor-pointer whitespace-nowrap select-none">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="accent-indigo-600"
          />
          Show inactive
        </label>
        <label className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 bg-white cursor-pointer whitespace-nowrap select-none">
          <input
            type="checkbox"
            checked={highRiskOnly}
            onChange={(e) => setHighRiskOnly(e.target.checked)}
            className="accent-red-600"
          />
          High risk only
        </label>
        <button
          onClick={handleDownloadSheet}
          disabled={exporting}
          title="Download the master product sheet (CSV, opens in Excel) — edit it, then upload it on the Product Sheet tab"
          className="px-4 py-2 bg-white text-gray-700 border border-gray-300 text-sm font-medium rounded-md hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
        >
          {exporting ? "Exporting…" : "Download Sheet"}
        </button>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 whitespace-nowrap"
        >
          + Add Product
        </button>
      </div>

      {/* View controls + grouping sheet */}
      <GroupingSheet
        token={token}
        onChanged={() => {
          loadProducts();
          loadCategories();
        }}
      >
        <button
          onClick={() =>
            setCollapsed(allCollapsed ? new Set() : new Set(sections.map((s) => s.category)))
          }
          disabled={sections.length === 0}
          className="px-3 py-1.5 bg-white text-gray-700 border border-gray-300 text-sm font-medium rounded-md hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
        >
          {allCollapsed ? "Expand all" : "Collapse all"}
        </button>
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none whitespace-nowrap">
          <input
            type="checkbox"
            checked={groupFlavors}
            onChange={(e) => setGroupFlavors(e.target.checked)}
            className="accent-indigo-600"
          />
          Group flavors
        </label>
        <span className="text-xs text-gray-500 whitespace-nowrap">
          {loading
            ? "Loading..."
            : `${productCount} products in ${sections.length} ${sections.length === 1 ? "category" : "categories"}`}
        </span>
      </GroupingSheet>

      {showAddModal && (
        <AddProductModal
          token={token}
          categories={categories}
          brands={brands}
          onClose={() => setShowAddModal(false)}
          onCreated={loadProducts}
          onBrandCreated={loadBrands}
        />
      )}

      {editingProduct && (
        <EditProductModal
          token={token}
          product={editingProduct}
          categories={categories}
          brands={brands}
          onClose={() => setEditingProduct(null)}
          onSaved={handleSaved}
          onBrandCreated={loadBrands}
        />
      )}

      {/* One table per category */}
      {loading && products.length === 0 ? (
        <div className="text-center text-gray-500 py-8">Loading products...</div>
      ) : sections.length === 0 ? (
        <div className="text-center text-gray-500 py-8">No products match these filters.</div>
      ) : (
        <div className="space-y-4">
          {sections.map((s) => (
            <CategoryTable
              key={s.category}
              category={s.category}
              rows={s.rows}
              collapsed={collapsed.has(s.category)}
              onToggle={() => toggleCategory(s.category)}
              forceOpenGroups={search.trim() !== "" || highRiskOnly}
              renderThreshold={renderThreshold}
              renderActions={renderActions}
            />
          ))}
        </div>
      )}
    </div>
  );
}
