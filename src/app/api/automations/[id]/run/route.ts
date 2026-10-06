import { NextRequest, NextResponse } from "next/server";
import { getAutomation, createRun } from "@/lib/automationStore";
import {
  ensureSchedulerStarted,
  executeAutomationRun,
} from "@/lib/automationScheduler";

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

  const run = createRun(id, "manual");

  // Fire async - don't await
  executeAutomationRun(id, run.id).catch(() => {
    // Errors handled inside executeAutomationRun
  });

  return NextResponse.json({ run: { id: run.id, status: run.status } }, { status: 202 });
}
