import { useState, useEffect, useCallback } from "react";
import {
  fetchRemovals,
  fetchAdminTeamMembers,
  fetchAdminCategories,
} from "../../api/adminClient";
import type {
  RemovalRecord,
  AdminTeamMember,
  RemovalFilters,
} from "../../api/adminClient";

interface ActivityLogProps {
  token: string;
}

function formatTimestamp(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function ActivityLog({ token }: ActivityLogProps) {
  const [removals, setRemovals] = useState<RemovalRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  // Filters
  const [memberId, setMemberId] = useState<number | undefined>(undefined);
  const [category, setCategory] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Filter option lists
  const [members, setMembers] = useState<AdminTeamMember[]>([]);
  const [categories, setCategories] = useState<string[]>([]);

  const limit = 50;

  useEffect(() => {
    fetchAdminTeamMembers(token).then(setMembers).catch(console.error);
    fetchAdminCategories(token).then(setCategories).catch(console.error);
  }, [token]);

  const loadRemovals = useCallback(() => {
    setLoading(true);
    const filters: RemovalFilters = {
      page,
      limit,
      sort: "createdAt",
      order: "desc",
    };
    if (memberId) filters.memberId = memberId;
    if (category) filters.category = category;
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;

    fetchRemovals(token, filters)
      .then((data) => {
        setRemovals(data.removals);
        setTotal(data.total);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token, page, memberId, category, startDate, endDate]);

  useEffect(() => {
    loadRemovals();
  }, [loadRemovals]);

  // Reset to page 1 on filter change
  useEffect(() => {
    setPage(1);
  }, [memberId, category, startDate, endDate]);

  const totalPages = Math.ceil(total / limit);

  function exportCSV() {
    const headers = [
      "Timestamp",
      "Member",
      "Product",
      "Category",
      "Qty Removed",
      "Stock After",
    ];
    const rows = removals.map((r) => [
      formatTimestamp(r.createdAt),
      r.memberName,
      r.productName,
      r.productCategory,
      String(r.qty),
      String(r.qtyAfter),
    ]);

    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `activity-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Member</label>
          <select
            value={memberId ?? ""}
            onChange={(e) =>
              setMemberId(e.target.value ? Number(e.target.value) : undefined)
            }
            className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
          >
            <option value="">All Members</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">From</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">To</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
          />
        </div>
        <button
          onClick={exportCSV}
          disabled={removals.length === 0}
          className="px-4 py-2 bg-gray-100 text-gray-700 border border-gray-300 rounded-md text-sm hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Export CSV
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center text-gray-500 py-8">Loading activity...</div>
      ) : removals.length === 0 ? (
        <div className="text-center text-gray-400 py-12">
          No removal records found.
        </div>
      ) : (
        <>
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Time
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Member
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Product
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Category
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">
                    Qty Removed
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">
                    Stock After
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {removals.map((r) => (
                  <tr
                    key={r.id}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">
                      {formatTimestamp(r.createdAt)}
                    </td>
                    <td className="px-4 py-2.5 text-gray-900 font-medium">
                      {r.memberName}
                    </td>
                    <td className="px-4 py-2.5 text-gray-900">
                      {r.productName}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">
                      {r.productCategory}
                    </td>
                    <td className="px-4 py-2.5 text-right text-red-600 font-mono font-medium">
                      -{r.qty}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-700 font-mono">
                      {r.qtyAfter}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
              <span>
                Page {page} of {totalPages} ({total} total records)
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
