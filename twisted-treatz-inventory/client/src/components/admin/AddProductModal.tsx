import { useState } from "react";
import {
  createProduct,
  createBrand,
  type Brand,
  type CreateProductData,
} from "../../api/adminClient";

interface AddProductModalProps {
  token: string;
  categories: string[];
  brands: Brand[];
  onClose: () => void;
  onCreated: () => void;
  // Called after a new brand is created inline so the parent can refresh
  // its brand list (filter dropdown etc.).
  onBrandCreated: () => void;
}

const NEW_BRAND = "__new__";

export default function AddProductModal({
  token,
  categories,
  brands,
  onClose,
  onCreated,
  onBrandCreated,
}: AddProductModalProps) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [purchaseUnit, setPurchaseUnit] = useState("");
  const [flavor, setFlavor] = useState("");
  const [unitSize, setUnitSize] = useState("");
  const [packSize, setPackSize] = useState("");
  const [uom, setUom] = useState("");
  const [supplier, setSupplier] = useState("");
  const [usedIn, setUsedIn] = useState("");
  const [alertThreshold, setAlertThreshold] = useState("10");
  const [unitPrice, setUnitPrice] = useState("");
  const [brandChoice, setBrandChoice] = useState(""); // "" = none, id, or NEW_BRAND
  const [newBrandName, setNewBrandName] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim() || !category.trim() || !purchaseUnit.trim()) {
      setError("Name, category, and purchase unit are required.");
      return;
    }

    setSaving(true);
    try {
      // Resolve the brand: existing id, a newly created brand, or none.
      let brandId: number | null = null;
      if (brandChoice === NEW_BRAND) {
        if (newBrandName.trim()) {
          const brand = await createBrand(token, newBrandName.trim());
          brandId = brand.id;
          onBrandCreated();
        }
      } else if (brandChoice !== "") {
        brandId = Number(brandChoice);
      }

      const threshold = parseInt(alertThreshold, 10);
      const price = unitPrice.trim() === "" ? null : Number(unitPrice);
      const pack = packSize.trim() === "" ? null : Number(packSize);

      const data: CreateProductData = {
        name: name.trim(),
        category: category.trim(),
        purchaseUnit: purchaseUnit.trim(),
        flavor: flavor.trim() || null,
        unitSize: unitSize.trim() || null,
        packSize: pack !== null && !isNaN(pack) ? pack : null,
        uom: uom.trim() || null,
        supplier: supplier.trim() || null,
        usedIn: usedIn.trim() || null,
        brandId,
        alertThreshold: isNaN(threshold) ? 10 : threshold,
        unitPrice: price !== null && !isNaN(price) ? price : null,
      };

      await createProduct(token, data);
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create product");
    } finally {
      setSaving(false);
    }
  }

  const field = "w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900";
  const label = "block text-xs font-medium text-gray-600 mb-1";

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Add Product</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <p className="text-xs text-gray-500">
            New products start at <strong>0 on hand</strong> — receive stock via
            the Receiving screen to add quantity.
          </p>

          <div>
            <label className={label}>Name *</label>
            <input className={field} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Category *</label>
              <input
                className={field}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                list="category-options"
                placeholder="e.g. Gummy"
              />
              <datalist id="category-options">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div>
              <label className={label}>Purchase Unit *</label>
              <input
                className={field}
                value={purchaseUnit}
                onChange={(e) => setPurchaseUnit(e.target.value)}
                placeholder="e.g. Bag, Box, Case"
              />
            </div>
          </div>

          <div>
            <label className={label}>Brand</label>
            <select
              className={field}
              value={brandChoice}
              onChange={(e) => setBrandChoice(e.target.value)}
            >
              <option value="">No brand</option>
              {brands.map((b) => (
                <option key={b.id} value={String(b.id)}>
                  {b.name}
                </option>
              ))}
              <option value={NEW_BRAND}>+ Add new brand…</option>
            </select>
            {brandChoice === NEW_BRAND && (
              <input
                className={`${field} mt-2`}
                value={newBrandName}
                onChange={(e) => setNewBrandName(e.target.value)}
                placeholder="New brand name"
              />
            )}
          </div>

          {/* Pack Size + UOM mirror Hani's master sheet — kept as two fields,
              not one free-text blob. Pack Size is numeric (e.g. 30, 26.4). */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Pack Size</label>
              <input
                type="number"
                step="0.001"
                min="0"
                className={field}
                value={packSize}
                onChange={(e) => setPackSize(e.target.value)}
                placeholder="e.g. 30"
              />
            </div>
            <div>
              <label className={label}>UOM</label>
              <input
                className={field}
                value={uom}
                onChange={(e) => setUom(e.target.value)}
                list="uom-options"
                placeholder="e.g. lb"
              />
              <datalist id="uom-options">
                <option value="lb" />
                <option value="ct" />
                <option value="oz" />
                <option value="each" />
                <option value="case" />
                <option value="box" />
                <option value="bag" />
                <option value="gallon" />
              </datalist>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Flavor</label>
              <input className={field} value={flavor} onChange={(e) => setFlavor(e.target.value)} />
            </div>
            <div>
              <label className={label}>Unit Size (optional)</label>
              <input
                className={field}
                value={unitSize}
                onChange={(e) => setUnitSize(e.target.value)}
                placeholder="e.g. 5 lb"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Supplier</label>
              <input className={field} value={supplier} onChange={(e) => setSupplier(e.target.value)} />
            </div>
            <div>
              <label className={label}>Used In</label>
              <input className={field} value={usedIn} onChange={(e) => setUsedIn(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Alert Threshold</label>
              <input
                type="number"
                min="0"
                className={field}
                value={alertThreshold}
                onChange={(e) => setAlertThreshold(e.target.value)}
              />
            </div>
            <div>
              <label className={label}>Unit Price</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className={field}
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 text-gray-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? "Creating…" : "Create Product"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
