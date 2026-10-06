import { NextRequest, NextResponse } from "next/server";
import { getAutomation, getRunsForAutomation } from "@/lib/automationStore";
import { ensureSchedulerStarted } from "@/lib/automationScheduler";

function featureDisabled(): boolean {
  return process.env.FEATURE_AUTOMATIONS === "false";
}

export async function GET(
  req: NextRequest,
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

  const statusFilter = req.nextUrl.searchParams.get("status");
  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") || "1", 10));

  const { runs, total } = getRunsForAutomation(id, {
    status: statusFilter || undefined,
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
