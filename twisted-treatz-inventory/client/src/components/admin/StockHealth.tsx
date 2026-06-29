import { useEffect, useMemo, useState } from "react";
import { fetchAdminProducts, type AdminProduct } from "../../api/adminClient";

interface StockHealthProps {
  token: string;
}

// Three states, loudest-first. Aria's rule: the problem outranks the healthy —
// out-of-stock shouts (red), low murmurs (amber), healthy recedes (quiet white
// pill + a small green dot) so the zeros are what the eye lands on.
type Status = "out" | "low" | "healthy";

function statusOf(p: AdminProduct): Status {
  if (p.currentQty <= 0) return "out";
  if (p.currentQty <= p.alertThreshold) return "low";
  return "healthy";
}

const BUBBLE: Record<Status, { pill: string; dot: string; qty: string }> = {
  out: {
    pill: "bg-red-50 border-red-200 text-red-700",
    dot: "bg-red-500",
    qty: "bg-red-100 text-red-700",
  },
  low: {
    pill: "bg-amber-50 border-amber-200 text-amber-800",
    dot: "bg-amber-500",
    qty: "bg-amber-100 text-amber-800",
  },
  healthy: {
    pill: "bg-white border-gray-200 text-gray-600",
    dot: "bg-emerald-400",
    qty: "bg-gray-100 text-gray-600",
  },
};

type FilterKey = Status | "all";

export default function StockHealth({ token }: StockHealthProps) {
  const [products, setProducts] = useState<AdminProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("out");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let alive = true;
    fetchAdminProducts(token)
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

  // Group the (filtered) products into category rows, worst-first within each
  // row and categories with the most out-of-stock floated to the top.
  const rows = useMemo(() => {
    if (!products) return [];
    const q = search.trim().toLowerCase();
    const rank: Record<Status, number> = { out: 0, low: 1, healthy: 2 };
    const byCat = new Map<string, AdminProduct[]>();
    for (const p of products) {
      const s = statusOf(p);
      if (filter !== "all" && s !== filter) continue;
      if (q && !p.name.toLowerCase().includes(q) && !(p.brand ?? "").toLowerCase().includes(q))
        continue;
      if (!byCat.has(p.category)) byCat.set(p.category, []);
      byCat.get(p.category)!.push(p);
    }
    const out: { category: string; items: AdminProduct[]; outCount: number }[] = [];
    for (const [category, items] of byCat) {
      items.sort(
        (a, b) => rank[statusOf(a)] - rank[statusOf(b)] || a.currentQty - b.currentQty,
      );
      out.push({ category, items, outCount: items.filter((p) => statusOf(p) === "out").length });
    }
    out.sort((a, b) => b.outCount - a.outCount || b.items.length - a.items.length);
    return out;
  }, [products, filter, search]);

  if (error)
    return (
      <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
        {error}
      </div>
    );
  if (!products) return <div className="text-sm text-gray-500">Loading stock health…</div>;

  const shown = rows.reduce((n, r) => n + r.items.length, 0);

  return (
    <div className="max-w-5xl">
      {/* Summary cards double as filters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Out of stock" value={counts.out} tone="red" active={filter === "out"} onClick={() => setFilter("out")} />
        <StatCard label="Low" value={counts.low} tone="amber" active={filter === "low"} onClick={() => setFilter("low")} />
        <StatCard label="Healthy" value={counts.healthy} tone="green" active={filter === "healthy"} onClick={() => setFilter("healthy")} />
        <StatCard label="All products" value={counts.all} tone="gray" active={filter === "all"} onClick={() => setFilter("all")} />
      </div>

      {/* Search */}
      <div className="mb-5">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by product or brand…"
          className="w-full sm:w-80 px-3 py-2 border border-gray-300 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
        />
      </div>

      {/* Bubble wall, by category row */}
      {shown === 0 ? (
        <p className="text-sm text-gray-500 py-8 text-center">
          Nothing here{search ? " matches your search" : filter === "out" ? " — nothing is out of stock 🎉" : ""}.
        </p>
      ) : (
        <div className="divide-y divide-gray-100">
          {rows.map((row) => (
            <div key={row.category} className="flex flex-col sm:flex-row gap-2 sm:gap-4 py-3.5">
              <div className="sm:w-36 shrink-0 pt-1">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {row.category}
                </span>
                <span className="ml-1.5 text-xs text-gray-400">{row.items.length}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {row.items.map((p) => {
                  const s = statusOf(p);
                  const c = BUBBLE[s];
                  return (
                    <span
                      key={p.id}
                      title={`${p.name}${p.brand ? ` · ${p.brand}` : ""} — ${p.currentQty} on hand (alert ≤ ${p.alertThreshold})`}
                      className={`inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-full border text-xs ${c.pill}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                      <span className="truncate max-w-[160px]">{p.name}</span>
                      <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[11px] font-semibold tabular-nums ${c.qty}`}>
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

      <p className="mt-6 text-xs text-gray-400">
        Showing {shown} of {counts.all} active products. Threshold-based: red = 0 on hand, amber = at
        or below the per-product alert level, green = healthy.
      </p>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone: "red" | "amber" | "green" | "gray";
  active: boolean;
  onClick: () => void;
}) {
  const tones: Record<string, { num: string; ring: string }> = {
    red: { num: "text-red-600", ring: "ring-red-400" },
    amber: { num: "text-amber-600", ring: "ring-amber-400" },
    green: { num: "text-emerald-600", ring: "ring-emerald-400" },
    gray: { num: "text-gray-700", ring: "ring-indigo-400" },
  };
  const t = tones[tone];
  return (
    <button
      onClick={onClick}
      className={`text-left bg-white border rounded-2xl px-5 py-4 transition-all ${
        active ? `border-transparent ring-2 ${t.ring}` : "border-gray-200 hover:border-gray-300"
      }`}
    >
      <div className={`text-3xl font-bold tabular-nums ${t.num}`}>{value}</div>
      <div className="text-xs font-medium text-gray-500 mt-0.5">{label}</div>
    </button>
  );
}
