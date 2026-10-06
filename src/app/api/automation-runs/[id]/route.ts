import { NextRequest, NextResponse } from "next/server";
import { getRun } from "@/lib/automationStore";
import { ensureSchedulerStarted } from "@/lib/automationScheduler";

function featureDisabled(): boolean {
  return process.env.FEATURE_AUTOMATIONS === "false";
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (featureDisabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  ensureSchedulerStarted();
  const { id } = await params;

  const run = getRun(id);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  return NextResponse.json({ run });
}
