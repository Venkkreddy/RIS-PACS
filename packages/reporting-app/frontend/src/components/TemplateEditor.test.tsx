import { fireEvent, render, screen } from "@testing-library/react";
import { TemplateEditor } from "./TemplateEditor";
import { vi } from "vitest";

vi.mock("../api/client", () => ({
  api: {
    post: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

describe("TemplateEditor", () => {
  it("submits template payload", async () => {
    render(<TemplateEditor />);

    fireEvent.change(screen.getByPlaceholderText("e.g. Chest X-Ray Normal"), {
      target: { value: "CT Brain" },
    });

    fireEvent.click(screen.getByText("Save Template"));

    expect(await screen.findByText("Template saved.")).toBeInTheDocument();
  });
});
