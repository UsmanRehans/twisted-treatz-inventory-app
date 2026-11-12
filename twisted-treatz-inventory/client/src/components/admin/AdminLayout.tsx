import { useEffect, useState, type ReactNode } from "react";
import AdminSidebar, { ADMIN_TABS, type AdminTab } from "./AdminSidebar";

// ─── Admin page frame ────────────────────────────────────────────────
// Desktop (lg+, ≥1024px): the sidebar sits beside the content as before.
// Phones, tablets in portrait and narrow windows: the sidebar hides behind
// a ☰ button in a slim top bar and slides in as a drawer.

interface AdminLayoutProps {
  active: AdminTab;
  onSelectTab?: (tab: Exclude<AdminTab, "receiving">) => void;
  children: ReactNode;
}

export default function AdminLayout({ active, onSelectTab, children }: AdminLayoutProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const title =
    active === "settings" ? "Change Password" : ADMIN_TABS.find((t) => t.id === active)?.label;

  return (
    <div className="h-dvh bg-gray-50 flex">
      <div className="hidden lg:flex flex-shrink-0">
        <AdminSidebar active={active} onSelectTab={onSelectTab} />
      </div>

      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/30" onClick={() => setMenuOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex shadow-xl">
            <AdminSidebar
              active={active}
              onSelectTab={onSelectTab}
              onNavigate={() => setMenuOpen(false)}
            />
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="lg:hidden flex items-center gap-3 px-3 h-14 bg-white border-b border-gray-200 flex-shrink-0">
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            className="w-11 h-11 -ml-1 flex items-center justify-center rounded-md text-gray-700 hover:bg-gray-100"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="min-w-0">
            <div className="text-xs text-gray-500 leading-tight">Twisted Treatz</div>
            <div className="font-semibold text-gray-900 truncate leading-tight">{title}</div>
          </div>
        </header>
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
