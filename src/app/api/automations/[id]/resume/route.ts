import { NextRequest, NextResponse } from "next/server";
import {
  getAutomation,
  updateAutomation,
  resetConsecutiveFailures,
} from "@/lib/automationStore";
import { computeNextRunAt } from "@/lib/automations";
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

  if (automation.status === "active") {
    return NextResponse.json({ automation });
  }

  resetConsecutiveFailures(id);

  const updated = updateAutomation(id, { status: "active" });
  if (!updated) {
    return NextResponse.json({ error: "Automation not found" }, { status: 404 });
  }

  updated.nextRunAt = computeNextRunAt(updated.triggers, updated.timezone);

  return NextResponse.json({ automation: updated });
}
