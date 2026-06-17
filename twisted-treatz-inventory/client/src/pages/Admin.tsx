import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAdminAuth } from "../hooks/useAdminAuth";
import AdminSidebar, {
  ADMIN_TABS,
  type AdminTab,
} from "../components/admin/AdminSidebar";
import StatCards from "../components/admin/StatCards";
import ProductTable from "../components/admin/ProductTable";
import TeamMemberCards from "../components/admin/TeamMemberCards";
import ActivityLog from "../components/admin/ActivityLog";
import BulkUpdate from "../components/admin/BulkUpdate";
import ChangePassword from "../components/admin/ChangePassword";

// Dashboard tabs are client state on this page; "receiving" is its own
// route. Other pages (e.g. Receiving) can deep-link a tab by navigating
// here with { state: { tab } }.
type Tab = Exclude<AdminTab, "receiving">;

export default function Admin() {
  const { token, isAuthenticated, refreshToken } = useAdminAuth();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<Tab>(
    (location.state as { tab?: Tab } | null)?.tab ?? "overview",
  );

  if (!isAuthenticated || !token) {
    return <Navigate to="/admin/login" replace />;
  }

  return (
    <div className="h-screen bg-gray-50 flex">
      <AdminSidebar active={activeTab} onSelectTab={setActiveTab} />

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto p-6">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-gray-900">
              {activeTab === "settings"
                ? "Change Password"
                : ADMIN_TABS.find((t) => t.id === activeTab)?.label}
            </h2>
          </div>

          {activeTab === "overview" && <StatCards token={token} />}
          {activeTab === "products" && <ProductTable token={token} />}
          {activeTab === "team" && <TeamMemberCards token={token} />}
          {activeTab === "activity" && <ActivityLog token={token} />}
          {activeTab === "bulk" && <BulkUpdate token={token} />}
          {activeTab === "settings" && (
            <ChangePassword token={token} onTokenRefresh={refreshToken} />
          )}
        </div>
      </main>
    </div>
  );
}
