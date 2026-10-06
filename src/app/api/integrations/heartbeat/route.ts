import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Multi-source heartbeat — supports Slack, Discord, and future integrations
interface HeartbeatData {
  connected: boolean;
  workspace?: string; // Slack
  guild?: string; // Discord
  botUser?: string;
  lastEventTime?: string;
  lastHeartbeat?: string;
}

const heartbeats = new Map<string, HeartbeatData>();

export function getHeartbeat(source: string): HeartbeatData {
  const hb = heartbeats.get(source) || { connected: false };
  if (hb.lastHeartbeat) {
    const elapsed = Date.now() - new Date(hb.lastHeartbeat).getTime();
    if (elapsed > 60_000) {
      return { ...hb, connected: false };
    }
  }
  return hb;
}

export function getAllHeartbeats(): Record<string, HeartbeatData> {
  const result: Record<string, HeartbeatData> = {};
  for (const [source, hb] of heartbeats) {
    result[source] = getHeartbeat(source);
  }
  return result;
}

export async function GET(req: NextRequest) {
  const source = req.nextUrl.searchParams.get("source");
  if (source) {
    return NextResponse.json(getHeartbeat(source));
  }
  return NextResponse.json(getAllHeartbeats());
}

export async function POST(req: NextRequest) {
  const token = process.env.NIA_INTERNAL_TOKEN;
  if (token) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${token}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const body = await req.json();
    const source = body.source || "slack";
    heartbeats.set(source, {
      ...body,
      lastHeartbeat: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
}
