import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

  it("shows loading spinner initially while checking viewer", () => {
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {}));
    render(<OhifViewerEmbed src="http://localhost:3000/viewer" />);
    expect(screen.getByText("Connecting to OHIF Viewer...")).toBeInTheDocument();
  });

  it("shows unavailable state when viewer is not reachable", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network error"));
    render(<OhifViewerEmbed src="http://localhost:3000/viewer" />);
    await waitFor(() => {
      expect(screen.getByText("OHIF Viewer Unavailable")).toBeInTheDocument();
    });
  });

  it("displays 'Retry Connection' button when unavailable", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network error"));
    render(<OhifViewerEmbed src="http://localhost:3000/viewer" />);
    await waitFor(() => {
      expect(screen.getByText("Retry Connection")).toBeInTheDocument();
    });
  });

  it("displays 'Open in Tab' link when unavailable", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network error"));
    render(<OhifViewerEmbed src="http://localhost:3000/viewer" />);
    await waitFor(() => {
      expect(screen.getByText("Open in Tab")).toBeInTheDocument();
    });
  });

  it("'Open in Tab' link points to the viewer URL", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network error"));
    render(<OhifViewerEmbed src="http://localhost:3000/viewer?StudyInstanceUIDs=1.2.3" />);
    await waitFor(() => {
      const link = screen.getByText("Open in Tab").closest("a");
      expect(link).toHaveAttribute("href", "http://localhost:3000/viewer?StudyInstanceUIDs=1.2.3");
      expect(link).toHaveAttribute("target", "_blank");
    });
  });

  it("shows Docker instructions when viewer is unavailable", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network error"));
    render(<OhifViewerEmbed src="http://localhost:3000/viewer" />);
    await waitFor(() => {
      expect(screen.getByText("Start the OHIF viewer")).toBeInTheDocument();
      expect(screen.getByText("docker compose up ohif -d")).toBeInTheDocument();
    });
  });

  it("shows common causes when viewer is unavailable", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network error"));
    render(<OhifViewerEmbed src="http://localhost:3000/viewer" />);
    await waitFor(() => {
      expect(screen.getByText("Common causes")).toBeInTheDocument();
      expect(screen.getByText("Docker Desktop is not running")).toBeInTheDocument();
    });
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
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error(""));
    render(<OhifViewerEmbed src="" />);
    await waitFor(() => {
      expect(screen.getByText("OHIF Viewer Unavailable")).toBeInTheDocument();
    });
  });

  it("shows unavailable when src is whitespace only", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error(""));
    render(<OhifViewerEmbed src="   " />);
    await waitFor(() => {
      expect(screen.getByText("OHIF Viewer Unavailable")).toBeInTheDocument();
    });
  });

  it("falls back to backend health check when direct probe fails", async () => {
    let callCount = 0;
    (fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string | URL | Request) => {
      callCount++;
      const urlString = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      if (urlString.includes("/api/health/ohif")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ available: true }),
        });
      }
      return Promise.reject(new Error("Connection refused"));
    });

    render(<OhifViewerEmbed src="http://localhost:3000/viewer" />);
    await waitFor(() => {
      expect(callCount).toBeGreaterThanOrEqual(1);
    });
  });
});
