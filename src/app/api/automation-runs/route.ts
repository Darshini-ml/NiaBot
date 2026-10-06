import { NextRequest, NextResponse } from "next/server";
import { getAllRuns } from "@/lib/automationStore";
import { ensureSchedulerStarted } from "@/lib/automationScheduler";

function featureDisabled(): boolean {
  return process.env.FEATURE_AUTOMATIONS === "false";
}

export async function GET(req: NextRequest) {
  if (featureDisabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  ensureSchedulerStarted();

  const statusFilter = req.nextUrl.searchParams.get("status");
  const automationId = req.nextUrl.searchParams.get("automationId");
  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") || "1", 10));

  const { runs, total } = getAllRuns({
    status: statusFilter || undefined,
    automationId: automationId || undefined,
    page,
    perPage: 20,
  });

  return NextResponse.json({
    runs,
    total,
    page,
    perPage: 20,
    totalPages: Math.ceil(total / 20),
  });
}
