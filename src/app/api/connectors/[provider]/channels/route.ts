import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/session";
import { executeConnectorTool } from "@/lib/connectorTools";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const userId = getUserId(req);

  if (provider !== "slack" && provider !== "discord") {
    return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
  }

  const toolName = provider === "slack" ? "slack_list_channels" : "discord_list_channels";
  const result = await executeConnectorTool(toolName, {}, userId);

  if (result.error) {
    return NextResponse.json({ error: result.content, channels: [] }, { status: 200 });
  }

  try {
    const channels = JSON.parse(result.content);
    return NextResponse.json({ channels });
  } catch {
    return NextResponse.json({ channels: [] });
  }
}
