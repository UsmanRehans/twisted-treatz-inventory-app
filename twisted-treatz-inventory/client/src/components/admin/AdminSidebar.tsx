import { useNavigate } from "react-router-dom";
import { useAdminAuth } from "../../hooks/useAdminAuth";

// Shared sidebar for all admin pages (/admin and /admin/receive) — nav tabs
// plus the account zone (Floor iPad View, name, Change Password, Log Out).
//
// "receiving" is a separate route; the other tabs live as client state on
// the dashboard. When no onSelectTab is provided (e.g. from Receiving), tab
// clicks navigate to /admin with the target tab in location state.

export type AdminTab =
  | "overview"
  | "products"
  | "team"
  | "activity"
  | "receiving"
  | "bulk"
  | "settings";

export const ADMIN_TABS: { id: AdminTab; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "[=]" },
  { id: "products", label: "Products", icon: "[#]" },
  { id: "team", label: "Team", icon: "[o]" },
  { id: "activity", label: "Activity Log", icon: "[>]" },
  { id: "receiving", label: "Receiving", icon: "[+]" },
  { id: "bulk", label: "Bulk Update", icon: "[~]" },
];

export default function AdminSidebar({
  active,
  onSelectTab,
}: {
  active: AdminTab;
  onSelectTab?: (tab: Exclude<AdminTab, "receiving">) => void;
}) {
  const navigate = useNavigate();
  const { admin, logout } = useAdminAuth();

  function handleClick(tab: AdminTab) {
    if (tab === "receiving") {
      if (active !== "receiving") navigate("/admin/receive");
      return;
    }
    if (onSelectTab) {
      onSelectTab(tab);
    } else {
      navigate("/admin", { state: { tab } });
    }
  }

  return (
    <aside className="w-60 bg-white border-r border-gray-200 flex flex-col h-full">
      <div className="p-5 border-b border-gray-200">
        <h1 className="text-lg font-bold text-gray-900">Twisted Treatz</h1>
        <p className="text-xs text-gray-500 mt-0.5">Admin Dashboard</p>
      </div>

      <nav className="flex-1 overflow-y-auto p-3 space-y-1">
        {ADMIN_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleClick(tab.id)}
            className={`w-full text-left px-3 py-2.5 rounded-md text-sm font-medium flex items-center gap-2.5 transition-colors ${
              active === tab.id
                ? "bg-indigo-50 text-indigo-700"
                : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            }`}
          >
            <span className="text-xs font-mono opacity-60">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="p-4 border-t border-gray-200 space-y-2">
        <button
          onClick={() => navigate("/app")}
          className="w-full text-sm px-3 py-2 text-indigo-600 bg-indigo-50 rounded-md hover:bg-indigo-100 transition-colors font-medium"
        >
          Floor iPad View
        </button>
        <div className="text-sm text-gray-600 mb-1 truncate">
          {admin?.name ?? admin?.email}
        </div>
        <button
          onClick={() => handleClick("settings")}
          className={`w-full text-sm px-3 py-2 rounded-md transition-colors font-medium ${
            active === "settings"
              ? "text-indigo-700 bg-indigo-50"
              : "text-gray-600 bg-gray-100 hover:bg-gray-200"
          }`}
        >
          Change Password
        </button>
        <button
          onClick={logout}
          className="w-full text-sm px-3 py-2 text-red-600 bg-red-50 rounded-md hover:bg-red-100 transition-colors font-medium"
        >
          Log Out
        </button>
      </div>
    </aside>
  );
}
