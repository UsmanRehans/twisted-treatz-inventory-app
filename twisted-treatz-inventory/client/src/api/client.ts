// ─── Types ─────────────────────────────────────────────────────────

export interface TeamMember {
  id: number;
  name: string;
  initials: string;
  active: boolean;
}

export interface Product {
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

export interface VerifyResponse {
  token: string;
  member: {
    id: number;
    name: string;
    initials: string;
  };
}

export interface RemovalResponse {
  removal: {
    id: number;
    productId: number;
    productName: string;
    teamMemberId: number;
    memberName: string;
    qty: number;
    qtyBefore: number;
    qtyAfter: number;
    createdAt: string;
  };
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

// ─── API Base URL ─────────────────────────────────────────────────
const API_BASE = import.meta.env.VITE_API_URL || "";

// ─── API Client Functions ──────────────────────────────────────────

async function apiFetch<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...options,
  });

  const json: ApiResponse<T> = await res.json();

  if (!json.success) {
    throw new Error(json.error ?? "Unknown API error");
  }

  return json.data;
}

export async function fetchTeamMembers(): Promise<TeamMember[]> {
  return apiFetch<TeamMember[]>("/api/v1/team-members");
}

export async function verifyPin(
  memberId: number,
  pin: string
): Promise<VerifyResponse> {
  return apiFetch<VerifyResponse>("/api/v1/auth/team/verify", {
    method: "POST",
    body: JSON.stringify({ memberId, pin }),
  });
}

export async function fetchProducts(
  category?: string,
  search?: string
): Promise<Product[]> {
  const params = new URLSearchParams();
  if (category && category !== "All") {
    params.set("category", category);
  }
  if (search) {
    params.set("search", search);
  }
  const qs = params.toString();
  return apiFetch<Product[]>(`/api/v1/products${qs ? `?${qs}` : ""}`);
}

export async function fetchCategories(): Promise<string[]> {
  return apiFetch<string[]>("/api/v1/products/categories");
}

export async function createRemoval(
  token: string,
  productId: number,
  qty: number
): Promise<RemovalResponse> {
  return apiFetch<RemovalResponse>("/api/v1/removals", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ productId, qty }),
  });
}
