import { createContext, createElement, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { api } from "../api/client";
import { firebaseAuth, firebaseConfigReady } from "../lib/firebase";
import type { Permission } from "@medical-report-system/shared";

export type Role = "admin" | "super_admin" | "developer" | "radiographer" | "radiologist" | "referring" | "billing" | "receptionist" | "viewer";

export interface AuthState {
  loading: boolean;
  isAuthenticated: boolean;
  approved: boolean;
  requestStatus: "pending" | "approved" | "rejected";
  role: Role;
  userId?: string;
  email?: string;
  displayName?: string;
  phone?: string;
  department?: string;
  createdAt?: string;
  landingPath: string;
  permissions: Permission[];
  hasPermission: (perm: Permission) => boolean;
  hasAnyPermission: (perms: Permission[]) => boolean;
  refreshPermissions: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

export function landingPathForRole(role: Role): string {
  if (role === "radiographer") return "/tech";
  if (role === "radiologist") return "/dr-portal";
  if (role === "admin") return "/admin-dashboard";
  if (role === "super_admin") return "/developer-portal";
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
  refreshProfile: noopRefresh,
};

const AuthContext = createContext<AuthState>(defaultAuth);

const ROLE_DEFAULT_PERMISSIONS: Record<string, Permission[]> = {
  super_admin: [
    "platform:view_overview", "platform:manage_hospitals", "platform:assign_pacs",
    "platform:manage_hospital_admins", "platform:view_monitoring",
    "dashboard:view", "patients:view", "patients:create", "patients:edit", "patients:delete",
    "orders:view", "orders:create", "orders:edit", "orders:delete",
    "scans:view", "scans:create", "scans:edit", "scans:delete",
    "scheduling:view", "scheduling:create", "scheduling:edit", "scheduling:delete",
    "worklist:view", "worklist:assign", "worklist:update_status",
    "reports:view", "reports:create", "reports:edit", "reports:sign", "reports:addendum", "reports:share", "reports:delete",
    "templates:view", "templates:create", "templates:edit", "templates:delete",
    "billing:view", "billing:create", "billing:edit", "billing:delete", "billing:invoice", "billing:mark_paid",
    "referring_physicians:view", "referring_physicians:create", "referring_physicians:edit", "referring_physicians:delete",
    "dicom:upload", "dicom:view", "ai:analyze", "ai:view_results",
    "admin:manage_users", "admin:manage_roles", "admin:view_analytics", "admin:manage_invites",
    "developer:toggle_services", "developer:view_health",
  ] as Permission[],
  admin: [
    "dashboard:view", "patients:view", "patients:create", "patients:edit", "patients:delete",
    "orders:view", "orders:create", "orders:edit", "orders:delete",
    "scans:view", "scans:create", "scans:edit", "scans:delete",
    "scheduling:view", "scheduling:create", "scheduling:edit", "scheduling:delete",
    "worklist:view", "worklist:assign", "worklist:update_status",
    "reports:view", "reports:create", "reports:edit", "reports:sign", "reports:addendum", "reports:share", "reports:delete",
    "templates:view", "templates:create", "templates:edit", "templates:delete",
    "billing:view", "billing:create", "billing:edit", "billing:delete", "billing:invoice", "billing:mark_paid",
    "referring_physicians:view", "referring_physicians:create", "referring_physicians:edit", "referring_physicians:delete",
    "dicom:upload", "dicom:view", "ai:analyze", "ai:view_results",
    "admin:manage_users", "admin:manage_roles", "admin:view_analytics", "admin:manage_invites",
    "developer:toggle_services", "developer:view_health",
  ] as Permission[],
  radiologist: [
    "dashboard:view", "patients:view", "patients:create", "patients:edit",
    "orders:view", "orders:create", "scans:view", "scheduling:view",
    "worklist:view", "worklist:assign", "worklist:update_status",
    "reports:view", "reports:create", "reports:edit", "reports:sign", "reports:addendum", "reports:share",
    "templates:view", "templates:create", "templates:edit", "templates:delete",
    "billing:view", "dicom:upload", "dicom:view", "ai:analyze", "ai:view_results",
    "referring_physicians:view",
  ] as Permission[],
  radiographer: [
    "dashboard:view", "patients:view", "patients:create", "patients:edit",
    "orders:view", "orders:create", "orders:edit", "scheduling:view",
    "worklist:view", "worklist:assign", "worklist:update_status",
    "dicom:upload", "dicom:view", "referring_physicians:view",
  ] as Permission[],
  viewer: [
    "dashboard:view", "patients:view", "orders:view", "scans:view", "scheduling:view",
    "worklist:view", "reports:view", "billing:view", "referring_physicians:view",
  ] as Permission[],
};

async function fetchPermissions(): Promise<Permission[]> {
  try {
    const res = await api.get<{ role: string; permissions: Permission[] }>("/permissions/my-permissions");
    return res.data.permissions;
  } catch {
    return [];
  }
}

const PERMISSIONS_FETCH_TIMEOUT_MS = 5000;

async function fetchPermissionsWithTimeout() {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      fetchPermissions().then((permissions) => ({ permissions, timedOut: false })),
      new Promise<{ permissions: Permission[]; timedOut: true }>((resolve) => {
        timeoutHandle = setTimeout(
          () => resolve({ permissions: [], timedOut: true }),
          PERMISSIONS_FETCH_TIMEOUT_MS,
        );
      }),
    ]);
    return result;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

interface MeUser {
  id: string;
  email: string;
  role: Role;
  approved?: boolean;
  requestStatus?: "pending" | "approved" | "rejected";
  displayName?: string;
  phone?: string;
  department?: string;
  createdAt?: string;
}

function buildAuthState(
  user: MeUser,
  permissions: Permission[],
  refreshPermissions: () => Promise<void>,
  refreshProfile: () => Promise<void>,
): AuthState {
  const approved = user.approved ?? false;
  const requestStatus = user.requestStatus ?? (approved ? "approved" : "pending");
  const effectivePermissions = permissions.length > 0
    ? permissions
    : (ROLE_DEFAULT_PERMISSIONS[user.role] ?? []);
  const hasPerm = (p: Permission) => effectivePermissions.includes(p);
  return {
    loading: false,
    isAuthenticated: true,
    approved,
    requestStatus,
    role: user.role,
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    phone: user.phone,
    department: user.department,
    createdAt: user.createdAt,
    landingPath: approved ? landingPathForRole(user.role) : "/pending-approval",
    permissions: effectivePermissions,
    hasPermission: hasPerm,
    hasAnyPermission: (perms: Permission[]) => perms.some(hasPerm),
    refreshPermissions,
    refreshProfile,
  };
}

function unauthenticatedState(refreshPermissions: () => Promise<void>, refreshProfile: () => Promise<void>): AuthState {
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
    refreshProfile,
  };
}

const SESSION_KEY = "tdai_authenticated";

export function hasExplicitSession(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === "true";
  } catch {
    return false;
  }
}

export function markExplicitSession(): void {
  try {
    sessionStorage.setItem(SESSION_KEY, "true");
  } catch {
    // storage unavailable
  }
}

export function clearExplicitSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // storage unavailable
  }
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

  const refreshProfile = useCallback(async () => {
    try {
      const meRes = await api.get<{ user: MeUser | null }>("/auth/me");
      if (meRes.data.user) {
        setState((prev) => ({
          ...prev,
          displayName: meRes.data.user!.displayName,
          phone: meRes.data.user!.phone,
          department: meRes.data.user!.department,
          createdAt: meRes.data.user!.createdAt,
        }));
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!hasExplicitSession()) {
      setState(unauthenticatedState(refreshPermissions, refreshProfile));
      return;
    }

    let cancelled = false;
    let resolved = false;
    let firebaseUnsubscribe: (() => void) | undefined;

    const safetyTimer = setTimeout(() => {
      if (!cancelled && !resolved) {
        console.warn("[AuthProvider] Auth check timed out — falling back to unauthenticated");
        setState(unauthenticatedState(refreshPermissions, refreshProfile));
      }
    }, 8000);

    void (async () => {
      try {
        const meRes = await api.get<{ user: MeUser | null }>("/auth/me");
        if (meRes.data.user && cancelled) {
          return;
        }
        if (!cancelled && meRes.data.user) {
          resolved = true;
          const permissionResult = await fetchPermissionsWithTimeout();
          if (!cancelled) {
            setState(buildAuthState(meRes.data.user, permissionResult.permissions, refreshPermissions, refreshProfile));
            if (permissionResult.timedOut) {
              void refreshPermissions();
            }
          }
          return;
        }
      } catch {
        // no existing session, fall through
      }

      if (cancelled) {
        return;
      }

      if (!cancelled) {
        resolved = true;
      }

      if (!firebaseConfigReady) {
        if (!cancelled) {
          setState(unauthenticatedState(refreshPermissions, refreshProfile));
        }
        return;
      }

      if (!firebaseAuth) {
        if (!cancelled) {
          setState(unauthenticatedState(refreshPermissions, refreshProfile));
        }
        return;
      }

      firebaseUnsubscribe = onAuthStateChanged(firebaseAuth, (firebaseUser) => {
        void (async () => {
          if (cancelled) return;
          if (!firebaseUser) {
            resolved = true;
            setState(unauthenticatedState(refreshPermissions, refreshProfile));
            return;
          }

          try {
            const idToken = await firebaseUser.getIdToken();
            const loginResponse = await api.post<{
              user: MeUser;
            }>("/auth/firebase-login", { idToken });

            resolved = true;
            const permissionResult = await fetchPermissionsWithTimeout();
            if (!cancelled) {
              setState(buildAuthState(loginResponse.data.user, permissionResult.permissions, refreshPermissions, refreshProfile));
              if (permissionResult.timedOut) {
                void refreshPermissions();
              }
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
                refreshProfile,
              });
            }
          }
        })();
      });
    })();

    return () => {
      cancelled = true;
      clearTimeout(safetyTimer);
      firebaseUnsubscribe?.();
    };
  }, [refreshPermissions, refreshProfile]);

  return createElement(AuthContext.Provider, { value: state }, children);
}

/** Read auth state from the nearest AuthProvider -- no duplicate API calls */
export function useAuthRole(): AuthState {
  return useContext(AuthContext);
}
