// Backward-compatible alias — re-exports from integrations heartbeat
// The Slack bot can continue using /api/slack/heartbeat
import { NextRequest, NextResponse } from "next/server";
import { getHeartbeat } from "@/app/api/integrations/heartbeat/route";

export const runtime = "nodejs";

// GET returns Slack-specific heartbeat for backward compatibility
export async function GET() {
  return NextResponse.json(getHeartbeat("slack"));
}

// POST forwards to the integrations heartbeat with source=slack
export { POST } from "@/app/api/integrations/heartbeat/route";
