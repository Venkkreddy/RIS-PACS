import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

vi.stubGlobal("fetch", vi.fn());

import { OhifViewerEmbed } from "./OhifViewerEmbed";

describe("OhifViewerEmbed", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    (fetch as ReturnType<typeof vi.fn>).mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  // ── Tests for when a valid src is provided (iframe rendered) ──────────

  it("shows loading spinner initially while iframe is loading", () => {
    render(<OhifViewerEmbed src="http://localhost:3000/viewer" />);
    expect(screen.getByText("Loading viewer study...")).toBeInTheDocument();
  });

  it("renders iframe immediately when src is provided", () => {
    render(<OhifViewerEmbed src="http://localhost:3000/viewer" />);
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toBe("http://localhost:3000/viewer");
  });

  it("iframe renders with loading overlay when viewer src is valid", () => {
    render(<OhifViewerEmbed src="http://localhost:3000/viewer" />);
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(screen.getByText("Loading viewer study...")).toBeInTheDocument();
  });

  it("iframe is rendered even when network might be unreachable", () => {
    // Component no longer probes via fetch; it always renders iframe for non-empty src
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network error"));
    render(<OhifViewerEmbed src="http://localhost:3000/viewer" />);
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toBe("http://localhost:3000/viewer");
  });

  it("iframe src includes StudyInstanceUIDs parameter", () => {
    render(<OhifViewerEmbed src="http://localhost:3000/viewer?StudyInstanceUIDs=1.2.3" />);
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toBe(
      "http://localhost:3000/viewer?StudyInstanceUIDs=1.2.3",
    );
  });

  it("shows Docker instructions when src is empty (unavailable state)", () => {
    render(<OhifViewerEmbed src="" />);
    expect(screen.getByText("Start the OHIF viewer")).toBeInTheDocument();
    expect(screen.getByText("docker compose up ohif -d")).toBeInTheDocument();
  });

  it("shows common causes when src is empty (unavailable state)", () => {
    render(<OhifViewerEmbed src="" />);
    expect(screen.getByText("Common causes")).toBeInTheDocument();
    expect(screen.getByText("Docker Desktop is not running")).toBeInTheDocument();
  });

  it("renders iframe when viewer is available", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ type: "opaque", ok: false });
    render(<OhifViewerEmbed src="http://localhost:3000/viewer?StudyInstanceUIDs=1.2.3" />);
    await waitFor(() => {
      const iframe = document.querySelector("iframe");
      expect(iframe).not.toBeNull();
      expect(iframe?.getAttribute("src")).toBe(
        "http://localhost:3000/viewer?StudyInstanceUIDs=1.2.3",
      );
    });
  });

  it("iframe has correct title attribute", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ type: "opaque", ok: false });
    render(<OhifViewerEmbed src="http://localhost:3000/viewer" />);
    await waitFor(() => {
      const iframe = document.querySelector("iframe");
      expect(iframe?.getAttribute("title")).toBe("DICOM Viewer");
    });
  });

  it("iframe allows fullscreen", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ type: "opaque", ok: false });
    render(<OhifViewerEmbed src="http://localhost:3000/viewer" />);
    await waitFor(() => {
      const iframe = document.querySelector("iframe");
      expect(iframe?.getAttribute("allow")).toBe("fullscreen");
    });
  });

  it("shows loading overlay while iframe is loading", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ type: "opaque", ok: false });
    render(<OhifViewerEmbed src="http://localhost:3000/viewer" />);
    await waitFor(() => {
      expect(screen.getByText("Loading viewer study...")).toBeInTheDocument();
    });
  });

  it("shows unavailable when src is empty", async () => {
    render(<OhifViewerEmbed src="" />);
    await waitFor(() => {
      expect(screen.getByText("OHIF Viewer Unavailable")).toBeInTheDocument();
    });
  });

  it("shows unavailable when src is whitespace only", async () => {
    render(<OhifViewerEmbed src="   " />);
    await waitFor(() => {
      expect(screen.getByText("OHIF Viewer Unavailable")).toBeInTheDocument();
    });
  });

  it("shows Retry Connection button when src is empty", () => {
    render(<OhifViewerEmbed src="" />);
    expect(screen.getByText("Retry Connection")).toBeInTheDocument();
  });

  it("shows Open in Tab link when src is empty", () => {
    render(<OhifViewerEmbed src="" />);
    expect(screen.getByText("Open in Tab")).toBeInTheDocument();
  });
});
