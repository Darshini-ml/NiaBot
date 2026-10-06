import { NextResponse } from "next/server";
import { getLastDebugRequest } from "@/app/api/chat/route";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  const data = getLastDebugRequest();
  if (!data) {
    return NextResponse.json({ error: "No requests recorded yet" }, { status: 404 });
  }

  // Redact API keys from the request body
  const sanitized = { ...data };
  if (sanitized.request_body) {
    const body = { ...sanitized.request_body };
    if (typeof body.api_key === "string") body.api_key = "***REDACTED***";
    sanitized.request_body = body;
  }

  return NextResponse.json(sanitized);
}
