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
  brand: string | null;
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

// ─── Stats ─────────────────────────────────────────────────────────

export async function fetchAdminStats(token: string): Promise<AdminStats> {
  return adminFetch<AdminStats>("/api/v1/admin/stats", token);
}

// ─── Products ──────────────────────────────────────────────────────

export async function fetchAdminProducts(
  token: string,
  filters?: { category?: string; search?: string; sort?: string; order?: string }
): Promise<AdminProduct[]> {
  const params = new URLSearchParams();
  if (filters?.category && filters.category !== "All") {
    params.set("category", filters.category);
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

// ─── Categories ────────────────────────────────────────────────────

export async function fetchAdminCategories(token: string): Promise<string[]> {
  return adminFetch<string[]>("/api/v1/products/categories", token);
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
