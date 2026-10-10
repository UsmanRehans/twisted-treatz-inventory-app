// The admin dashboard's tab list. Kept apart from the sidebar component so
// the component file exports only components (Vite fast refresh).

export type AdminTab =
  | "overview"
  | "products"
  | "stock"
  | "team"
  | "activity"
  | "receiving"
  | "bulk"
  | "catalog"
  | "thresholds"
  | "settings";

export const ADMIN_TABS: { id: AdminTab; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "[=]" },
  { id: "products", label: "Products", icon: "[#]" },
  { id: "stock", label: "Stock Health", icon: "[!]" },
  { id: "team", label: "Team", icon: "[o]" },
  { id: "activity", label: "Activity Log", icon: "[>]" },
  { id: "receiving", label: "Receiving", icon: "[+]" },
  { id: "bulk", label: "Bulk Update", icon: "[~]" },
  { id: "catalog", label: "Import Catalog", icon: "[^]" },
  { id: "thresholds", label: "Thresholds", icon: "[%]" },
];
