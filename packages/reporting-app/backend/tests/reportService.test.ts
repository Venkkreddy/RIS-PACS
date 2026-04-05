import { ReportService } from "../src/services/reportService";

const baseReport = {
  id: "report-1",
  studyId: "study-1",
  content: "Initial",
  ownerId: "user-1",
  versions: [],
  attachments: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("ReportService", () => {
  it("appends immutable addendum entry", async () => {
    const storeMock: any = {
      createReport: jest.fn(),
      appendVersion: jest.fn().mockResolvedValue({
        ...baseReport,
        versions: [
          {
            id: "v1",
            type: "addendum",
            content: "Added finding",
            authorId: "user-1",
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    };

    const service = new ReportService(storeMock);
    const updated = await service.addAddendum("report-1", "Added finding", "user-1");

    expect(storeMock.appendVersion).toHaveBeenCalledTimes(1);
    expect(updated.versions[0].type).toBe("addendum");
    expect(updated.versions[0].content).toContain("Added finding");
  });
});
