/**
 * Universal file extraction pipeline.
 * Shared by web uploads and Slack attachment path.
 *
 * extractFile(buffer, name, mimetype) → { text, kind, meta, method, truncated }
 */

// ── Result shape ──────────────────────────────────────────────────────────────

export interface ExtractionResult {
  text: string;
  kind: string; // "pdf" | "image" | "docx" | "doc" | "pptx" | "xlsx" | "csv" | "text" | "code" | "html" | "json" | "xml" | "epub" | "zip" | "audio" | "video" | "unknown"
  meta: Record<string, unknown>; // pages, sheets, slides, rows, etc.
  method: string; // "pdf-parse" | "tesseract-ocr" | "mammoth" | "plaintext" | "exceljs" | "pptx-xml" | "jszip" | "vision" | "ffmpeg-whisper" | "utf8-fallback"
  truncated: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_INLINE_CHARS = 30_000;
const MAX_EXTRACT_CHARS = 60_000;

const CODE_EXTENSIONS = new Set([
  "py", "js", "ts", "tsx", "jsx", "java", "go", "rs", "c", "cpp", "cc", "cxx",
  "h", "hpp", "cs", "rb", "php", "sql", "sh", "bash", "zsh", "ps1", "psm1",
  "swift", "kt", "kts", "scala", "r", "m", "mm", "pl", "pm", "lua", "zig",
  "dart", "ex", "exs", "erl", "hrl", "hs", "lhs", "ml", "mli", "fs", "fsx",
  "v", "sv", "vhd", "vhdl", "makefile", "cmake", "gradle", "groovy",
  "dockerfile", "tf", "hcl", "proto", "graphql", "gql", "vue", "svelte",
]);

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "rst", "rtf", "log", "ini", "toml", "env",
  "cfg", "conf", "properties", "gitignore", "gitattributes", "editorconfig",
  "prettierrc", "eslintrc", "babelrc",
]);

const LANG_MAP: Record<string, string> = {
  py: "python", js: "javascript", ts: "typescript", tsx: "tsx", jsx: "jsx",
  java: "java", go: "go", rs: "rust", c: "c", cpp: "cpp", cs: "csharp",
  rb: "ruby", php: "php", sql: "sql", sh: "bash", swift: "swift",
  kt: "kotlin", scala: "scala", r: "r", lua: "lua", dart: "dart",
  ex: "elixir", hs: "haskell", ml: "ocaml", fs: "fsharp", vue: "vue",
  svelte: "svelte", graphql: "graphql", proto: "protobuf", tf: "hcl",
};

// Supported formats list (for the fallback error message)
export const SUPPORTED_FORMATS = [
  "PDF", "Images (PNG/JPG/WebP/GIF)", "Word (.docx)", "PowerPoint (.pptx)",
  "Excel/CSV/TSV (.xlsx/.xls/.csv/.tsv)", "Text/Markdown", "Code files",
  "JSON/YAML/XML/HTML", "EPUB", "ZIP archives",
].join(", ");

// ── Helpers ───────────────────────────────────────────────────────────────────

function ext(name: string): string {
  const base = name.split("/").pop() || name;
  const dot = base.lastIndexOf(".");
  if (dot < 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

function truncate(text: string, max = MAX_EXTRACT_CHARS): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const keep = Math.floor(max * 0.83);
  const tail = max - keep;
  return {
    text: text.slice(0, keep) + "\n\n[… truncated …]\n\n" + text.slice(-tail),
    truncated: true,
  };
}

function isPrintable(buf: Buffer): boolean {
  let printable = 0;
  const check = Math.min(buf.length, 8192);
  for (let i = 0; i < check; i++) {
    const b = buf[i];
    if ((b >= 0x20 && b < 0x7f) || b === 0x09 || b === 0x0a || b === 0x0d) printable++;
  }
  return printable / check >= 0.9;
}

// ── Extractors ────────────────────────────────────────────────────────────────

async function extractPdf(buffer: Buffer): Promise<ExtractionResult> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require("pdf-parse");
  const data = await pdfParse(buffer);
  let text: string = data.text || "";
  const pages: number = data.numpages || 1;

  // Scanned PDF detection: < 50 chars per page → OCR
  const charsPerPage = text.trim().length / Math.max(pages, 1);
  if (charsPerPage < 50) {
    try {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng");
      const { data: ocrData } = await worker.recognize(buffer);
      await worker.terminate();
      if (ocrData.text && ocrData.text.trim().length > text.trim().length) {
        const t = truncate(ocrData.text);
        return { text: t.text, kind: "pdf", meta: { pages }, method: "tesseract-ocr", truncated: t.truncated };
      }
    } catch {
      // OCR failed, use whatever text we have
    }
  }

  const t = truncate(text);
  return { text: t.text, kind: "pdf", meta: { pages }, method: "pdf-parse", truncated: t.truncated };
}

async function extractDocx(buffer: Buffer): Promise<ExtractionResult> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  const t = truncate(result.value || "");
  return { text: t.text, kind: "docx", meta: {}, method: "mammoth", truncated: t.truncated };
}

async function extractPptx(buffer: Buffer): Promise<ExtractionResult> {
  const JSZip = (await import("jszip")).default;
  const { XMLParser } = await import("fast-xml-parser");
  const zip = await JSZip.loadAsync(buffer);

  const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true });
  const slides: string[] = [];

  // Find slide files (ppt/slides/slide1.xml, slide2.xml, ...)
  const slideFiles = Object.keys(zip.files)
    .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)/)?.[1] || "0");
      const nb = parseInt(b.match(/slide(\d+)/)?.[1] || "0");
      return na - nb;
    });

  for (const slidePath of slideFiles) {
    const xml = await zip.files[slidePath].async("string");
    const parsed = parser.parse(xml);

    // Extract all text recursively
    const texts: string[] = [];
    function walk(obj: unknown) {
      if (!obj || typeof obj !== "object") return;
      if (Array.isArray(obj)) { obj.forEach(walk); return; }
      const o = obj as Record<string, unknown>;
      if ("t" in o && typeof o.t === "string") texts.push(o.t);
      else if ("t" in o && typeof o.t === "number") texts.push(String(o.t));
      for (const v of Object.values(o)) walk(v);
    }
    walk(parsed);
    const slideNum = slideFiles.indexOf(slidePath) + 1;
    if (texts.length > 0) {
      slides.push(`Slide ${slideNum}: ${texts.join(" ")}`);
    }
  }

  // Also try to extract notes
  for (let i = 0; i < slideFiles.length; i++) {
    const notePath = `ppt/notesSlides/notesSlide${i + 1}.xml`;
    if (zip.files[notePath]) {
      try {
        const noteXml = await zip.files[notePath].async("string");
        const parsed = parser.parse(noteXml);
        const texts: string[] = [];
        function walkNote(obj: unknown) {
          if (!obj || typeof obj !== "object") return;
          if (Array.isArray(obj)) { obj.forEach(walkNote); return; }
          const o = obj as Record<string, unknown>;
          if ("t" in o && typeof o.t === "string") texts.push(o.t);
          for (const v of Object.values(o)) walkNote(v);
        }
        walkNote(parsed);
        if (texts.length > 0) {
          slides.push(`Notes (Slide ${i + 1}): ${texts.join(" ")}`);
        }
      } catch { /* skip broken notes */ }
    }
  }

  const t = truncate(slides.join("\n\n"));
  return {
    text: t.text,
    kind: "pptx",
    meta: { slides: slideFiles.length },
    method: "pptx-xml",
    truncated: t.truncated,
  };
}

async function extractXlsx(buffer: Buffer, fileName: string): Promise<ExtractionResult> {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();

  const e = ext(fileName);
  if (e === "csv" || e === "tsv") {
    // CSV/TSV: treat as plaintext with table formatting
    const text = buffer.toString("utf-8");
    const lines = text.split("\n").slice(0, 200);
    const t = truncate(lines.join("\n"));
    return {
      text: t.text,
      kind: "csv",
      meta: { rows: lines.length },
      method: "plaintext",
      truncated: t.truncated,
    };
  }

  await workbook.xlsx.load(buffer as any);

  const sheets: string[] = [];
  workbook.eachSheet((sheet) => {
    const rows: string[] = [];
    const colCount = Math.min(sheet.columnCount, 20);

    // Header row
    const headerRow = sheet.getRow(1);
    const headers: string[] = [];
    for (let c = 1; c <= colCount; c++) {
      headers.push(String(headerRow.getCell(c).value ?? ""));
    }

    // Build markdown table
    rows.push("| " + headers.join(" | ") + " |");
    rows.push("| " + headers.map(() => "---").join(" | ") + " |");

    const maxRows = Math.min(sheet.rowCount, 200);
    for (let r = 2; r <= maxRows; r++) {
      const row = sheet.getRow(r);
      const cells: string[] = [];
      for (let c = 1; c <= colCount; c++) {
        cells.push(String(row.getCell(c).value ?? "").replace(/\n/g, " "));
      }
      rows.push("| " + cells.join(" | ") + " |");
    }

    sheets.push(`Sheet: ${sheet.name} (${sheet.rowCount} rows)\n${rows.join("\n")}`);
  });

  const t = truncate(sheets.join("\n\n"));
  return {
    text: t.text,
    kind: "xlsx",
    meta: { sheets: sheets.length },
    method: "exceljs",
    truncated: t.truncated,
  };
}

function extractPlainText(buffer: Buffer, fileName: string): ExtractionResult {
  const text = buffer.toString("utf-8");
  const t = truncate(text);
  return { text: t.text, kind: "text", meta: {}, method: "plaintext", truncated: t.truncated };
}

function extractCode(buffer: Buffer, fileName: string): ExtractionResult {
  const e = ext(fileName);
  const lang = LANG_MAP[e] || e;
  const raw = buffer.toString("utf-8");
  const fenced = "```" + lang + "\n" + raw + "\n```";
  const t = truncate(fenced);
  return { text: t.text, kind: "code", meta: { language: lang }, method: "plaintext", truncated: t.truncated };
}

function extractHtml(buffer: Buffer): ExtractionResult {
  const html = buffer.toString("utf-8");
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const t = truncate(text);
  return { text: t.text, kind: "html", meta: {}, method: "plaintext", truncated: t.truncated };
}

function extractJson(buffer: Buffer): ExtractionResult {
  const raw = buffer.toString("utf-8");
  let pretty: string;
  try {
    pretty = JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    pretty = raw;
  }
  const t = truncate(pretty);
  return { text: t.text, kind: "json", meta: {}, method: "plaintext", truncated: t.truncated };
}

function extractXml(buffer: Buffer): ExtractionResult {
  // XML/YAML: just pass through as text
  const raw = buffer.toString("utf-8");
  const t = truncate(raw);
  return { text: t.text, kind: "xml", meta: {}, method: "plaintext", truncated: t.truncated };
}

async function extractEpub(buffer: Buffer): Promise<ExtractionResult> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);

  const htmlFiles = Object.keys(zip.files)
    .filter(f => /\.(x?html?|htm)$/i.test(f))
    .sort();

  const texts: string[] = [];
  for (const path of htmlFiles) {
    const html = await zip.files[path].async("string");
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length > 20) texts.push(text);
  }

  const t = truncate(texts.join("\n\n"));
  return { text: t.text, kind: "epub", meta: { chapters: texts.length }, method: "jszip", truncated: t.truncated };
}

// Paths to skip inside archives
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".svn", ".hg", "__pycache__", ".DS_Store",
  "dist", "build", ".next", ".nuxt", "vendor", "target",
]);

// Binary extensions — never try to read as text
const BINARY_EXTENSIONS = new Set([
  "exe", "dll", "so", "dylib", "a", "lib", "o", "obj",
  "class", "jar", "war", "ear", "pyc", "pyo", "wasm",
  "ttf", "otf", "woff", "woff2", "eot",
  "ico", "icns", "cur",
  "db", "sqlite", "sqlite3",
  "lock", // package-lock.json is handled as json; yarn.lock/pnpm-lock are huge
]);

const MAX_ZIP_UNCOMPRESSED = 200 * 1024 * 1024; // 200 MB zip bomb guard
const MAX_ZIP_FILES = 30;
const MAX_ZIP_FILE_SIZE = 5 * 1024 * 1024; // 5 MB per inner file
const MAX_ZIP_TOTAL_CHARS = 40_000;

function shouldSkipPath(path: string): boolean {
  const parts = path.split("/");
  return parts.some(p => SKIP_DIRS.has(p));
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function extractZip(buffer: Buffer, depth = 0): Promise<ExtractionResult> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);

  const allEntries = Object.keys(zip.files).filter(f => !zip.files[f].dir);

  // Zip bomb guard: estimate uncompressed size
  let totalUncompressed = 0;
  for (const entry of allEntries) {
    const file = zip.files[entry];
    // jszip exposes _data.uncompressedSize on some versions; fallback to checking after load
    totalUncompressed += (file as any)?._data?.uncompressedSize || 0;
  }
  if (totalUncompressed > MAX_ZIP_UNCOMPRESSED) {
    return {
      text: `[ZIP bomb detected: estimated uncompressed size ${formatSize(totalUncompressed)} exceeds 200 MB limit. Aborting extraction.]`,
      kind: "zip",
      meta: { entries: allEntries.length },
      method: "jszip",
      truncated: false,
    };
  }

  // Build tree listing with sizes
  const treeParts: string[] = [];
  const entrySizes = new Map<string, number>();
  for (const entry of allEntries) {
    const file = zip.files[entry];
    let size = (file as any)?._data?.uncompressedSize || 0;
    if (!size) {
      // Fallback: load to get size (only for tree display)
      try {
        const buf = await file.async("arraybuffer");
        size = buf.byteLength;
      } catch { size = 0; }
    }
    entrySizes.set(entry, size);
    const skipDir = shouldSkipPath(entry);
    const skipBin = !skipDir && BINARY_EXTENSIONS.has(ext(entry));
    const tag = skipDir ? ' [skipped]' : skipBin ? ' (binary)' : '';
    treeParts.push(`  ${entry}  (${formatSize(size)})${tag}`);
  }

  const listing = `Archive contents (${allEntries.length} files):\n${treeParts.join("\n")}`;

  // Collect binary-extension entries so they appear in the skipped summary
  const binaryExtEntries = allEntries.filter(e => !shouldSkipPath(e) && BINARY_EXTENSIONS.has(ext(e)));

  // Filter entries: skip node_modules, .git, binaries, etc.
  const extractable = allEntries.filter(e => {
    if (shouldSkipPath(e)) return false;
    const innerExt = ext(e);
    if (BINARY_EXTENSIONS.has(innerExt)) return false;
    return true;
  });

  // Extract supported files (max 30, 5MB each, 40k total chars)
  const extracted: string[] = [listing];
  let extractedCount = 0;
  let totalChars = listing.length;
  const skippedBinary: string[] = binaryExtEntries.map(e => `${e} (binary)`);
  const omittedFiles: string[] = [];

  for (const entry of extractable) {
    if (extractedCount >= MAX_ZIP_FILES) {
      omittedFiles.push(entry);
      continue;
    }

    const file = zip.files[entry];
    if (!file || file.dir) continue;

    try {
      const innerBuf = await file.async("arraybuffer").catch(() => null);
      if (!innerBuf) { skippedBinary.push(entry); continue; }
      if (innerBuf.byteLength > MAX_ZIP_FILE_SIZE) {
        skippedBinary.push(`${entry} (too large: ${formatSize(innerBuf.byteLength)})`);
        continue;
      }

      const buf = Buffer.from(innerBuf);
      const innerExt = ext(entry);

      // Nested zip — one level deep only
      if ((innerExt === "zip") && depth < 1) {
        const nestedResult = await extractZip(buf, depth + 1);
        if (nestedResult.text.length > 10) {
          const section = `### ${entry}\n${nestedResult.text}`;
          if (totalChars + section.length > MAX_ZIP_TOTAL_CHARS) {
            omittedFiles.push(entry);
            continue;
          }
          extracted.push(section);
          totalChars += section.length;
          extractedCount++;
        }
        continue;
      }

      // Check if file is readable
      const innerMime = guessMime(entry);
      const isImage = innerMime.startsWith("image/");
      const isAudio = innerMime.startsWith("audio/");
      const isVideo = innerMime.startsWith("video/");

      if (isImage || isAudio || isVideo) {
        skippedBinary.push(`${entry} (${isImage ? 'image' : isAudio ? 'audio' : 'video'})`);
        continue;
      }

      // Check if it looks like a binary file
      if (!isPrintable(buf) && !["pdf", "docx", "pptx", "xlsx", "xls", "epub"].includes(innerExt)) {
        skippedBinary.push(`${entry} (binary)`);
        continue;
      }

      const innerResult = await extractFile(buf, entry, innerMime);
      if (innerResult.kind === "unknown" || innerResult.method === "unsupported") {
        skippedBinary.push(`${entry} (${innerResult.kind})`);
        continue;
      }

      if (innerResult.text.length > 10) {
        const section = `### ${entry}\n${innerResult.text}`;
        if (totalChars + section.length > MAX_ZIP_TOTAL_CHARS) {
          omittedFiles.push(entry);
          continue;
        }
        extracted.push(section);
        totalChars += section.length;
        extractedCount++;
      }
    } catch (err) {
      skippedBinary.push(`${entry} (error: ${(err as Error).message?.slice(0, 60)})`);
    }
  }

  // Add skipped files note
  if (skippedBinary.length > 0) {
    extracted.push(`Skipped (binary/unreadable):\n${skippedBinary.map(s => `  ${s}`).join("\n")}`);
  }

  // Add omitted files note
  const totalOmitted = omittedFiles.length +
    allEntries.filter(e => shouldSkipPath(e)).length +
    allEntries.filter(e => BINARY_EXTENSIONS.has(ext(e)) && !shouldSkipPath(e)).length;
  if (omittedFiles.length > 0) {
    extracted.push(`${omittedFiles.length} more files omitted (char limit reached).`);
  }

  const t = truncate(extracted.join("\n\n"), MAX_ZIP_TOTAL_CHARS);
  return {
    text: t.text,
    kind: "zip",
    meta: { entries: allEntries.length, extracted: extractedCount },
    method: "jszip",
    truncated: t.truncated,
  };
}

// ── Audio/Video ───────────────────────────────────────────────────────────────

async function extractAudio(_buffer: Buffer, fileName: string): Promise<ExtractionResult> {
  // Check if ffmpeg is available for video → audio extraction
  // For now, return unsupported message since Whisper/STT requires gateway
  return {
    text: `[Audio file: ${fileName} — transcription requires an STT service which is not currently configured]`,
    kind: "audio",
    meta: {},
    method: "unsupported",
    truncated: false,
  };
}

async function extractVideo(_buffer: Buffer, fileName: string): Promise<ExtractionResult> {
  return {
    text: `[Video file: ${fileName} — transcription requires ffmpeg + STT service which is not currently configured]`,
    kind: "video",
    meta: {},
    method: "unsupported",
    truncated: false,
  };
}

// ── MIME guessing ─────────────────────────────────────────────────────────────

function guessMime(fileName: string): string {
  const e = ext(fileName);
  const map: Record<string, string> = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    doc: "application/msword",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ppt: "application/vnd.ms-powerpoint",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
    csv: "text/csv",
    tsv: "text/tab-separated-values",
    ods: "application/vnd.oasis.opendocument.spreadsheet",
    odt: "application/vnd.oasis.opendocument.text",
    odp: "application/vnd.oasis.opendocument.presentation",
    epub: "application/epub+zip",
    zip: "application/zip",
    json: "application/json",
    xml: "application/xml",
    yaml: "application/x-yaml",
    yml: "application/x-yaml",
    html: "text/html",
    htm: "text/html",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    heic: "image/heic",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    ogg: "audio/ogg",
    mp4: "video/mp4",
    mkv: "video/x-matroska",
    avi: "video/x-msvideo",
    mov: "video/quicktime",
    webm: "video/webm",
    txt: "text/plain",
    md: "text/markdown",
    rtf: "text/rtf",
    log: "text/plain",
  };
  return map[e] || "application/octet-stream";
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

export async function extractFile(
  buffer: Buffer,
  name: string,
  mimetype: string,
): Promise<ExtractionResult> {
  const e = ext(name);
  // Resolve mimetype if generic
  if (!mimetype || mimetype === "application/octet-stream") {
    mimetype = guessMime(name);
  }

  try {
    // ── PDF ──
    if (mimetype === "application/pdf" || e === "pdf") {
      return await extractPdf(buffer);
    }

    // ── Images → return kind "image" so the caller can handle vision input ──
    if (mimetype.startsWith("image/")) {
      return {
        text: "",
        kind: "image",
        meta: {},
        method: "vision",
        truncated: false,
      };
    }

    // ── Word .docx ──
    if (
      mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      e === "docx"
    ) {
      return await extractDocx(buffer);
    }

    // ── Word .doc (legacy) ──
    if (mimetype === "application/msword" || e === "doc") {
      return {
        text: `[Legacy .doc format — please convert to .docx for full extraction]`,
        kind: "doc",
        meta: {},
        method: "unsupported",
        truncated: false,
      };
    }

    // ── PowerPoint .pptx ──
    if (
      mimetype === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
      e === "pptx"
    ) {
      return await extractPptx(buffer);
    }

    // ── PowerPoint .ppt (legacy) ──
    if (mimetype === "application/vnd.ms-powerpoint" || e === "ppt") {
      return {
        text: `[Legacy .ppt format — please convert to .pptx for full extraction]`,
        kind: "ppt",
        meta: {},
        method: "unsupported",
        truncated: false,
      };
    }

    // ── Excel / CSV / TSV ──
    if (
      mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      mimetype === "application/vnd.ms-excel" ||
      mimetype === "text/csv" ||
      mimetype === "text/tab-separated-values" ||
      ["xlsx", "xls", "csv", "tsv", "ods"].includes(e)
    ) {
      return await extractXlsx(buffer, name);
    }

    // ── EPUB ──
    if (mimetype === "application/epub+zip" || e === "epub") {
      return await extractEpub(buffer);
    }

    // ── ZIP archives ──
    if (mimetype === "application/zip" || mimetype === "application/x-zip-compressed" || e === "zip") {
      return await extractZip(buffer);
    }

    // ── HTML/HTM ──
    if (mimetype === "text/html" || mimetype === "application/xhtml+xml" || ["html", "htm"].includes(e)) {
      return extractHtml(buffer);
    }

    // ── JSON ──
    if (mimetype === "application/json" || e === "json") {
      return extractJson(buffer);
    }

    // ── XML / YAML / TOML / INI ──
    if (
      mimetype === "application/xml" || mimetype === "text/xml" ||
      mimetype === "application/x-yaml" ||
      ["xml", "yaml", "yml", "toml", "ini"].includes(e)
    ) {
      return extractXml(buffer);
    }

    // ── Code files ──
    if (CODE_EXTENSIONS.has(e)) {
      return extractCode(buffer, name);
    }

    // ── Text-like files ──
    if (mimetype.startsWith("text/") || TEXT_EXTENSIONS.has(e)) {
      return extractPlainText(buffer, name);
    }

    // ── Audio ──
    if (mimetype.startsWith("audio/") || ["mp3", "wav", "m4a", "ogg", "flac", "aac", "wma"].includes(e)) {
      return await extractAudio(buffer, name);
    }

    // ── Video ──
    if (mimetype.startsWith("video/") || ["mp4", "mkv", "avi", "mov", "webm", "wmv", "flv"].includes(e)) {
      return await extractVideo(buffer, name);
    }

    // ── Fallback: try UTF-8 ──
    if (isPrintable(buffer)) {
      const text = buffer.toString("utf-8");
      const t = truncate(text);
      return { text: t.text, kind: "text", meta: {}, method: "utf8-fallback", truncated: t.truncated };
    }

    // ── Unsupported binary ──
    return {
      text: `I can't read .${e || "this format"} yet. Supported formats: ${SUPPORTED_FORMATS}`,
      kind: "unknown",
      meta: {},
      method: "unsupported",
      truncated: false,
    };
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[extractFile] ${name} (${mimetype}): ${msg}`);
    return {
      text: `Error extracting ${name}: ${msg}`,
      kind: "error",
      meta: {},
      method: "error",
      truncated: false,
    };
  }
}

/**
 * Wrap extracted text in prompt-injection-safe <file> tags.
 */
export function wrapFileContext(
  name: string,
  kind: string,
  meta: Record<string, unknown>,
  text: string,
): string {
  // Archives get <file type="archive" entries="N">
  if (kind === "zip") {
    const entries = meta.entries || 0;
    return `<file name="${name}" type="archive" entries="${entries}">\n${text}\n</file>`;
  }

  const metaParts: string[] = [kind];
  if (meta.pages) metaParts.push(`${meta.pages} pages`);
  if (meta.slides) metaParts.push(`${meta.slides} slides`);
  if (meta.sheets) metaParts.push(`${meta.sheets} sheets`);
  if (meta.rows) metaParts.push(`${meta.rows} rows`);
  if (meta.chapters) metaParts.push(`${meta.chapters} chapters`);
  if (meta.entries) metaParts.push(`${meta.entries} files`);
  if (meta.language) metaParts.push(meta.language as string);

  return `<file name="${name}" ${metaParts.join(" ")}>\n${text}\n</file>`;
}

/** Max chars to include inline in the prompt (first 30k). */
export { MAX_INLINE_CHARS };
