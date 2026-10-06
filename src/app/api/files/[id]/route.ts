import { NextRequest, NextResponse } from "next/server";

// Access the same global file store used by the generate route
function getFileStore() {
  if (!(globalThis as any).__niaFileStore) {
    (globalThis as any).__niaFileStore = new Map();
  }
  return (globalThis as any).__niaFileStore as Map<string, {
    buffer: Buffer;
    filename: string;
    mimeType: string;
    type: string;
    size_bytes: number;
    pages: number;
    created_at: string;
  }>;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const store = getFileStore();
  const file = store.get(id);

  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const isDownload = url.searchParams.get("download") === "1";
  const disposition = isDownload
    ? `attachment; filename="${file.filename}"`
    : `inline; filename="${file.filename}"`;

  return new NextResponse(new Uint8Array(file.buffer), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": disposition,
      "Content-Length": String(file.size_bytes),
      "Content-Security-Policy": "frame-ancestors 'self'",
      "Accept-Ranges": "bytes",
    },
  });
}
