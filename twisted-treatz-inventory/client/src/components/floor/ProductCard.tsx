import type { Product } from "../../api/client";

interface ProductCardProps {
  product: Product;
  isSelected: boolean;
  onSelect: (product: Product) => void;
}

export default function ProductCard({
  product,
  isSelected,
  onSelect,
}: ProductCardProps) {
  const isOutOfStock = product.currentQty === 0;
  const isLowStock =
    !isOutOfStock && product.currentQty <= product.alertThreshold;

  let borderClass = "border-gray-200";
  if (isSelected) {
    borderClass = "border-blue-500 bg-blue-50";
  } else if (isOutOfStock) {
    borderClass = "border-red-400";
  } else if (isLowStock) {
    borderClass = "border-orange-400";
  }

  return (
    <button
      onClick={() => onSelect(product)}
      className={`flex flex-col items-start p-4 rounded-xl bg-white border-2 min-h-[100px] transition-colors text-left ${borderClass} ${
        isOutOfStock && !isSelected ? "opacity-60" : ""
      }`}
    >
      {/* Product name */}
      <span
        className={`text-[18px] font-medium leading-tight mb-2 ${
          isOutOfStock ? "text-gray-400" : "text-gray-800"
        }`}
      >
        {product.name}
      </span>

      {/* Qty + unit row */}
      <div className="flex items-baseline gap-2 mt-auto">
        <span
          className={`text-[28px] font-bold ${
            isOutOfStock
              ? "text-red-400"
              : isLowStock
                ? "text-orange-500"
                : "text-gray-800"
          }`}
        >
          {product.currentQty}
        </span>
        <span className="text-[14px] text-gray-400">
          {product.purchaseUnit}
        </span>
      </div>

      {/* Status indicators */}
      {isLowStock && (
        <span className="text-[13px] text-orange-500 font-medium mt-1">
          Low stock
        </span>
      )}
      {isOutOfStock && (
        <span className="text-[13px] text-red-500 font-medium mt-1">
          Out of stock
        </span>
      )}
    </button>
  );
}
