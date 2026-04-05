import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { WorklistUser } from "../types/worklist";
import { Dashboard } from "./Dashboard";
import { InviteForm } from "./InviteForm";
import { PermissionsManager } from "./PermissionsManager";
import type { UserRole } from "@medical-report-system/shared";

type Tab = "users" | "analytics" | "permissions";

export function AdminSection() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>("users");
  const [requestRoles, setRequestRoles] = useState<Record<string, UserRole>>({});
  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const response = await api.get<WorklistUser[]>("/users");
      return response.data;
    },
  });
  const requestsQuery = useQuery({
    queryKey: ["pending-user-requests"],
    queryFn: async () => {
      const response = await api.get<WorklistUser[]>("/admin/user-requests");
      return response.data;
    },
  });

  async function approveRequest(userId: string) {
    await api.post(`/admin/user-requests/${userId}/approve`, {
      role: requestRoles[userId] ?? "radiographer",
    });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["users"] }),
      queryClient.invalidateQueries({ queryKey: ["pending-user-requests"] }),
    ]);
  }

  async function rejectRequest(userId: string) {
    await api.post(`/admin/user-requests/${userId}/reject`);
    await queryClient.invalidateQueries({ queryKey: ["pending-user-requests"] });
  }

  return (
    <div className="space-y-4">
      <div className="page-intro">
        <h2 className="text-xl font-semibold text-tdai-primary dark:text-white">Admin Section</h2>
        <p className="page-subheader mt-1">Manage users, approvals, analytics, and permissions.</p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className={`rounded-xl px-3 py-2 text-sm ${activeTab === "users" ? "bg-tdai-primary text-white shadow-sm" : "bg-slate-200 text-tdai-secondary"}`}
          onClick={() => setActiveTab("users")}
        >
          Users
        </button>
        <button
          type="button"
          className={`rounded-xl px-3 py-2 text-sm ${activeTab === "analytics" ? "bg-tdai-primary text-white shadow-sm" : "bg-slate-200 text-tdai-secondary dark:bg-white/[0.06] dark:text-tdai-gray-400"}`}
          onClick={() => setActiveTab("analytics")}
        >
          Analytics
        </button>
        <button
          type="button"
          className={`rounded-xl px-3 py-2 text-sm ${activeTab === "permissions" ? "bg-tdai-primary text-white shadow-sm" : "bg-slate-200 text-tdai-secondary dark:bg-white/[0.06] dark:text-tdai-gray-400"}`}
          onClick={() => setActiveTab("permissions")}
        >
          Permissions
        </button>
      </div>

      {activeTab === "permissions" ? (
        <PermissionsManager />
      ) : activeTab === "users" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card p-4">
            <h3 className="mb-3 font-semibold dark:text-tdai-gray-100">User List</h3>
            {usersQuery.isLoading ? <p className="dark:text-tdai-gray-300">Loading users...</p> : null}
            {usersQuery.error ? <p className="text-red-600 dark:text-red-400">Failed to load users.</p> : null}
            <ul className="space-y-2 text-sm">
              {usersQuery.data?.map((user) => (
                <li key={user.id} className="rounded-xl border border-blue-100 p-2.5 dark:border-white/[0.08]">
                  <div className="font-medium dark:text-tdai-gray-100">{user.displayName ?? user.email}</div>
                  <div className="text-slate-600 dark:text-tdai-gray-400">
                    {user.role}
                    {"approved" in user ? ` • ${(user as WorklistUser & { approved?: boolean }).approved ? "approved" : "pending"}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <InviteForm />
          <div className="card p-4 lg:col-span-2">
            <h3 className="mb-3 font-semibold dark:text-tdai-gray-100">Pending User Requests</h3>
            {requestsQuery.isLoading ? <p className="dark:text-tdai-gray-300">Loading requests...</p> : null}
            {requestsQuery.data?.length === 0 ? <p className="text-sm text-slate-500 dark:text-tdai-gray-400">No pending requests.</p> : null}
            <ul className="space-y-2">
              {requestsQuery.data?.map((request) => (
                <li key={request.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-100 p-3 text-sm dark:border-white/[0.08]">
                  <div>
                    <div className="font-medium dark:text-tdai-gray-100">{request.displayName ?? request.email}</div>
                    <div className="text-slate-500 dark:text-tdai-gray-400">{request.email}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      className="select-field !px-2 !py-1"
                      value={requestRoles[request.id] ?? "radiographer"}
                      onChange={(event) =>
                        setRequestRoles((prev) => ({
                          ...prev,
                          [request.id]: event.target.value as UserRole,
                        }))
                      }
                    >
                      <option value="radiographer">Radiographer</option>
                      <option value="radiologist">Radiologist</option>
                      <option value="receptionist">Receptionist</option>
                      <option value="billing">Billing</option>
                      <option value="referring">Referring</option>
                      <option value="viewer">Viewer</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button className="btn-primary !px-3 !py-1" type="button" onClick={() => void approveRequest(request.id)}>
                      Approve
                    </button>
                    <button className="btn-secondary !px-3 !py-1 text-rose-700 dark:text-rose-400" type="button" onClick={() => void rejectRequest(request.id)}>
                      Reject
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <Dashboard />
      )}
    </div>
  );
}
