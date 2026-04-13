import { Link } from "react-router-dom";
import { useAuthRole } from "../hooks/useAuthRole";
import { motion } from "framer-motion";
import { Bell, User } from "lucide-react";

const roleLabels: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Administrator",
  developer: "Developer",
  radiologist: "Radiologist",
  radiographer: "Radiographer",
  referring: "Referring",
  billing: "Billing",
  receptionist: "Receptionist",
  viewer: "Viewer",
};

export function UserAccountBar() {
  const auth = useAuthRole();

  if (!auth.isAuthenticated) return null;

  const displayLabel = auth.displayName || auth.email?.split("@")[0] || "User";

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="relative z-50 border-b border-tdai-navy-700/50 bg-gradient-to-r from-tdai-navy-900 via-tdai-navy-800 to-tdai-navy-900"
    >
      <div className="mx-auto flex max-w-[1440px] items-center justify-between px-5 py-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-tdai-gray-400">
            Welcome back,{" "}
            <span className="text-white">{displayLabel}</span>
          </span>
          <span className="hidden text-[10px] text-tdai-gray-500 sm:inline">
            &middot; {roleLabels[auth.role] ?? auth.role}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            type="button"
            className="relative flex h-7 w-7 items-center justify-center rounded-lg text-tdai-gray-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <Bell className="h-3.5 w-3.5" />
          </motion.button>
          <Link
            to="/profile"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-tdai-gray-400 transition-colors hover:bg-white/10 hover:text-white"
            title="My Profile"
          >
            <User className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </motion.div>
  );
}
