import { useState, useCallback } from "react";

const TOKEN_KEY = "twisted_treatz_admin_token";
const ADMIN_KEY = "twisted_treatz_admin_info";

interface AdminInfo {
  id: number;
  email: string;
  name: string;
}

// Reads the stored token and drops it if it is malformed or expired, so the
// first render already knows whether the admin is signed in (no effect, no
// flash of a dashboard that then redirects). JWT segments are base64url.
function readStoredToken(): string | null {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null;
  try {
    const segment = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(segment));
    if (payload.exp && payload.exp * 1000 < Date.now()) throw new Error("expired");
    return token;
  } catch {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ADMIN_KEY);
    return null;
  }
}

export function useAdminAuth() {
  const [token, setToken] = useState<string | null>(readStoredToken);
  const [admin, setAdmin] = useState<AdminInfo | null>(() => {
    // readStoredToken ran first and cleared ADMIN_KEY if the token was bad
    const stored = localStorage.getItem(ADMIN_KEY);
    return stored ? (JSON.parse(stored) as AdminInfo) : null;
  });

  const login = useCallback((newToken: string, adminInfo: AdminInfo) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(ADMIN_KEY, JSON.stringify(adminInfo));
    setToken(newToken);
    setAdmin(adminInfo);
  }, []);

  // Swap in a re-issued token (e.g. after a password change revokes the
  // old one) without touching the stored admin info.
  const refreshToken = useCallback((newToken: string) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ADMIN_KEY);
    setToken(null);
    setAdmin(null);
  }, []);

  const isAuthenticated = token !== null;

  return { token, admin, isAuthenticated, login, logout, refreshToken };
}
