import { v4 as uuid } from "uuid";
import { Report, ReportSection, ReportStatus, CriticalPriority } from "@medical-report-system/shared";
import { StoreService } from "./store";

export class ReportService {
  constructor(private readonly store: StoreService) {}

  async createReport(payload: {
    studyId: string;
    templateId?: string;
    content: string;
    sections?: ReportSection[];
    status?: ReportStatus;
    priority?: CriticalPriority;
    ownerId: string;
    metadata?: Record<string, unknown>;
  }): Promise<Report> {
    return this.store.createReport({
      ...payload,
      status: payload.status ?? "draft",
    });
  }

  async addAddendum(reportId: string, addendum: string, authorId: string): Promise<Report> {
    return this.store.appendVersion(reportId, {
      id: uuid(),
      type: "addendum",
      content: addendum,
      authorId,
      createdAt: new Date().toISOString(),
    });
  }
}
