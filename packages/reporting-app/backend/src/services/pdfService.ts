import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from "pdf-lib";
import { Report } from "@medical-report-system/shared";

const MARGIN_LEFT = 50;
const MARGIN_RIGHT = 50;
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

const COLOR = {
  primary: rgb(0.12, 0.24, 0.42),
  accent: rgb(0.15, 0.45, 0.7),
  text: rgb(0.15, 0.15, 0.15),
  muted: rgb(0.45, 0.45, 0.45),
  danger: rgb(0.8, 0.15, 0.15),
  success: rgb(0.1, 0.55, 0.2),
  warning: rgb(0.85, 0.55, 0.05),
  line: rgb(0.8, 0.83, 0.87),
  white: rgb(1, 1, 1),
  headerBg: rgb(0.12, 0.24, 0.42),
} as const;

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "  \u2022 ")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }
    const words = paragraph.split(/\s+/);
    let currentLine = "";
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const width = font.widthOfTextAtSize(testLine, fontSize);
      if (width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);
  }
  return lines;
}

export class PdfService {
  async buildReportPdf(report: Report): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const helveticaOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

    let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let y = PAGE_HEIGHT;

    const newPage = (): PDFPage => {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - 40;
      drawFooter(page, helvetica, pdfDoc.getPageCount());
      return page;
    };

    const ensureSpace = (needed: number) => {
      if (y - needed < 60) newPage();
    };

    // ── Header ───────────────────────────────────
    page.drawRectangle({
      x: 0, y: PAGE_HEIGHT - 80, width: PAGE_WIDTH, height: 80,
      color: COLOR.headerBg,
    });

    page.drawText("TD|ai Radiology", {
      x: MARGIN_LEFT, y: PAGE_HEIGHT - 35, size: 20,
      font: helveticaBold, color: COLOR.white,
    });
    page.drawText("Diagnostic Report", {
      x: MARGIN_LEFT, y: PAGE_HEIGHT - 55, size: 11,
      font: helvetica, color: rgb(0.7, 0.8, 0.95),
    });

    const statusLabel = (report.status ?? "draft").toUpperCase();
    const statusColor =
      report.status === "final" ? COLOR.success :
      report.status === "preliminary" ? COLOR.warning :
      report.status === "amended" ? COLOR.accent :
      COLOR.muted;
    const statusWidth = helveticaBold.widthOfTextAtSize(statusLabel, 10) + 16;
    page.drawRectangle({
      x: PAGE_WIDTH - MARGIN_RIGHT - statusWidth - 4,
      y: PAGE_HEIGHT - 42,
      width: statusWidth + 8,
      height: 20,
      color: statusColor,
      borderColor: statusColor,
      borderWidth: 1,
    });
    page.drawText(statusLabel, {
      x: PAGE_WIDTH - MARGIN_RIGHT - statusWidth,
      y: PAGE_HEIGHT - 37,
      size: 10, font: helveticaBold, color: COLOR.white,
    });

    if (report.priority === "critical") {
      page.drawText("CRITICAL", {
        x: PAGE_WIDTH - MARGIN_RIGHT - statusWidth - 70,
        y: PAGE_HEIGHT - 37,
        size: 10, font: helveticaBold, color: COLOR.danger,
      });
    }

    y = PAGE_HEIGHT - 100;

    // ── Patient / Study Info ─────────────────────
    const infoLeft = [
      { label: "Study ID", value: report.studyId },
      { label: "Report ID", value: report.id },
      { label: "Created", value: formatDate(report.createdAt) },
    ];

    const infoRight = [
      { label: "Status", value: statusLabel },
      { label: "Priority", value: (report.priority ?? "routine").toUpperCase() },
      ...(report.signedAt ? [{ label: "Signed", value: formatDate(report.signedAt) }] : []),
    ];

    for (let i = 0; i < Math.max(infoLeft.length, infoRight.length); i++) {
      const left = infoLeft[i];
      const right = infoRight[i];
      if (left) {
        page.drawText(`${left.label}:`, { x: MARGIN_LEFT, y, size: 8, font: helveticaBold, color: COLOR.muted });
        page.drawText(left.value, { x: MARGIN_LEFT + 65, y, size: 9, font: helvetica, color: COLOR.text });
      }
      if (right) {
        page.drawText(`${right.label}:`, { x: 330, y, size: 8, font: helveticaBold, color: COLOR.muted });
        page.drawText(right.value, { x: 395, y, size: 9, font: helvetica, color: COLOR.text });
      }
      y -= 14;
    }

    y -= 6;
    page.drawLine({ start: { x: MARGIN_LEFT, y }, end: { x: PAGE_WIDTH - MARGIN_RIGHT, y }, thickness: 0.5, color: COLOR.line });
    y -= 16;

    // ── Structured Sections ──────────────────────
    if (report.sections && report.sections.length > 0) {
      for (const section of report.sections) {
        const plainText = stripHtml(section.content);
        if (!plainText.trim()) continue;

        ensureSpace(40);

        page.drawText(section.title.toUpperCase(), {
          x: MARGIN_LEFT, y, size: 10,
          font: helveticaBold, color: COLOR.accent,
        });
        y -= 3;
        page.drawLine({
          start: { x: MARGIN_LEFT, y },
          end: { x: MARGIN_LEFT + helveticaBold.widthOfTextAtSize(section.title.toUpperCase(), 10), y },
          thickness: 1.5, color: COLOR.accent,
        });
        y -= 14;

        const lines = wrapText(plainText, helvetica, 10, CONTENT_WIDTH);
        for (const line of lines) {
          ensureSpace(14);
          if (!line.trim()) { y -= 6; continue; }

          const isBullet = line.trimStart().startsWith("\u2022");
          page.drawText(line, {
            x: isBullet ? MARGIN_LEFT + 10 : MARGIN_LEFT,
            y, size: 10,
            font: helvetica, color: COLOR.text,
          });
          y -= 14;
        }
        y -= 8;
      }
    } else {
      const plainContent = stripHtml(report.content);
      if (plainContent.trim()) {
        const lines = wrapText(plainContent, helvetica, 10, CONTENT_WIDTH);
        for (const line of lines) {
          ensureSpace(14);
          if (!line.trim()) { y -= 6; continue; }
          page.drawText(line, { x: MARGIN_LEFT, y, size: 10, font: helvetica, color: COLOR.text });
          y -= 14;
        }
      }
    }

    // ── AI Findings Section ──────────────────────
    const aiFindings = (report.metadata?.aiFindings as Array<{ label: string; confidence: number; description: string }>) ?? [];
    if (aiFindings.length > 0) {
      y -= 10;
      ensureSpace(50);
      page.drawRectangle({
        x: MARGIN_LEFT - 5, y: y - 4, width: CONTENT_WIDTH + 10, height: 20,
        color: rgb(0.93, 0.95, 1),
      });
      page.drawText("AI ANALYSIS FINDINGS", {
        x: MARGIN_LEFT, y, size: 10,
        font: helveticaBold, color: COLOR.accent,
      });
      y -= 20;

      for (const finding of aiFindings.slice(0, 10)) {
        ensureSpace(30);
        const conf = Math.round((finding.confidence ?? 0) * 100);
        const confColor = conf >= 75 ? COLOR.danger : conf >= 50 ? COLOR.warning : COLOR.muted;

        page.drawText(`\u2022 ${finding.label}`, {
          x: MARGIN_LEFT + 5, y, size: 9, font: helveticaBold, color: COLOR.text,
        });
        page.drawText(`${conf}%`, {
          x: MARGIN_LEFT + 200, y, size: 9, font: helveticaBold, color: confColor,
        });
        y -= 12;

        if (finding.description) {
          const descLines = wrapText(finding.description, helveticaOblique, 8, CONTENT_WIDTH - 20);
          for (const dl of descLines.slice(0, 2)) {
            ensureSpace(12);
            page.drawText(dl, { x: MARGIN_LEFT + 15, y, size: 8, font: helveticaOblique, color: COLOR.muted });
            y -= 11;
          }
        }
        y -= 4;
      }
    }

    // ── Version History ──────────────────────────
    if (report.versions.length > 1) {
      y -= 12;
      ensureSpace(40);
      page.drawText("VERSION HISTORY", {
        x: MARGIN_LEFT, y, size: 9,
        font: helveticaBold, color: COLOR.muted,
      });
      y -= 14;

      for (const version of report.versions.slice(-8)) {
        ensureSpace(14);
        const label = `${formatDate(version.createdAt)} — ${version.type}`;
        page.drawText(label, {
          x: MARGIN_LEFT + 5, y, size: 7,
          font: helvetica, color: COLOR.muted,
        });
        y -= 10;
      }
    }

    // ── Signature Block ──────────────────────────
    if (report.status === "final" && report.signedBy) {
      y -= 20;
      ensureSpace(50);
      page.drawLine({ start: { x: MARGIN_LEFT, y }, end: { x: PAGE_WIDTH - MARGIN_RIGHT, y }, thickness: 0.5, color: COLOR.line });
      y -= 20;
      page.drawText("Electronically Signed", {
        x: MARGIN_LEFT, y, size: 10, font: helveticaBold, color: COLOR.primary,
      });
      y -= 14;
      page.drawText(`Signed by: ${report.signedBy}`, {
        x: MARGIN_LEFT, y, size: 9, font: helvetica, color: COLOR.text,
      });
      y -= 12;
      page.drawText(`Date: ${formatDate(report.signedAt!)}`, {
        x: MARGIN_LEFT, y, size: 9, font: helvetica, color: COLOR.text,
      });
    }

    drawFooter(page, helvetica, pdfDoc.getPageCount());

    const bytes = await pdfDoc.save();
    return Buffer.from(bytes);
  }
}

function drawFooter(page: PDFPage, font: PDFFont, pageNum: number) {
  page.drawLine({
    start: { x: MARGIN_LEFT, y: 40 },
    end: { x: PAGE_WIDTH - MARGIN_RIGHT, y: 40 },
    thickness: 0.5, color: COLOR.line,
  });
  page.drawText("TD|ai Radiology Platform — Confidential Medical Document", {
    x: MARGIN_LEFT, y: 26, size: 7, font, color: COLOR.muted,
  });
  page.drawText(`Page ${pageNum}`, {
    x: PAGE_WIDTH - MARGIN_RIGHT - 40, y: 26, size: 7, font, color: COLOR.muted,
  });
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
