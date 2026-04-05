import { useState, useMemo } from "react";
import type { Product } from "../../api/client";
import CategoryTabs from "./CategoryTabs";
import ProductCard from "./ProductCard";

interface ProductGridProps {
  products: Product[];
  categories: string[];
  selectedProduct: Product | null;
  onSelectProduct: (product: Product) => void;
  onLogout: () => void;
  onActivity: () => void;
  memberName: string;
  loading: boolean;
}

export default function ProductGrid({
  products,
  categories,
  selectedProduct,
  onSelectProduct,
  onLogout,
  onActivity,
  memberName,
  loading,
}: ProductGridProps) {
  const [activeCategory, setActiveCategory] = useState("All");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    let result = products;
    if (activeCategory !== "All") {
      result = result.filter((p) => p.category === activeCategory);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((p) => p.name.toLowerCase().includes(q));
    }
    return result;
  }, [products, activeCategory, search]);

  return (
    <div className="flex flex-col h-full">
      {/* Top bar with member name, search, and back */}
      <div className="flex items-center gap-4 px-4 py-3 bg-white border-b border-gray-200">
        <span className="text-[16px] font-medium text-gray-700 flex-shrink-0">
          {memberName}
        </span>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search products..."
          className="flex-1 min-h-[48px] px-4 rounded-lg border border-gray-200 bg-gray-50 text-[16px] text-gray-800 placeholder-gray-400 outline-none focus:border-blue-400"
        />
        <button
          onClick={onActivity}
          className="min-h-[48px] px-5 rounded-lg bg-gray-100 text-[16px] text-gray-600 font-medium active:bg-gray-200 flex-shrink-0"
        >
          Activity
        </button>
        <button
          onClick={onLogout}
          className="min-h-[48px] px-5 rounded-lg bg-red-50 text-[16px] text-red-600 font-medium active:bg-red-100 flex-shrink-0"
        >
          Log Out
        </button>
      </div>

      {/* Category tabs */}
      <CategoryTabs
        categories={categories}
        active={activeCategory}
        onSelect={setActiveCategory}
      />

      {/* Product grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <span className="text-gray-400 text-[18px]">
              Loading products...
            </span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-40">
            <span className="text-gray-400 text-[18px]">
              No products found
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-3 lg:grid-cols-4 gap-4">
            {filtered.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                isSelected={selectedProduct?.id === product.id}
                onSelect={onSelectProduct}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
