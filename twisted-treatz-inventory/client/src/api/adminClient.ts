// ─── Types ─────────────────────────────────────────────────────────

export interface AdminLoginResponse {
  token: string;
  admin: {
    id: number;
    email: string;
    name: string;
  };
}

export interface AdminStats {
  totalActiveSKUs: number;
  lowStockCount: number;
  totalRemovedToday: number;
  lastReceiptDate: string | null;
  lowStockProducts: LowStockProduct[];
}

export interface LowStockProduct {
  id: number;
  name: string;
  category: string;
  currentQty: number;
  alertThreshold: number;
}

export interface AdminProduct {
  id: number;
  name: string;
  category: string;
  flavor: string | null;
  purchaseUnit: string;
  unitSize: string | null;
  packSize: string | null; // Decimal serializes to string over the wire
  uom: string | null;
  brand: string | null;
  brandId: number | null;
  supplier: string | null;
  usedIn: string | null;
  currentQty: number;
  alertThreshold: number;
  unitPrice: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminTeamMember {
  id: number;
  name: string;
  initials: string;
  active: boolean;
}

export interface RemovalRecord {
  id: number;
  productId: number;
  productName: string;
  productCategory: string;
  teamMemberId: number;
  memberName: string;
  qty: number;
  qtyBefore: number;
  qtyAfter: number;
  createdAt: string;
}

export interface RemovalsResponse {
  removals: RemovalRecord[];
  total: number;
  page: number;
  limit: number;
}

export interface RemovalFilters {
  memberId?: number;
  category?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
  sort?: string;
  order?: string;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

// ─── Helper ────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_URL || "";

async function adminFetch<T>(
  url: string,
  token?: string,
  options?: RequestInit
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      ...headers,
      ...(options?.headers as Record<string, string> | undefined),
    },
  });

  const json: ApiResponse<T> = await res.json();

  if (!json.success) {
    throw new Error(json.error ?? "Unknown API error");
  }

  return json.data;
}

// ─── Auth ──────────────────────────────────────────────────────────

export async function adminLogin(
  email: string,
  password: string
): Promise<AdminLoginResponse> {
  return adminFetch<AdminLoginResponse>("/api/v1/auth/admin/login", undefined, {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

// A successful change revokes every outstanding admin session (including
// the token used to make the call) and returns a fresh token for this one.
export async function changeAdminPassword(
  token: string,
  currentPassword: string,
  newPassword: string
): Promise<{ message: string; token: string }> {
  return adminFetch<{ message: string; token: string }>(
    "/api/v1/auth/admin/change-password",
    token,
    {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }
  );
}

export async function requestPasswordReset(
  email: string
): Promise<{ message: string }> {
  return adminFetch<{ message: string }>(
    "/api/v1/auth/admin/request-reset",
    undefined,
    {
      method: "POST",
      body: JSON.stringify({ email }),
    }
  );
}

export async function resetPassword(
  token: string,
  newPassword: string
): Promise<{ message: string }> {
  return adminFetch<{ message: string }>(
    "/api/v1/auth/admin/reset-password",
    undefined,
    {
      method: "POST",
      body: JSON.stringify({ token, newPassword }),
    }
  );
}

// ─── Stats ─────────────────────────────────────────────────────────

export async function fetchAdminStats(token: string): Promise<AdminStats> {
  return adminFetch<AdminStats>("/api/v1/admin/stats", token);
}

// ─── Products ──────────────────────────────────────────────────────

export async function fetchAdminProducts(
  token: string,
  filters?: { category?: string; brandId?: number; search?: string; sort?: string; order?: string }
): Promise<AdminProduct[]> {
  const params = new URLSearchParams();
  if (filters?.category && filters.category !== "All") {
    params.set("category", filters.category);
  }
  if (filters?.brandId) {
    params.set("brandId", String(filters.brandId));
  }
  if (filters?.search) {
    params.set("search", filters.search);
  }
  if (filters?.sort) {
    params.set("sort", filters.sort);
  }
  if (filters?.order) {
    params.set("order", filters.order);
  }
  const qs = params.toString();
  return adminFetch<AdminProduct[]>(
    `/api/v1/products${qs ? `?${qs}` : ""}`,
    token
  );
}

export async function updateProduct(
  token: string,
  id: number,
  data: Record<string, unknown>
): Promise<AdminProduct> {
  return adminFetch<AdminProduct>(`/api/v1/products/${id}`, token, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export interface CreateProductData {
  name: string;
  category: string;
  purchaseUnit: string;
  flavor?: string | null;
  unitSize?: string | null;
  packSize?: number | null;
  uom?: string | null;
  brandId?: number | null;
  supplier?: string | null;
  usedIn?: string | null;
  alertThreshold?: number;
  unitPrice?: number | null;
}

export async function createProduct(
  token: string,
  data: CreateProductData
): Promise<AdminProduct> {
  return adminFetch<AdminProduct>("/api/v1/products", token, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ─── Categories ────────────────────────────────────────────────────

export async function fetchAdminCategories(token: string): Promise<string[]> {
  return adminFetch<string[]>("/api/v1/products/categories", token);
}

// ─── Brands ────────────────────────────────────────────────────────

export interface Brand {
  id: number;
  name: string;
  active: boolean;
}

export async function fetchBrands(token: string): Promise<Brand[]> {
  return adminFetch<Brand[]>("/api/v1/brands", token);
}

export async function createBrand(token: string, name: string): Promise<Brand> {
  return adminFetch<Brand>("/api/v1/brands", token, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

// ─── Team Members ──────────────────────────────────────────────────

export async function fetchAdminTeamMembers(
  token: string
): Promise<AdminTeamMember[]> {
  return adminFetch<AdminTeamMember[]>(
    "/api/v1/team-members?all=true",
    token
  );
}

export async function updateTeamMember(
  token: string,
  id: number,
  data: { pin?: string; active?: boolean }
): Promise<AdminTeamMember> {
  return adminFetch<AdminTeamMember>(`/api/v1/team-members/${id}`, token, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

// ─── Receipts ─────────────────────────────────────────────────────

export interface ReceiptRecord {
  id: number;
  productId: number;
  productName: string;
  productCategory: string;
  adminId: number;
  supplier: string | null;
  expectedQty: number;
  actualQty: number;
  unitPrice: number | null;
  notes: string | null;
  createdAt: string;
}

export interface ReceiptsResponse {
  receipts: ReceiptRecord[];
  total: number;
  page: number;
  limit: number;
}

export interface CreateReceiptData {
  productId: number;
  expectedQty: number;
  actualQty: number;
  supplier?: string;
  unitPrice?: number;
  notes?: string;
}

export interface CreateReceiptResponse {
  receipt: ReceiptRecord;
}

export async function createReceipt(
  token: string,
  data: CreateReceiptData
): Promise<CreateReceiptResponse> {
  return adminFetch<CreateReceiptResponse>("/api/v1/receipts", token, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function fetchReceipts(
  token: string,
  filters?: {
    productId?: number;
    supplier?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
    sort?: string;
    order?: string;
  }
): Promise<ReceiptsResponse> {
  const params = new URLSearchParams();
  if (filters?.productId) params.set("productId", String(filters.productId));
  if (filters?.supplier) params.set("supplier", filters.supplier);
  if (filters?.startDate) params.set("startDate", filters.startDate);
  if (filters?.endDate) params.set("endDate", filters.endDate);
  if (filters?.page) params.set("page", String(filters.page));
  if (filters?.limit) params.set("limit", String(filters.limit));
  if (filters?.sort) params.set("sort", filters.sort);
  if (filters?.order) params.set("order", filters.order);
  const qs = params.toString();
  return adminFetch<ReceiptsResponse>(
    `/api/v1/receipts${qs ? `?${qs}` : ""}`,
    token
  );
}

// ─── Bulk Adjustments (CSV export / import) ───────────────────────

export interface AdjustmentImportRow {
  id: number;
  newQty: number;
  csvQty?: number;
  note?: string;
}

export interface AdjustmentAppliedRow {
  id: number;
  name: string;
  qtyBefore: number;
  qtyAfter: number;
  delta: number;
  conflict: boolean;
  belowThreshold: boolean;
}

export interface AdjustmentSkippedRow {
  row: number;
  id: number | null;
  reason: string;
}

export interface AdjustmentImportSummary {
  changes: number;
  unchanged: number;
  added: number;
  removed: number;
  zeroed: number;
  conflicts: number;
  belowThreshold: number;
  errors: number;
}

export interface AdjustmentImportResult {
  dryRun: boolean;
  batchId: string | null;
  applied: AdjustmentAppliedRow[];
  skipped: AdjustmentSkippedRow[];
  summary: AdjustmentImportSummary;
}

export async function exportAdjustmentsCsv(
  token: string
): Promise<{ csv: string; productCount: number; exportedAt: string }> {
  return adminFetch<{ csv: string; productCount: number; exportedAt: string }>(
    "/api/v1/adjustments/export",
    token
  );
}

export async function importAdjustments(
  token: string,
  rows: AdjustmentImportRow[],
  dryRun: boolean
): Promise<AdjustmentImportResult> {
  return adminFetch<AdjustmentImportResult>("/api/v1/adjustments/import", token, {
    method: "POST",
    body: JSON.stringify({ rows, dryRun }),
  });
}

// ─── Catalog import (Hani's master sheet) ─────────────────────────
// Ingests Item/Category/Qty/Pack Size/UOM/Brand rows: creates products we
// don't have, updates catalog fields on the ones we do, and routes the
// counted Qty through an audited Adjustment. Always preview before apply.

export type CatalogMissingField = "qty" | "packSize" | "uom" | "brand";

export interface CatalogImportRow {
  item: string;
  category?: string | null;
  brand?: string | null;
  packSize?: number | null;
  uom?: string | null;
  qty?: number | null;
}

export interface CatalogCreate {
  item: string;
  category: string | null;
  brand: string | null;
  packSize: number | null;
  uom: string | null;
  qty: number;
  missing: CatalogMissingField[];
}

export interface CatalogUpdate {
  id: number;
  item: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  qtyBefore: number;
  qtyAfter: number;
  qtyDelta: number;
}

export interface CatalogSkippedRow {
  row: number;
  item: string | null;
  reason: string;
}

export interface CatalogFlagged {
  item: string;
  missing: CatalogMissingField[];
}

export interface CatalogImportSummary {
  creates: number;
  updates: number;
  qtyChanges: number;
  zeroed: number;
  brandsToCreate: number;
  flagged: number;
  unchanged: number;
  errors: number;
}

export interface CatalogImportResult {
  dryRun: boolean;
  batchId: string | null;
  creates: CatalogCreate[];
  updates: CatalogUpdate[];
  brandsToCreate: string[];
  flagged: CatalogFlagged[];
  skipped: CatalogSkippedRow[];
  unchanged: number;
  summary: CatalogImportSummary;
}

export async function importCatalog(
  token: string,
  rows: CatalogImportRow[],
  dryRun: boolean
): Promise<CatalogImportResult> {
  return adminFetch<CatalogImportResult>("/api/v1/catalog/import", token, {
    method: "POST",
    body: JSON.stringify({ rows, dryRun }),
  });
}

// ─── Unified Activity Feed (removals + receipts + adjustments) ─────

export type ActivityType = "removal" | "receipt" | "adjustment";

export interface ActivityEvent {
  type: ActivityType;
  id: string;
  productId: number;
  productName: string;
  productCategory: string;
  actorName: string;
  delta: number;
  qtyAfter: number | null;
  note: string | null;
  createdAt: string;
}

export interface ActivityResponse {
  events: ActivityEvent[];
  total: number;
  page: number;
  limit: number;
}

export async function fetchActivity(
  token: string,
  filters?: {
    type?: ActivityType | "all";
    memberId?: number;
    category?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }
): Promise<ActivityResponse> {
  const params = new URLSearchParams();
  if (filters?.type && filters.type !== "all") params.set("type", filters.type);
  if (filters?.memberId) params.set("memberId", String(filters.memberId));
  if (filters?.category) params.set("category", filters.category);
  if (filters?.startDate) params.set("startDate", filters.startDate);
  if (filters?.endDate) params.set("endDate", filters.endDate);
  if (filters?.page) params.set("page", String(filters.page));
  if (filters?.limit) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return adminFetch<ActivityResponse>(
    `/api/v1/admin/activity${qs ? `?${qs}` : ""}`,
    token
  );
}

// ─── Removals (Activity Log) ──────────────────────────────────────

export async function fetchRemovals(
  token: string,
  filters?: RemovalFilters
): Promise<RemovalsResponse> {
  const params = new URLSearchParams();
  if (filters?.memberId) params.set("memberId", String(filters.memberId));
  if (filters?.category) params.set("category", filters.category);
  if (filters?.startDate) params.set("startDate", filters.startDate);
  if (filters?.endDate) params.set("endDate", filters.endDate);
  if (filters?.page) params.set("page", String(filters.page));
  if (filters?.limit) params.set("limit", String(filters.limit));
  if (filters?.sort) params.set("sort", filters.sort);
  if (filters?.order) params.set("order", filters.order);
  const qs = params.toString();
  return adminFetch<RemovalsResponse>(
    `/api/v1/removals${qs ? `?${qs}` : ""}`,
    token
  );
}
