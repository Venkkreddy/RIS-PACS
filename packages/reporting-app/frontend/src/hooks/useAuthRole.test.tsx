import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { Permission } from "@medical-report-system/shared";

const apiGetMock = vi.fn();
const apiPostMock = vi.fn();
const onAuthStateChangedMock = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    get: (...args: unknown[]) => apiGetMock(...args),
    post: (...args: unknown[]) => apiPostMock(...args),
  },
}));

vi.mock("../lib/firebase", () => ({
  firebaseAuth: null,
  firebaseConfigReady: false,
}));

vi.mock("firebase/auth", () => ({
  onAuthStateChanged: (...args: unknown[]) => onAuthStateChangedMock(...args),
}));

import { AuthProvider, useAuthRole } from "./useAuthRole";

function AuthStateProbe() {
  const auth = useAuthRole();
  return (
    <output
      data-testid="auth-state"
      data-loading={String(auth.loading)}
      data-authenticated={String(auth.isAuthenticated)}
      data-role={auth.role}
      data-permissions={String(auth.permissions.length)}
    />
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiGetMock.mockReset();
    apiPostMock.mockReset();
    onAuthStateChangedMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("falls back to role-based defaults when permissions request is slow", async () => {
    apiGetMock.mockImplementation((url: string) => {
      if (url === "/auth/me") {
        return Promise.resolve({
          data: {
            user: {
              id: "dev-radiologist",
              email: "radiologist@example.com",
              role: "radiologist",
              approved: true,
              requestStatus: "approved",
            },
          },
        });
      }
      if (url === "/permissions/my-permissions") {
        return new Promise(() => {
          // Never resolve to simulate a degraded/slow permissions service.
        });
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });

    render(
      <AuthProvider>
        <AuthStateProbe />
      </AuthProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5500);
    });

    expect(apiGetMock).toHaveBeenCalledWith("/auth/me");
    expect(apiGetMock).toHaveBeenCalledWith("/permissions/my-permissions");
    expect(screen.getByTestId("auth-state")).toHaveAttribute("data-authenticated", "true");
    expect(screen.getByTestId("auth-state")).toHaveAttribute("data-role", "radiologist");
    expect(screen.getByTestId("auth-state")).toHaveAttribute("data-loading", "false");
    expect(Number(screen.getByTestId("auth-state").getAttribute("data-permissions"))).toBeGreaterThan(0);
  });

  it("uses permissions when permission service responds in time", async () => {
    const permissions: Permission[] = ["worklist:view", "reports:view"];

    apiGetMock.mockImplementation((url: string) => {
      if (url === "/auth/me") {
        return Promise.resolve({
          data: {
            user: {
              id: "dev-radiographer",
              email: "radiographer@example.com",
              role: "radiographer",
              approved: true,
              requestStatus: "approved",
            },
          },
        });
      }
      if (url === "/permissions/my-permissions") {
        return Promise.resolve({
          data: {
            role: "radiographer",
            permissions,
          },
        });
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });

    render(
      <AuthProvider>
        <AuthStateProbe />
      </AuthProvider>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("auth-state")).toHaveAttribute("data-authenticated", "true");
    expect(screen.getByTestId("auth-state")).toHaveAttribute("data-role", "radiographer");
    expect(screen.getByTestId("auth-state")).toHaveAttribute("data-loading", "false");
    expect(screen.getByTestId("auth-state")).toHaveAttribute("data-permissions", String(permissions.length));
  });
});
