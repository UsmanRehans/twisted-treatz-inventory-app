import { useState, useEffect, useRef, useCallback } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAdminAuth } from "../hooks/useAdminAuth";
import {
  fetchAdminProducts,
  createReceipt,
  fetchReceipts,
  type AdminProduct,
  type ReceiptRecord,
} from "../api/adminClient";

// ─── Types ──────────────────────────────────────────────────────────

type Step = "product" | "supplier" | "expected" | "actual1" | "actual2" | "notes" | "review";

const STEP_ORDER: Step[] = ["product", "supplier", "expected", "actual1", "actual2", "notes", "review"];

function stepIndex(s: Step): number {
  return STEP_ORDER.indexOf(s);
}

// ─── Timezone helper ────────────────────────────────────────────────

function formatChicago(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// ─── Component ──────────────────────────────────────────────────────

export default function Receive() {
  const { token, admin, isAuthenticated, logout } = useAdminAuth();
  const navigate = useNavigate();

  // Products list
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);

  // Recent receipts
  const [recentReceipts, setRecentReceipts] = useState<ReceiptRecord[]>([]);
  const [loadingReceipts, setLoadingReceipts] = useState(true);

  // Form state
  const [step, setStep] = useState<Step>("product");
  const [selectedProduct, setSelectedProduct] = useState<AdminProduct | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [supplier, setSupplier] = useState("");
  const [expectedQty, setExpectedQty] = useState("");
  const [actualQty1, setActualQty1] = useState("");
  const [actualQty2, setActualQty2] = useState("");
  const [notes, setNotes] = useState("");
  const [matchError, setMatchError] = useState(false);

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [successInfo, setSuccessInfo] = useState<{
    productName: string;
    actualQty: number;
    newStock: number;
  } | null>(null);

  // Refs for auto-focus
  const supplierRef = useRef<HTMLInputElement>(null);
  const expectedRef = useRef<HTMLInputElement>(null);
  const actual1Ref = useRef<HTMLInputElement>(null);
  const actual2Ref = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Auth guard
  if (!isAuthenticated || !token) {
    return <Navigate to="/admin/login" replace />;
  }

  // Load products and receipts on mount
  useEffect(() => {
    if (!token) return;
    fetchAdminProducts(token)
      .then((p) => setProducts(p.filter((x) => x.active)))
      .catch(console.error)
      .finally(() => setLoadingProducts(false));
  }, [token]);

  const loadReceipts = useCallback(() => {
    if (!token) return;
    setLoadingReceipts(true);
    fetchReceipts(token, { limit: 20, sort: "createdAt", order: "desc" })
      .then((r) => setRecentReceipts(r.receipts))
      .catch(console.error)
      .finally(() => setLoadingReceipts(false));
  }, [token]);

  useEffect(() => {
    loadReceipts();
  }, [loadReceipts]);

  // Auto-focus on step change
  useEffect(() => {
    const t = setTimeout(() => {
      if (step === "product") searchRef.current?.focus();
      if (step === "supplier") supplierRef.current?.focus();
      if (step === "expected") expectedRef.current?.focus();
      if (step === "actual1") actual1Ref.current?.focus();
      if (step === "actual2") actual2Ref.current?.focus();
      if (step === "notes") notesRef.current?.focus();
    }, 100);
    return () => clearTimeout(t);
  }, [step]);

  // ─── Filtered products ─────────────────────────────────────────────

  const filteredProducts = products.filter((p) => {
    const q = productSearch.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      (p.brand && p.brand.toLowerCase().includes(q))
    );
  });

  // ─── Form Handlers ─────────────────────────────────────────────────

  function selectProduct(product: AdminProduct) {
    setSelectedProduct(product);
    setProductSearch("");
    setStep("supplier");
  }

  function confirmSupplier() {
    setStep("expected");
  }

  function confirmExpected() {
    const val = Number(expectedQty);
    if (!expectedQty || isNaN(val) || val <= 0 || !Number.isInteger(val)) return;
    setStep("actual1");
  }

  function confirmActual1() {
    const val = Number(actualQty1);
    if (!actualQty1 || isNaN(val) || val <= 0 || !Number.isInteger(val)) return;
    setStep("actual2");
  }

  function confirmActual2() {
    const val = Number(actualQty2);
    if (!actualQty2 || isNaN(val) || val <= 0 || !Number.isInteger(val)) return;
    if (actualQty1 !== actualQty2) {
      setMatchError(true);
      setActualQty2("");
      return;
    }
    setMatchError(false);
    setStep("notes");
  }

  function confirmNotes() {
    setStep("review");
  }

  function goBack() {
    const idx = stepIndex(step);
    if (idx > 0) {
      setMatchError(false);
      setStep(STEP_ORDER[idx - 1]);
    }
  }

  function resetForm() {
    setStep("product");
    setSelectedProduct(null);
    setProductSearch("");
    setSupplier("");
    setExpectedQty("");
    setActualQty1("");
    setActualQty2("");
    setNotes("");
    setMatchError(false);
    setSubmitError("");
    setSuccessInfo(null);
  }

  async function handleSubmit() {
    if (!token || !selectedProduct) return;
    setSubmitting(true);
    setSubmitError("");

    try {
      const resp = await createReceipt(token, {
        productId: selectedProduct.id,
        expectedQty: Number(expectedQty),
        actualQty: Number(actualQty1),
        supplier: supplier || undefined,
        notes: notes || undefined,
      });

      const newStock = selectedProduct.currentQty + Number(actualQty1);
      setSuccessInfo({
        productName: resp.receipt.productName ?? selectedProduct.name,
        actualQty: Number(actualQty1),
        newStock,
      });

      // Reload receipts
      loadReceipts();

      // Reset form after short delay
      setTimeout(() => {
        resetForm();
      }, 4000);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to record receipt");
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Step Progress ─────────────────────────────────────────────────

  function StepProgress() {
    const labels = ["Product", "Supplier", "Expected", "Count", "Verify", "Notes", "Review"];
    const currentIdx = stepIndex(step);
    return (
      <div className="flex items-center gap-1 mb-6">
        {labels.map((label, i) => (
          <div key={label} className="flex items-center gap-1">
            <div
              className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold ${
                i < currentIdx
                  ? "bg-green-500 text-white"
                  : i === currentIdx
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-200 text-gray-500"
              }`}
            >
              {i < currentIdx ? "\u2713" : i + 1}
            </div>
            <span
              className={`text-xs hidden sm:inline ${
                i === currentIdx ? "text-indigo-700 font-semibold" : "text-gray-400"
              }`}
            >
              {label}
            </span>
            {i < labels.length - 1 && (
              <div
                className={`w-4 h-0.5 ${
                  i < currentIdx ? "bg-green-400" : "bg-gray-200"
                }`}
              />
            )}
          </div>
        ))}
      </div>
    );
  }

  // ─── Success Overlay ───────────────────────────────────────────────

  if (successInfo) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <Header admin={admin} logout={logout} navigate={navigate} />
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="bg-white rounded-xl shadow-lg p-10 text-center max-w-md w-full">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-green-600 text-3xl font-bold">{"\u2713"}</span>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Receipt Recorded</h2>
            <p className="text-lg text-gray-600 mb-1">
              <span className="font-semibold">{successInfo.actualQty}</span> units of{" "}
              <span className="font-semibold">{successInfo.productName}</span> received
            </p>
            <p className="text-base text-gray-500 mb-6">
              Updated stock level: <span className="font-bold text-indigo-600">{successInfo.newStock}</span>
            </p>
            <button
              onClick={resetForm}
              className="px-6 py-3 bg-indigo-600 text-white rounded-lg font-medium text-lg hover:bg-indigo-700 transition-colors"
            >
              Record Another Receipt
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Main Render ───────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Header admin={admin} logout={logout} navigate={navigate} />

      <div className="flex-1 p-6">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row gap-6">
          {/* Left: Receipt Form */}
          <div className="flex-1 min-w-0">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-1">New Receipt</h2>
              <p className="text-sm text-gray-500 mb-4">
                Record an incoming shipment step by step
              </p>

              <StepProgress />

              {/* Step 1: Select Product */}
              {step === "product" && (
                <div>
                  <label className="block text-base font-semibold text-gray-700 mb-2">
                    Step 1: Select Product
                  </label>
                  <input
                    ref={searchRef}
                    type="text"
                    placeholder="Search by name, category, or brand..."
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    className="w-full px-4 py-3 text-lg border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                  />
                  {loadingProducts ? (
                    <p className="text-gray-400 mt-4 text-center">Loading products...</p>
                  ) : (
                    <div className="mt-3 max-h-80 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                      {filteredProducts.length === 0 ? (
                        <p className="text-gray-400 text-center py-6">No products found</p>
                      ) : (
                        filteredProducts.slice(0, 50).map((p) => (
                          <button
                            key={p.id}
                            onClick={() => selectProduct(p)}
                            className="w-full text-left px-4 py-3 hover:bg-indigo-50 transition-colors flex items-center justify-between"
                          >
                            <div>
                              <div className="text-base font-medium text-gray-900">
                                {p.name}
                              </div>
                              <div className="text-sm text-gray-500">
                                {p.category}
                                {p.brand ? ` \u00b7 ${p.brand}` : ""}
                              </div>
                            </div>
                            <div className="text-right ml-4 flex-shrink-0">
                              <div className="text-sm font-medium text-gray-700">
                                {p.currentQty} {p.purchaseUnit}
                              </div>
                              <div className="text-xs text-gray-400">in stock</div>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Step 2: Supplier */}
              {step === "supplier" && (
                <div>
                  <SelectedProductBadge product={selectedProduct!} />
                  <label className="block text-base font-semibold text-gray-700 mb-2">
                    Step 2: Supplier (optional)
                  </label>
                  <input
                    ref={supplierRef}
                    type="text"
                    placeholder="e.g. Sam's Club, Costco, etc."
                    value={supplier}
                    onChange={(e) => setSupplier(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && confirmSupplier()}
                    className="w-full px-4 py-3 text-lg border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                  />
                  <div className="flex gap-3 mt-4">
                    <button
                      onClick={goBack}
                      className="px-5 py-3 text-base font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      Back
                    </button>
                    <button
                      onClick={confirmSupplier}
                      className="flex-1 px-5 py-3 text-base font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
                    >
                      {supplier ? "Next" : "Skip"}
                    </button>
                  </div>
                </div>
              )}

              {/* Step 3: Expected Quantity */}
              {step === "expected" && (
                <div>
                  <SelectedProductBadge product={selectedProduct!} />
                  <label className="block text-base font-semibold text-gray-700 mb-2">
                    Step 3: How many units does the PO say?
                  </label>
                  <input
                    ref={expectedRef}
                    type="number"
                    min="1"
                    step="1"
                    placeholder="Enter expected quantity"
                    value={expectedQty}
                    onChange={(e) => setExpectedQty(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && confirmExpected()}
                    className="w-full px-4 py-4 text-xl font-semibold border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-center"
                  />
                  <div className="flex gap-3 mt-4">
                    <button
                      onClick={goBack}
                      className="px-5 py-3 text-base font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      Back
                    </button>
                    <button
                      onClick={confirmExpected}
                      disabled={!expectedQty || Number(expectedQty) <= 0}
                      className="flex-1 px-5 py-3 text-base font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}

              {/* Step 4: Actual Count (first entry) */}
              {step === "actual1" && (
                <div>
                  <SelectedProductBadge product={selectedProduct!} />
                  <label className="block text-base font-semibold text-gray-700 mb-2">
                    Step 4: Count the actual units received
                  </label>
                  <p className="text-sm text-gray-500 mb-3">
                    Physically count what was delivered
                  </p>
                  <input
                    ref={actual1Ref}
                    type="number"
                    min="1"
                    step="1"
                    placeholder="Enter actual count"
                    value={actualQty1}
                    onChange={(e) => setActualQty1(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && confirmActual1()}
                    className="w-full px-4 py-4 text-xl font-semibold border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-center"
                  />
                  <div className="flex gap-3 mt-4">
                    <button
                      onClick={goBack}
                      className="px-5 py-3 text-base font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      Back
                    </button>
                    <button
                      onClick={confirmActual1}
                      disabled={!actualQty1 || Number(actualQty1) <= 0}
                      className="flex-1 px-5 py-3 text-base font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}

              {/* Step 5: Confirm Actual Count (second entry) */}
              {step === "actual2" && (
                <div>
                  <SelectedProductBadge product={selectedProduct!} />
                  <label className="block text-base font-semibold text-gray-700 mb-2">
                    Step 5: Re-enter the actual count to confirm
                  </label>
                  <p className="text-sm text-gray-500 mb-3">
                    This must match your previous entry
                  </p>
                  {matchError && (
                    <div className="mb-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm font-medium">
                      Counts don't match. Please re-enter.
                    </div>
                  )}
                  <input
                    ref={actual2Ref}
                    type="number"
                    min="1"
                    step="1"
                    placeholder="Re-enter actual count"
                    value={actualQty2}
                    onChange={(e) => {
                      setActualQty2(e.target.value);
                      setMatchError(false);
                    }}
                    onKeyDown={(e) => e.key === "Enter" && confirmActual2()}
                    className={`w-full px-4 py-4 text-xl font-semibold border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-center ${
                      matchError ? "border-red-400" : "border-gray-300"
                    }`}
                  />
                  <div className="flex gap-3 mt-4">
                    <button
                      onClick={goBack}
                      className="px-5 py-3 text-base font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      Back
                    </button>
                    <button
                      onClick={confirmActual2}
                      disabled={!actualQty2 || Number(actualQty2) <= 0}
                      className="flex-1 px-5 py-3 text-base font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Verify
                    </button>
                  </div>
                </div>
              )}

              {/* Step 6: Notes */}
              {step === "notes" && (
                <div>
                  <SelectedProductBadge product={selectedProduct!} />
                  <label className="block text-base font-semibold text-gray-700 mb-2">
                    Step 6: Notes (optional)
                  </label>
                  <textarea
                    ref={notesRef}
                    placeholder="Any notes about this shipment..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none"
                  />
                  <div className="flex gap-3 mt-4">
                    <button
                      onClick={goBack}
                      className="px-5 py-3 text-base font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      Back
                    </button>
                    <button
                      onClick={confirmNotes}
                      className="flex-1 px-5 py-3 text-base font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
                    >
                      {notes ? "Next" : "Skip"}
                    </button>
                  </div>
                </div>
              )}

              {/* Step 7: Review & Submit */}
              {step === "review" && selectedProduct && (
                <div>
                  <label className="block text-base font-semibold text-gray-700 mb-4">
                    Step 7: Review and Submit
                  </label>

                  <div className="bg-gray-50 rounded-lg p-5 space-y-3">
                    <ReviewRow label="Product" value={selectedProduct.name} />
                    <ReviewRow label="Category" value={selectedProduct.category} />
                    <ReviewRow label="Current Stock" value={`${selectedProduct.currentQty} ${selectedProduct.purchaseUnit}`} />
                    <ReviewRow label="Supplier" value={supplier || "Not specified"} muted={!supplier} />
                    <ReviewRow label="Expected Qty" value={expectedQty} />

                    {/* Highlight discrepancy */}
                    {Number(expectedQty) !== Number(actualQty1) ? (
                      <div className="flex justify-between items-center py-2 px-3 bg-orange-50 border border-orange-200 rounded-md">
                        <span className="text-sm font-medium text-orange-800">Actual Qty</span>
                        <span className="text-sm font-bold text-orange-800">
                          {actualQty1} (discrepancy: {Number(actualQty1) - Number(expectedQty) > 0 ? "+" : ""}
                          {Number(actualQty1) - Number(expectedQty)})
                        </span>
                      </div>
                    ) : (
                      <ReviewRow label="Actual Qty" value={actualQty1} />
                    )}

                    <ReviewRow
                      label="New Stock Level"
                      value={`${selectedProduct.currentQty + Number(actualQty1)} ${selectedProduct.purchaseUnit}`}
                      bold
                    />
                    {notes && <ReviewRow label="Notes" value={notes} />}
                  </div>

                  {submitError && (
                    <div className="mt-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm font-medium">
                      {submitError}
                    </div>
                  )}

                  <div className="flex gap-3 mt-5">
                    <button
                      onClick={goBack}
                      disabled={submitting}
                      className="px-5 py-3 text-base font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-40"
                    >
                      Back
                    </button>
                    <button
                      onClick={handleSubmit}
                      disabled={submitting}
                      className="flex-1 px-5 py-4 text-lg font-bold text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {submitting ? "Recording..." : "Record Receipt"}
                    </button>
                  </div>

                  <button
                    onClick={resetForm}
                    disabled={submitting}
                    className="w-full mt-3 text-sm text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    Cancel and start over
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right: Recent Receipts */}
          <div className="w-full lg:w-[440px] flex-shrink-0">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Recent Receipts</h2>

              {loadingReceipts ? (
                <p className="text-gray-400 text-center py-8">Loading...</p>
              ) : recentReceipts.length === 0 ? (
                <p className="text-gray-400 text-center py-8">No receipts yet</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-left">
                        <th className="pb-2 font-semibold text-gray-600 pr-3">Date</th>
                        <th className="pb-2 font-semibold text-gray-600 pr-3">Product</th>
                        <th className="pb-2 font-semibold text-gray-600 pr-2 text-right">Exp</th>
                        <th className="pb-2 font-semibold text-gray-600 pr-2 text-right">Act</th>
                        <th className="pb-2 font-semibold text-gray-600">Supplier</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentReceipts.map((r) => {
                        const mismatch = r.expectedQty !== r.actualQty;
                        return (
                          <tr
                            key={r.id}
                            className={`border-b border-gray-100 ${
                              mismatch ? "bg-orange-50" : ""
                            }`}
                          >
                            <td className="py-2 pr-3 text-xs text-gray-500 whitespace-nowrap">
                              {formatChicago(r.createdAt)}
                            </td>
                            <td className="py-2 pr-3 text-gray-900 font-medium max-w-[140px] truncate">
                              {r.productName}
                            </td>
                            <td className="py-2 pr-2 text-right text-gray-700">
                              {r.expectedQty}
                            </td>
                            <td
                              className={`py-2 pr-2 text-right font-medium ${
                                mismatch ? "text-orange-700" : "text-gray-700"
                              }`}
                            >
                              {r.actualQty}
                            </td>
                            <td className="py-2 text-gray-500 max-w-[100px] truncate">
                              {r.supplier || "\u2014"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

function Header({
  admin,
  logout,
  navigate,
}: {
  admin: { name: string; email: string } | null;
  logout: () => void;
  navigate: (path: string) => void;
}) {
  return (
    <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-bold text-gray-900">
          Twisted Treatz &mdash; Receiving
        </h1>
        <button
          onClick={() => navigate("/admin")}
          className="text-sm text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
        >
          &larr; Back to Dashboard
        </button>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-gray-500">{admin?.name ?? admin?.email}</span>
        <button
          onClick={logout}
          className="text-sm px-3 py-1.5 text-red-600 bg-red-50 rounded-md hover:bg-red-100 transition-colors font-medium"
        >
          Log Out
        </button>
      </div>
    </header>
  );
}

function SelectedProductBadge({ product }: { product: AdminProduct }) {
  return (
    <div className="mb-4 px-4 py-3 bg-indigo-50 border border-indigo-200 rounded-lg flex items-center justify-between">
      <div>
        <span className="text-sm font-semibold text-indigo-800">{product.name}</span>
        <span className="text-xs text-indigo-500 ml-2">{product.category}</span>
      </div>
      <span className="text-sm text-indigo-600 font-medium">
        {product.currentQty} {product.purchaseUnit} in stock
      </span>
    </div>
  );
}

function ReviewRow({
  label,
  value,
  bold,
  muted,
}: {
  label: string;
  value: string;
  bold?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-gray-600">{label}</span>
      <span
        className={`text-sm ${
          bold
            ? "font-bold text-indigo-700"
            : muted
              ? "text-gray-400 italic"
              : "font-medium text-gray-900"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
