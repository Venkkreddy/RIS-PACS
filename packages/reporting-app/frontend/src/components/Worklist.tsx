import { useCallback, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { api } from "../api/client";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { WorklistStudy, WorklistUser } from "../types/worklist";

async function fetchRadiologists(): Promise<WorklistUser[]> {
  const response = await api.get<WorklistUser[]>("/users").catch(() => ({ data: [] as WorklistUser[] }));
  return response.data.filter((user) => user.role === "radiologist");
}

const EMPTY_DATA: WorklistStudy[] = [];

function hasViewerLaunchParams(viewerUrl: string): boolean {
  try {
    const parsed = new URL(viewerUrl);
    if (/\/dicom-microscopy-viewer(?:\/|$)/i.test(parsed.pathname)) {
      return false;
    }
    const studyUids = parsed.searchParams.get("StudyInstanceUIDs");
    const studyUidsLower = parsed.searchParams.get("studyInstanceUIDs");
    return (
      (typeof studyUids === "string" && studyUids.trim().length > 0) ||
      (typeof studyUidsLower === "string" && studyUidsLower.trim().length > 0)
    );
  } catch {
    return false;
  }
}

function pickLaunchableViewerUrl(...candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    if (candidate && hasViewerLaunchParams(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function Worklist({
  scopedUploaderId,
  scopedRadiologistId,
  hideAssignment,
  listQueryEnabled = true,
}: {
  scopedUploaderId?: string;
  scopedRadiologistId?: string;
  hideAssignment?: boolean;
  /** When false, worklist is not fetched (e.g. radiographer auth still loading). */
  listQueryEnabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const [searchName, setSearchName] = useState("");
  const [searchDate, setSearchDate] = useState("");
  const [searchLocation, setSearchLocation] = useState("");
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({});
  const [radiologistId, setRadiologistId] = useState("");
  const [isAssigning, setIsAssigning] = useState(false);
  const [ohifWarning, setOhifWarning] = useState<string | null>(null);
  const [weasisWarning, setWeasisWarning] = useState<string | null>(null);
  const [validatingStudyId, setValidatingStudyId] = useState<string | null>(null);

  const handleOhifClick = useCallback(async (
    e: React.MouseEvent<HTMLAnchorElement>,
    studyId: string,
    fallbackViewerUrl: string,
  ) => {
    e.preventDefault();
    setOhifWarning(null);
    setValidatingStudyId(studyId);
    try {
      const validationResponse = await api.get<{
        allowed: boolean;
        viewerUrl: string | null;
        message?: string;
      }>(`/worklist/${encodeURIComponent(studyId)}/viewer-access`);
      if (!validationResponse.data.allowed || !validationResponse.data.viewerUrl) {
        const message = validationResponse.data.message || "Study exists but images not yet available";
        setOhifWarning(message);
        setTimeout(() => setOhifWarning(null), 6000);
        return;
      }

      const rawViewerUrl = pickLaunchableViewerUrl(
        validationResponse.data.viewerUrl,
        fallbackViewerUrl,
      );
      if (!rawViewerUrl) {
        setOhifWarning("OHIF launch URL is invalid (missing study parameters). Please refresh and try again.");
        setTimeout(() => setOhifWarning(null), 6000);
        return;
      }
      const parsed = new URL(rawViewerUrl);
      parsed.protocol = window.location.protocol;
      parsed.hostname = window.location.hostname;
      const viewerUrl = parsed.toString();
      window.open(viewerUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      let apiMessage: string | undefined;
      if (error && typeof error === "object" && "response" in error) {
        const maybeMessage = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
        if (typeof maybeMessage === "string" && maybeMessage.trim()) {
          apiMessage = maybeMessage;
        }
      }
      setOhifWarning(apiMessage || "OHIF Viewer is not reachable. Start it with: docker compose up ohif -d");
      setTimeout(() => setOhifWarning(null), 6000);
    } finally {
      setValidatingStudyId(null);
    }
  }, []);

  const handleWeasisClick = useCallback(() => {
    setWeasisWarning(null);
    const timeout = setTimeout(() => {
      setWeasisWarning(
        "Weasis may not be installed. Download it from weasis.org and ensure the weasis:// protocol is registered.",
      );
      setTimeout(() => setWeasisWarning(null), 8000);
    }, 2000);
    window.addEventListener(
      "blur",
      () => clearTimeout(timeout),
      { once: true },
    );
  }, []);

  const debouncedName = useDebouncedValue(searchName, 400);
  const debouncedLocation = useDebouncedValue(searchLocation, 400);

  const filters = useMemo(
    () => ({ name: debouncedName, date: searchDate, location: debouncedLocation }),
    [debouncedName, searchDate, debouncedLocation],
  );

  const worklistQuery = useQuery({
    queryKey: ["worklist", filters, scopedUploaderId, scopedRadiologistId],
    queryFn: async () => {
      const response = await api.get<WorklistStudy[]>("/worklist", {
        params: {
          ...filters,
          ...(scopedUploaderId ? { uploaderId: scopedUploaderId } : {}),
          ...(scopedRadiologistId ? { assignedTo: scopedRadiologistId } : {}),
        },
        timeout: 30000,
      });
      return response.data;
    },
    enabled: listQueryEnabled,
    refetchInterval: 30_000,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
  });

  const radiologistsQuery = useQuery({
    queryKey: ["radiologists"],
    queryFn: fetchRadiologists,
    staleTime: 60_000,
    enabled: !hideAssignment,
  });

  const data = worklistQuery.data ?? EMPTY_DATA;

  const selectedRowsRef = useRef(selectedRows);
  selectedRowsRef.current = selectedRows;

  const columns = useMemo<ColumnDef<WorklistStudy>[]>(
    () => [
      ...(!hideAssignment ? [{
        id: "select",
        header: ({ table: t }: { table: any }) => {
          const allRows = t.getRowModel().rows;
          const allChecked = allRows.length > 0 && allRows.every((r: any) => selectedRowsRef.current[r.original.studyId]);
          return (
            <input
              type="checkbox"
              className="accent-tdai-teal-500 h-4 w-4 rounded dark:accent-tdai-teal-400"
              checked={allChecked}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                const next: Record<string, boolean> = {};
                if (event.target.checked) {
                  allRows.forEach((r: any) => { next[r.original.studyId] = true; });
                }
                setSelectedRows(next);
              }}
            />
          );
        },
        cell: ({ row }: { row: any }) => (
          <input
            type="checkbox"
            className="accent-tdai-teal-500 h-4 w-4 rounded dark:accent-tdai-teal-400"
            checked={!!selectedRowsRef.current[row.original.studyId]}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setSelectedRows((prev) => ({
                ...prev,
                [row.original.studyId]: event.target.checked,
              }))
            }
          />
        ),
      } as ColumnDef<WorklistStudy>] : []),
      { accessorKey: "patientName", header: "Patient Name" },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            <Link
              to={row.original.reportUrl}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-all duration-150 hover:shadow-sm dark:hover:shadow-[0_2px_12px_rgba(0,0,0,0.55)]"
              style={{ background: "#00B4A6", color: "#fff" }}
              title="Write Report"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Write Report
            </Link>
          </div>
        ),
      },
      { accessorKey: "studyDate", header: "Study Date" },
      { accessorKey: "location", header: "Uploading Location" },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
          const status = row.original.status;
          const classes =
            status === "reported"
              ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-700/50"
              : status === "assigned"
                ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-700/50"
                : "bg-tdai-surface-alt text-tdai-secondary ring-1 ring-tdai-border dark:bg-white/[0.05] dark:text-tdai-gray-400 dark:ring-white/[0.08]";
          return <span className={`badge ${classes}`}>{status}</span>;
        },
      },
      {
        accessorKey: "tatHours",
        header: "TAT (h)",
        cell: ({ row }) => {
          const tat = row.original.tatHours;
          if (tat === undefined) return <span className="text-tdai-muted dark:text-tdai-gray-500">-</span>;
          const isHigh = tat > 24;
          return (
            <span className={`badge ${isHigh ? "bg-tdai-red-50 text-tdai-red-700 ring-1 ring-tdai-red-200 dark:bg-tdai-red-900/30 dark:text-tdai-red-300 dark:ring-tdai-red-800/50" : "bg-tdai-surface-alt text-tdai-secondary dark:bg-white/[0.05] dark:text-tdai-gray-400"}`}>
              {tat.toFixed(2)}h
            </span>
          );
        },
      },
      {
        id: "viewer",
        header: "Viewer",
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            {row.original.viewerUrl ? (
              <a
                className="btn-primary !px-2.5 !py-1 text-[11px] !rounded-md"
                href={row.original.viewerUrl}
                target="_blank"
                rel="noreferrer"
                title="Open in OHIF"
                onClick={(e) => void handleOhifClick(e, row.original.studyId, row.original.viewerUrl!)}
                aria-busy={validatingStudyId === row.original.studyId}
              >
                {validatingStudyId === row.original.studyId ? "Checking..." : "OHIF"}
              </a>
            ) : (
              <span className="inline-flex items-center px-2.5 py-1 text-[11px] rounded-md bg-tdai-gray-100 text-tdai-gray-400 cursor-not-allowed dark:bg-tdai-gray-800 dark:text-tdai-gray-500" title="No DICOM images available">
                OHIF
              </span>
            )}
            {row.original.weasisUrl ? (
              <a
                className="btn-secondary !px-2.5 !py-1 text-[11px] !rounded-md"
                href={row.original.weasisUrl}
                title="Open in Weasis (desktop)"
                onClick={handleWeasisClick}
              >
                Weasis
              </a>
            ) : (
              <span className="inline-flex items-center px-2.5 py-1 text-[11px] rounded-md bg-tdai-gray-100 text-tdai-gray-400 cursor-not-allowed" title="No DICOM images available">
                Weasis
              </span>
            )}
          </div>
        ),
      },
      {
        id: "report",
        header: "Report",
        cell: ({ row }) => (
          <Link className="btn-ghost !px-2.5 !py-1 text-[11px] !text-tdai-accent hover:!text-tdai-accent-hover !rounded-md ring-1 ring-tdai-border dark:!text-tdai-teal-400 dark:hover:!text-tdai-teal-300 dark:ring-white/[0.08]" to={row.original.reportUrl}>
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            Report
          </Link>
        ),
      },
    ],
    [hideAssignment, handleOhifClick, handleWeasisClick, validatingStudyId],
  );

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const selectedStudyIds = Object.entries(selectedRows)
    .filter((entry) => entry[1])
    .map((entry) => entry[0]);

  async function assignSelected() {
    if (!selectedStudyIds.length || !radiologistId) return;
    setIsAssigning(true);
    try {
      await api.post("/assign", {
        studyIds: selectedStudyIds,
        radiologistId,
      });
      setSelectedRows({});
      await queryClient.invalidateQueries({ queryKey: ["worklist"] });
    } finally {
      setIsAssigning(false);
    }
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {ohifWarning && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-300 animate-fade-in">
          <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          <span>{ohifWarning}</span>
          <button className="ml-auto shrink-0 text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-200" onClick={() => setOhifWarning(null)}>&times;</button>
        </div>
      )}
      {weasisWarning && (
        <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-700/50 dark:bg-blue-950/40 dark:text-blue-300 animate-fade-in">
          <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <span>{weasisWarning}</span>
          <button className="ml-auto shrink-0 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200" onClick={() => setWeasisWarning(null)}>&times;</button>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="page-header">Study Worklist</h2>
          <p className="page-subheader mt-1">{data.length} {data.length === 1 ? "study" : "studies"} found</p>
        </div>
        {worklistQuery.isFetching && !worklistQuery.isLoading && (
          <div className="flex items-center gap-2 text-xs text-tdai-muted dark:text-tdai-gray-400">
            <div className="h-3 w-3 animate-spin rounded-full border border-tdai-border border-t-tdai-accent dark:border-white/[0.08] dark:border-t-tdai-teal-400" />
            Refreshing...
          </div>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
            <svg className="h-4 w-4 text-tdai-muted dark:text-tdai-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          </div>
          <input
            className="input-field !pl-10"
            placeholder="Search patient name..."
            value={searchName}
            onChange={(event) => setSearchName(event.target.value)}
          />
        </div>
        <input className="input-field" type="date" value={searchDate} onChange={(event) => setSearchDate(event.target.value)} />
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
            <svg className="h-4 w-4 text-tdai-muted dark:text-tdai-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          </div>
          <input
            className="input-field !pl-10"
            placeholder="Search location..."
            value={searchLocation}
            onChange={(event) => setSearchLocation(event.target.value)}
          />
        </div>
      </div>

      {!hideAssignment && (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-tdai-border-light bg-tdai-surface-alt/60 p-3 dark:border-white/[0.08] dark:bg-white/[0.03]">
          <div className="w-full min-w-[220px] flex-1">
            <label htmlFor="assign-radiologist" className="mb-1.5 block text-xs font-semibold tracking-wide text-tdai-muted uppercase dark:text-tdai-gray-400">
              Assign radiologist
            </label>
            <select
              id="assign-radiologist"
              className="select-field w-full"
              value={radiologistId}
              onChange={(event) => setRadiologistId(event.target.value)}
            >
              <option value="">Assign to radiologist...</option>
              {radiologistsQuery.data?.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName ?? user.email}
                </option>
              ))}
            </select>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:flex-nowrap">
            <span className="inline-flex h-10 items-center rounded-lg border border-tdai-border bg-white/80 px-3 text-xs font-semibold text-tdai-secondary dark:border-white/[0.1] dark:bg-white/[0.05] dark:text-tdai-gray-300">
              Selected: {selectedStudyIds.length}
            </span>
            <button
              className="btn-secondary !h-10 !px-3.5 text-xs whitespace-nowrap sm:text-sm"
              type="button"
              disabled={isAssigning}
              onClick={() => setSelectedRows({})}
            >
              Clear selection
            </button>
            <button
              className="btn-primary !h-10 w-full !bg-teal-800 !px-3.5 text-xs whitespace-nowrap hover:!bg-teal-700 focus-visible:!ring-teal-500 disabled:!bg-teal-900/80 disabled:!opacity-75 disabled:!text-white/90 dark:!bg-teal-700 dark:hover:!bg-teal-600 sm:w-auto sm:text-sm"
              type="button"
              disabled={!selectedStudyIds.length || !radiologistId || isAssigning}
              onClick={() => void assignSelected()}
            >
              {isAssigning ? (
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-30" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" />
                </svg>
              ) : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
              )}
              {isAssigning ? "Assigning..." : `Assign selected (${selectedStudyIds.length})`}
            </button>
          </div>
        </div>
      )}

      {worklistQuery.isLoading ? (
        <div className="card overflow-hidden">
          <div className="space-y-0">
            <div className="table-header px-4 py-3">
              <div className="skeleton h-4 w-full max-w-md" />
            </div>
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-4 border-b border-tdai-border-light px-4 py-4 dark:border-white/[0.08]">
                <div className="skeleton h-4 w-32" />
                <div className="skeleton h-4 w-24" />
                <div className="skeleton h-4 w-28" />
                <div className="skeleton h-4 w-16" />
                <div className="skeleton h-4 w-16" />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {worklistQuery.error ? (
        <div className="card px-6 py-10 text-center">
          <svg className="mx-auto h-10 w-10 text-tdai-danger dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <p className="mt-3 text-sm font-medium text-tdai-danger dark:text-red-400">Failed to load worklist</p>
          <p className="mt-1 text-xs text-tdai-secondary dark:text-tdai-gray-400">
            {worklistQuery.error instanceof Error && worklistQuery.error.message.includes("Network Error")
              ? "Backend server is not reachable. Please ensure the backend is running."
              : worklistQuery.error instanceof Error && worklistQuery.error.message.includes("timeout")
                ? "Request timed out. The server may be busy — please try again."
                : "Please check your connection and try again."}
          </p>
          <button
            className="btn-primary mt-4 !text-xs"
            onClick={() => worklistQuery.refetch()}
          >
            Try Again
          </button>
        </div>
      ) : null}

      {!worklistQuery.isLoading && !worklistQuery.error && (
        <div className="table-wrap">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="table-header">
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <th key={header.id}>
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody className="divide-y divide-tdai-border-light dark:divide-white/[0.08]">
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="table-row-hover">
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="table-cell">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.length === 0 && (
            <div className="py-16 text-center">
              <svg className="mx-auto h-12 w-12 text-tdai-muted dark:text-tdai-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="mt-3 text-sm font-medium text-tdai-secondary dark:text-tdai-gray-300">No studies found</p>
              <p className="mt-1 text-xs text-tdai-muted dark:text-tdai-gray-400">Try adjusting your search filters</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
