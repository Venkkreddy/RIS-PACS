import { Link, useLocation } from "react-router-dom";
import { signOut } from "firebase/auth";
import { api } from "../api/client";
import { firebaseAuth } from "../lib/firebase";
import { BrandLogo } from "./BrandLogo";
import { useAuthRole, landingPathForRole } from "../hooks/useAuthRole";
import { useState } from "react";
import type { Permission } from "@medical-report-system/shared";

interface NavItem {
  to: string;
  label: string;
  icon: string;
  permissions?: Permission[];
  adminOnly?: boolean;
}

const roleDashboardLabel: Record<string, string> = {
  radiologist: "Patient List",
  radiographer: "Tech Dashboard",
  admin: "Admin Dashboard",
  super_admin: "Super Admin Portal",
  developer: "Developer Portal",
  referring: "Referral Portal",
  billing: "Billing Dashboard",
  receptionist: "Reception Desk",
};

const navItems: NavItem[] = [
  { to: "/patients", label: "Patients", icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z", permissions: ["patients:view"] },
  { to: "/orders", label: "Orders", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01", permissions: ["orders:view"] },
  { to: "/scans", label: "Scans", icon: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z", permissions: ["scans:view"] },
  { to: "/schedule", label: "Schedule", icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z", permissions: ["scheduling:view"] },
  { to: "/worklist", label: "Worklist", icon: "M4 6h16M4 10h16M4 14h16M4 18h16", permissions: ["worklist:view"] },
  { to: "/templates", label: "Templates", icon: "M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z", permissions: ["templates:view"] },
  { to: "/reports", label: "Reports", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z", permissions: ["reports:view"] },
  { to: "/billing", label: "Billing", icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z", permissions: ["billing:view"] },
  { to: "/referring-physicians", label: "Physicians", icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z", permissions: ["referring_physicians:view"] },
  { to: "/my-uploads", label: "Uploads", icon: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12", permissions: ["dicom:upload"] },
  { to: "/my-studies", label: "Studies", icon: "M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z", permissions: ["reports:create"] },
  { to: "/admin", label: "Admin", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z", adminOnly: true },
];

const roleLabels: Record<string, string> = {
  admin: "Administrator",
  super_admin: "Super Admin",
  developer: "Developer",
  radiologist: "Radiologist",
  radiographer: "Radiographer",
  referring: "Referring",
  billing: "Billing",
  receptionist: "Receptionist",
  viewer: "Viewer",
};

export function InternalNavbar() {
  const location = useLocation();
  const auth = useAuthRole();
  const [mobileOpen, setMobileOpen] = useState(false);

  const dashboardPath = landingPathForRole(auth.role);
  const dashboardLabel = roleDashboardLabel[auth.role] ?? "Dashboard";

  const visibleItems = navItems.filter((item) => {
    if (item.adminOnly) return auth.role === "admin" || auth.role === "super_admin";
    if (!item.permissions) return true;
    if (auth.role === "admin" || auth.role === "super_admin") return true;
    return item.permissions.some((p) => auth.hasPermission(p));
  });

  async function logout() {
    if (firebaseAuth) {
      await signOut(firebaseAuth).catch(() => undefined);
    }
    await api.post("/auth/logout").catch(() => undefined);
    window.location.href = "/login";
  }

  const userInitial = (() => {
    if (auth.displayName) {
      const parts = auth.displayName.trim().split(/\s+/);
      return parts.length >= 2
        ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
        : parts[0][0].toUpperCase();
    }
    return (auth.email ?? "U")[0].toUpperCase();
  })();

  return (
    <header className="sticky top-0 z-40 border-b border-tdai-gray-200/80 bg-white/95 backdrop-blur-xl shadow-nav">
      <div className="mx-auto flex w-full max-w-[1720px] items-center justify-between gap-3 px-4 py-2.5 xl:px-6">
        <Link to={dashboardPath} className="group flex flex-shrink-0 items-center gap-3.5 transition-opacity duration-200 hover:opacity-90 lg:ml-1">
          <BrandLogo compact showPoweredBy={false} />
          <div className="hidden h-6 w-px bg-tdai-gray-200 lg:block" />
          <span className="hidden max-w-[11rem] truncate rounded-lg bg-tdai-teal-50 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-tdai-teal-700 ring-1 ring-tdai-teal-500/10 lg:inline">
            {roleLabels[auth.role] ?? auth.role}
          </span>
        </Link>

        <nav className="hidden min-w-0 flex-1 items-center gap-3 lg:flex">
          <div className="min-w-0 flex-1">
            <div className="overflow-x-auto pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5">
              <div className="flex min-w-max items-center justify-end gap-2 lg:gap-2.5">
              {/* Role-specific dashboard link */}
              {dashboardPath !== "/worklist" && (
                <Link
                  to={dashboardPath}
                  title={dashboardLabel}
                  className={`group relative flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-[11px] font-medium transition-all duration-200 ${
                    location.pathname === dashboardPath
                      ? "bg-tdai-teal-50 text-tdai-teal-700 shadow-sm ring-1 ring-tdai-teal-500/10"
                      : "text-tdai-gray-500 hover:bg-tdai-gray-50 hover:text-tdai-navy-700"
                  }`}
                >
                  <svg className="h-4 w-4 flex-shrink-0 transition-transform duration-200 group-hover:scale-110" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                  </svg>
                  <span className="hidden lg:inline">{dashboardLabel}</span>
                </Link>
              )}
              {visibleItems.map((item) => {
                const isActive = location.pathname === item.to || (item.to !== "/" && location.pathname.startsWith(item.to));
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    title={item.label}
                    className={`group relative flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-[11px] font-medium transition-all duration-200 ${
                      isActive
                        ? "bg-tdai-teal-50 text-tdai-teal-700 shadow-sm ring-1 ring-tdai-teal-500/10"
                        : "text-tdai-gray-500 hover:bg-tdai-gray-50 hover:text-tdai-navy-700"
                    }`}
                  >
                    <svg className="h-4 w-4 flex-shrink-0 transition-transform duration-200 group-hover:scale-110" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                    </svg>
                    <span className="hidden lg:inline">{item.label}</span>
                  </Link>
                );
              })}
              </div>
            </div>
          </div>

          <div className="mx-1.5 h-8 w-px flex-shrink-0 bg-tdai-gray-200" />

          <div className="relative z-10 flex flex-shrink-0 items-center gap-2.5">
            <Link
              to="/profile"
              className="group flex items-center gap-2 rounded-xl px-1.5 py-1 transition-colors hover:bg-tdai-gray-50"
              title="My Profile"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-tdai-navy-700 to-tdai-navy-800 text-[11px] font-bold text-white shadow-sm transition-transform group-hover:scale-105">
                {userInitial}
              </div>
              <span className="hidden whitespace-nowrap text-[11px] font-medium text-tdai-navy-700 lg:inline xl:hidden">
                Profile
              </span>
              <div className="hidden flex-col xl:flex">
                <span className="max-w-[10rem] truncate text-[11px] font-semibold leading-tight text-tdai-navy-800">
                  {auth.displayName || auth.email?.split("@")[0] || "User"}
                </span>
                <span className="max-w-[10rem] truncate text-[10px] leading-tight text-tdai-gray-400">
                  {auth.email}
                </span>
              </div>
            </Link>
            <button
              className="flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-[11px] font-medium text-tdai-gray-500 transition-all duration-200 hover:bg-tdai-red-50 hover:text-tdai-red-600"
              type="button"
              onClick={() => void logout()}
              aria-label="Sign out"
              title="Sign out"
            >
              <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span className="hidden lg:inline">Sign out</span>
            </button>
          </div>
        </nav>

        <div className="flex items-center gap-1.5 lg:hidden">
          <button
            className="rounded-xl p-2.5 text-tdai-gray-500 transition-colors hover:bg-tdai-red-50 hover:text-tdai-red-600"
            type="button"
            onClick={() => void logout()}
            aria-label="Sign out"
            title="Sign out"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
          <button
            className="rounded-xl p-2.5 text-tdai-navy-500 transition-colors hover:bg-tdai-gray-50"
            type="button"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle navigation"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {mobileOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="animate-slide-down border-t border-tdai-gray-100 bg-white px-4 pb-5 pt-3 lg:hidden">
          <div className="space-y-1">
            {dashboardPath !== "/worklist" && (
              <Link
                to={dashboardPath}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-medium transition-colors ${
                  location.pathname === dashboardPath
                    ? "bg-tdai-teal-50 text-tdai-teal-700"
                    : "text-tdai-navy-600 hover:bg-tdai-gray-50 hover:text-tdai-navy-800"
                }`}
              >
                <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                {dashboardLabel}
              </Link>
            )}
            {visibleItems.map((item) => {
              const isActive = location.pathname === item.to || (item.to !== "/" && location.pathname.startsWith(item.to));
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-tdai-teal-50 text-tdai-teal-700"
                      : "text-tdai-navy-600 hover:bg-tdai-gray-50 hover:text-tdai-navy-800"
                  }`}
                >
                  <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                  </svg>
                  {item.label}
                </Link>
              );
            })}
          </div>
          <div className="mt-4 border-t border-tdai-gray-100 pt-4 space-y-1">
            <Link
              to="/profile"
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-medium text-tdai-navy-600 transition-colors hover:bg-tdai-gray-50 hover:text-tdai-navy-800"
            >
              <div className="flex h-[18px] w-[18px] items-center justify-center rounded-md bg-gradient-to-br from-tdai-navy-700 to-tdai-navy-800 text-[8px] font-bold text-white">
                {userInitial}
              </div>
              My Profile
            </Link>
            <button
              className="flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-medium text-tdai-gray-500 transition-colors hover:bg-tdai-red-50 hover:text-tdai-red-600"
              type="button"
              onClick={() => void logout()}
            >
              <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Sign out
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
