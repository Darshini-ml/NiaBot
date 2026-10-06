import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Slack bot connection status — updated by the bot service via POST
let slackStatus: {
  connected: boolean;
  workspace?: string;
  botUser?: string;
  lastEventTime?: string;
  socketUrl?: string;
} = { connected: false };

export async function GET() {
  return NextResponse.json(slackStatus);
}

export async function POST(req: NextRequest) {
  // Allow the slack bot service to update its connection status
  const token = process.env.NIA_INTERNAL_TOKEN;
  if (token) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${token}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const body = await req.json();
    slackStatus = { ...slackStatus, ...body };
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
}
