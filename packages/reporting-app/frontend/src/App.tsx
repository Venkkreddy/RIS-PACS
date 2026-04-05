import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { InternalNavbar } from "./components/InternalNavbar";
import { RoleGate } from "./components/RoleGate";
import { PermissionGate } from "./components/PermissionGate";
import { AdminPage } from "./pages/AdminPage";
import { useAuthRole } from "./hooks/useAuthRole";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { MyStudiesPage } from "./pages/MyStudiesPage";
import { MyUploadsPage } from "./pages/MyUploadsPage";
import { PendingApprovalPage } from "./pages/PendingApprovalPage";
import { ReportPage } from "./pages/ReportPage";
import { ReportsPage } from "./pages/ReportsPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { WorklistPage } from "./pages/WorklistPage";
import { PatientsPage } from "./pages/PatientsPage";
import { OrdersPage } from "./pages/OrdersPage";
import { ScansPage } from "./pages/ScansPage";
import { SchedulePage } from "./pages/SchedulePage";
import { BillingPage } from "./pages/BillingPage";
import { ReferringPhysiciansPage } from "./pages/ReferringPhysiciansPage";
import { RadiologistPage } from "./pages/RadiologistPage";
import { AdminDashboardPage } from "./pages/AdminDashboardPage";
import { TechPage } from "./pages/TechPage";
import { ReferringPage } from "./pages/ReferringPage";
import { BillingDashboardPage } from "./pages/BillingDashboardPage";
import { ReceptionistPage } from "./pages/ReceptionistPage";
import { useEffect, useState } from "react";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo({ top: 0, behavior: "smooth" }); }, [pathname]);
  return null;
}

function AuthLoadingScreen() {
  const [showFallback, setShowFallback] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShowFallback(true), 4000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-white">
      <div className="flex flex-col items-center gap-5 animate-fade-in">
        <div className="relative">
          <div className="h-10 w-10 rounded-full border-2 border-tdai-gray-200" />
          <div className="absolute inset-0 h-10 w-10 animate-spin rounded-full border-2 border-transparent border-t-tdai-teal-500" />
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <p className="text-sm font-medium text-tdai-navy-700">Loading TD|ai</p>
          <p className="text-xs text-tdai-gray-400">Preparing your workspace...</p>
        </div>
        {showFallback && (
          <Link
            to="/login"
            className="mt-2 text-xs font-medium text-tdai-teal-600 hover:text-tdai-teal-700 hover:underline transition-colors animate-fade-in"
          >
            Taking too long? Go to login
          </Link>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const auth = useAuthRole();
  const location = useLocation();
  const isPublicRoute = ["/", "/login", "/pending-approval"].includes(location.pathname);
  const shouldShowAuthLoader = auth.loading && !isPublicRoute;

  useEffect(() => {
    // Force the white template for all role portals.
    document.documentElement.classList.remove("dark");
  }, []);

  if (shouldShowAuthLoader) {
    return <AuthLoadingScreen />;
  }

  return (
    <div className="min-h-screen bg-tdai-background">
      <ScrollToTop />
      {!isPublicRoute ? <InternalNavbar /> : null}
      <main className={!isPublicRoute ? "animate-fade-in" : ""}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/pending-approval" element={<PendingApprovalPage />} />
        <Route path="/home" element={<Navigate to={auth.landingPath} replace />} />
        <Route path="/patients" element={
          <PermissionGate require={["patients:view"]}><PatientsPage /></PermissionGate>
        } />
        <Route path="/orders" element={
          <PermissionGate require={["orders:view"]}><OrdersPage /></PermissionGate>
        } />
        <Route path="/scans" element={
          <PermissionGate require={["scans:view"]}><ScansPage /></PermissionGate>
        } />
        <Route path="/schedule" element={
          <PermissionGate require={["scheduling:view"]}><SchedulePage /></PermissionGate>
        } />
        <Route path="/billing" element={
          <PermissionGate require={["billing:view"]}><BillingPage /></PermissionGate>
        } />
        <Route path="/referring-physicians" element={
          <PermissionGate require={["referring_physicians:view"]}><ReferringPhysiciansPage /></PermissionGate>
        } />
        <Route path="/worklist" element={
          <PermissionGate require={["worklist:view"]}><WorklistPage /></PermissionGate>
        } />
        <Route path="/my-uploads" element={
          <PermissionGate require={["dicom:upload"]}><MyUploadsPage /></PermissionGate>
        } />
        <Route path="/my-studies" element={
          <PermissionGate require={["reports:create", "reports:view"]}><MyStudiesPage /></PermissionGate>
        } />
        <Route path="/templates" element={
          <PermissionGate require={["templates:view"]}><TemplatesPage /></PermissionGate>
        } />
        <Route path="/reports" element={
          <PermissionGate require={["reports:view"]}><ReportsPage /></PermissionGate>
        } />
        <Route path="/reports/:id" element={
          <PermissionGate require={["reports:view"]}><ReportPage /></PermissionGate>
        } />
        <Route path="/reports/study/:id" element={
          <PermissionGate require={["reports:view"]}><ReportPage /></PermissionGate>
        } />
        <Route path="/admin" element={
          <RoleGate allow={["admin"]}><AdminPage /></RoleGate>
        } />
        {/* Role-specific dashboard routes */}
        <Route path="/radiologist" element={
          <RoleGate allow={["radiologist", "admin"]}><RadiologistPage /></RoleGate>
        } />
        <Route path="/dr-portal" element={
          <RoleGate allow={["radiologist", "admin"]}><RadiologistPage /></RoleGate>
        } />
        <Route path="/admin-dashboard" element={
          <RoleGate allow={["admin", "developer"]}><AdminDashboardPage /></RoleGate>
        } />
        <Route path="/developer-portal" element={
          <RoleGate allow={["admin", "developer"]}><AdminDashboardPage /></RoleGate>
        } />
        <Route path="/tech" element={
          <RoleGate allow={["radiographer", "admin"]}><TechPage /></RoleGate>
        } />
        <Route path="/referring" element={
          <RoleGate allow={["referring", "admin"]}><ReferringPage /></RoleGate>
        } />
        <Route path="/billing-dashboard" element={
          <RoleGate allow={["billing", "admin"]}><BillingDashboardPage /></RoleGate>
        } />
        <Route path="/receptionist" element={
          <RoleGate allow={["receptionist", "admin"]}><ReceptionistPage /></RoleGate>
        } />
      </Routes>
      </main>
    </div>
  );
}
