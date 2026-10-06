import {
  getAllAutomations,
  getAutomation,
  createRun,
  updateRun,
  updateAutomation,
  getConsecutiveFailures,
  incrementConsecutiveFailures,
  resetConsecutiveFailures,
} from "./automationStore";
import { computeNextRunAt } from "./automations";
import type { EmailStatus, Automation, AutomationRun } from "./automations";
import { performSearch, type SearchResult } from "@/app/api/web-search/route";
import { recordUsage } from "@/lib/recordUsage";

/* ── Config ──────────────────────────────────────────────── */

import { NIA_GATEWAY_URL, NIA_API_KEY } from "@/lib/config";
const SCHEDULER_INTERVAL_MS = 30_000;
const MAX_CONSECUTIVE_FAILURES = 3;
const AI_MAX_TOKENS = 1200;
const AI_TIMEOUT_MS = 60_000;

/* ── Notifications store ─────────────────────────────────── */

interface Notification {
  id: string;
  type: "automation_run";
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
}

const notificationsStore = new Map<string, Notification[]>();

function emitNotification(userId: string, title: string, message: string): void {
  const notification: Notification = {
    id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    type: "automation_run",
    title,
    message,
    timestamp: new Date().toISOString(),
    read: false,
  };

  const existing = notificationsStore.get(userId) || [];
  existing.push(notification);
  notificationsStore.set(userId, existing);
}

export function getNotifications(userId: string): Notification[] {
  return notificationsStore.get(userId) || [];
}

/* ── Email helper ────────────────────────────────────────── */

async function sendRunEmail(
  automation: Automation,
  run: AutomationRun,
  output: string,
): Promise<{ id: string }> {
  const res = await fetch(
    `${typeof window !== "undefined" ? "" : "http://localhost:3000"}/api/automations/send-email`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: automation.notify_email,
        subject: `[NiaAI] ${automation.name} — Run Complete`,
        body: output,
        automation_id: automation.id,
        run_id: run.id,
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Email endpoint returned ${res.status}: ${text}`);
  }

  return res.json();
}

/* ── Skill-specific system prompts ───────────────────────── */

const skillSystemPrompts: Record<string, string> = {
  brainstorm:
    "You are an automated brainstorming assistant. Produce creative, actionable ideas based on the user's instructions. Be concise and practical.",
  plan:
    "You are an automated planning assistant. Create structured, actionable plans with clear steps and timelines based on the user's instructions.",
  analyze:
    "You are an automated analysis assistant. Provide clear, data-driven analysis based on the user's instructions. Be concise and highlight key findings.",
  code:
    "You are an automated coding assistant. Write clean, well-commented code based on the user's instructions. Include brief explanations.",
  slides:
    "You are an automated presentation assistant. Create structured slide outlines with clear titles, bullet points, and speaker notes.",
  image:
    "You are an automated creative assistant. Generate detailed image prompts or descriptions based on the user's instructions.",
};

/* ── Execute a single automation run ─────────────────────── */

export async function executeAutomationRun(
  automationId: string,
  runId: string,
): Promise<void> {
  const automation = getAutomation(automationId);
  if (!automation) {
    updateRun(runId, {
      status: "failed",
      error: "Automation not found",
      finishedAt: new Date().toISOString(),
    });
    return;
  }

  // Pick the first skill for the system prompt, or fall back to default
  const skillKey = automation.skills.length > 0 ? automation.skills[0] : "";
  let systemPrompt =
    skillSystemPrompts[skillKey] ||
    "You are an automated assistant. Complete the task described in the user's instructions.";

  // Inject today's date
  const now = new Date();
  const weekday = now.toLocaleDateString("en-US", { weekday: "long", timeZone: automation.timezone || "UTC" });
  const dateStr = now.toLocaleDateString("en-CA", { timeZone: automation.timezone || "UTC" });
  systemPrompt = `Today is ${weekday}, ${dateStr}. Your training data may be outdated; use the search results provided for current information.\n\n${systemPrompt}`;

  const startTime = Date.now();

  try {
    // Perform web search for fresh data (use recency:"day" for scheduled runs)
    let searchResults: SearchResult[] = [];
    try {
      searchResults = await performSearch(automation.instructions, "day", 6);
    } catch { /* continue without search */ }

    // Inject search results into system prompt
    if (searchResults.length > 0) {
      const searchContext = searchResults
        .map((r, i) => `[${i + 1}] ${r.title}${r.published_at ? ` (${r.published_at})` : ""}\n${r.snippet}\nURL: ${r.url}`)
        .join("\n\n");
      systemPrompt += `\n\n--- Live Web Search Results ---\n${searchContext}\n--- End Search Results ---\n\nUse these results for current facts. Cite sources with [1], [2] etc. Include source URLs at the end.`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

    const response = await fetch(`${NIA_GATEWAY_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${NIA_API_KEY}`,
      },
      body: JSON.stringify({
        model: automation.model || "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: automation.instructions },
        ],
        stream: false,
        max_tokens: AI_MAX_TOKENS,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`AI provider returned ${response.status}`);
    }

    const data = await response.json();
    let output =
      data.choices?.[0]?.message?.content || "No output generated.";

    // Append source links to email output
    if (searchResults.length > 0) {
      const sourceLinks = searchResults.map((r, i) => `[${i + 1}] ${r.title}: ${r.url}`).join("\n");
      output += `\n\n---\nSources:\n${sourceLinks}`;
    }
    const durationMs = Date.now() - startTime;
    const tokens = data.usage?.total_tokens ?? null;

    const inTokens = data.usage?.prompt_tokens || 0;
    const outTokens = data.usage?.completion_tokens || 0;
    recordUsage({
      kind: "automation",
      provider: "niaai",
      model: automation.model || "google/gemini-2.5-flash",
      input_tokens: inTokens,
      output_tokens: outTokens,
      cost_usd: 0,
      latency_ms: durationMs,
      automation_id: automation.id,
    });

    updateRun(runId, {
      status: "success",
      output,
      finishedAt: new Date().toISOString(),
      durationMs,
      tokens,
    });

    // ── Email delivery ──────────────────────────────────
    const notifyEmail = automation.notify_email;
    let emailOutcomeMsg = "";

    if (
      (automation.notification === "email_app" ||
        automation.notification === "email_only") &&
      notifyEmail
    ) {
      updateRun(runId, { email_to: notifyEmail, email_status: "sending" });

      try {
        const run = { id: runId } as AutomationRun;
        const emailResponse = await sendRunEmail(automation, run, output);
        updateRun(runId, {
          email_status: "sent",
          email_provider_id: emailResponse.id,
          email_sent_at: new Date().toISOString(),
        });
        const maskedEmail =
          notifyEmail.charAt(0) +
          "…" +
          notifyEmail.slice(notifyEmail.indexOf("@"));
        emailOutcomeMsg = `Email sent to ${maskedEmail}`;
      } catch (emailErr: unknown) {
        const emailError =
          emailErr instanceof Error ? emailErr.message : "Unknown email error";
        updateRun(runId, {
          email_status: "failed",
          email_error: emailError,
        });
        // Keep status "success" but note the email failure
        emailOutcomeMsg = `Email failed: ${emailError}`;
      }
    } else {
      updateRun(runId, { email_status: "skipped" });
    }

    // Update automation on success
    const now = new Date().toISOString();
    resetConsecutiveFailures(automationId);

    const current = getAutomation(automationId);
    if (current) {
      const nextRunAt =
        current.status === "active"
          ? computeNextRunAt(current.triggers, current.timezone)
          : null;

      updateAutomation(automationId, { status: current.status });
      current.lastRunResult = "success";
      // Update lastRunAt and nextRunAt via the store
      const refreshed = getAutomation(automationId);
      if (refreshed) {
        refreshed.lastRunAt = now;
        refreshed.lastRunResult = "success";
        if (nextRunAt !== undefined) {
          refreshed.nextRunAt = nextRunAt;
        }
      }
    }

    // ── In-app notification ─────────────────────────────
    const notifTitle = `${automation.name} — Run Complete`;
    const notifMessage = emailOutcomeMsg
      ? `${automation.name} ran · ${emailOutcomeMsg}`
      : `${automation.name} ran successfully`;
    emitNotification(automation.userId, notifTitle, notifMessage);
  } catch (err: unknown) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown error during execution";
    const durationMs = Date.now() - startTime;

    recordUsage({
      kind: "automation",
      provider: "niaai",
      model: automation.model || "google/gemini-2.5-flash",
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
      latency_ms: durationMs,
      status: "error",
      error_message: errorMessage,
      automation_id: automation.id,
    });

    updateRun(runId, {
      status: "failed",
      error: errorMessage,
      finishedAt: new Date().toISOString(),
      durationMs,
    });

    // Increment consecutive failures
    const failCount = incrementConsecutiveFailures(automationId);
    const current = getAutomation(automationId);
    if (current) {
      current.lastRunAt = new Date().toISOString();
      current.lastRunResult = "failed";

      if (failCount >= MAX_CONSECUTIVE_FAILURES) {
        updateAutomation(automationId, { status: "failed" });
      } else if (current.status === "active") {
        current.nextRunAt = computeNextRunAt(current.triggers, current.timezone);
      }
    }

    // ── In-app notification for failure ─────────────────
    const failedAutomation = getAutomation(automationId);
    const failName = failedAutomation?.name || automationId;
    emitNotification(
      failedAutomation?.userId || "unknown",
      `${failName} — Run Failed`,
      `${failName} failed: ${errorMessage}`,
    );
  }
}

/* ── Scheduler tick ──────────────────────────────────────── */

async function tick(): Promise<void> {
  const now = new Date();
  const activeAutomations = getAllAutomations("active");

  for (const automation of activeAutomations) {
    if (!automation.nextRunAt) continue;

    const nextRun = new Date(automation.nextRunAt);
    if (nextRun > now) continue;

    // Time to run
    const run = createRun(automation.id, "schedule");

    // Fire and forget (don't block the tick for other automations)
    executeAutomationRun(automation.id, run.id).catch(() => {
      // Error already handled inside executeAutomationRun
    });
  }
}

/* ── Lazy init ───────────────────────────────────────────── */

let schedulerStarted = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function ensureSchedulerStarted(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  intervalHandle = setInterval(() => {
    tick().catch((err) => {
      console.error("[AutomationScheduler] tick error:", err);
    });
  }, SCHEDULER_INTERVAL_MS);

  // Don't prevent process exit
  if (intervalHandle && typeof intervalHandle === "object" && "unref" in intervalHandle) {
    intervalHandle.unref();
  }
}
