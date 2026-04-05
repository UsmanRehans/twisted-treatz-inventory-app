import { useState, useEffect, useCallback, useRef } from "react";
import {
  fetchAdminProducts,
  fetchAdminCategories,
  updateProduct,
} from "../../api/adminClient";
import type { AdminProduct } from "../../api/adminClient";

interface ProductTableProps {
  token: string;
}

type SortField = "name" | "category" | "currentQty";
type SortOrder = "asc" | "desc";

function getStatusBadge(product: AdminProduct) {
  if (product.currentQty === 0) {
    return (
      <span className="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700">
        Out
      </span>
    );
  }
  if (product.currentQty <= product.alertThreshold) {
    return (
      <span className="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-orange-100 text-orange-700">
        Low
      </span>
    );
  }
  return (
    <span className="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700">
      OK
    </span>
  );
}

export default function ProductTable({ token }: ProductTableProps) {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [savingId, setSavingId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadProducts = useCallback(() => {
    setLoading(true);
    fetchAdminProducts(token, { category, search, sort: sortField, order: sortOrder })
      .then(setProducts)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token, category, search, sortField, sortOrder]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    fetchAdminCategories(token).then(setCategories).catch(console.error);
  }, [token]);

  useEffect(() => {
    if (editingId !== null && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  }

  function sortIndicator(field: SortField) {
    if (sortField !== field) return "";
    return sortOrder === "asc" ? " ^" : " v";
  }

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
      setProducts((prev) =>
        prev.map((p) => (p.id === productId ? updated : p))
      );
    } catch (err) {
      console.error("Failed to update threshold:", err);
    } finally {
      setEditingId(null);
      setSavingId(null);
    }
  }

  // Pagination
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const totalPages = Math.ceil(products.length / pageSize);
  const paged = products.slice((page - 1) * pageSize, page * pageSize);

  // Reset to page 1 on filter changes
  useEffect(() => {
    setPage(1);
  }, [search, category, sortField, sortOrder]);

  return (
    <div>
      {/* Filters */}
      <div className="flex gap-3 mb-4">
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
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center text-gray-500 py-8">Loading products...</div>
      ) : (
        <>
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th
                    className="text-left px-4 py-3 font-medium text-gray-600 cursor-pointer hover:text-gray-900 select-none"
                    onClick={() => handleSort("name")}
                  >
                    Product Name{sortIndicator("name")}
                  </th>
                  <th
                    className="text-left px-4 py-3 font-medium text-gray-600 cursor-pointer hover:text-gray-900 select-none"
                    onClick={() => handleSort("category")}
                  >
                    Category{sortIndicator("category")}
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Unit
                  </th>
                  <th
                    className="text-right px-4 py-3 font-medium text-gray-600 cursor-pointer hover:text-gray-900 select-none"
                    onClick={() => handleSort("currentQty")}
                  >
                    Qty{sortIndicator("currentQty")}
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">
                    Threshold
                  </th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paged.map((product) => (
                  <tr
                    key={product.id}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-4 py-2.5 text-gray-900 font-medium">
                      {product.name}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">
                      {product.category}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">
                      {product.purchaseUnit}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-900 font-mono">
                      {product.currentQty}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {editingId === product.id ? (
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
                      ) : (
                        <button
                          onClick={() => startEdit(product)}
                          className="font-mono text-gray-700 hover:text-indigo-600 hover:bg-indigo-50 px-2 py-0.5 rounded cursor-pointer transition-colors"
                          title="Click to edit threshold"
                        >
                          {product.alertThreshold}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {getStatusBadge(product)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
              <span>
                Showing {(page - 1) * pageSize + 1}-
                {Math.min(page * pageSize, products.length)} of{" "}
                {products.length} products
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
