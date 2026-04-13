import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, RefreshCw, Terminal, ExternalLink, WifiOff } from "lucide-react";

type ViewerStatus = "checking" | "available" | "unavailable" | "error";
const VIEWER_PROBE_TIMEOUT_MS = 6000;
const DIRECT_VIEWER_PROBE_TIMEOUT_MS = 2500;
const IFRAME_READY_TIMEOUT_MS = 12000;

function createProbeSignal(timeoutMs: number, parentSignal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  parentSignal?.addEventListener("abort", onAbort);
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      window.clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onAbort);
    },
  };
}

async function probeViewerUrl(url: string, signal?: AbortSignal): Promise<boolean> {
  let directOutcome: "available" | "unavailable" | "exception" = "unavailable";
  const directProbe = createProbeSignal(DIRECT_VIEWER_PROBE_TIMEOUT_MS, signal);
  try {
    const origin = new URL(url).origin;
    const response = await fetch(origin, { mode: "no-cors", cache: "no-store", signal: directProbe.signal });
    if (response.type === "opaque" || response.ok) {
      directOutcome = "available";
    }
  } catch {
    directOutcome = "exception";
    // Direct cross-origin probe failed (browser policy, firewall, etc.)
  } finally {
    directProbe.cleanup();
  }
  if (directOutcome === "available") return true;

  // Fallback: ask the backend which can reach OHIF via Docker networking
  let fallbackOutcome: "available" | "unavailable" | "exception" = "unavailable";
  const fallbackProbe = createProbeSignal(VIEWER_PROBE_TIMEOUT_MS, signal);
  try {
    const res = await fetch("/api/health/ohif?force=true", { signal: fallbackProbe.signal });
    if (res.ok) {
      const data = await res.json();
      fallbackOutcome = data.available === true ? "available" : "unavailable";
    }
  } catch {
    fallbackOutcome = "exception";
    // Backend also unreachable
  } finally {
    fallbackProbe.cleanup();
  }
  return fallbackOutcome === "available";
}

export function OhifViewerEmbed({ src }: { src: string }) {
  const [status, setStatus] = useState<ViewerStatus>("checking");
  const [retryCount, setRetryCount] = useState(0);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const checkAvailability = useCallback(async (signal?: AbortSignal) => {
    setStatus("checking");
    setIframeLoaded(false);
    if (!src.trim()) {
      setStatus("unavailable");
      return;
    }
    const reachable = await probeViewerUrl(src, signal);
    if (signal?.aborted) return;
    setStatus(reachable ? "available" : "unavailable");
  }, [src]);

  useEffect(() => {
    const controller = new AbortController();
    void checkAvailability(controller.signal);
    return () => controller.abort();
  }, [checkAvailability, retryCount]);

  useEffect(() => {
    if (status !== "available" || iframeLoaded) return;
    const timer = window.setTimeout(() => {
      setStatus((prev) => (prev === "available" ? "error" : prev));
    }, IFRAME_READY_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [status, iframeLoaded]);

  const handleRetry = () => setRetryCount((c) => c + 1);
  const handleIframeLoad = () => {
    setIframeLoaded(true);
    const countStudyUids = (url: string): number => {
      try {
        const parsed = new URL(url);
        const all = [
          parsed.searchParams.get("StudyInstanceUIDs") ?? "",
          parsed.searchParams.get("studyInstanceUIDs") ?? "",
        ]
          .join(",")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
        return new Set(all).size;
      } catch {
        return 0;
      }
    };
    const frameRect = iframeRef.current?.getBoundingClientRect();
    // #region agent log
    fetch("http://127.0.0.1:7829/ingest/0823df88-6411-4f3d-9920-ebf0779efd31",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"8d3439"},body:JSON.stringify({sessionId:"8d3439",runId:"multi-series",hypothesisId:"H13",location:"OhifViewerEmbed.tsx:handleIframeLoad",message:"OHIF iframe loaded in embed container",data:{uidCount:countStudyUids(src),iframeWidth:frameRect?Math.round(frameRect.width):null,iframeHeight:frameRect?Math.round(frameRect.height):null,windowWidth:window.innerWidth,windowHeight:window.innerHeight},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
  };
  const handleIframeError = () => {
    setStatus("error");
  };

  if (status === "checking") {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-tdai-navy-950 text-white gap-4">
        <div className="relative">
          <div className="h-10 w-10 rounded-full border-4 border-white/10" />
          <div className="absolute inset-0 h-10 w-10 animate-spin rounded-full border-4 border-transparent border-t-tdai-teal-500" />
        </div>
        <p className="text-sm text-tdai-gray-300 font-medium">Connecting to OHIF Viewer...</p>
      </div>
    );
  }

  if (status === "unavailable" || status === "error") {
    const isLoadError = status === "error";
    let origin: string;
    try {
      origin = new URL(src).origin;
    } catch {
      origin = src;
    }

    return (
      <div className="absolute inset-0 flex items-center justify-center bg-tdai-navy-950 p-8">
        <div className="max-w-lg w-full text-center space-y-6">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10 ring-1 ring-amber-500/20">
            <WifiOff className="h-8 w-8 text-amber-400" />
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-bold text-white">
              {isLoadError ? "OHIF Viewer Failed to Load" : "OHIF Viewer Unavailable"}
            </h3>
            {isLoadError ? (
              <p className="text-sm text-tdai-gray-400 leading-relaxed">
                The viewer opened but did not finish rendering in this panel. Retry, or open it in a separate tab.
              </p>
            ) : (
              <p className="text-sm text-tdai-gray-400 leading-relaxed">
                Cannot reach the OHIF viewer at <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-tdai-teal-300 font-mono">{origin}</code>
              </p>
            )}
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-5 text-left space-y-4">
            <div className="flex items-start gap-3">
              <Terminal className="h-5 w-5 text-tdai-teal-400 mt-0.5 shrink-0" />
              <div className="space-y-2">
                <p className="text-sm font-semibold text-white">Start the OHIF viewer</p>
                <div className="space-y-1.5">
                  <p className="text-xs text-tdai-gray-400">Option 1 — Docker (recommended):</p>
                  <code className="block rounded-lg bg-black/40 px-3 py-2 text-xs text-tdai-teal-300 font-mono">
                    docker compose up ohif -d
                  </code>
                </div>
                <div className="space-y-1.5 pt-1">
                  <p className="text-xs text-tdai-gray-400">Option 2 — From source:</p>
                  <code className="block rounded-lg bg-black/40 px-3 py-2 text-xs text-tdai-teal-300 font-mono leading-relaxed">
                    cd packages/ohif-viewer<br />
                    yarn install --frozen-lockfile<br />
                    yarn dev
                  </code>
                </div>
              </div>
            </div>

            <div className="flex items-start gap-3 border-t border-white/5 pt-4">
              <AlertTriangle className="h-5 w-5 text-amber-400 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-white">Common causes</p>
                <ul className="text-xs text-tdai-gray-400 space-y-1 list-disc list-inside">
                  <li>Docker Desktop is not running</li>
                  <li>OHIF container hasn't been started yet</li>
                  <li>Port 3000 is blocked or used by another app</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              onClick={handleRetry}
              className="inline-flex items-center gap-2 rounded-lg bg-tdai-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-tdai-teal-900/40 transition-all hover:bg-tdai-teal-500 active:scale-[0.98]"
            >
              <RefreshCw className="h-4 w-4" />
              Retry Connection
            </button>
            <a
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-5 py-2.5 text-sm font-medium text-tdai-gray-300 transition-all hover:bg-white/5 hover:text-white"
            >
              <ExternalLink className="h-4 w-4" />
              Open in Tab
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 bg-tdai-navy-950">
      <iframe
        ref={iframeRef}
        src={src}
        className="absolute inset-0 w-full h-full border-0"
        title="DICOM Viewer"
        allow="fullscreen"
        onLoad={handleIframeLoad}
        onError={handleIframeError}
      />
      {!iframeLoaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-tdai-navy-950/90 text-white">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-white/10 border-t-tdai-teal-500" />
          <p className="text-sm text-tdai-gray-300 font-medium">Loading viewer study...</p>
        </div>
      )}
    </div>
  );
}
