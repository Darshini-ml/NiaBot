import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { extractFile } from "@/lib/extractFile";
import { recordUsage } from "@/lib/recordUsage";

export const runtime = "nodejs";

const UPLOAD_DIR = join(process.cwd(), "uploads");
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

// ---------------------------------------------------------------------------
// Error logging (stored in-memory, accessible via LogsPage)
// ---------------------------------------------------------------------------
const extractionErrors: { source: string; message: string; timestamp: string; stack?: string }[] = [];

function logExtractionError(source: string, message: string, stack?: string) {
  extractionErrors.push({
    source,
    message,
    timestamp: new Date().toISOString(),
    stack,
  });
  if (extractionErrors.length > 100) extractionErrors.shift();
}

export function getExtractionErrors() {
  return extractionErrors;
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum size is 25 MB.` },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const id = randomUUID();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storedName = `${id}_${safeName}`;

    // Ensure upload directory exists
    await mkdir(UPLOAD_DIR, { recursive: true });
    const filePath = join(UPLOAD_DIR, storedName);
    await writeFile(filePath, buffer);

    // Extract content via the universal pipeline
    const isImage = file.type.startsWith("image/");
    const extractStart = Date.now();
    const extraction = await extractFile(buffer, file.name, file.type);

    // Log extraction errors
    if (extraction.method === "error") {
      logExtractionError("extractFile", extraction.text);
    }

    // For images, create a base64 data URL for the model
    let base64DataUrl: string | undefined;
    if (isImage) {
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      const base64 = buffer.toString("base64");
      const mime = file.type || `image/${ext}`;
      base64DataUrl = `data:${mime};base64,${base64}`;
    }

    const extractMs = Date.now() - extractStart;
    console.log(
      `[uploads] file=${file.name} size=${file.size} kind=${extraction.kind} method=${extraction.method} chars=${extraction.text.length} truncated=${extraction.truncated} ms=${extractMs}`
    );

    // Record usage event for file extraction
    if (extraction.kind !== "image" && extraction.method !== "error") {
      recordUsage({
        kind: "tool_file",
        provider: "local",
        model: extraction.method,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
        latency_ms: extractMs,
        status: "ok",
      });
    }

    // Build response with extraction metadata
    return NextResponse.json({
      id,
      name: file.name,
      mimeType: file.type,
      size: file.size,
      storedName,
      isImage,
      extractedText: extraction.text || undefined,
      extractionKind: extraction.kind,
      extractionMeta: extraction.meta,
      extractionMethod: extraction.method,
      truncated: extraction.truncated,
      pages: (extraction.meta.pages as number) || undefined,
      chars: extraction.text.length || undefined,
      base64DataUrl,
    });
  } catch (err) {
    const msg = (err as Error).message;
    const stack = (err as Error).stack;
    console.error("Upload error:", err);
    logExtractionError("upload", msg, stack);
    return NextResponse.json(
      { error: "Upload failed" },
      { status: 500 }
    );
  }
}
