import { AdminDashboard } from "../components/AdminDashboard";
import { SuperAdminPortal } from "../components/SuperAdminPortal";
import { useAuthRole } from "../hooks/useAuthRole";

export function AdminDashboardPage() {
  const { role } = useAuthRole();
  if (role === "super_admin") {
    return <SuperAdminPortal />;
  }
  return <AdminDashboard />;
}
