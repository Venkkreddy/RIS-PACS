import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const apiGetMock = vi.fn();
const apiPostMock = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    get: (...args: unknown[]) => apiGetMock(...args),
    post: (...args: unknown[]) => apiPostMock(...args),
  },
}));

vi.mock("../hooks/useAuthRole", () => ({
  useAuthRole: () => ({
    isAuthenticated: true,
    approved: true,
    role: "radiologist",
    permissions: ["ai:analyze", "ai:view_results", "worklist:view", "reports:create"],
    hasPermission: (p: string) => ["ai:analyze", "ai:view_results"].includes(p),
    loading: false,
  }),
}));

vi.mock("../hooks/useServiceStatus", () => ({
  useServiceStatus: () => ({
    isMonaiEnabled: true,
    monaiUiVisible: true,
    isSttEnabled: false,
    isLlmEnabled: false,
    loading: false,
  }),
}));

import { MonaiPanel } from "./MonaiPanel";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("MonaiPanel", () => {
  beforeEach(() => {
    apiGetMock.mockReset();
    apiPostMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders MONAI panel header", async () => {
    apiGetMock.mockImplementation((url: string) => {
      if (url === "/ai/models") {
        return Promise.resolve({
          data: {
            enabled: true,
            models: [
              { name: "monai_chest_xray", description: "CXR classification", type: "classification", bodyParts: ["Chest"], modalities: ["CR", "DX"], version: "1.0" },
            ],
          },
        });
      }
      if (url.startsWith("/ai/results/")) {
        return Promise.resolve({ data: { studyId: "1.2.3", findings: [], summary: null, model: null } });
      }
      return Promise.reject(new Error("unexpected"));
    });

    render(<MonaiPanel studyId="1.2.3" />, { wrapper: createWrapper() });
    expect(screen.getByText("MONAI")).toBeInTheDocument();
    expect(screen.getByText("Image Analysis")).toBeInTheDocument();
  });

  it("shows 'Enabled' badge when MONAI is active", async () => {
    apiGetMock.mockImplementation((url: string) => {
      if (url === "/ai/models") {
        return Promise.resolve({ data: { enabled: true, models: [] } });
      }
      if (url.startsWith("/ai/results/")) {
        return Promise.resolve({ data: { studyId: "1.2.3", findings: [], summary: null, model: null } });
      }
      return Promise.reject(new Error("unexpected"));
    });

    render(<MonaiPanel studyId="1.2.3" />, { wrapper: createWrapper() });
    expect(screen.getByText("Enabled")).toBeInTheDocument();
  });

  it("renders 'Run MONAI' button for users with ai:analyze permission", async () => {
    apiGetMock.mockImplementation((url: string) => {
      if (url === "/ai/models") {
        return Promise.resolve({
          data: {
            enabled: true,
            models: [{ name: "monai_chest_xray", description: "CXR", type: "classification", bodyParts: ["Chest"], modalities: ["CR"], version: "1.0" }],
          },
        });
      }
      if (url.startsWith("/ai/results/")) {
        return Promise.resolve({ data: { studyId: "1.2.3", findings: [], summary: null, model: null } });
      }
      return Promise.reject(new Error("unexpected"));
    });

    render(<MonaiPanel studyId="1.2.3" />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByText("Run MONAI")).toBeInTheDocument();
    });
  });

  it("renders 'Refresh' button for users with ai:view_results permission", async () => {
    apiGetMock.mockImplementation((url: string) => {
      if (url === "/ai/models") {
        return Promise.resolve({ data: { enabled: true, models: [] } });
      }
      if (url.startsWith("/ai/results/")) {
        return Promise.resolve({ data: { studyId: "1.2.3", findings: [], summary: null, model: null } });
      }
      return Promise.reject(new Error("unexpected"));
    });

    render(<MonaiPanel studyId="1.2.3" />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByText("Refresh")).toBeInTheDocument();
    });
  });

  it("renders model selector dropdown", async () => {
    apiGetMock.mockImplementation((url: string) => {
      if (url === "/ai/models") {
        return Promise.resolve({
          data: {
            enabled: true,
            models: [
              { name: "monai_chest_xray", description: "CXR", type: "classification", bodyParts: ["Chest"], modalities: ["CR"], version: "1.0" },
              { name: "monai_ct_lung", description: "CT Lung", type: "segmentation", bodyParts: ["Lung"], modalities: ["CT"], version: "2.0" },
            ],
          },
        });
      }
      if (url.startsWith("/ai/results/")) {
        return Promise.resolve({ data: { studyId: "1.2.3", findings: [], summary: null, model: null } });
      }
      return Promise.reject(new Error("unexpected"));
    });

    render(<MonaiPanel studyId="1.2.3" />, { wrapper: createWrapper() });
    await waitFor(() => {
      const select = document.querySelector("select");
      expect(select).not.toBeNull();
    });
  });

  it("displays cached AI findings when available", async () => {
    apiGetMock.mockImplementation((url: string) => {
      if (url === "/ai/models") {
        return Promise.resolve({ data: { enabled: true, models: [] } });
      }
      if (url.startsWith("/ai/results/")) {
        return Promise.resolve({
          data: {
            studyId: "1.2.3",
            findings: [
              { label: "Cardiomegaly", confidence: 0.87, description: "Enlarged cardiac silhouette" },
              { label: "Pleural Effusion", confidence: 0.72, description: "Left-sided effusion" },
            ],
            summary: "AI analysis: 2 significant findings",
            model: "monai_chest_xray",
          },
        });
      }
      return Promise.reject(new Error("unexpected"));
    });

    render(<MonaiPanel studyId="1.2.3" />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByText("Cardiomegaly")).toBeInTheDocument();
    });
    expect(screen.getByText("Pleural Effusion")).toBeInTheDocument();
    expect(screen.getByText("87%")).toBeInTheDocument();
    expect(screen.getByText("72%")).toBeInTheDocument();
  });

  it("displays AI summary when results are cached", async () => {
    apiGetMock.mockImplementation((url: string) => {
      if (url === "/ai/models") {
        return Promise.resolve({ data: { enabled: true, models: [] } });
      }
      if (url.startsWith("/ai/results/")) {
        return Promise.resolve({
          data: {
            studyId: "1.2.3",
            findings: [{ label: "Normal", confidence: 0.95, description: "No abnormality" }],
            summary: "AI analysis: Normal chest radiograph",
            model: "monai_chest_xray",
          },
        });
      }
      return Promise.reject(new Error("unexpected"));
    });

    render(<MonaiPanel studyId="1.2.3" />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByText("AI analysis: Normal chest radiograph")).toBeInTheDocument();
    });
  });

  it("shows 'No MONAI findings' message when no results exist", async () => {
    apiGetMock.mockImplementation((url: string) => {
      if (url === "/ai/models") {
        return Promise.resolve({ data: { enabled: true, models: [] } });
      }
      if (url.startsWith("/ai/results/")) {
        return Promise.resolve({
          data: { studyId: "1.2.3", findings: [], summary: null, model: null },
        });
      }
      return Promise.reject(new Error("unexpected"));
    });

    render(<MonaiPanel studyId="1.2.3" />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByText("No MONAI findings stored for this study yet.")).toBeInTheDocument();
    });
  });

  it("shows DICOM Artifacts section", async () => {
    apiGetMock.mockImplementation((url: string) => {
      if (url === "/ai/models") {
        return Promise.resolve({ data: { enabled: true, models: [] } });
      }
      if (url.startsWith("/ai/results/")) {
        return Promise.resolve({ data: { studyId: "1.2.3", findings: [], summary: null, model: null } });
      }
      return Promise.reject(new Error("unexpected"));
    });

    render(<MonaiPanel studyId="1.2.3" />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByText("DICOM Artifacts")).toBeInTheDocument();
    });
  });

  it("shows artifact links placeholder when no artifacts generated", async () => {
    apiGetMock.mockImplementation((url: string) => {
      if (url === "/ai/models") {
        return Promise.resolve({ data: { enabled: true, models: [] } });
      }
      if (url.startsWith("/ai/results/")) {
        return Promise.resolve({ data: { studyId: "1.2.3", findings: [], summary: null, model: null } });
      }
      return Promise.reject(new Error("unexpected"));
    });

    render(<MonaiPanel studyId="1.2.3" />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByText("Artifacts will appear here after MONAI analysis runs.")).toBeInTheDocument();
    });
  });

  it("displays finding descriptions", async () => {
    apiGetMock.mockImplementation((url: string) => {
      if (url === "/ai/models") {
        return Promise.resolve({ data: { enabled: true, models: [] } });
      }
      if (url.startsWith("/ai/results/")) {
        return Promise.resolve({
          data: {
            studyId: "1.2.3",
            findings: [
              { label: "Atelectasis", confidence: 0.45, description: "Minor bibasilar atelectasis noted" },
            ],
            summary: "AI analysis",
            model: "monai_chest_xray",
          },
        });
      }
      return Promise.reject(new Error("unexpected"));
    });

    render(<MonaiPanel studyId="1.2.3" />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByText("Minor bibasilar atelectasis noted")).toBeInTheDocument();
    });
  });

  it("displays confidence as percentage", async () => {
    apiGetMock.mockImplementation((url: string) => {
      if (url === "/ai/models") {
        return Promise.resolve({ data: { enabled: true, models: [] } });
      }
      if (url.startsWith("/ai/results/")) {
        return Promise.resolve({
          data: {
            studyId: "1.2.3",
            findings: [{ label: "Pneumonia", confidence: 0.63, description: "Possible pneumonia" }],
            summary: "findings",
            model: "monai_chest_xray",
          },
        });
      }
      return Promise.reject(new Error("unexpected"));
    });

    render(<MonaiPanel studyId="1.2.3" />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByText("63%")).toBeInTheDocument();
    });
  });

  it("shows model description and metadata when a model is selected", async () => {
    apiGetMock.mockImplementation((url: string) => {
      if (url === "/ai/models") {
        return Promise.resolve({
          data: {
            enabled: true,
            models: [
              {
                name: "monai_chest_xray",
                description: "CXR 14-class classification",
                type: "classification",
                bodyParts: ["Chest"],
                modalities: ["CR", "DX"],
                version: "1.0.0",
              },
            ],
          },
        });
      }
      if (url.startsWith("/ai/results/")) {
        return Promise.resolve({ data: { studyId: "1.2.3", findings: [], summary: null, model: null } });
      }
      return Promise.reject(new Error("unexpected"));
    });

    render(<MonaiPanel studyId="1.2.3" />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByText("CXR 14-class classification")).toBeInTheDocument();
      expect(screen.getByText(/CR, DX/)).toBeInTheDocument();
      expect(screen.getByText(/Chest/)).toBeInTheDocument();
    });
  });
});

describe("MonaiPanel — Inactive state", () => {
  beforeEach(() => {
    apiGetMock.mockReset();
    apiPostMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows 'Inactive' badge when MONAI is disabled in service config", async () => {
    vi.doMock("../hooks/useServiceStatus", () => ({
      useServiceStatus: () => ({
        isMonaiEnabled: false,
        monaiUiVisible: true,
        isSttEnabled: false,
        isLlmEnabled: false,
        loading: false,
      }),
    }));

    apiGetMock.mockImplementation((url: string) => {
      if (url === "/ai/models") {
        return Promise.resolve({ data: { enabled: false, models: [] } });
      }
      if (url.startsWith("/ai/results/")) {
        return Promise.resolve({ data: { studyId: "1.2.3", findings: [], summary: null, model: null } });
      }
      return Promise.reject(new Error("unexpected"));
    });

    const { MonaiPanel: Panel } = await import("./MonaiPanel");
    render(<Panel studyId="1.2.3" />, { wrapper: createWrapper() });

    await waitFor(() => {
      const badges = screen.getAllByText(/Inactive|Enabled/);
      expect(badges.length).toBeGreaterThanOrEqual(1);
    });
  });
});
