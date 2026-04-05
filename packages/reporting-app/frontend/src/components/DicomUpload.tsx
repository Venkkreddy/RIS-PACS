import { useCallback, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import type { Patient } from "@medical-report-system/shared";
import { api } from "../api/client";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

interface UploadResult {
  filename: string;
  status: string;
  error?: string;
}

interface DicomUploadProps {
  patientId?: string;
  patientName?: string;
  /** Called after a successful upload when a patient MRN/id was sent (for OHIF reload per patient). */
  onUploaded?: (ctx: { patientId: string }) => void;
}

function getUploadErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const responseError = error.response?.data;
    if (
      responseError &&
      typeof responseError === "object" &&
      "error" in responseError &&
      typeof responseError.error === "string"
    ) {
      return responseError.error;
    }
    if (error.code === "ECONNABORTED") {
      return "Upload timed out. Try uploading fewer files at once.";
    }
    if (error.message === "Network Error") {
      return "Network error during upload. Verify backend is running and try a smaller batch.";
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Upload failed. Please try again.";
}

export function DicomUpload({ patientId, patientName, onUploaded }: DicomUploadProps = {}) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);

  const isPatientBound = Boolean(patientId?.trim());
  const [registrySearch, setRegistrySearch] = useState("");
  const debouncedRegistrySearch = useDebouncedValue(registrySearch, 300);
  const [selectedRegistryPatient, setSelectedRegistryPatient] = useState<Patient | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [manualMrn, setManualMrn] = useState("");
  const [manualFullName, setManualFullName] = useState("");

  const patientsQuery = useQuery({
    queryKey: ["patients", "dicom-upload", debouncedRegistrySearch],
    queryFn: async () => {
      const res = await api.get<Patient[]>("/patients", {
        params: debouncedRegistrySearch.trim() ? { search: debouncedRegistrySearch.trim() } : {},
      });
      return res.data;
    },
    enabled: !isPatientBound,
    staleTime: 10_000,
    retry: 1,
  });

  const resolvedPatientId = isPatientBound
    ? patientId!.trim()
    : manualMode
      ? manualMrn.trim()
      : (selectedRegistryPatient?.patientId ?? "").trim();

  const resolvedPatientName = isPatientBound
    ? (patientName ?? "").trim()
    : manualMode
      ? manualFullName.trim()
      : selectedRegistryPatient
        ? `${selectedRegistryPatient.firstName} ${selectedRegistryPatient.lastName}`.trim()
        : "";

  const hasUploadPatient = isPatientBound || Boolean(resolvedPatientId && resolvedPatientName);

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      setUploadProgress(0);
      const form = new FormData();
      for (const f of files) {
        form.append("files", f);
      }
      if (resolvedPatientId) {
        form.append("patientId", resolvedPatientId);
      }
      if (resolvedPatientName) {
        form.append("patientName", resolvedPatientName);
      }
      const res = await api.post<{ message: string; results: UploadResult[] }>("/dicom/upload", form, {
        timeout: 300_000,
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            setUploadProgress(Math.round((progressEvent.loaded * 100) / progressEvent.total));
          }
        },
      });
      setUploadProgress(100);
      const uploadedPatientId = resolvedPatientId.trim() || undefined;
      return { ...res.data, uploadedPatientId };
    },
    onSuccess: (data) => {
      setSelectedFiles([]);
      setFilterWarning(null);
      setUploadProgress(0);
      void queryClient.invalidateQueries({
        predicate: (q) => q.queryKey[0] === "worklist" || q.queryKey[0] === "patients",
      });
      void api.post("/dicomweb/warm").catch(() => {});
      if (data.uploadedPatientId) {
        onUploaded?.({ patientId: data.uploadedPatientId });
      }
    },
    onError: () => {
      setUploadProgress(0);
    },
  });

  const [filterWarning, setFilterWarning] = useState<string | null>(null);

  const addFiles = useCallback((incoming: FileList | null) => {
    if (!incoming) return;
    const allFiles = Array.from(incoming);
    const dcmFiles = allFiles.filter((f) => {
      const name = f.name.toLowerCase();
      const ext = name.includes(".") ? name.split(".").pop() : "";
      const isDicomExt = ["dcm", "dicom", "ima", "img"].includes(ext ?? "");
      const isDicomMime = f.type === "application/dicom" || f.type === "application/octet-stream";
      const hasNoExtension = !name.includes(".");
      const hasNoMime = f.type === "";
      return isDicomExt || isDicomMime || hasNoExtension || hasNoMime;
    });

    setFilterWarning(null);
    if (dcmFiles.length === 0 && allFiles.length > 0) {
      setFilterWarning(`${allFiles.length} file${allFiles.length > 1 ? "s" : ""} rejected — only DICOM files (.dcm, .ima, .img) are accepted.`);
      return;
    }
    if (dcmFiles.length < allFiles.length) {
      const skipped = allFiles.length - dcmFiles.length;
      setFilterWarning(`${skipped} non-DICOM file${skipped > 1 ? "s" : ""} skipped. ${dcmFiles.length} DICOM file${dcmFiles.length > 1 ? "s" : ""} added.`);
    }

    uploadMutation.reset();
    setSelectedFiles((prev) => [...prev, ...dcmFiles]);
  }, [uploadMutation]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="card max-h-[80vh] overflow-y-auto p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tdai-teal-50">
          <svg className="h-5 w-5 text-tdai-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
        </div>
        <div>
          <h3 className="text-base font-semibold text-tdai-navy-800">Upload DICOM Studies</h3>
          {isPatientBound ? (
            <p className="text-xs font-medium text-tdai-teal-600">
              {patientName?.trim() ? `${patientName} — ` : ""}MRN: {patientId}
            </p>
          ) : (
            <p className="text-xs text-tdai-gray-500">
              Drag &amp; drop DICOM files or click to browse
            </p>
          )}
        </div>
      </div>

      {!isPatientBound && (
        <div className="mt-5 rounded-2xl border border-tdai-gray-200 bg-tdai-gray-50/80 p-4">
          <p className="text-sm font-semibold text-tdai-navy-800">Who is this study for?</p>
          <p className="mt-1 text-xs text-tdai-gray-500">
            Choose a patient from the registry or enter an MRN and name so the worklist shows the correct person.
          </p>

          {!manualMode ? (
            <div className="mt-3 space-y-2">
              <input
                type="search"
                className="input-field w-full text-sm"
                placeholder="Search by name or MRN..."
                value={registrySearch}
                onChange={(e) => setRegistrySearch(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
              <div className="max-h-36 overflow-y-auto rounded-xl border border-tdai-gray-200 bg-white">
                {patientsQuery.isLoading ? (
                  <p className="px-3 py-3 text-xs text-tdai-gray-400">Loading patients…</p>
                ) : patientsQuery.isError ? (
                  <p className="px-3 py-3 text-xs text-tdai-red-600">
                    Could not load the patient list. Use “Enter manually” below or try again later.
                  </p>
                ) : (patientsQuery.data ?? []).length === 0 ? (
                  <p className="px-3 py-3 text-xs text-tdai-gray-500">
                    No patients match. Add patients under Patients or enter details manually.
                  </p>
                ) : (
                  <ul className="divide-y divide-tdai-gray-100">
                    {(patientsQuery.data ?? []).map((p) => {
                      const label = `${p.firstName} ${p.lastName}`.trim();
                      const selected = selectedRegistryPatient?.id === p.id;
                      return (
                        <li key={p.id}>
                          <button
                            type="button"
                            className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm transition-colors ${
                              selected ? "bg-tdai-teal-50 text-tdai-navy-800" : "hover:bg-tdai-gray-50 text-tdai-navy-700"
                            }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedRegistryPatient(p);
                              setManualMode(false);
                            }}
                          >
                            <span className="font-medium">{label || p.patientId}</span>
                            <span className="ml-2 shrink-0 text-xs text-tdai-gray-500">MRN {p.patientId}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <button
                type="button"
                className="text-xs font-medium text-tdai-teal-600 hover:text-tdai-teal-700"
                onClick={(e) => {
                  e.stopPropagation();
                  setManualMode(true);
                  setSelectedRegistryPatient(null);
                }}
              >
                Enter MRN and name manually
              </button>
            </div>
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-tdai-gray-600">MRN / Patient ID</label>
                <input
                  className="input-field w-full text-sm"
                  placeholder="e.g. MRN-001"
                  value={manualMrn}
                  onChange={(e) => setManualMrn(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-tdai-gray-600">Patient name</label>
                <input
                  className="input-field w-full text-sm"
                  placeholder="Full name as it should appear on the worklist"
                  value={manualFullName}
                  onChange={(e) => setManualFullName(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
              <div className="sm:col-span-2">
                <button
                  type="button"
                  className="text-xs font-medium text-tdai-teal-600 hover:text-tdai-teal-700"
                  onClick={(e) => {
                    e.stopPropagation();
                    setManualMode(false);
                    setManualMrn("");
                    setManualFullName("");
                  }}
                >
                  Back to patient search
                </button>
              </div>
            </div>
          )}

          {hasUploadPatient && (
            <p className="mt-3 text-xs font-medium text-tdai-teal-700">
              Upload will be linked to: {resolvedPatientName}
              {resolvedPatientId ? ` (MRN: ${resolvedPatientId})` : ""}
            </p>
          )}
        </div>
      )}

      <div
        className={`mt-5 flex min-h-[140px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed transition-all duration-200 ${
          dragActive
            ? "border-tdai-teal-500 bg-tdai-teal-50/50 shadow-glow-teal"
            : "border-tdai-gray-200 hover:border-tdai-teal-400 hover:bg-tdai-gray-50"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <svg
          className={`mb-2 h-8 w-8 transition-colors ${dragActive ? "text-tdai-teal-500" : "text-tdai-gray-300"}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
          />
        </svg>
        <span className="text-sm text-tdai-gray-500">
          {dragActive ? "Drop files here" : "Click or drag DICOM (.dcm) files here"}
        </span>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".dcm,.dicom,.ima,.img,application/dicom,application/octet-stream,*/*"
          multiple
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {filterWarning && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          {filterWarning}
        </div>
      )}

      {selectedFiles.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-medium text-tdai-navy-700">
            {selectedFiles.length} file{selectedFiles.length > 1 ? "s" : ""} selected
          </p>
          <ul className="mt-2 max-h-40 space-y-1.5 overflow-y-auto">
            {selectedFiles.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="flex items-center justify-between rounded-xl bg-tdai-gray-50 px-3.5 py-2 text-sm"
              >
                <span className="truncate text-tdai-navy-700">{f.name}</span>
                <span className="ml-2 flex items-center gap-2 text-xs text-tdai-gray-400">
                  {formatSize(f.size)}
                  <button
                    type="button"
                    className="text-tdai-gray-400 transition-colors hover:text-tdai-red-500"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(i);
                    }}
                  >
                    &times;
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {selectedFiles.length > 0 && !hasUploadPatient && !isPatientBound && (
        <p className="mt-3 text-xs text-amber-700">
          Select a patient above (or enter MRN and name manually) before uploading.
        </p>
      )}

      {selectedFiles.length > 0 && (
        <div className="mt-4 space-y-3">
          {uploadMutation.isPending && uploadProgress > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-tdai-navy-700">
                  Uploading {selectedFiles.length} file{selectedFiles.length > 1 ? "s" : ""}…
                </span>
                <span className="font-mono text-tdai-teal-600">{uploadProgress}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-tdai-gray-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-tdai-teal-500 to-tdai-teal-400 transition-all duration-300 ease-out"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="text-[11px] text-tdai-gray-400">
                {uploadProgress < 100
                  ? "Transferring DICOM data to server…"
                  : "Processing and indexing — this may take a moment…"}
              </p>
            </div>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={uploadMutation.isPending || !hasUploadPatient}
            onClick={() => uploadMutation.mutate(selectedFiles)}
          >
            {uploadMutation.isPending ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                Uploading… {uploadProgress > 0 ? `${uploadProgress}%` : ""}
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
                Upload {selectedFiles.length} file{selectedFiles.length > 1 ? "s" : ""}
              </>
            )}
          </button>
        </div>
      )}

      {uploadMutation.isSuccess && (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
          <p className="font-semibold">{uploadMutation.data.message}</p>
          <ul className="mt-2 space-y-1">
            {uploadMutation.data.results.map((r, i) => (
              <li key={i} className="flex items-center gap-1.5">
                {r.status === "stored" ? (
                  <svg className="h-3.5 w-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                ) : (
                  <svg className="h-3.5 w-3.5 text-tdai-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                )}
                <span className="truncate">{r.filename}</span>
                {r.error && <span className="text-tdai-red-600"> — {r.error}</span>}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-900 transition-colors"
            onClick={() => {
              uploadMutation.reset();
              inputRef.current?.click();
            }}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
            Upload more files to this patient
          </button>
        </div>
      )}

      {uploadMutation.isError && (
        <div className="mt-4 rounded-xl border border-tdai-red-200 bg-tdai-red-50 p-4 text-sm text-tdai-red-700">
          Upload failed: {getUploadErrorMessage(uploadMutation.error)}
        </div>
      )}
    </div>
  );
}
