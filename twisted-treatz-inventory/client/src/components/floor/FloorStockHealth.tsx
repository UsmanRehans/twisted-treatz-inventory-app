import { useEffect, useMemo, useState } from "react";
import { fetchProducts, type Product } from "../../api/client";

interface FloorStockHealthProps {
  token: string;
  onBack: () => void;
}

// Read-only floor view: "what's out / running low" at a glance while pulling
// stock. Same status logic as the admin Stock Health, scaled up for the iPad
// (big type, 48px+ tap targets, no hover). Opens on Out.
type Status = "out" | "low" | "healthy";

function statusOf(p: Product): Status {
  if (p.currentQty <= 0) return "out";
  if (p.currentQty <= p.alertThreshold) return "low";
  return "healthy";
}

const BUBBLE: Record<Status, { pill: string; dot: string; qty: string }> = {
  out: { pill: "bg-red-50 border-red-200 text-red-700", dot: "bg-red-500", qty: "bg-red-100 text-red-700" },
  low: { pill: "bg-amber-50 border-amber-200 text-amber-800", dot: "bg-amber-500", qty: "bg-amber-100 text-amber-800" },
  healthy: { pill: "bg-white border-gray-200 text-gray-600", dot: "bg-emerald-400", qty: "bg-gray-100 text-gray-600" },
};

type FilterKey = Status | "all";

export default function FloorStockHealth({ token, onBack }: FloorStockHealthProps) {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("out");

  useEffect(() => {
    let alive = true;
    fetchProducts(token)
      .then((p) => alive && setProducts(p))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Failed to load"));
    return () => {
      alive = false;
    };
  }, [token]);

  const counts = useMemo(() => {
    const c = { out: 0, low: 0, healthy: 0, all: 0 };
    for (const p of products ?? []) {
      c[statusOf(p)]++;
      c.all++;
    }
    return c;
  }, [products]);

  const rows = useMemo(() => {
    if (!products) return [];
    const rank: Record<Status, number> = { out: 0, low: 1, healthy: 2 };
    const byCat = new Map<string, Product[]>();
    for (const p of products) {
      const s = statusOf(p);
      if (filter !== "all" && s !== filter) continue;
      if (!byCat.has(p.category)) byCat.set(p.category, []);
      byCat.get(p.category)!.push(p);
    }
    const out: { category: string; items: Product[]; outCount: number }[] = [];
    for (const [category, items] of byCat) {
      items.sort((a, b) => rank[statusOf(a)] - rank[statusOf(b)] || a.currentQty - b.currentQty);
      out.push({ category, items, outCount: items.filter((p) => statusOf(p) === "out").length });
    }
    out.sort((a, b) => b.outCount - a.outCount || b.items.length - a.items.length);
    return out;
  }, [products, filter]);

  const shown = rows.reduce((n, r) => n + r.items.length, 0);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200 flex-shrink-0">
        <button
          onClick={onBack}
          className="min-h-[48px] px-5 rounded-lg bg-gray-100 text-[16px] text-gray-700 font-medium active:bg-gray-200"
        >
          ← Back
        </button>
        <span className="text-[18px] font-semibold text-gray-800">Stock Health</span>
      </div>

      {/* Filter pills (touch) */}
      <div className="flex gap-2 px-4 py-3 bg-white border-b border-gray-200 flex-shrink-0 overflow-x-auto hide-scrollbar">
        <FilterPill label="Out" n={counts.out} tone="red" active={filter === "out"} onClick={() => setFilter("out")} />
        <FilterPill label="Low" n={counts.low} tone="amber" active={filter === "low"} onClick={() => setFilter("low")} />
        <FilterPill label="Healthy" n={counts.healthy} tone="green" active={filter === "healthy"} onClick={() => setFilter("healthy")} />
        <FilterPill label="All" n={counts.all} tone="gray" active={filter === "all"} onClick={() => setFilter("all")} />
      </div>

      {/* Bubble wall */}
      <div className="flex-1 overflow-y-auto p-4">
        {error ? (
          <p className="text-[18px] text-red-600 text-center mt-8">{error}</p>
        ) : !products ? (
          <p className="text-[18px] text-gray-400 text-center mt-8">Loading…</p>
        ) : shown === 0 ? (
          <p className="text-[18px] text-gray-500 text-center mt-8">
            {filter === "out" ? "Nothing is out of stock 🎉" : "Nothing here."}
          </p>
        ) : (
          <div className="space-y-4">
            {rows.map((row) => (
              <div key={row.category}>
                <div className="text-[13px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  {row.category} <span className="text-gray-400">{row.items.length}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {row.items.map((p) => {
                    const c = BUBBLE[statusOf(p)];
                    return (
                      <span
                        key={p.id}
                        className={`inline-flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-full border text-[15px] ${c.pill}`}
                      >
                        <span className={`w-2 h-2 rounded-full ${c.dot}`} />
                        <span>{p.name}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[15px] font-bold tabular-nums ${c.qty}`}>
                          {p.currentQty}
                        </span>
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterPill({
  label,
  n,
  tone,
  active,
  onClick,
}: {
  label: string;
  n: number;
  tone: "red" | "amber" | "green" | "gray";
  active: boolean;
  onClick: () => void;
}) {
  const activeTone: Record<string, string> = {
    red: "bg-red-600 text-white",
    amber: "bg-amber-500 text-white",
    green: "bg-emerald-600 text-white",
    gray: "bg-gray-800 text-white",
  };
  return (
    <button
      onClick={onClick}
      className={`min-h-[48px] px-5 rounded-full text-[16px] font-medium flex-shrink-0 transition-colors ${
        active ? activeTone[tone] : "bg-gray-100 text-gray-600 active:bg-gray-200"
      }`}
    >
      {label} <span className="font-bold tabular-nums">{n}</span>
    </button>
  );
}
