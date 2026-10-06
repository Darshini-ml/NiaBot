import { NextRequest, NextResponse } from "next/server";
import { getAutomation, updateAutomation } from "@/lib/automationStore";
import { ensureSchedulerStarted } from "@/lib/automationScheduler";

function featureDisabled(): boolean {
  return process.env.FEATURE_AUTOMATIONS === "false";
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (featureDisabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  ensureSchedulerStarted();
  const { id } = await params;

  const automation = getAutomation(id);
  if (!automation) {
    return NextResponse.json({ error: "Automation not found" }, { status: 404 });
  }

  if (automation.status === "paused") {
    return NextResponse.json({ automation });
  }

  const updated = updateAutomation(id, { status: "paused" });
  if (!updated) {
    return NextResponse.json({ error: "Automation not found" }, { status: 404 });
  }

  // Clear nextRunAt since paused automations should not run
  updated.nextRunAt = null;

  return NextResponse.json({ automation: updated });
}
