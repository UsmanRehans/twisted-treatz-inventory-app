import { useState, useEffect } from "react";
import { fetchAdminStats } from "../../api/adminClient";
import type { AdminStats } from "../../api/adminClient";

interface StatCardsProps {
  token: string;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "None";
  return new Date(dateStr).toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function StatCards({ token }: StatCardsProps) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAdminStats(token)
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load stats");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [token]);

  if (loading) {
    return (
      <div className="text-gray-500 py-8 text-center">Loading stats...</div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 text-red-700 px-4 py-3 rounded-md">{error}</div>
    );
  }

  if (!stats) return null;

  const cards = [
    { label: "Total SKUs", value: stats.totalActiveSKUs, color: "bg-blue-50 text-blue-700" },
    { label: "Low Stock", value: stats.lowStockCount, color: stats.lowStockCount > 0 ? "bg-orange-50 text-orange-700" : "bg-green-50 text-green-700" },
    { label: "Removed Today", value: stats.totalRemovedToday, color: "bg-purple-50 text-purple-700" },
    { label: "Last Receipt", value: formatDate(stats.lastReceiptDate), color: "bg-gray-50 text-gray-700" },
  ];

  return (
    <div>
      <div className="grid grid-cols-4 gap-4 mb-6">
        {cards.map((card) => (
          <div
            key={card.label}
            className={`rounded-lg p-5 ${card.color} border border-current/10`}
          >
            <p className="text-sm font-medium opacity-75">{card.label}</p>
            <p className="text-2xl font-bold mt-1">{card.value}</p>
          </div>
        ))}
      </div>

      {stats.lowStockProducts.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
          <h3 className="font-semibold text-orange-800 mb-3">
            Low Stock Alerts ({stats.lowStockProducts.length})
          </h3>
          <div className="space-y-2">
            {stats.lowStockProducts.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between bg-white rounded-md px-3 py-2 border border-orange-100"
              >
                <div>
                  <span className="font-medium text-gray-900">{p.name}</span>
                  <span className="text-sm text-gray-500 ml-2">{p.category}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-sm font-medium ${p.currentQty === 0 ? "text-red-600" : "text-orange-600"}`}>
                    {p.currentQty} / {p.alertThreshold}
                  </span>
                  <a
                    href="/admin/receive"
                    className="text-xs bg-indigo-600 text-white px-3 py-1 rounded hover:bg-indigo-700 transition-colors"
                  >
                    Receive
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {stats.lowStockProducts.length === 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-green-700">
          All products are above their alert thresholds.
        </div>
      )}
    </div>
  );
}
