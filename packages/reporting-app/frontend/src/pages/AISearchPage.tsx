import { useState, useRef, useCallback, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { InternalNavbar } from "../components/InternalNavbar";

/* ─── Types ─────────────────────────────────────────────────────── */
interface SearchResult {
  studyId: string;
  patientName: string;
  patientId: string;
  modality: string;
  bodyPart: string;
  studyDate: string;
  status: string;
  assignedTo: string | null;
  location: string;
  description: string;
  aiSummary: string | null;
  matchReasons: string[];
}

interface SearchResponse {
  query: string;
  parsedFilters: Record<string, string>;
  total: number;
  results: SearchResult[];
}

/* ─── Status badge colours ───────────────────────────────────────── */
const statusStyle: Record<string, { bg: string; color: string; label: string }> = {
  assigned:           { bg: "rgba(245,158,11,0.15)",  color: "#f59e0b",  label: "Pending" },
  "ready-for-reporting": { bg: "rgba(59,130,246,0.15)", color: "#3b82f6", label: "Ready" },
  reported:           { bg: "rgba(16,185,129,0.15)",  color: "#10b981",  label: "Reported" },
  scheduled:          { bg: "rgba(139,92,246,0.15)",  color: "#8b5cf6",  label: "Scheduled" },
  "qc-pending":       { bg: "rgba(249,115,22,0.15)",  color: "#f97316",  label: "QC" },
};

/* ─── Example query chips ────────────────────────────────────────── */
const EXAMPLE_QUERIES = [
  "Chest X-ray last week pending",
  "CT abdomen reported today",
  "Spine MRI with cardiomegaly findings",
  "Lumbar spine scheduled",
  "Knee X-ray last month",
  "Brain CT urgent",
];

/* ─── Format YYYYMMDD to readable date ──────────────────────────── */
function fmtDate(d: string) {
  if (!d || d.length < 8) return d;
  return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
}

/* ─── Skeleton loader card ──────────────────────────────────────── */
function SkeletonCard() {
  return (
    <div style={{
      backgroundColor: "#161b22", borderRadius: 12, padding: "16px 20px",
      border: "1px solid #2a3345", animation: "pulse 1.5s ease-in-out infinite",
    }}>
      {[80, 120, 60, 100].map((w, i) => (
        <div key={i} style={{
          height: 12, width: `${w}%`, borderRadius: 6,
          backgroundColor: "#1e2533", marginBottom: 10,
        }} />
      ))}
    </div>
  );
}

/* ─── Main page ─────────────────────────────────────────────────── */
export function AISearchPage() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    setHasSearched(true);
    try {
      const resp = await api.get<SearchResponse>(`/search?q=${encodeURIComponent(q.trim())}&limit=40`);
      setResponse((resp as any).data ?? resp);
    } catch (err: any) {
      setError(err?.message ?? "Search failed. Please try again.");
      setResponse(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runSearch(query);
  };

  const handleChip = (q: string) => {
    setQuery(q);
    runSearch(q);
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#0d1117", color: "#c8d6e5", fontFamily: "'Inter', 'system-ui', sans-serif" }}>
      <InternalNavbar />

      {/* ── Page hero ── */}
      <div style={{
        maxWidth: 900, margin: "0 auto", padding: "40px 20px 0",
        textAlign: "center",
      }}>
        {/* AI badge */}
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 16,
          backgroundColor: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)",
          borderRadius: 20, padding: "4px 14px", fontSize: 11, fontWeight: 700,
          color: "#818cf8", letterSpacing: "0.08em",
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          AI-POWERED SEARCH
        </div>

        <h1 style={{ fontSize: 32, fontWeight: 800, color: "#e6edf3", margin: "0 0 8px", lineHeight: 1.2 }}>
          Search Radiology Studies
        </h1>
        <p style={{ fontSize: 14, color: "#6e7b8c", margin: "0 0 28px" }}>
          Use plain English — describe modality, body part, timeframe, findings, or patient name
        </p>

        {/* ── Search bar ── */}
        <form onSubmit={handleSubmit} style={{ position: "relative", marginBottom: 16 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 0,
            backgroundColor: "#161b22", border: "1px solid #2a3345",
            borderRadius: 14, overflow: "hidden",
            boxShadow: "0 0 0 0 rgba(99,102,241,0)", transition: "box-shadow 200ms",
          }}
            onFocusCapture={e => (e.currentTarget.style.boxShadow = "0 0 0 3px rgba(99,102,241,0.25), 0 0 0 1px rgba(99,102,241,0.5)")}
            onBlurCapture={e => (e.currentTarget.style.boxShadow = "0 0 0 0 rgba(99,102,241,0)")}
          >
            <svg style={{ marginLeft: 16, flexShrink: 0, color: "#6366f1" }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref={inputRef}
              id="ai-search-input"
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="e.g. chest X-ray last week pending, CT abdomen cardiomegaly..."
              style={{
                flex: 1, backgroundColor: "transparent", border: "none", outline: "none",
                fontSize: 15, color: "#e6edf3", padding: "14px 12px",
                caretColor: "#6366f1",
              }}
            />
            {query && (
              <button type="button" onClick={() => { setQuery(""); setResponse(null); setHasSearched(false); }}
                style={{ padding: "8px 10px", color: "#6e7b8c", background: "none", border: "none", cursor: "pointer" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
            <button
              id="ai-search-submit"
              type="submit"
              disabled={!query.trim() || loading}
              style={{
                padding: "12px 24px", fontWeight: 700, fontSize: 13,
                backgroundColor: "#6366f1", color: "#fff", border: "none",
                cursor: query.trim() && !loading ? "pointer" : "not-allowed",
                opacity: query.trim() && !loading ? 1 : 0.5,
                transition: "opacity 150ms",
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              {loading
                ? <><svg style={{ animation: "spin 1s linear infinite" }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9" /></svg> Searching…</>
                : <>Search</>}
            </button>
          </div>
        </form>

        {/* ── Example chips ── */}
        {!hasSearched && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
            {EXAMPLE_QUERIES.map(q => (
              <button key={q} id={`chip-${q.replace(/\s+/g, '-').toLowerCase().slice(0, 20)}`}
                onClick={() => handleChip(q)}
                style={{
                  padding: "5px 12px", borderRadius: 20, fontSize: 11, fontWeight: 600,
                  backgroundColor: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)",
                  color: "#818cf8", cursor: "pointer", transition: "all 150ms",
                }}
                onMouseOver={e => { (e.currentTarget.style.backgroundColor = "rgba(99,102,241,0.18)"); }}
                onMouseOut={e => { (e.currentTarget.style.backgroundColor = "rgba(99,102,241,0.08)"); }}
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Results area ── */}
      <div style={{ maxWidth: 900, margin: "28px auto", padding: "0 20px 60px" }}>

        {/* Error */}
        {error && (
          <div style={{
            backgroundColor: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 10, padding: "12px 16px", color: "#f87171", fontSize: 13, marginBottom: 16,
          }}>
            ⚠ {error}
          </div>
        )}

        {/* Skeleton loading */}
        {loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {/* Parsed filters chips */}
        {!loading && response && Object.keys(response.parsedFilters).length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "#6e7b8c", fontWeight: 600 }}>PARSED:</span>
            {Object.entries(response.parsedFilters).map(([k, v]) => (
              <span key={k} style={{
                padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                backgroundColor: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.25)",
                color: "#34d399",
              }}>
                {k.replace(/_/g, ' ')}: {v}
              </span>
            ))}
          </div>
        )}

        {/* Result count */}
        {!loading && response && (
          <div style={{ fontSize: 12, color: "#6e7b8c", marginBottom: 14 }}>
            {response.total === 0
              ? "No studies matched your query"
              : `${response.total} study${response.total !== 1 ? "s" : ""} found${response.results.length < response.total ? `, showing ${response.results.length}` : ""}`}
          </div>
        )}

        {/* Result cards */}
        {!loading && response?.results.map(study => {
          const st = statusStyle[study.status] ?? { bg: "rgba(107,114,128,0.15)", color: "#9ca3af", label: study.status };
          return (
            <div key={study.studyId}
              id={`result-${study.studyId}`}
              style={{
                backgroundColor: "#161b22", borderRadius: 12, padding: "14px 18px",
                border: "1px solid #2a3345", marginBottom: 10,
                transition: "border-color 150ms, box-shadow 150ms",
                cursor: "default",
              }}
              onMouseOver={e => {
                (e.currentTarget.style.borderColor = "#6366f1");
                (e.currentTarget.style.boxShadow = "0 0 0 1px rgba(99,102,241,0.2)");
              }}
              onMouseOut={e => {
                (e.currentTarget.style.borderColor = "#2a3345");
                (e.currentTarget.style.boxShadow = "none");
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                {/* Left: patient info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#e6edf3" }}>{study.patientName}</span>
                    {study.patientId && (
                      <span style={{ fontSize: 10, color: "#6e7b8c" }}>#{study.patientId}</span>
                    )}
                    {/* Status badge */}
                    <span style={{
                      padding: "2px 8px", borderRadius: 20, fontSize: 10, fontWeight: 700,
                      backgroundColor: st.bg, color: st.color,
                    }}>{st.label}</span>
                    {/* Modality badge */}
                    {study.modality && (
                      <span style={{
                        padding: "2px 8px", borderRadius: 20, fontSize: 10, fontWeight: 700,
                        backgroundColor: "rgba(59,130,246,0.12)", color: "#60a5fa",
                      }}>{study.modality}</span>
                    )}
                  </div>

                  {/* Body part + date + location */}
                  <div style={{ fontSize: 12, color: "#8899b0", display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
                    {study.bodyPart && <span>📍 {study.bodyPart}</span>}
                    {study.studyDate && <span>📅 {fmtDate(study.studyDate)}</span>}
                    {study.location && <span>🏥 {study.location}</span>}
                  </div>

                  {/* AI summary snippet */}
                  {study.aiSummary && (
                    <p style={{
                      fontSize: 11, color: "#6e7b8c", margin: "0 0 6px",
                      lineHeight: 1.5, overflow: "hidden", textOverflow: "ellipsis",
                      display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                    }}>
                      🤖 {study.aiSummary}
                    </p>
                  )}

                  {/* Match reasons */}
                  {study.matchReasons.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
                      {study.matchReasons.map((r, i) => (
                        <span key={i} style={{
                          padding: "2px 8px", borderRadius: 20, fontSize: 9, fontWeight: 700,
                          backgroundColor: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.2)",
                          color: "#fbbf24",
                        }}>✓ {r}</span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Right: actions */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
                  <Link
                    id={`view-study-${study.studyId}`}
                    to={`/reports/study/${study.studyId}`}
                    style={{
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "6px 12px", borderRadius: 8, fontSize: 11, fontWeight: 700,
                      backgroundColor: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)",
                      color: "#818cf8", textDecoration: "none", whiteSpace: "nowrap",
                      transition: "all 150ms",
                    }}
                    onMouseOver={e => { (e.currentTarget.style.backgroundColor = "rgba(99,102,241,0.25)"); }}
                    onMouseOut={e => { (e.currentTarget.style.backgroundColor = "rgba(99,102,241,0.15)"); }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    Open
                  </Link>
                </div>
              </div>
            </div>
          );
        })}

        {/* Empty state */}
        {!loading && hasSearched && response?.total === 0 && (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#2a3345" style={{ marginBottom: 16 }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p style={{ color: "#6e7b8c", fontSize: 14 }}>No studies found. Try different terms or filters.</p>
            <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              {EXAMPLE_QUERIES.slice(0, 3).map(q => (
                <button key={q} onClick={() => handleChip(q)}
                  style={{
                    padding: "5px 12px", borderRadius: 20, fontSize: 11, fontWeight: 600,
                    backgroundColor: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)",
                    color: "#818cf8", cursor: "pointer",
                  }}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        * { box-sizing: border-box; }
      `}</style>
    </div>
  );
}
