import { NextRequest, NextResponse } from "next/server";
import {
  getAutomation,
  updateAutomation,
  deleteAutomation,
} from "@/lib/automationStore";
import { ensureSchedulerStarted } from "@/lib/automationScheduler";
import type { TriggerType } from "@/lib/automations";

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

export async function GET(
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

  return NextResponse.json({ automation });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (featureDisabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  ensureSchedulerStarted();
  const { id } = await params;

  const existing = getAutomation(id);
  if (!existing) {
    return NextResponse.json({ error: "Automation not found" }, { status: 404 });
  }

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
      status,
    } = body;

    // Validate name
    if (name !== undefined && (typeof name !== "string" || name.length < 1 || name.length > 80)) {
      return NextResponse.json(
        { error: "name must be between 1 and 80 characters" },
        { status: 400 },
      );
    }

    // Validate instructions
    if (instructions !== undefined && (typeof instructions !== "string" || instructions.length < 1 || instructions.length > 6000)) {
      return NextResponse.json(
        { error: "instructions must be between 1 and 6000 characters" },
        { status: 400 },
      );
    }

    // Validate icon
    if (icon !== undefined && (typeof icon !== "string" || !icon)) {
      return NextResponse.json(
        { error: "icon must be a non-empty string" },
        { status: 400 },
      );
    }

    // Validate color
    if (color !== undefined && (typeof color !== "string" || !color)) {
      return NextResponse.json(
        { error: "color must be a non-empty string" },
        { status: 400 },
      );
    }

    // Validate model
    if (model !== undefined && (typeof model !== "string" || !model)) {
      return NextResponse.json(
        { error: "model must be a non-empty string" },
        { status: 400 },
      );
    }

    // Validate skills
    if (skills !== undefined && !Array.isArray(skills)) {
      return NextResponse.json(
        { error: "skills must be an array" },
        { status: 400 },
      );
    }

    // Validate connectors
    if (connectors !== undefined && !Array.isArray(connectors)) {
      return NextResponse.json(
        { error: "connectors must be an array" },
        { status: 400 },
      );
    }

    // Validate attachments
    if (attachments !== undefined && !Array.isArray(attachments)) {
      return NextResponse.json(
        { error: "attachments must be an array" },
        { status: 400 },
      );
    }

    // Validate notification
    if (notification !== undefined) {
      const validNotifications = ["email_app", "app_only", "email_only", "none"];
      if (typeof notification !== "string" || !validNotifications.includes(notification)) {
        return NextResponse.json(
          { error: "notification must be one of: email_app, app_only, email_only, none" },
          { status: 400 },
        );
      }
    }

    // Validate timezone
    if (timezone !== undefined && (typeof timezone !== "string" || !timezone)) {
      return NextResponse.json(
        { error: "timezone must be a non-empty string" },
        { status: 400 },
      );
    }

    // Validate status
    if (status !== undefined) {
      const validStatuses = ["active", "paused", "failed"];
      if (typeof status !== "string" || !validStatuses.includes(status)) {
        return NextResponse.json(
          { error: "status must be one of: active, paused, failed" },
          { status: 400 },
        );
      }
    }

    // Validate triggers
    if (triggers !== undefined) {
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
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (icon !== undefined) updateData.icon = icon;
    if (color !== undefined) updateData.color = color;
    if (instructions !== undefined) updateData.instructions = instructions;
    if (model !== undefined) updateData.model = model;
    if (skills !== undefined) updateData.skills = skills;
    if (connectors !== undefined) updateData.connectors = connectors;
    if (attachments !== undefined) updateData.attachments = attachments;
    if (notification !== undefined) updateData.notification = notification;
    if (timezone !== undefined) updateData.timezone = timezone;
    if (triggers !== undefined) updateData.triggers = triggers;
    if (status !== undefined) updateData.status = status;

    const updated = updateAutomation(id, updateData);
    if (!updated) {
      return NextResponse.json({ error: "Automation not found" }, { status: 404 });
    }

    return NextResponse.json({ automation: updated });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (featureDisabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  ensureSchedulerStarted();
  const { id } = await params;

  const deleted = deleteAutomation(id);
  if (!deleted) {
    return NextResponse.json({ error: "Automation not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
