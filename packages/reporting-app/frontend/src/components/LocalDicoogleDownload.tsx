export function LocalDicoogleDownload() {
  const downloadUrl =
    import.meta.env.VITE_LOCAL_DICOOGLE_ZIP_URL ??
    "https://github.com/metupalle-jpg/tdai/releases/download/v1.0.0/tdai-local-dicoogle.zip";

  return (
    <div className="card p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tdai-navy-50">
          <svg className="h-5 w-5 text-tdai-navy-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 3.75H6.912a2.25 2.25 0 00-2.15 1.588L2.35 13.177a2.25 2.25 0 00-.1.661V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H15M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859" />
          </svg>
        </div>
        <div>
          <h3 className="text-base font-semibold text-tdai-navy-800">Local Dicoogle Installer</h3>
          <p className="text-xs text-tdai-gray-500">
            Pre-configured PACS node for radiographer workstations
          </p>
        </div>
      </div>
      <p className="mt-4 text-sm leading-relaxed text-tdai-gray-600">
        Download the preconfigured local Dicoogle package for radiographer uploads. It is pre-wired to
        forward studies to the central TDAI endpoint automatically.
      </p>
      <a
        className="btn-primary mt-4 inline-flex items-center gap-2"
        href={downloadUrl}
        target="_blank"
        rel="noreferrer"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
        </svg>
        Download Dicoogle ZIP
      </a>
    </div>
  );
}
