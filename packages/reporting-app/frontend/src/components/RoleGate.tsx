import { Navigate } from "react-router-dom";
import { PropsWithChildren } from "react";
import { useAuthRole } from "../hooks/useAuthRole";

export function RoleGate({
  allow,
  children,
}: PropsWithChildren<{ allow: Array<"admin" | "super_admin" | "developer" | "radiographer" | "radiologist" | "referring" | "billing" | "receptionist" | "viewer"> }>) {
  const auth = useAuthRole();

  if (auth.loading) {
    return <div className="p-6">Checking access...</div>;
  }

  if (!auth.isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  if (!auth.approved) {
    return <Navigate to="/pending-approval" replace />;
  }

  if (!allow.includes(auth.role)) {
    return <Navigate to="/home" replace />;
  }

  return <>{children}</>;
}
