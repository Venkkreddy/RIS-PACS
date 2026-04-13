import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const apiGetMock = vi.fn();
const apiPostMock = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    get: (...args: unknown[]) => apiGetMock(...args),
    post: (...args: unknown[]) => apiPostMock(...args),
  },
}));

vi.mock("../hooks/useDebouncedValue", () => ({
  useDebouncedValue: (val: unknown) => val,
}));

import { DicomUpload } from "./DicomUpload";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("DicomUpload", () => {
  beforeEach(() => {
    apiGetMock.mockReset();
    apiPostMock.mockReset();
    apiGetMock.mockImplementation((url: string) => {
      if (url === "/patients") {
        return Promise.resolve({ data: [] });
      }
      return Promise.reject(new Error("unexpected"));
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders upload heading", () => {
    render(<DicomUpload />, { wrapper: createWrapper() });
    expect(screen.getByText("Upload DICOM Studies")).toBeInTheDocument();
  });

  it("renders drag and drop area", () => {
    render(<DicomUpload />, { wrapper: createWrapper() });
    expect(screen.getByText(/Click or drag DICOM/)).toBeInTheDocument();
  });

  it("shows patient info when patientId is provided", () => {
    render(
      <DicomUpload patientId="MRN-001" patientName="John Doe" />,
      { wrapper: createWrapper() },
    );
    expect(screen.getByText(/MRN: MRN-001/)).toBeInTheDocument();
    expect(screen.getByText(/John Doe/)).toBeInTheDocument();
  });

  it("shows patient search when no patientId bound", () => {
    render(<DicomUpload />, { wrapper: createWrapper() });
    expect(screen.getByText("Who is this study for?")).toBeInTheDocument();
  });

  it("has a file input that accepts DICOM files", () => {
    render(<DicomUpload />, { wrapper: createWrapper() });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.getAttribute("accept")).toContain(".dcm");
    expect(input.getAttribute("accept")).toContain("application/dicom");
  });

  it("file input allows multiple files", () => {
    render(<DicomUpload />, { wrapper: createWrapper() });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.multiple).toBe(true);
  });

  it("shows 'Enter MRN and name manually' option", () => {
    render(<DicomUpload />, { wrapper: createWrapper() });
    expect(screen.getByText("Enter MRN and name manually")).toBeInTheDocument();
  });

  it("switches to manual mode when clicking manual entry link", async () => {
    render(<DicomUpload />, { wrapper: createWrapper() });
    const manualLink = screen.getByText("Enter MRN and name manually");
    fireEvent.click(manualLink);
    await waitFor(() => {
      expect(screen.getByPlaceholderText("e.g. MRN-001")).toBeInTheDocument();
    });
  });

  it("shows 'Back to patient search' in manual mode", async () => {
    render(<DicomUpload />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByText("Enter MRN and name manually"));
    await waitFor(() => {
      expect(screen.getByText("Back to patient search")).toBeInTheDocument();
    });
  });

  it("has patient search input", () => {
    render(<DicomUpload />, { wrapper: createWrapper() });
    expect(screen.getByPlaceholderText("Search by name or MRN...")).toBeInTheDocument();
  });

  it("shows patient list from registry", async () => {
    apiGetMock.mockImplementation((url: string) => {
      if (url === "/patients") {
        return Promise.resolve({
          data: [
            { id: "1", patientId: "MRN-001", firstName: "Alice", lastName: "Smith", dateOfBirth: "1985-01-01", gender: "F" },
            { id: "2", patientId: "MRN-002", firstName: "Bob", lastName: "Jones", dateOfBirth: "1990-05-15", gender: "M" },
          ],
        });
      }
      return Promise.reject(new Error("unexpected"));
    });

    render(<DicomUpload />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByText("Alice Smith")).toBeInTheDocument();
      expect(screen.getByText("Bob Jones")).toBeInTheDocument();
    });
  });

  it("shows loading state when patients are being fetched", async () => {
    apiGetMock.mockImplementation((url: string) => {
      if (url === "/patients") {
        return new Promise(() => {});
      }
      return Promise.reject(new Error("unexpected"));
    });

    render(<DicomUpload />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByText("Loading patients…")).toBeInTheDocument();
    });
  });

  it("shows 'no patients' message when registry is empty", async () => {
    apiGetMock.mockImplementation((url: string) => {
      if (url === "/patients") {
        return Promise.resolve({ data: [] });
      }
      return Promise.reject(new Error("unexpected"));
    });

    render(<DicomUpload />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByText(/No patients match/)).toBeInTheDocument();
    });
  });

  it("handles drag over state", () => {
    render(<DicomUpload patientId="MRN-001" patientName="Test" />, { wrapper: createWrapper() });
    const dropZone = screen.getByText(/Click or drag DICOM/).closest("div")!;
    fireEvent.dragOver(dropZone, { preventDefault: () => {} });
  });

  it("does not show patient selector when patientId is bound", () => {
    render(
      <DicomUpload patientId="MRN-001" patientName="Test Patient" />,
      { wrapper: createWrapper() },
    );
    expect(screen.queryByText("Who is this study for?")).not.toBeInTheDocument();
  });
});
