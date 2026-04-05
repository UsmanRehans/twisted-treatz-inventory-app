import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAdminAuth } from "../hooks/useAdminAuth";
import StatCards from "../components/admin/StatCards";
import ProductTable from "../components/admin/ProductTable";
import TeamMemberCards from "../components/admin/TeamMemberCards";
import ActivityLog from "../components/admin/ActivityLog";

type Tab = "overview" | "products" | "team" | "activity" | "receiving";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "[=]" },
  { id: "products", label: "Products", icon: "[#]" },
  { id: "team", label: "Team", icon: "[o]" },
  { id: "activity", label: "Activity Log", icon: "[>]" },
  { id: "receiving", label: "Receiving", icon: "[+]" },
];

export default function Admin() {
  const { token, admin, isAuthenticated, logout } = useAdminAuth();
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const navigate = useNavigate();

  if (!isAuthenticated || !token) {
    return <Navigate to="/admin/login" replace />;
  }

  function handleTabClick(tab: Tab) {
    if (tab === "receiving") {
      navigate("/admin/receive");
      return;
    }
    setActiveTab(tab);
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className="w-60 bg-white border-r border-gray-200 flex flex-col min-h-screen">
        <div className="p-5 border-b border-gray-200">
          <h1 className="text-lg font-bold text-gray-900">Twisted Treatz</h1>
          <p className="text-xs text-gray-500 mt-0.5">Admin Dashboard</p>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabClick(tab.id)}
              className={`w-full text-left px-3 py-2.5 rounded-md text-sm font-medium flex items-center gap-2.5 transition-colors ${
                activeTab === tab.id
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              <span className="text-xs font-mono opacity-60">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-200">
          <div className="text-sm text-gray-600 mb-2 truncate">
            {admin?.name ?? admin?.email}
          </div>
          <button
            onClick={logout}
            className="w-full text-sm px-3 py-2 text-red-600 bg-red-50 rounded-md hover:bg-red-100 transition-colors font-medium"
          >
            Log Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto p-6">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-gray-900">
              {TABS.find((t) => t.id === activeTab)?.label}
            </h2>
          </div>

          {activeTab === "overview" && <StatCards token={token} />}
          {activeTab === "products" && <ProductTable token={token} />}
          {activeTab === "team" && <TeamMemberCards token={token} />}
          {activeTab === "activity" && <ActivityLog token={token} />}
        </div>
      </main>
    </div>
  );
}
