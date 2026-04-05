import { useState } from "react";
import type { Product } from "../../api/client";

interface ConfirmBarProps {
  product: Product;
  onConfirm: (qty: number) => void;
  onCancel: () => void;
  submitting: boolean;
}

export default function ConfirmBar({
  product,
  onConfirm,
  onCancel,
  submitting,
}: ConfirmBarProps) {
  const [qty, setQty] = useState(1);
  const isOutOfStock = product.currentQty === 0;
  const maxQty = product.currentQty;

  const increment = () => setQty((q) => Math.min(q + 1, maxQty));
  const decrement = () => setQty((q) => Math.max(q - 1, 1));

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t-2 border-gray-200 shadow-[0_-4px_20px_rgba(0,0,0,0.1)] z-50">
      <div className="flex items-center gap-4 px-6 py-4 max-w-[1200px] mx-auto">
        {/* Product info */}
        <div className="flex-1 min-w-0">
          <div className="text-[18px] font-semibold text-gray-800 truncate">
            {product.name}
          </div>
          <div className="text-[14px] text-gray-400">
            Current stock:{" "}
            <span className="font-semibold text-gray-600">
              {product.currentQty} {product.purchaseUnit}
            </span>
          </div>
        </div>

        {/* Out of stock warning */}
        {isOutOfStock ? (
          <div className="flex items-center gap-4">
            <span className="text-[16px] text-red-500 font-medium">
              This product is out of stock
            </span>
            <button
              onClick={onCancel}
              className="min-h-[64px] px-6 rounded-xl bg-gray-200 text-[20px] font-semibold text-gray-600 active:bg-gray-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            {/* Qty picker */}
            <div className="flex items-center gap-3">
              <button
                onClick={decrement}
                disabled={qty <= 1}
                className="w-[64px] min-h-[64px] rounded-xl bg-gray-100 text-[28px] font-bold text-gray-600 active:bg-gray-200 disabled:opacity-30 transition-colors"
              >
                -
              </button>
              <span className="text-[28px] font-bold text-gray-800 w-16 text-center">
                {qty}
              </span>
              <button
                onClick={increment}
                disabled={qty >= maxQty}
                className="w-[64px] min-h-[64px] rounded-xl bg-gray-100 text-[28px] font-bold text-gray-600 active:bg-gray-200 disabled:opacity-30 transition-colors"
              >
                +
              </button>
            </div>

            {/* Cancel */}
            <button
              onClick={onCancel}
              className="min-h-[64px] px-6 rounded-xl bg-gray-200 text-[20px] font-semibold text-gray-600 active:bg-gray-300 transition-colors"
            >
              Cancel
            </button>

            {/* Confirm */}
            <button
              onClick={() => onConfirm(qty)}
              disabled={submitting}
              className="min-h-[64px] px-8 rounded-xl bg-green-600 text-[20px] font-bold text-white active:bg-green-700 disabled:opacity-60 transition-colors"
            >
              {submitting ? "Removing..." : `Confirm Removal`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
