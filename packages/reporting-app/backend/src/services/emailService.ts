import sendgrid from "@sendgrid/mail";
import { env } from "../config/env";

export class EmailService {
  constructor() {
    if (env.SENDGRID_API_KEY) sendgrid.setApiKey(env.SENDGRID_API_KEY);
  }

  async sendReportShareEmail(to: string, pdf: Buffer, reportId: string): Promise<void> {
    if (!env.SENDGRID_API_KEY) throw new Error("SENDGRID_API_KEY not configured");

    await sendgrid.send({
      to,
      from: env.SENDGRID_FROM_EMAIL,
      subject: `Radiology report ${reportId}`,
      text: "Please find attached the radiology report.",
      attachments: [
        {
          content: pdf.toString("base64"),
          filename: `report-${reportId}.pdf`,
          type: "application/pdf",
          disposition: "attachment",
        },
      ],
    });
  }

  async sendInviteEmail(to: string, role: string, token: string): Promise<void> {
    if (!env.SENDGRID_API_KEY) throw new Error("SENDGRID_API_KEY not configured");

    const signupUrl = `${env.FRONTEND_URL}/signup?token=${encodeURIComponent(token)}&role=${encodeURIComponent(role)}`;
    await sendgrid.send({
      to,
      from: env.SENDGRID_FROM_EMAIL,
      subject: `Join tdairad.com as ${role}`,
      text: `You have been invited to join tdairad.com as ${role}. Click to sign up: ${signupUrl}`,
      html: `<p>You have been invited to join <strong>tdairad.com</strong> as <strong>${role}</strong>.</p>
<p><a href="${signupUrl}">Click here to sign up</a></p>`,
    });
  }

  async sendTatReminderEmail(to: string, studyId: string): Promise<void> {
    if (!env.SENDGRID_API_KEY) throw new Error("SENDGRID_API_KEY not configured");

    await sendgrid.send({
      to,
      from: env.SENDGRID_FROM_EMAIL,
      subject: `Reminder: pending report for study ${studyId}`,
      text: `This is a reminder that study ${studyId} is pending reporting.`,
    });
  }
}
