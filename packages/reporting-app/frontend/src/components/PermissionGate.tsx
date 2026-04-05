import { Navigate } from "react-router-dom";
import { PropsWithChildren } from "react";
import { useAuthRole } from "../hooks/useAuthRole";
import type { Permission } from "@medical-report-system/shared";

interface PermissionGateProps {
  /** User must hold at least one of these permissions to access children */
  require: Permission[];
  /** Where to redirect if the user lacks the permission (defaults to /home) */
  fallback?: string;
}

export function PermissionGate({
  require,
  fallback = "/home",
  children,
}: PropsWithChildren<PermissionGateProps>) {
  const auth = useAuthRole();

  if (auth.loading) {
    return <div className="p-6">Checking access...</div>;
  }

  if (!auth.isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!auth.approved) {
    return <Navigate to="/pending-approval" replace />;
  }

  if (auth.role === "admin") {
    return <>{children}</>;
  }

  if (!auth.hasAnyPermission(require)) {
    return <Navigate to={fallback} replace />;
  }

  return <>{children}</>;
}
