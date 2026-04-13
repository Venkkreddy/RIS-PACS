import { useState, useEffect } from "react";
import { useAuthRole } from "../hooks/useAuthRole";
import { api } from "../api/client";
import { motion, AnimatePresence } from "framer-motion";
import { User, Mail, Phone, Building2, Shield, Clock, Save, CheckCircle2, AlertCircle, Pencil, X } from "lucide-react";

const roleLabels: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Administrator",
  developer: "Developer",
  radiologist: "Radiologist",
  radiographer: "Radiographer",
  referring: "Referring Physician",
  billing: "Billing",
  receptionist: "Receptionist",
  viewer: "Viewer",
};

const roleBadgeColors: Record<string, string> = {
  super_admin: "bg-purple-50 text-purple-700 ring-purple-500/20",
  admin: "bg-red-50 text-red-700 ring-red-500/20",
  developer: "bg-amber-50 text-amber-700 ring-amber-500/20",
  radiologist: "bg-blue-50 text-blue-700 ring-blue-500/20",
  radiographer: "bg-teal-50 text-teal-700 ring-teal-500/20",
  referring: "bg-indigo-50 text-indigo-700 ring-indigo-500/20",
  billing: "bg-emerald-50 text-emerald-700 ring-emerald-500/20",
  receptionist: "bg-orange-50 text-orange-700 ring-orange-500/20",
  viewer: "bg-gray-50 text-gray-700 ring-gray-500/20",
};

type SaveStatus = "idle" | "saving" | "success" | "error";

export function ProfilePage() {
  const auth = useAuthRole();

  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [department, setDepartment] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    setDisplayName(auth.displayName ?? "");
    setPhone(auth.phone ?? "");
    setDepartment(auth.department ?? "");
  }, [auth.displayName, auth.phone, auth.department]);

  const userInitials = (() => {
    if (auth.displayName) {
      const parts = auth.displayName.trim().split(/\s+/);
      return parts.length >= 2
        ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
        : parts[0][0].toUpperCase();
    }
    return (auth.email ?? "U")[0].toUpperCase();
  })();

  function startEditing() {
    setDisplayName(auth.displayName ?? "");
    setPhone(auth.phone ?? "");
    setDepartment(auth.department ?? "");
    setEditing(true);
    setSaveStatus("idle");
    setErrorMessage("");
  }

  function cancelEditing() {
    setEditing(false);
    setSaveStatus("idle");
    setErrorMessage("");
  }

  async function handleSave() {
    setSaveStatus("saving");
    setErrorMessage("");

    try {
      await api.patch("/auth/profile", {
        displayName: displayName.trim() || undefined,
        phone: phone.trim() || undefined,
        department: department.trim() || undefined,
      });

      setSaveStatus("success");
      await auth.refreshProfile();

      setTimeout(() => {
        setEditing(false);
        setSaveStatus("idle");
      }, 1200);
    } catch (err: unknown) {
      setSaveStatus("error");
      const msg =
        err && typeof err === "object" && "response" in err
          ? ((err as { response?: { data?: { error?: string } } }).response?.data?.error ?? "Failed to update profile")
          : "Failed to update profile";
      setErrorMessage(msg);
    }
  }

  const memberSince = auth.createdAt
    ? new Date(auth.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-tdai-navy-900">My Profile</h1>
          <p className="mt-1 text-sm text-tdai-gray-500">
            View and manage your account information
          </p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-tdai-gray-200/80 bg-white shadow-sm">
          {/* Header with avatar */}
          <div className="relative bg-gradient-to-br from-tdai-navy-800 via-tdai-navy-700 to-tdai-teal-800 px-6 pb-16 pt-8">
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIyMCIgY3k9IjIwIiByPSIxIiBmaWxsPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMDUpIi8+PC9zdmc+')] opacity-60" />
          </div>

          {/* Avatar overlap */}
          <div className="relative -mt-12 px-6">
            <div className="flex items-end gap-5">
              <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-gradient-to-br from-tdai-navy-700 to-tdai-navy-800 text-2xl font-bold text-white shadow-lg ring-4 ring-white">
                {userInitials}
              </div>
              <div className="mb-1.5 flex-1">
                <h2 className="text-lg font-semibold text-tdai-navy-900">
                  {auth.displayName || auth.email}
                </h2>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${roleBadgeColors[auth.role] ?? roleBadgeColors.viewer}`}>
                    <Shield className="mr-1 h-3 w-3" />
                    {roleLabels[auth.role] ?? auth.role}
                  </span>
                  {auth.approved && (
                    <span className="inline-flex items-center rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-500/20">
                      <CheckCircle2 className="mr-1 h-3 w-3" />
                      Approved
                    </span>
                  )}
                </div>
              </div>
              {!editing && (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={startEditing}
                  className="mb-2 flex items-center gap-1.5 rounded-xl bg-tdai-teal-50 px-4 py-2 text-sm font-medium text-tdai-teal-700 transition-colors hover:bg-tdai-teal-100"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </motion.button>
              )}
            </div>
          </div>

          {/* Profile details */}
          <div className="px-6 pb-6 pt-6">
            <AnimatePresence mode="wait">
              {editing ? (
                <motion.div
                  key="edit"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-5"
                >
                  <div>
                    <label className="mb-1.5 flex items-center gap-2 text-sm font-medium text-tdai-navy-700">
                      <User className="h-4 w-4 text-tdai-gray-400" />
                      Display Name
                    </label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Enter your full name"
                      className="w-full rounded-xl border border-tdai-gray-200 bg-white px-4 py-2.5 text-sm text-tdai-navy-800 shadow-sm transition-all placeholder:text-tdai-gray-400 focus:border-tdai-teal-400 focus:outline-none focus:ring-2 focus:ring-tdai-teal-400/20"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 flex items-center gap-2 text-sm font-medium text-tdai-navy-700">
                      <Phone className="h-4 w-4 text-tdai-gray-400" />
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="Enter your phone number"
                      className="w-full rounded-xl border border-tdai-gray-200 bg-white px-4 py-2.5 text-sm text-tdai-navy-800 shadow-sm transition-all placeholder:text-tdai-gray-400 focus:border-tdai-teal-400 focus:outline-none focus:ring-2 focus:ring-tdai-teal-400/20"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 flex items-center gap-2 text-sm font-medium text-tdai-navy-700">
                      <Building2 className="h-4 w-4 text-tdai-gray-400" />
                      Department
                    </label>
                    <input
                      type="text"
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      placeholder="e.g. Radiology, Cardiology"
                      className="w-full rounded-xl border border-tdai-gray-200 bg-white px-4 py-2.5 text-sm text-tdai-navy-800 shadow-sm transition-all placeholder:text-tdai-gray-400 focus:border-tdai-teal-400 focus:outline-none focus:ring-2 focus:ring-tdai-teal-400/20"
                    />
                  </div>

                  <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-tdai-navy-700">
                    <Mail className="h-4 w-4 text-tdai-gray-400" />
                    Email
                  </div>
                  <p className="-mt-4 text-sm text-tdai-gray-500">{auth.email}</p>
                  <p className="-mt-3 text-xs text-tdai-gray-400">Email cannot be changed</p>

                  {saveStatus === "error" && (
                    <div className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700">
                      <AlertCircle className="h-4 w-4 flex-shrink-0" />
                      {errorMessage}
                    </div>
                  )}

                  <div className="flex items-center gap-3 pt-2">
                    <motion.button
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.98 }}
                      type="button"
                      onClick={handleSave}
                      disabled={saveStatus === "saving" || saveStatus === "success"}
                      className="flex items-center gap-2 rounded-xl bg-tdai-teal-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-tdai-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {saveStatus === "saving" ? (
                        <>
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                          Saving...
                        </>
                      ) : saveStatus === "success" ? (
                        <>
                          <CheckCircle2 className="h-4 w-4" />
                          Saved!
                        </>
                      ) : (
                        <>
                          <Save className="h-4 w-4" />
                          Save Changes
                        </>
                      )}
                    </motion.button>
                    <button
                      type="button"
                      onClick={cancelEditing}
                      disabled={saveStatus === "saving"}
                      className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-medium text-tdai-gray-500 transition-colors hover:bg-tdai-gray-50 hover:text-tdai-navy-700 disabled:opacity-60"
                    >
                      <X className="h-4 w-4" />
                      Cancel
                    </button>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="view"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="divide-y divide-tdai-gray-100">
                    <ProfileField
                      icon={<User className="h-4 w-4" />}
                      label="Display Name"
                      value={auth.displayName}
                      placeholder="Not set"
                    />
                    <ProfileField
                      icon={<Mail className="h-4 w-4" />}
                      label="Email"
                      value={auth.email}
                    />
                    <ProfileField
                      icon={<Phone className="h-4 w-4" />}
                      label="Phone"
                      value={auth.phone}
                      placeholder="Not set"
                    />
                    <ProfileField
                      icon={<Building2 className="h-4 w-4" />}
                      label="Department"
                      value={auth.department}
                      placeholder="Not set"
                    />
                    <ProfileField
                      icon={<Shield className="h-4 w-4" />}
                      label="Role"
                      value={roleLabels[auth.role] ?? auth.role}
                    />
                    {memberSince && (
                      <ProfileField
                        icon={<Clock className="h-4 w-4" />}
                        label="Member Since"
                        value={memberSince}
                      />
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function ProfileField({
  icon,
  label,
  value,
  placeholder = "—",
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  placeholder?: string;
}) {
  return (
    <div className="flex items-center gap-4 py-3.5">
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-tdai-gray-50 text-tdai-gray-400">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-wider text-tdai-gray-400">{label}</p>
        <p className={`mt-0.5 text-sm ${value ? "font-medium text-tdai-navy-800" : "text-tdai-gray-400 italic"}`}>
          {value || placeholder}
        </p>
      </div>
    </div>
  );
}
