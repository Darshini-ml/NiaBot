import { NextRequest } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Sanitize — only allow uuid characters
  if (!/^[a-f0-9-]+$/i.test(id)) {
    return new Response("Not found", { status: 404 });
  }

  const filePath = path.join(process.cwd(), "uploads", "images", `${id}.png`);

  try {
    const buffer = await readFile(filePath);
    return new Response(buffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
        "Content-Length": buffer.length.toString(),
      },
    });
  } catch {
    return new Response("Image not found", { status: 404 });
  }
}
