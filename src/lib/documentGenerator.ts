import PDFDocument from "pdfkit";
import { PDFDocument as PDFLib } from "pdf-lib";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  TableRow,
  TableCell,
  Table,
  WidthType,
  BorderStyle,
} from "docx";
import ExcelJS from "exceljs";
import PptxGenJS from "pptxgenjs";

export type DocType = "pdf" | "docx" | "xlsx" | "csv" | "pptx" | "md";
export type PdfTheme = "travel" | "business" | "academic" | "minimal";

export interface DocResult {
  buffer: Buffer;
  filename: string;
  type: DocType;
  mimeType: string;
  size_bytes: number;
  pages: number;
  target_pages?: number;
  fit_exact?: boolean;
  fit_passes?: { pass: number; action: string; pages: number }[];
}

export interface DocOptions {
  images?: boolean;
  accent_color?: string;
  theme?: PdfTheme;
  subtitle?: string;
  target_pages?: number;
  strict_pages?: boolean;
}

const MIME_TYPES: Record<DocType, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  md: "text/markdown",
};

// Theme color palettes
const THEME_COLORS: Record<PdfTheme, {
  primary: string;      // Main accent color
  secondary: string;    // Secondary accent
  coverBg: string;      // Cover page background
  coverBg2: string;     // Cover gradient end
  coverText: string;    // Cover text color
  h1Color: string;      // H1 heading color
  h2Color: string;      // H2 heading color
  h3Color: string;      // H3 heading color
  bodyColor: string;    // Body text color
  mutedColor: string;   // Muted/footer text
  tableHeader: string;  // Table header bg
  tableStripe: string;  // Table stripe bg
  tipBg: string;        // Tip/blockquote background
  tipBorder: string;    // Tip/blockquote border
  ruleColor: string;    // Horizontal rule color
}> = {
  travel: {
    primary: "#7c3aed",
    secondary: "#06b6d4",
    coverBg: "#1b0b36",
    coverBg2: "#7c3aed",
    coverText: "#ffffff",
    h1Color: "#7c3aed",
    h2Color: "#7c3aed",
    h3Color: "#6d28d9",
    bodyColor: "#1f2937",
    mutedColor: "#6b7280",
    tableHeader: "#7c3aed",
    tableStripe: "#f5f3ff",
    tipBg: "#f0fdf4",
    tipBorder: "#06b6d4",
    ruleColor: "#7c3aed",
  },
  business: {
    primary: "#1e40af",
    secondary: "#0369a1",
    coverBg: "#0f172a",
    coverBg2: "#1e40af",
    coverText: "#ffffff",
    h1Color: "#1e40af",
    h2Color: "#1e40af",
    h3Color: "#1e3a8a",
    bodyColor: "#1f2937",
    mutedColor: "#6b7280",
    tableHeader: "#1e40af",
    tableStripe: "#eff6ff",
    tipBg: "#f0f9ff",
    tipBorder: "#0369a1",
    ruleColor: "#1e40af",
  },
  academic: {
    primary: "#991b1b",
    secondary: "#92400e",
    coverBg: "#1c1917",
    coverBg2: "#991b1b",
    coverText: "#ffffff",
    h1Color: "#991b1b",
    h2Color: "#991b1b",
    h3Color: "#7f1d1d",
    bodyColor: "#1f2937",
    mutedColor: "#6b7280",
    tableHeader: "#991b1b",
    tableStripe: "#fef2f2",
    tipBg: "#fffbeb",
    tipBorder: "#92400e",
    ruleColor: "#991b1b",
  },
  minimal: {
    primary: "#7c3aed",
    secondary: "#8b5cf6",
    coverBg: "#1b0b36",
    coverBg2: "#7c3aed",
    coverText: "#ffffff",
    h1Color: "#7c3aed",
    h2Color: "#7c3aed",
    h3Color: "#6d28d9",
    bodyColor: "#1f2937",
    mutedColor: "#6b7280",
    tableHeader: "#7c3aed",
    tableStripe: "#f5f3ff",
    tipBg: "#faf5ff",
    tipBorder: "#7c3aed",
    ruleColor: "#7c3aed",
  },
};

function sanitizeTitle(title: string): string {
  return title
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function sanitizeDocTitle(title: string): string {
  // Remove "Page N:" prefixes
  let clean = title.replace(/^Page\s*\d+\s*[:\-–—]\s*/i, "");
  // Trim to ≤ 8 words
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length > 8) {
    clean = words.slice(0, 8).join(" ");
  }
  return clean.trim();
}

interface ParsedLine {
  type: "h1" | "h2" | "h3" | "bullet" | "numbered" | "table" | "paragraph" | "blockquote" | "hr";
  text: string;
  cells?: string[];
}

function parseMarkdown(content: string): ParsedLine[] {
  const lines = content.split("\n");
  const parsed: ParsedLine[] = [];

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === "") continue;

    if (line.trim() === "---" || line.trim() === "***" || line.trim() === "___") {
      parsed.push({ type: "hr", text: "" });
    } else if (line.startsWith("### ")) {
      parsed.push({ type: "h3", text: line.slice(4).trim() });
    } else if (line.startsWith("## ")) {
      parsed.push({ type: "h2", text: line.slice(3).trim() });
    } else if (line.startsWith("# ")) {
      parsed.push({ type: "h1", text: line.slice(2).trim() });
    } else if (/^\s*>\s/.test(line)) {
      parsed.push({ type: "blockquote", text: line.replace(/^\s*>\s*/, "").trim() });
    } else if (/^\s*[-*]\s/.test(line)) {
      parsed.push({ type: "bullet", text: line.replace(/^\s*[-*]\s/, "").trim() });
    } else if (/^\s*\d+\.\s/.test(line)) {
      parsed.push({
        type: "numbered",
        text: line.replace(/^\s*\d+\.\s/, "").trim(),
      });
    } else if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
      const trimmed = line.trim();
      // Skip separator rows like |---|---|
      if (/^\|[\s\-:|]+\|$/.test(trimmed)) continue;
      const cells = trimmed
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim());
      parsed.push({ type: "table", text: trimmed, cells });
    } else {
      parsed.push({ type: "paragraph", text: line.trim() });
    }
  }

  return parsed;
}

// Extract H1/H2 headings for Table of Contents
function extractTOC(parsed: ParsedLine[]): { level: number; text: string }[] {
  const toc: { level: number; text: string }[] = [];
  for (const line of parsed) {
    if (line.type === "h1") toc.push({ level: 1, text: line.text });
    else if (line.type === "h2") toc.push({ level: 2, text: line.text });
  }
  return toc;
}

function extractTables(
  parsed: ParsedLine[]
): { headers: string[]; rows: string[][] }[] {
  const tables: { headers: string[]; rows: string[][] }[] = [];
  let current: { headers: string[]; rows: string[][] } | null = null;

  for (let i = 0; i < parsed.length; i++) {
    const line = parsed[i];
    if (line.type === "table" && line.cells) {
      if (!current) {
        current = { headers: line.cells, rows: [] };
      } else {
        current.rows.push(line.cells);
      }
    } else {
      if (current) {
        tables.push(current);
        current = null;
      }
    }
  }
  if (current) tables.push(current);

  return tables;
}

// Strip markdown formatting from text (bold, italic, links, etc.)
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/~~(.+?)~~/g, "$1");
}

/**
 * Sanitize AI-generated markdown: strip conversational preamble,
 * image suggestions, export instructions, and trailing meta sections.
 */
function sanitizeContentMarkdown(content: string): string {
  let lines = content.split("\n");

  // Strip leading conversational preamble lines until the first heading or substantial content
  const preamblePattern = /^(okay|sure|certainly|here('s| is)|i will|i'll|let me|of course|absolutely|great|alright)\b/i;
  while (lines.length > 0) {
    const trimmed = lines[0].trim();
    if (trimmed === "") {
      lines.shift();
      continue;
    }
    if (preamblePattern.test(trimmed)) {
      lines.shift();
      continue;
    }
    break;
  }

  // Drop lines matching unwanted patterns
  const dropPattern = /image suggestion|how to create (the|this) pdf|copy and paste|you can then use this|you can use this|here's how to|use word|use canva|I cannot create|I can't create/i;
  lines = lines.filter((line) => !dropPattern.test(line));

  // Strip "Page N:" prefixes from headings
  lines = lines.map((line) => {
    return line.replace(/^(#+\s*)Page\s*\d+\s*[:\-–—]\s*/i, "$1");
  });

  // Drop trailing "How to create the PDF" or similar meta sections
  const trailingSectionPattern = /^#+\s*(how to (create|make|export)|next steps|instructions for)/i;
  const trailIdx = lines.findIndex((l) => trailingSectionPattern.test(l.trim()));
  if (trailIdx > 0) {
    lines = lines.slice(0, trailIdx);
  }

  return lines.join("\n").trim();
}

interface PdfTypography {
  bodyFontSize: number;
  h1FontSize: number;
  h2FontSize: number;
  h3FontSize: number;
  bodyLineGap: number;
  paragraphSpacing: number;
}

function computeTypography(targetPages?: number): PdfTypography {
  let bodyFontSize = 11, h1FontSize = 22, h2FontSize = 17, h3FontSize = 14;
  let bodyLineGap = 3, paragraphSpacing = 0.3;

  if (targetPages && targetPages <= 3) {
    bodyFontSize = 10; h1FontSize = 19; h2FontSize = 15; h3FontSize = 12.5;
    bodyLineGap = 2; paragraphSpacing = 0.2;
  } else if (targetPages && targetPages <= 5) {
    bodyFontSize = 10.5; h1FontSize = 20; h2FontSize = 16; h3FontSize = 13;
    bodyLineGap = 2.5; paragraphSpacing = 0.25;
  } else if (targetPages && targetPages >= 8) {
    bodyFontSize = 11.5; h1FontSize = 24; h2FontSize = 18; h3FontSize = 15;
    bodyLineGap = 4; paragraphSpacing = 0.4;
  }

  return { bodyFontSize, h1FontSize, h2FontSize, h3FontSize, bodyLineGap, paragraphSpacing };
}

async function generatePDF(
  title: string,
  content: string,
  options: DocOptions,
  typo?: PdfTypography
): Promise<{ buffer: Buffer; pages: number }> {
  return new Promise((resolve, reject) => {
    const theme = options.theme || "minimal";
    const colors = THEME_COLORS[theme];
    const subtitle = options.subtitle;
    const targetPages = options.target_pages;

    // Use provided typography overrides or compute from target page count
    const t = typo || computeTypography(options.target_pages);
    let bodyFontSize = t.bodyFontSize;
    let h1FontSize = t.h1FontSize;
    let h2FontSize = t.h2FontSize;
    let h3FontSize = t.h3FontSize;
    let bodyLineGap = t.bodyLineGap;
    let paragraphSpacing = t.paragraphSpacing;

    const skipTOC = targetPages != null && targetPages <= 5;

    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 55, bottom: 55, left: 50, right: 50 },
      bufferPages: true,
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);

    let pageCount = 1;
    doc.on("pageAdded", () => { pageCount++; });

    const pageWidth = doc.page.width;
    const contentWidth = pageWidth - 100; // 50px margins each side

    // ── Cover Page ──
    // Full-bleed gradient background
    const coverGrad = doc.linearGradient(0, 0, pageWidth, doc.page.height);
    coverGrad.stop(0, colors.coverBg);
    coverGrad.stop(1, colors.coverBg2);
    doc.rect(0, 0, pageWidth, doc.page.height).fill(coverGrad);

    // Decorative line at top
    doc.rect(0, 0, pageWidth, 4).fill(colors.secondary);

    // Title on cover
    const titleY = doc.page.height * 0.35;
    doc.fontSize(36).font("Helvetica-Bold").fillColor(colors.coverText);
    doc.text(title, 60, titleY, { width: pageWidth - 120, align: "left" });

    // Subtitle
    if (subtitle) {
      doc.moveDown(0.5);
      doc.fontSize(16).font("Helvetica").fillColor(colors.coverText).opacity(0.8);
      doc.text(subtitle, 60, doc.y, { width: pageWidth - 120 });
      doc.opacity(1);
    }

    // Date and branding
    doc.moveDown(1.5);
    doc.fontSize(12).font("Helvetica").fillColor(colors.coverText).opacity(0.6);
    doc.text(new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }), 60, doc.y, { width: pageWidth - 120 });
    doc.moveDown(0.3);
    doc.text("Generated by NiaAI", 60, doc.y, { width: pageWidth - 120 });
    doc.opacity(1);

    // Decorative bottom bar
    doc.rect(0, doc.page.height - 4, pageWidth, 4).fill(colors.secondary);

    // ── Table of Contents Page ──
    const parsed = parseMarkdown(content);
    const toc = extractTOC(parsed);

    // Estimate target page count: ~3000 chars per page + 1 cover page
    const estimatedPages = 1 + Math.ceil(content.length / 3000);
    const shouldGenerateTOC = !skipTOC && estimatedPages > 5 && toc.length >= 3;

    if (shouldGenerateTOC) {
      doc.addPage();

      doc.fontSize(24).font("Helvetica-Bold").fillColor(colors.h1Color);
      doc.text("Table of Contents", 50, 50);

      doc.moveDown(1);
      const tocY = doc.y;

      // Decorative line under TOC title
      doc.moveTo(50, tocY - 5).lineTo(200, tocY - 5).strokeColor(colors.primary).lineWidth(2).stroke();
      doc.moveDown(0.5);

      let tocNumber = 0;
      for (const entry of toc) {
        if (entry.level === 1) {
          tocNumber++;
          doc.fontSize(13).font("Helvetica-Bold").fillColor(colors.bodyColor);
          doc.text(`${tocNumber}.  ${entry.text}`, 50, doc.y, { continued: false });
          doc.moveDown(0.2);
        } else {
          doc.fontSize(11).font("Helvetica").fillColor(colors.mutedColor);
          doc.text(`      ${entry.text}`, 70, doc.y, { continued: false });
          doc.moveDown(0.15);
        }
      }
    }

    // ── Body Pages ──
    doc.addPage();
    let bulletIndex = 0;
    let inBlockquote = false;
    const blockquoteLines: string[] = [];
    let justStartedNewPage = true; // Track if we just added a new page (to avoid double page-adds)
    let isFirstH1AfterCoverTOC = true; // Track the first H1 after cover/TOC

    const flushBlockquote = () => {
      if (blockquoteLines.length === 0) return;
      const bqText = blockquoteLines.join("\n");
      const bqY = doc.y;
      const bqHeight = Math.max(40, blockquoteLines.length * 16 + 20);

      // Tip box background
      doc.rect(50, bqY, contentWidth, bqHeight)
        .fill(colors.tipBg);
      // Left border
      doc.rect(50, bqY, 3, bqHeight)
        .fill(colors.tipBorder);

      doc.fontSize(bodyFontSize).font("Helvetica-Oblique").fillColor(colors.mutedColor);
      doc.text(bqText, 62, bqY + 10, { width: contentWidth - 20 });
      doc.y = bqY + bqHeight + 8;
      blockquoteLines.length = 0;
      inBlockquote = false;
    };

    for (let i = 0; i < parsed.length; i++) {
      const line = parsed[i];

      // Flush blockquote if we hit a non-blockquote line
      if (line.type !== "blockquote" && inBlockquote) {
        flushBlockquote();
      }

      // Check if we need a new page (leave room for footer)
      if (doc.y > doc.page.height - 70) {
        if (inBlockquote) flushBlockquote();
        doc.addPage();
        justStartedNewPage = true;
      }

      switch (line.type) {
        case "h1":
          bulletIndex = 0;
          // H1 page break: only add a new page if there's actual content on the current page,
          // never for the first H1 after cover/TOC, and never if we just started a new page.
          if (!isFirstH1AfterCoverTOC && !justStartedNewPage && doc.y > 200 && i < parsed.length - 1) {
            doc.addPage();
            justStartedNewPage = true;
          }
          isFirstH1AfterCoverTOC = false;
          doc.moveDown(0.3);
          doc.fontSize(h1FontSize).font("Helvetica-Bold").fillColor(colors.h1Color);
          doc.text(stripMarkdown(line.text), 50, doc.y, { width: contentWidth });

          // Decorative underline
          doc.moveDown(0.3);
          doc.moveTo(50, doc.y).lineTo(50 + Math.min(contentWidth, 150), doc.y)
            .strokeColor(colors.ruleColor).lineWidth(2).stroke();
          doc.moveDown(0.5);
          justStartedNewPage = false;
          break;

        case "h2":
          bulletIndex = 0;
          doc.moveDown(0.7);
          doc.fontSize(h2FontSize).font("Helvetica-Bold").fillColor(colors.h2Color);
          doc.text(stripMarkdown(line.text), 50, doc.y, { width: contentWidth });
          doc.moveDown(0.4);
          break;

        case "h3":
          bulletIndex = 0;
          doc.moveDown(0.5);
          doc.fontSize(h3FontSize).font("Helvetica-Bold").fillColor(colors.h3Color);
          doc.text(stripMarkdown(line.text), 50, doc.y, { width: contentWidth });
          doc.moveDown(0.3);
          break;

        case "blockquote":
          inBlockquote = true;
          blockquoteLines.push(stripMarkdown(line.text));
          break;

        case "hr":
          bulletIndex = 0;
          doc.moveDown(0.5);
          doc.moveTo(50, doc.y).lineTo(pageWidth - 50, doc.y)
            .strokeColor(colors.ruleColor).lineWidth(0.5).opacity(0.3).stroke();
          doc.opacity(1);
          doc.moveDown(0.5);
          break;

        case "bullet":
          bulletIndex = 0;
          doc.fontSize(bodyFontSize).font("Helvetica").fillColor(colors.bodyColor);
          doc.text(`  \u2022  ${stripMarkdown(line.text)}`, 55, doc.y, { indent: 15, width: contentWidth - 15 });
          doc.moveDown(0.15);
          break;

        case "numbered":
          bulletIndex++;
          doc.fontSize(bodyFontSize).font("Helvetica").fillColor(colors.bodyColor);
          doc.text(`  ${bulletIndex}.  ${stripMarkdown(line.text)}`, 55, doc.y, { indent: 15, width: contentWidth - 15 });
          doc.moveDown(0.15);
          break;

        case "table": {
          // Collect consecutive table lines
          const tableLines: ParsedLine[] = [];
          let j = i;
          while (j < parsed.length && parsed[j].type === "table") {
            tableLines.push(parsed[j]);
            j++;
          }
          i = j - 1; // advance outer loop

          if (tableLines.length > 0 && tableLines[0].cells) {
            const colCount = tableLines[0].cells.length;
            const colWidth = contentWidth / colCount;
            const rowHeight = 24;

            for (let r = 0; r < tableLines.length; r++) {
              const cells = tableLines[r].cells || [];
              const yPos = doc.y;

              if (yPos + rowHeight > doc.page.height - 90) {
                doc.addPage();
              }

              const currentY = doc.y;

              // Row background
              if (r === 0) {
                doc.rect(50, currentY, contentWidth, rowHeight)
                  .fill(colors.tableHeader);
                doc.fillColor("#ffffff");
              } else if (r % 2 === 0) {
                doc.rect(50, currentY, contentWidth, rowHeight)
                  .fill(colors.tableStripe);
                doc.fillColor(colors.bodyColor);
              } else {
                doc.fillColor(colors.bodyColor);
              }

              // Cell text
              doc.fontSize(10).font(r === 0 ? "Helvetica-Bold" : "Helvetica");
              for (let c = 0; c < colCount; c++) {
                const cellText = stripMarkdown(cells[c] || "");
                doc.text(cellText, 50 + c * colWidth + 6, currentY + 6, {
                  width: colWidth - 12,
                  height: rowHeight,
                  lineBreak: false,
                });
              }

              // Grid lines
              doc.strokeColor("#d1d5db").lineWidth(0.5);
              doc.rect(50, currentY, contentWidth, rowHeight).stroke();
              for (let c = 1; c < colCount; c++) {
                doc.moveTo(50 + c * colWidth, currentY)
                  .lineTo(50 + c * colWidth, currentY + rowHeight).stroke();
              }

              doc.y = currentY + rowHeight;
            }
            doc.moveDown(0.5);
          }
          break;
        }

        case "paragraph":
        default:
          bulletIndex = 0;
          doc.fontSize(bodyFontSize).font("Helvetica").fillColor(colors.bodyColor);
          doc.text(stripMarkdown(line.text), 50, doc.y, { width: contentWidth, lineGap: bodyLineGap });
          doc.moveDown(paragraphSpacing);
          break;
      }

      // Any rendered content means we're no longer on a fresh page (h1 manages this itself)
      if (line.type !== "h1" && line.type !== "blockquote") {
        justStartedNewPage = false;
      }
    }

    // Flush any remaining blockquote
    if (inBlockquote) flushBlockquote();

    // ── Add headers & footers to all pages ──
    // CRITICAL: every doc.text() call MUST have lineBreak:false and a height
    // constraint, otherwise PDFKit advances doc.y past the page boundary and
    // silently appends blank pages.
    const totalPages = doc.bufferedPageRange().count;
    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(i);

      if (i === 0) continue; // Skip cover page

      doc.save();

      // Header: doc title (small, muted)
      doc.fontSize(8).font("Helvetica").fillColor(colors.mutedColor);
      doc.text(title, 50, 25, { width: contentWidth, align: "left", lineBreak: false, height: 12 });

      // Footer: "Generated by NiaAI" on left, "Page X of Y" on right
      const footerY = doc.page.height - 35;
      doc.fontSize(8).font("Helvetica").fillColor(colors.mutedColor);
      doc.text("Generated by NiaAI", 50, footerY, { width: contentWidth / 2, align: "left", lineBreak: false, height: 12 });
      doc.text(`Page ${i} of ${totalPages - 1}`, pageWidth / 2, footerY, { width: contentWidth / 2, align: "right", lineBreak: false, height: 12 });

      // Footer line
      doc.moveTo(50, footerY - 5).lineTo(pageWidth - 50, footerY - 5)
        .strokeColor(colors.ruleColor).lineWidth(0.3).opacity(0.2).stroke();
      doc.opacity(1);

      doc.restore();
    }

    doc.on("end", async () => {
      try {
        const buffer = Buffer.concat(chunks);

        // Use pdf-lib to get the REAL page count from the rendered PDF
        const pdfDoc = await PDFLib.load(buffer);
        const realPageCount = pdfDoc.getPageCount();

        // Blank page guard: check each page (except cover) for content
        const pages = pdfDoc.getPages();
        const blankPages: number[] = [];
        for (let p = 1; p < pages.length; p++) {
          const page = pages[p];
          // A page with no content ops beyond the header/footer is suspicious
          // Check if the page has meaningful content by examining its content stream size
          const { width, height } = page.getSize();
          if (width === 0 || height === 0) {
            blankPages.push(p + 1);
          }
        }

        if (blankPages.length > 0) {
          console.log(`[pdf-guard] Potentially blank pages detected: [${blankPages.join(",")}] in ${realPageCount}-page PDF`);
        }

        console.log(`[pdf-gen] rendered ${realPageCount} pages (PDFKit reported ${totalPages}), ${buffer.length} bytes`);

        resolve({ buffer, pages: realPageCount });
      } catch (err) {
        // If pdf-lib fails, fall back to PDFKit's count
        const buffer = Buffer.concat(chunks);
        console.log(`[pdf-gen] pdf-lib verification failed, using PDFKit count: ${totalPages} pages, ${buffer.length} bytes`);
        resolve({ buffer, pages: totalPages });
      }
    });

    // Ensure body has no extra margin that could cause phantom pages
    doc.end();
  });
}

async function generateDOCX(
  title: string,
  content: string,
  _options: DocOptions
): Promise<{ buffer: Buffer; pages: number }> {
  const parsed = parseMarkdown(content);
  const children: Paragraph[] = [];

  // Title page
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: title, bold: true, size: 48, font: "Helvetica" }),
      ],
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    })
  );
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: "Generated by NiaAI",
          size: 28,
          color: "666666",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
    })
  );
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: new Date().toLocaleDateString(),
          size: 24,
          color: "999999",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    })
  );

  for (let i = 0; i < parsed.length; i++) {
    const line = parsed[i];

    switch (line.type) {
      case "h1":
        children.push(
          new Paragraph({
            children: [new TextRun({ text: stripMarkdown(line.text), bold: true })],
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 240, after: 120 },
          })
        );
        break;

      case "h2":
        children.push(
          new Paragraph({
            children: [new TextRun({ text: stripMarkdown(line.text), bold: true })],
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 100 },
          })
        );
        break;

      case "h3":
        children.push(
          new Paragraph({
            children: [new TextRun({ text: stripMarkdown(line.text), bold: true })],
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 160, after: 80 },
          })
        );
        break;

      case "bullet":
        children.push(
          new Paragraph({
            children: [new TextRun({ text: stripMarkdown(line.text) })],
            bullet: { level: 0 },
            spacing: { after: 40 },
          })
        );
        break;

      case "numbered":
        children.push(
          new Paragraph({
            children: [new TextRun({ text: stripMarkdown(line.text) })],
            numbering: { reference: "default-numbering", level: 0 },
            spacing: { after: 40 },
          })
        );
        break;

      case "blockquote":
        children.push(
          new Paragraph({
            children: [new TextRun({ text: stripMarkdown(line.text), italics: true, color: "6b7280" })],
            indent: { left: 360 },
            spacing: { after: 40 },
          })
        );
        break;

      case "table": {
        // Collect consecutive table lines
        const tableLines: ParsedLine[] = [];
        let j = i;
        while (j < parsed.length && parsed[j].type === "table") {
          tableLines.push(parsed[j]);
          j++;
        }
        i = j - 1;

        if (tableLines.length > 0) {
          const borderStyle = {
            style: BorderStyle.SINGLE,
            size: 1,
            color: "cccccc",
          };
          const borders = {
            top: borderStyle,
            bottom: borderStyle,
            left: borderStyle,
            right: borderStyle,
          };

          const rows = tableLines.map(
            (tl, rowIdx) =>
              new TableRow({
                children: (tl.cells || []).map(
                  (cell) =>
                    new TableCell({
                      children: [
                        new Paragraph({
                          children: [
                            new TextRun({
                              text: stripMarkdown(cell),
                              bold: rowIdx === 0,
                            }),
                          ],
                        }),
                      ],
                      borders,
                      width: { size: 100 / (tl.cells?.length || 1), type: WidthType.PERCENTAGE },
                    })
                ),
              })
          );

          children.push(
            new Paragraph({ spacing: { before: 100 } })
          );
          const table = new Table({
            rows,
            width: { size: 100, type: WidthType.PERCENTAGE },
          });
          children.push(table as unknown as Paragraph);
          children.push(
            new Paragraph({ spacing: { after: 100 } })
          );
        }
        break;
      }

      case "hr":
        children.push(
          new Paragraph({
            spacing: { before: 100, after: 100 },
          })
        );
        break;

      case "paragraph":
      default:
        children.push(
          new Paragraph({
            children: [new TextRun({ text: stripMarkdown(line.text) })],
            spacing: { after: 80 },
          })
        );
        break;
    }
  }

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "default-numbering",
          levels: [
            {
              level: 0,
              format: "decimal" as const,
              text: "%1.",
              alignment: AlignmentType.LEFT,
            },
          ],
        },
      ],
    },
    sections: [
      {
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const pages = Math.max(1, Math.ceil(content.length / 3000));

  return { buffer: Buffer.from(buffer), pages };
}

async function generateXLSX(
  title: string,
  content: string,
  options: DocOptions
): Promise<{ buffer: Buffer; pages: number }> {
  const accent = options.accent_color || "#7c3aed";
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(title.slice(0, 31));

  const parsed = parseMarkdown(content);
  const tables = extractTables(parsed);

  if (tables.length > 0) {
    let rowOffset = 1;
    for (const table of tables) {
      const headerRow = worksheet.getRow(rowOffset);
      table.headers.forEach((h, colIdx) => {
        const cell = headerRow.getCell(colIdx + 1);
        cell.value = h;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF" + accent.replace("#", "") },
        };
        cell.alignment = { horizontal: "center" };
      });
      headerRow.commit();
      rowOffset++;

      for (const row of table.rows) {
        const dataRow = worksheet.getRow(rowOffset);
        row.forEach((val, colIdx) => {
          dataRow.getCell(colIdx + 1).value = val;
        });
        dataRow.commit();
        rowOffset++;
      }
      rowOffset++;
    }

    worksheet.columns.forEach((col) => {
      let maxLen = 10;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const len = String(cell.value || "").length;
        if (len > maxLen) maxLen = len;
      });
      col.width = Math.min(maxLen + 2, 50);
    });
  } else {
    const headerRow = worksheet.getRow(1);
    const headerCell = headerRow.getCell(1);
    headerCell.value = title;
    headerCell.font = { bold: true, size: 14 };
    headerRow.commit();

    const contentRow = worksheet.getRow(2);
    const contentCell = contentRow.getCell(1);
    contentCell.value = content;
    contentCell.alignment = { wrapText: true, vertical: "top" };
    contentRow.commit();

    worksheet.getColumn(1).width = 80;
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return { buffer, pages: 1 };
}

async function generatePPTX(
  title: string,
  content: string,
  options: DocOptions
): Promise<{ buffer: Buffer; pages: number }> {
  const accent = options.accent_color || "#7c3aed";
  const pptx = new PptxGenJS();

  // Title slide
  const titleSlide = pptx.addSlide();
  titleSlide.addText(title, {
    x: 0.5,
    y: 1.5,
    w: 9,
    h: 1.5,
    fontSize: 36,
    bold: true,
    color: accent.replace("#", ""),
    align: "center",
    valign: "middle",
  });
  titleSlide.addText("Generated by NiaAI", {
    x: 0.5,
    y: 3.2,
    w: 9,
    h: 0.6,
    fontSize: 18,
    color: "666666",
    align: "center",
  });
  titleSlide.addText(new Date().toLocaleDateString(), {
    x: 0.5,
    y: 3.8,
    w: 9,
    h: 0.5,
    fontSize: 14,
    color: "999999",
    align: "center",
  });

  // Parse into sections by H2
  const parsed = parseMarkdown(content);
  let currentSection: { title: string; bullets: string[] } | null = null;
  const sections: { title: string; bullets: string[] }[] = [];

  for (const line of parsed) {
    if (line.type === "h2") {
      if (currentSection) sections.push(currentSection);
      currentSection = { title: line.text, bullets: [] };
    } else if (currentSection) {
      if (
        line.type === "bullet" ||
        line.type === "numbered" ||
        line.type === "paragraph"
      ) {
        currentSection.bullets.push(stripMarkdown(line.text));
      }
    } else {
      if (
        line.type === "bullet" ||
        line.type === "numbered" ||
        line.type === "paragraph" ||
        line.type === "h1" ||
        line.type === "h3"
      ) {
        if (!currentSection) {
          currentSection = { title: line.type === "h1" || line.type === "h3" ? line.text : "Overview", bullets: [] };
          if (line.type !== "h1" && line.type !== "h3") {
            currentSection.bullets.push(stripMarkdown(line.text));
          }
        }
      }
    }
  }
  if (currentSection) sections.push(currentSection);

  // Create slides from sections
  for (const section of sections) {
    const slide = pptx.addSlide();
    slide.addText(section.title, {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.8,
      fontSize: 28,
      bold: true,
      color: accent.replace("#", ""),
    });

    if (section.bullets.length > 0) {
      const bulletItems = section.bullets.map((b) => ({
        text: b,
        options: {
          fontSize: 16,
          color: "333333" as const,
          bullet: { code: "2022" } as const,
          breakLine: true as const,
        },
      }));
      slide.addText(bulletItems, {
        x: 0.8,
        y: 1.3,
        w: 8.4,
        h: 3.8,
        valign: "top" as const,
        lineSpacingMultiple: 1.3,
      });
    }
  }

  const slideCount = 1 + sections.length;

  const output = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  const buffer = Buffer.isBuffer(output) ? output : Buffer.from(output as ArrayBuffer);

  return { buffer, pages: slideCount };
}

function generateCSV(
  _title: string,
  content: string
): { buffer: Buffer; pages: number } {
  const parsed = parseMarkdown(content);
  const tables = extractTables(parsed);

  let csvContent: string;

  if (tables.length > 0) {
    const lines: string[] = [];
    for (const table of tables) {
      lines.push(table.headers.map((h) => escapeCsvField(h)).join(","));
      for (const row of table.rows) {
        lines.push(row.map((cell) => escapeCsvField(cell)).join(","));
      }
      lines.push("");
    }
    csvContent = lines.join("\n");
  } else {
    const lines = content.split("\n").filter((l) => l.trim() !== "");
    csvContent = "Content\n" + lines.map((l) => escapeCsvField(l)).join("\n");
  }

  const buffer = Buffer.from(csvContent, "utf-8");
  return { buffer, pages: 1 };
}

function escapeCsvField(field: string): string {
  if (field.includes(",") || field.includes('"') || field.includes("\n")) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

function generateMD(
  content: string
): { buffer: Buffer; pages: number } {
  const buffer = Buffer.from(content, "utf-8");
  const pages = Math.max(1, Math.ceil(content.length / 3000));
  return { buffer, pages };
}

export async function generateDocument(
  type: DocType,
  title: string,
  content_markdown: string,
  options?: DocOptions
): Promise<DocResult> {
  const opts: DocOptions = options || {};
  const sanitized = sanitizeTitle(title);
  const ext = type;
  const displayTitle = title.replace(/\s+/g, "-");
  const filename = sanitized ? `${sanitized}.${ext}` : `${displayTitle}.${ext}`;
  const mimeType = MIME_TYPES[type];

  // Sanitize AI content before rendering any document
  const cleanContent = sanitizeContentMarkdown(content_markdown);

  // Sanitize the title: strip "Page N:" prefix, limit to 8 words
  const cleanTitle = sanitizeDocTitle(title);

  let buffer: Buffer;
  let pages: number;

  switch (type) {
    case "pdf": {
      let typo = computeTypography(opts.target_pages);
      let result = await generatePDF(cleanTitle, cleanContent, opts, typo);
      buffer = result.buffer;
      pages = result.pages;

      // Fit loop: adjust typography to hit target page count
      if (opts.target_pages && pages !== opts.target_pages) {
        const target = opts.target_pages;
        const strict = opts.strict_pages ?? false;
        const fitPasses: { pass: number; action: string; pages: number }[] = [];

        for (let pass = 1; pass <= 4 && pages !== target; pass++) {
          let action = "";

          if (pages > target) {
            // Too many pages — shrink
            switch (pass) {
              case 1:
                typo = { ...typo, bodyFontSize: 10.5, bodyLineGap: 2, paragraphSpacing: 0.2 };
                if (typo.bodyFontSize > 10.5) typo.bodyFontSize = 10.5;
                typo.bodyLineGap = Math.min(typo.bodyLineGap, 2);
                typo.paragraphSpacing = Math.min(typo.paragraphSpacing, 0.2);
                action = "shrink-fonts-10.5pt";
                break;
              case 2:
                typo = { ...typo, bodyFontSize: 10, h1FontSize: 18, h2FontSize: 15, h3FontSize: 12, bodyLineGap: 1.5, paragraphSpacing: 0.15 };
                action = "shrink-fonts-10pt+spacing";
                break;
              case 3:
                typo = { ...typo, bodyFontSize: 9.5 };
                action = "shrink-9.5pt+margins";
                break;
              case 4:
                typo = { ...typo, bodyFontSize: 9, bodyLineGap: 1, paragraphSpacing: 0.1 };
                action = "max-shrink-9pt";
                break;
            }
          } else {
            // Too few pages — expand
            switch (pass) {
              case 1:
                typo = { ...typo, bodyFontSize: 11.5, bodyLineGap: 4, paragraphSpacing: 0.4 };
                action = "expand-fonts-11.5pt";
                break;
              case 2:
                typo = { ...typo, bodyFontSize: 12, h1FontSize: 24, h2FontSize: 19, h3FontSize: 16, bodyLineGap: 5, paragraphSpacing: 0.5 };
                action = "expand-fonts-12pt+spacing";
                break;
              case 3:
                typo = { ...typo, bodyFontSize: 12.5, bodyLineGap: 6, paragraphSpacing: 0.6 };
                action = "expand-12.5pt+margins";
                break;
              case 4:
                typo = { ...typo, bodyFontSize: 13, bodyLineGap: 7, paragraphSpacing: 0.7 };
                action = "max-expand-13pt";
                break;
            }
          }

          result = await generatePDF(cleanTitle, cleanContent, opts, typo);
          buffer = result.buffer;
          pages = result.pages;
          fitPasses.push({ pass, action, pages });

          console.log(`[pdf-fit] pass ${pass}: ${action} → ${pages} pages (target: ${target})`);
        }

        console.log(`[pdf-fit] ${JSON.stringify({ target, strict, passes: fitPasses, final_pages: pages })}`);

        // Store fit info in result
        (result as any).__fitPasses = fitPasses;
        (result as any).__fitExact = pages === target;
      }

      break;
    }
    case "docx": {
      const result = await generateDOCX(cleanTitle, cleanContent, opts);
      buffer = result.buffer;
      pages = result.pages;
      break;
    }
    case "xlsx": {
      const result = await generateXLSX(title, cleanContent, opts);
      buffer = result.buffer;
      pages = result.pages;
      break;
    }
    case "pptx": {
      const result = await generatePPTX(cleanTitle, cleanContent, opts);
      buffer = result.buffer;
      pages = result.pages;
      break;
    }
    case "csv": {
      const result = generateCSV(title, cleanContent);
      buffer = result.buffer;
      pages = result.pages;
      break;
    }
    case "md": {
      const result = generateMD(cleanContent);
      buffer = result.buffer;
      pages = result.pages;
      break;
    }
    default:
      throw new Error(`Unsupported document type: ${type}`);
  }

  // Include fit info if available
  let target_pages_result: number | undefined;
  let fit_exact: boolean | undefined;
  let fit_passes: { pass: number; action: string; pages: number }[] | undefined;

  if (opts.target_pages) {
    target_pages_result = opts.target_pages;
    fit_exact = pages === opts.target_pages;
  }

  return {
    buffer,
    filename,
    type,
    mimeType,
    size_bytes: buffer.length,
    pages,
    target_pages: target_pages_result,
    fit_exact,
    fit_passes,
  };
}
