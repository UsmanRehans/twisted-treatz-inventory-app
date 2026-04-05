import { useState, useCallback, useEffect } from "react";

const TOKEN_KEY = "twisted_treatz_admin_token";
const ADMIN_KEY = "twisted_treatz_admin_info";

interface AdminInfo {
  id: number;
  email: string;
  name: string;
}

export function useAdminAuth() {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem(TOKEN_KEY)
  );
  const [admin, setAdmin] = useState<AdminInfo | null>(() => {
    const stored = localStorage.getItem(ADMIN_KEY);
    return stored ? (JSON.parse(stored) as AdminInfo) : null;
  });

  const login = useCallback((newToken: string, adminInfo: AdminInfo) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(ADMIN_KEY, JSON.stringify(adminInfo));
    setToken(newToken);
    setAdmin(adminInfo);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ADMIN_KEY);
    setToken(null);
    setAdmin(null);
  }, []);

  const isAuthenticated = token !== null;

  // Check token validity on mount (simple expiry check)
  useEffect(() => {
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        if (payload.exp && payload.exp * 1000 < Date.now()) {
          logout();
        }
      } catch {
        logout();
      }
    }
  }, [token, logout]);

  return { token, admin, isAuthenticated, login, logout };
}
