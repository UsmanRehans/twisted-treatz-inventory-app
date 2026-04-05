import { useState, useEffect, useCallback, useRef } from "react";
import type { TeamMember, Product } from "../api/client";
import {
  fetchTeamMembers,
  verifyPin,
  fetchProducts,
  fetchCategories,
  createRemoval,
} from "../api/client";
import MemberSelect from "../components/floor/MemberSelect";
import PinPad from "../components/floor/PinPad";
import ProductGrid from "../components/floor/ProductGrid";
import ConfirmBar from "../components/floor/ConfirmBar";
import SuccessAnimation from "../components/floor/SuccessAnimation";

type Step = "member" | "pin" | "browse" | "success";

const IDLE_TIMEOUT = 30_000;
const COUNTDOWN_START = 20_000;

export default function FloorApp() {
  // ─── State ──────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>("member");
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersError, setMembersError] = useState<string | null>(null);

  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [successInfo, setSuccessInfo] = useState<{
    qty: number;
    productName: string;
  } | null>(null);

  // ─── Idle timer ─────────────────────────────────────────────────
  const [idleCountdown, setIdleCountdown] = useState<number | null>(null);
  const lastActivityRef = useRef(Date.now());
  const idleTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const resetIdle = useCallback(() => {
    lastActivityRef.current = Date.now();
    setIdleCountdown(null);
  }, []);

  // Reset idle on any touch/click
  useEffect(() => {
    const handler = () => resetIdle();
    document.addEventListener("touchstart", handler, { passive: true });
    document.addEventListener("mousedown", handler);
    return () => {
      document.removeEventListener("touchstart", handler);
      document.removeEventListener("mousedown", handler);
    };
  }, [resetIdle]);

  // Idle timer tick — only runs when NOT on member select (step 1)
  useEffect(() => {
    if (step === "member" || step === "success") {
      setIdleCountdown(null);
      return;
    }

    idleTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;

      if (elapsed >= IDLE_TIMEOUT) {
        // Reset to step 1
        resetToStart();
      } else if (elapsed >= COUNTDOWN_START) {
        setIdleCountdown(Math.ceil((IDLE_TIMEOUT - elapsed) / 1000));
      } else {
        setIdleCountdown(null);
      }
    }, 500);

    return () => clearInterval(idleTimerRef.current);
  }, [step]);

  // ─── Reset ──────────────────────────────────────────────────────
  const resetToStart = useCallback(() => {
    setStep("member");
    setSelectedMember(null);
    setAuthToken(null);
    setPinError(null);
    setSelectedProduct(null);
    setSubmitting(false);
    setSuccessInfo(null);
    setIdleCountdown(null);
    resetIdle();
  }, [resetIdle]);

  // ─── Load team members on mount ─────────────────────────────────
  useEffect(() => {
    fetchTeamMembers()
      .then(setMembers)
      .catch((err) => setMembersError(err.message))
      .finally(() => setMembersLoading(false));
  }, []);

  // ─── Handlers ───────────────────────────────────────────────────
  const handleMemberSelect = (member: TeamMember) => {
    setSelectedMember(member);
    setPinError(null);
    setStep("pin");
    resetIdle();
  };

  const handlePinSubmit = async (pin: string) => {
    if (!selectedMember) return;
    try {
      const result = await verifyPin(selectedMember.id, pin);
      setAuthToken(result.token);
      setPinError(null);

      // Load products and categories
      setProductsLoading(true);
      setStep("browse");
      resetIdle();

      const [prods, cats] = await Promise.all([
        fetchProducts(),
        fetchCategories(),
      ]);
      setProducts(prods);
      setCategories(cats);
      setProductsLoading(false);
    } catch (err) {
      setPinError(err instanceof Error ? err.message : "Invalid PIN");
    }
  };

  const handlePinBack = () => {
    setStep("member");
    setSelectedMember(null);
    setPinError(null);
    resetIdle();
  };

  const handleProductSelect = (product: Product) => {
    setSelectedProduct(product);
    resetIdle();
  };

  const handleProductBack = () => {
    resetToStart();
  };

  const handleCancelProduct = () => {
    setSelectedProduct(null);
    resetIdle();
  };

  const handleConfirmRemoval = async (qty: number) => {
    if (!selectedProduct || !authToken) return;
    setSubmitting(true);
    resetIdle();

    try {
      await createRemoval(authToken, selectedProduct.id, qty);

      // Update local product qty
      setProducts((prev) =>
        prev.map((p) =>
          p.id === selectedProduct.id
            ? { ...p, currentQty: p.currentQty - qty }
            : p
        )
      );

      // Show success
      setSuccessInfo({ qty, productName: selectedProduct.name });
      setSelectedProduct(null);
      setStep("success");

      // Auto-return to step 1 after 2 seconds
      setTimeout(() => {
        resetToStart();
      }, 2000);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to remove inventory");
      setSubmitting(false);
    }
  };

  // ─── Render ─────────────────────────────────────────────────────
  return (
    <div className="h-screen flex flex-col bg-gray-50 floor-app-root">
      {/* Header */}
      <header className="bg-gray-900 text-white px-6 py-3 flex items-center justify-between flex-shrink-0">
        <h1 className="text-[22px] font-bold tracking-tight">
          Twisted Treatz
        </h1>
        <span className="text-[14px] text-gray-400">
          Inventory Removal
        </span>
      </header>

      {/* Idle countdown indicator */}
      {idleCountdown !== null && (
        <div className="bg-amber-100 text-amber-700 text-center text-[14px] py-1 flex-shrink-0">
          Returning to home in {idleCountdown}s...
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 relative overflow-hidden">
        {step === "member" && (
          <MemberSelect
            members={members}
            onSelect={handleMemberSelect}
            loading={membersLoading}
            error={membersError}
          />
        )}

        {step === "pin" && selectedMember && (
          <PinPad
            memberName={selectedMember.name}
            onSubmit={handlePinSubmit}
            onBack={handlePinBack}
            error={pinError}
          />
        )}

        {step === "browse" && (
          <div className="h-full flex flex-col">
            <ProductGrid
              products={products}
              categories={categories}
              selectedProduct={selectedProduct}
              onSelectProduct={handleProductSelect}
              onBack={handleProductBack}
              memberName={selectedMember?.name ?? ""}
              loading={productsLoading}
            />

            {/* Spacer to prevent content from hiding behind fixed ConfirmBar */}
            {selectedProduct && <div className="h-[100px] flex-shrink-0" />}
          </div>
        )}

        {step === "success" && successInfo && (
          <SuccessAnimation
            qty={successInfo.qty}
            productName={successInfo.productName}
          />
        )}
      </main>

      {/* Bottom confirm bar — only visible when a product is selected */}
      {step === "browse" && selectedProduct && (
        <ConfirmBar
          product={selectedProduct}
          onConfirm={handleConfirmRemoval}
          onCancel={handleCancelProduct}
          submitting={submitting}
        />
      )}
    </div>
  );
}
