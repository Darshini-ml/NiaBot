import { NextRequest, NextResponse } from "next/server";
import { AUTOMATION_TEMPLATES } from "@/lib/automations";
import { ensureSchedulerStarted } from "@/lib/automationScheduler";

function featureDisabled(): boolean {
  return process.env.FEATURE_AUTOMATIONS === "false";
}

export async function GET(_req: NextRequest) {
  if (featureDisabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  ensureSchedulerStarted();

  return NextResponse.json(
    { templates: AUTOMATION_TEMPLATES },
    {
      headers: {
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}
