import { NextRequest, NextResponse } from "next/server";
import {
  getAllAutomations,
  createAutomation,
} from "@/lib/automationStore";
import type { CreateAutomationInput } from "@/lib/automationStore";
import { ensureSchedulerStarted } from "@/lib/automationScheduler";
import type { AutomationStatus, TriggerType } from "@/lib/automations";

function featureDisabled(): boolean {
  return process.env.FEATURE_AUTOMATIONS === "false";
}

const VALID_TRIGGER_TYPES: TriggerType[] = [
  "hourly",
  "daily",
  "weekdays",
  "weekly",
  "monthly",
  "cron",
];

function validateTriggerInput(t: unknown): boolean {
  if (!t || typeof t !== "object") return false;
  const trigger = t as Record<string, unknown>;
  if (typeof trigger.type !== "string" || !VALID_TRIGGER_TYPES.includes(trigger.type as TriggerType)) return false;
  if (typeof trigger.time !== "string" || !/^\d{2}:\d{2}$/.test(trigger.time)) return false;
  if (trigger.type === "cron" && (typeof trigger.cron !== "string" || !trigger.cron)) return false;
  if (trigger.type === "weekly" && trigger.weekdays !== undefined && trigger.weekdays !== null) {
    if (!Array.isArray(trigger.weekdays) || !trigger.weekdays.every((d: unknown) => typeof d === "number" && d >= 0 && d <= 6)) return false;
  }
  if (trigger.type === "monthly" && trigger.dayOfMonth !== undefined && trigger.dayOfMonth !== null) {
    if (typeof trigger.dayOfMonth !== "number" || trigger.dayOfMonth < 1 || trigger.dayOfMonth > 31) return false;
  }
  return true;
}

export async function GET(req: NextRequest) {
  if (featureDisabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  ensureSchedulerStarted();

  const statusFilter = req.nextUrl.searchParams.get("status") as AutomationStatus | null;
  const automations = getAllAutomations(statusFilter || undefined);

  return NextResponse.json({ automations });
}

export async function POST(req: NextRequest) {
  if (featureDisabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  ensureSchedulerStarted();

  try {
    const body = await req.json();
    const {
      name,
      icon,
      color,
      instructions,
      model,
      skills,
      connectors,
      attachments,
      notification,
      timezone,
      triggers,
    } = body;

    // Validate name
    if (typeof name !== "string" || name.length < 1 || name.length > 80) {
      return NextResponse.json(
        { error: "name must be between 1 and 80 characters" },
        { status: 400 },
      );
    }

    // Validate instructions
    if (typeof instructions !== "string" || instructions.length < 1 || instructions.length > 6000) {
      return NextResponse.json(
        { error: "instructions must be between 1 and 6000 characters" },
        { status: 400 },
      );
    }

    // Validate icon
    if (typeof icon !== "string" || !icon) {
      return NextResponse.json(
        { error: "icon is required" },
        { status: 400 },
      );
    }

    // Validate color
    if (typeof color !== "string" || !color) {
      return NextResponse.json(
        { error: "color is required" },
        { status: 400 },
      );
    }

    // Validate model
    if (typeof model !== "string" || !model) {
      return NextResponse.json(
        { error: "model is required" },
        { status: 400 },
      );
    }

    // Validate skills
    if (!Array.isArray(skills)) {
      return NextResponse.json(
        { error: "skills must be an array" },
        { status: 400 },
      );
    }

    // Validate connectors
    if (!Array.isArray(connectors)) {
      return NextResponse.json(
        { error: "connectors must be an array" },
        { status: 400 },
      );
    }

    // Validate attachments
    if (!Array.isArray(attachments)) {
      return NextResponse.json(
        { error: "attachments must be an array" },
        { status: 400 },
      );
    }

    // Validate notification
    const validNotifications = ["email_app", "app_only", "email_only", "none"];
    if (typeof notification !== "string" || !validNotifications.includes(notification)) {
      return NextResponse.json(
        { error: "notification must be one of: email_app, app_only, email_only, none" },
        { status: 400 },
      );
    }

    // Validate timezone
    if (typeof timezone !== "string" || !timezone) {
      return NextResponse.json(
        { error: "timezone is required" },
        { status: 400 },
      );
    }

    // Validate triggers
    if (!Array.isArray(triggers) || triggers.length < 1) {
      return NextResponse.json(
        { error: "At least one trigger is required" },
        { status: 400 },
      );
    }

    for (const trigger of triggers) {
      if (!validateTriggerInput(trigger)) {
        return NextResponse.json(
          { error: "Invalid trigger: each trigger must have a valid type (hourly, daily, weekdays, weekly, monthly, cron) and time (HH:mm)" },
          { status: 400 },
        );
      }
    }

    const input: CreateAutomationInput = {
      name,
      icon,
      color,
      instructions,
      model,
      skills,
      connectors,
      attachments,
      notification: notification as import("@/lib/automations").NotificationSetting,
      timezone,
      triggers,
    };

    const automation = createAutomation(input);
    return NextResponse.json({ automation }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
