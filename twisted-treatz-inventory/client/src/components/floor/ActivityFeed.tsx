import { useState, useEffect } from "react";

interface Removal {
  id: number;
  productName: string;
  productCategory: string;
  memberName: string;
  qty: number;
  qtyAfter: number;
  createdAt: string;
}

interface ActivityFeedProps {
  token: string;
  onBack: () => void;
}

const API_BASE = import.meta.env.VITE_API_URL || "";

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function ActivityFeed({ token, onBack }: ActivityFeedProps) {
  const [removals, setRemovals] = useState<Removal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API_BASE}/api/v1/removals?limit=50`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (json.success) {
          setRemovals(json.data.removals);
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-4 px-4 py-3 bg-white border-b border-gray-200">
        <button
          onClick={onBack}
          className="min-h-[48px] px-4 text-[16px] text-gray-500 font-medium active:text-gray-800 flex-shrink-0"
        >
          &larr; Back
        </button>
        <h2 className="text-[20px] font-semibold text-gray-800">
          Activity Log
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <span className="text-gray-400 text-[18px]">Loading...</span>
          </div>
        ) : removals.length === 0 ? (
          <div className="flex items-center justify-center h-40">
            <span className="text-gray-400 text-[18px]">No activity yet</span>
          </div>
        ) : (
          <div className="space-y-3">
            {removals.map((r) => (
              <div
                key={r.id}
                className="bg-white rounded-xl border border-gray-200 px-5 py-4 flex items-center justify-between"
              >
                <div>
                  <div className="text-[18px] font-semibold text-gray-800">
                    {r.productName}
                  </div>
                  <div className="text-[14px] text-gray-400 mt-1">
                    {r.memberName} &middot; {r.productCategory} &middot; {formatTime(r.createdAt)}
                  </div>
                </div>
                <div className="text-right flex-shrink-0 ml-4">
                  <div className="text-[22px] font-bold text-red-500">
                    &minus;{r.qty}
                  </div>
                  <div className="text-[14px] text-gray-400">
                    {r.qtyAfter} left
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
