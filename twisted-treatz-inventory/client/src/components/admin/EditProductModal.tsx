import { useState } from "react";
import {
  updateProduct,
  createBrand,
  type AdminProduct,
  type Brand,
} from "../../api/adminClient";

interface EditProductModalProps {
  token: string;
  product: AdminProduct;
  categories: string[];
  brands: Brand[];
  onClose: () => void;
  // Called with the updated product after any successful save
  // (field edit, deactivate, or reactivate).
  onSaved: (updated: AdminProduct) => void;
  onBrandCreated: () => void;
}

const NEW_BRAND = "__new__";

export default function EditProductModal({
  token,
  product,
  categories,
  brands,
  onClose,
  onSaved,
  onBrandCreated,
}: EditProductModalProps) {
  const [name, setName] = useState(product.name);
  const [category, setCategory] = useState(product.category);
  const [purchaseUnit, setPurchaseUnit] = useState(product.purchaseUnit);
  const [flavor, setFlavor] = useState(product.flavor ?? "");
  const [packSize, setPackSize] = useState(
    product.packSize !== null ? String(Number(product.packSize)) : ""
  );
  const [uom, setUom] = useState(product.uom ?? "");
  const [supplier, setSupplier] = useState(product.supplier ?? "");
  const [usedIn, setUsedIn] = useState(product.usedIn ?? "");
  const [alertThreshold, setAlertThreshold] = useState(
    String(product.alertThreshold)
  );
  const [unitPrice, setUnitPrice] = useState(
    product.unitPrice !== null ? String(Number(product.unitPrice)) : ""
  );
  const [brandChoice, setBrandChoice] = useState(
    product.brandId !== null ? String(product.brandId) : ""
  );
  const [newBrandName, setNewBrandName] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);

  // Build a PATCH body with only the fields that actually changed, so an
  // accidental save with no edits is a no-op and untouched fields can't
  // be clobbered by round-trip formatting (Decimal strings etc).
  async function buildPatch(): Promise<Record<string, unknown> | null> {
    const patch: Record<string, unknown> = {};

    if (name.trim() !== product.name) patch.name = name.trim();
    if (category.trim() !== product.category) patch.category = category.trim();
    if (purchaseUnit.trim() !== product.purchaseUnit)
      patch.purchaseUnit = purchaseUnit.trim();

    const optional: Array<
      ["flavor" | "supplier" | "usedIn" | "uom", string, string | null]
    > = [
      ["flavor", flavor, product.flavor],
      ["supplier", supplier, product.supplier],
      ["usedIn", usedIn, product.usedIn],
      ["uom", uom, product.uom],
    ];
    for (const [key, value, prev] of optional) {
      const next = value.trim() || null;
      if (next !== prev) patch[key] = next;
    }

    const nextPack = packSize.trim() === "" ? null : Number(packSize);
    const prevPack = product.packSize !== null ? Number(product.packSize) : null;
    if (nextPack !== null && isNaN(nextPack)) {
      setError("Pack size must be a number.");
      return null;
    }
    if (nextPack !== prevPack) patch.packSize = nextPack;

    const threshold = parseInt(alertThreshold, 10);
    if (isNaN(threshold) || threshold < 0) {
      setError("Alert threshold must be a non-negative number.");
      return null;
    }
    if (threshold !== product.alertThreshold) patch.alertThreshold = threshold;

    const nextPrice = unitPrice.trim() === "" ? null : Number(unitPrice);
    const prevPrice =
      product.unitPrice !== null ? Number(product.unitPrice) : null;
    if (nextPrice !== null && isNaN(nextPrice)) {
      setError("Unit price must be a number.");
      return null;
    }
    if (nextPrice !== prevPrice) patch.unitPrice = nextPrice;

    // Brand: existing id, a newly created brand, or none.
    let brandId: number | null;
    if (brandChoice === NEW_BRAND) {
      if (!newBrandName.trim()) {
        setError("Enter a name for the new brand.");
        return null;
      }
      const brand = await createBrand(token, newBrandName.trim());
      brandId = brand.id;
      onBrandCreated();
    } else {
      brandId = brandChoice === "" ? null : Number(brandChoice);
    }
    if (brandId !== product.brandId) patch.brandId = brandId;

    return patch;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim() || !category.trim() || !purchaseUnit.trim()) {
      setError("Name, category, and purchase unit are required.");
      return;
    }

    setSaving(true);
    try {
      const patch = await buildPatch();
      if (patch === null) return; // validation error already set

      if (Object.keys(patch).length === 0) {
        onClose();
        return;
      }

      const updated = await updateProduct(token, product.id, patch);
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setSaving(false);
    }
  }

  async function setActive(active: boolean) {
    setError(null);
    setSaving(true);
    try {
      const updated = await updateProduct(token, product.id, { active });
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `Failed to ${active ? "reactivate" : "deactivate"} product`
      );
      setConfirmingDeactivate(false);
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
          <h2 className="text-lg font-semibold text-gray-900">
            Edit Product
            {!product.active && (
              <span className="ml-2 inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-gray-200 text-gray-600 align-middle">
                Inactive
              </span>
            )}
          </h2>
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
            On hand: <strong>{product.currentQty}</strong> — stock changes via
            Receiving and Adjustments, not here.
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
                list="edit-category-options"
              />
              <datalist id="edit-category-options">
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
                list="edit-purchase-unit-options"
                placeholder="e.g. Bag, Box, Case"
              />
              <datalist id="edit-purchase-unit-options">
                <option value="Bag" />
                <option value="Box" />
                <option value="Case" />
                <option value="Bucket" />
                <option value="Gallon" />
                <option value="Each" />
              </datalist>
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
                list="edit-uom-options"
                placeholder="e.g. lb"
              />
              <datalist id="edit-uom-options">
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
              <label className={label}>Supplier</label>
              <input className={field} value={supplier} onChange={(e) => setSupplier(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Used In</label>
              <input className={field} value={usedIn} onChange={(e) => setUsedIn(e.target.value)} />
            </div>
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
          </div>

          <div className="grid grid-cols-2 gap-3">
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
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>

          {/* Deactivate / Reactivate */}
          <div className="border-t border-gray-200 pt-4">
            {product.active ? (
              confirmingDeactivate ? (
                <div className="bg-red-50 border border-red-200 rounded-md p-3 space-y-2">
                  <p className="text-sm text-red-800">
                    Deactivate <strong>{product.name}</strong>? It disappears
                    from the floor iPad and product lists. History is kept. You
                    can reactivate it anytime.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => setActive(false)}
                      className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
                    >
                      {saving ? "Deactivating…" : "Yes, deactivate"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDeactivate(false)}
                      className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 text-gray-700"
                    >
                      Keep active
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingDeactivate(true)}
                  className="text-sm text-red-600 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-md border border-red-200"
                >
                  Deactivate product
                </button>
              )
            ) : (
              <button
                type="button"
                disabled={saving}
                onClick={() => setActive(true)}
                className="text-sm text-green-700 hover:bg-green-50 px-3 py-1.5 rounded-md border border-green-300 disabled:opacity-50"
              >
                {saving ? "Reactivating…" : "Reactivate product"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
