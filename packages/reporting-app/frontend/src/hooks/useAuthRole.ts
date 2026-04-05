import { createContext, createElement, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { api } from "../api/client";
import { firebaseAuth, firebaseConfigReady } from "../lib/firebase";
import type { Permission } from "@medical-report-system/shared";

export type Role = "admin" | "developer" | "radiographer" | "radiologist" | "referring" | "billing" | "receptionist" | "viewer";

export interface AuthState {
  loading: boolean;
  isAuthenticated: boolean;
  approved: boolean;
  requestStatus: "pending" | "approved" | "rejected";
  role: Role;
  userId?: string;
  email?: string;
  landingPath: string;
  permissions: Permission[];
  hasPermission: (perm: Permission) => boolean;
  hasAnyPermission: (perms: Permission[]) => boolean;
  refreshPermissions: () => Promise<void>;
}

export function landingPathForRole(role: Role): string {
  if (role === "radiographer") return "/tech";
  if (role === "radiologist") return "/dr-portal";
  if (role === "admin") return "/admin-dashboard";
  if (role === "developer") return "/developer-portal";
  if (role === "referring") return "/referring";
  if (role === "billing") return "/billing-dashboard";
  if (role === "receptionist") return "/receptionist";
  return "/worklist";
}

const noopHasPerm = () => false;
const noopRefresh = async () => {};

const defaultAuth: AuthState = {
  loading: true,
  isAuthenticated: false,
  approved: false,
  requestStatus: "pending",
  role: "viewer",
  landingPath: "/login",
  permissions: [],
  hasPermission: noopHasPerm,
  hasAnyPermission: noopHasPerm,
  refreshPermissions: noopRefresh,
};

const AuthContext = createContext<AuthState>(defaultAuth);

async function fetchPermissions(): Promise<Permission[]> {
  try {
    const res = await api.get<{ role: string; permissions: Permission[] }>("/permissions/my-permissions");
    return res.data.permissions;
  } catch {
    return [];
  }
}

function buildAuthState(
  user: { id: string; email: string; role: Role; approved?: boolean; requestStatus?: "pending" | "approved" | "rejected" },
  permissions: Permission[],
  refreshPermissions: () => Promise<void>,
): AuthState {
  const approved = user.approved ?? false;
  const requestStatus = user.requestStatus ?? (approved ? "approved" : "pending");
  const hasPerm = (p: Permission) => permissions.includes(p);
  return {
    loading: false,
    isAuthenticated: true,
    approved,
    requestStatus,
    role: user.role,
    userId: user.id,
    email: user.email,
    landingPath: approved ? landingPathForRole(user.role) : "/pending-approval",
    permissions,
    hasPermission: hasPerm,
    hasAnyPermission: (perms: Permission[]) => perms.some(hasPerm),
    refreshPermissions,
  };
}

function unauthenticatedState(refreshPermissions: () => Promise<void>): AuthState {
  return {
    loading: false,
    isAuthenticated: false,
    approved: false,
    requestStatus: "pending",
    role: "viewer",
    landingPath: "/login",
    permissions: [],
    hasPermission: noopHasPerm,
    hasAnyPermission: noopHasPerm,
    refreshPermissions,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(defaultAuth);

  const refreshPermissions = useCallback(async () => {
    const perms = await fetchPermissions();
    setState((prev) => ({
      ...prev,
      permissions: perms,
      hasPermission: (p: Permission) => perms.includes(p),
      hasAnyPermission: (ps: Permission[]) => ps.some((p) => perms.includes(p)),
    }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    let resolved = false;

    const safetyTimer = setTimeout(() => {
      if (!cancelled && !resolved) {
        console.warn("[AuthProvider] Auth check timed out — falling back to unauthenticated");
        setState(unauthenticatedState(refreshPermissions));
      }
    }, 8000);

    void (async () => {
      try {
        const meRes = await api.get<{ user: { id: string; email: string; role: Role; approved?: boolean; requestStatus?: "pending" | "approved" | "rejected" } | null }>("/auth/me");
        if (!cancelled && meRes.data.user) {
          const perms = await fetchPermissions();
          if (!cancelled) {
            resolved = true;
            setState(buildAuthState(meRes.data.user, perms, refreshPermissions));
          }
          return;
        }
      } catch {
        // no existing session, fall through
      }

      if (!cancelled) {
        resolved = true;
      }

      if (!firebaseConfigReady) {
        if (!cancelled) {
          setState(unauthenticatedState(refreshPermissions));
        }
        return;
      }

      const unsubscribe = onAuthStateChanged(firebaseAuth, (firebaseUser) => {
        void (async () => {
          if (cancelled) return;
          if (!firebaseUser) {
            resolved = true;
            setState(unauthenticatedState(refreshPermissions));
            return;
          }

          try {
            const idToken = await firebaseUser.getIdToken();
            const loginResponse = await api.post<{
              user: {
                id: string;
                email: string;
                role: Role;
                approved?: boolean;
                requestStatus?: "pending" | "approved" | "rejected";
              };
            }>("/auth/firebase-login", { idToken });

            const perms = await fetchPermissions();
            if (!cancelled) {
              resolved = true;
              setState(buildAuthState(loginResponse.data.user, perms, refreshPermissions));
            }
          } catch {
            if (!cancelled) {
              resolved = true;
              setState({
                loading: false,
                isAuthenticated: true,
                approved: false,
                requestStatus: "pending",
                role: "viewer",
                userId: firebaseUser.uid,
                email: firebaseUser.email ?? undefined,
                landingPath: "/pending-approval",
                permissions: [],
                hasPermission: noopHasPerm,
                hasAnyPermission: noopHasPerm,
                refreshPermissions,
              });
            }
          }
        })();
      });

      return () => unsubscribe();
    })();

    return () => {
      cancelled = true;
      clearTimeout(safetyTimer);
    };
  }, [refreshPermissions]);

  return createElement(AuthContext.Provider, { value: state }, children);
}

/** Read auth state from the nearest AuthProvider -- no duplicate API calls */
export function useAuthRole(): AuthState {
  return useContext(AuthContext);
}
