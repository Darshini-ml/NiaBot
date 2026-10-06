import type {
  Automation,
  AutomationRun,
  AutomationStatus,
  AutomationTrigger,
  EmailStatus,
  NotificationSetting,
} from "./automations";
import { computeNextRunAt } from "./automations";

/* ── In-memory stores ────────────────────────────────────── */

const automationsMap = new Map<string, Automation>();
const runsMap = new Map<string, AutomationRun>();

/* ── ID helpers ──────────────────────────────────────────── */

let autoInc = 0;
function uid(prefix: string): string {
  autoInc += 1;
  return `${prefix}_${Date.now().toString(36)}${autoInc.toString(36)}`;
}

/* ── Automation CRUD ─────────────────────────────────────── */

export function getAutomation(id: string): Automation | undefined {
  return automationsMap.get(id);
}

export function getAllAutomations(statusFilter?: AutomationStatus): Automation[] {
  const all = Array.from(automationsMap.values());
  if (statusFilter) return all.filter((a) => a.status === statusFilter);
  return all;
}

export interface CreateAutomationInput {
  name: string;
  icon: string;
  color: string;
  instructions: string;
  model: string;
  skills: string[];
  connectors: string[];
  attachments: any[];
  notification: NotificationSetting;
  notify_email?: string;
  timezone: string;
  triggers: Omit<AutomationTrigger, "id" | "automationId" | "createdAt">[];
}

export function createAutomation(data: CreateAutomationInput): Automation {
  const id = uid("auto");
  const now = new Date().toISOString();
  const triggers: AutomationTrigger[] = data.triggers.map((t) => ({
    ...t,
    id: uid("trg"),
    automationId: id,
    createdAt: now,
  }));
  const automation: Automation = {
    id,
    userId: "user_default",
    name: data.name,
    icon: data.icon,
    color: data.color,
    instructions: data.instructions,
    model: data.model,
    skills: data.skills,
    connectors: data.connectors,
    attachments: data.attachments,
    notification: data.notification,
    notify_email: data.notify_email || "user@example.com",
    timezone: data.timezone,
    status: "active",
    triggers,
    lastRunAt: null,
    lastRunResult: null,
    nextRunAt: computeNextRunAt(triggers, data.timezone),
    createdAt: now,
    updatedAt: now,
  };
  automationsMap.set(id, automation);
  return automation;
}

export function updateAutomation(
  id: string,
  data: Partial<CreateAutomationInput> & { status?: AutomationStatus },
): Automation | null {
  const existing = automationsMap.get(id);
  if (!existing) return null;

  if (data.name !== undefined) existing.name = data.name;
  if (data.icon !== undefined) existing.icon = data.icon;
  if (data.color !== undefined) existing.color = data.color;
  if (data.instructions !== undefined) existing.instructions = data.instructions;
  if (data.model !== undefined) existing.model = data.model;
  if (data.skills !== undefined) existing.skills = data.skills;
  if (data.connectors !== undefined) existing.connectors = data.connectors;
  if (data.attachments !== undefined) existing.attachments = data.attachments;
  if (data.notification !== undefined) existing.notification = data.notification;
  if (data.notify_email !== undefined) existing.notify_email = data.notify_email;
  if (data.timezone !== undefined) existing.timezone = data.timezone;
  if (data.status !== undefined) existing.status = data.status;

  if (data.triggers !== undefined) {
    const now = new Date().toISOString();
    existing.triggers = data.triggers.map((t) => ({
      ...t,
      id: uid("trg"),
      automationId: id,
      createdAt: now,
    }));
  }

  existing.updatedAt = new Date().toISOString();

  if (existing.status === "active") {
    existing.nextRunAt = computeNextRunAt(existing.triggers, existing.timezone);
  }

  automationsMap.set(id, existing);
  return existing;
}

export function deleteAutomation(id: string): boolean {
  for (const [runId, run] of runsMap) {
    if (run.automationId === id) runsMap.delete(runId);
  }
  return automationsMap.delete(id);
}

/* ── Run CRUD ────────────────────────────────────────────── */

export function createRun(
  automationId: string,
  triggeredBy: "schedule" | "manual" = "manual",
): AutomationRun {
  const id = uid("run");
  const run: AutomationRun = {
    id,
    automationId,
    userId: "user_default",
    status: "running",
    output: null,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    durationMs: null,
    tokens: null,
    triggeredBy,
    email_to: null,
    email_status: null,
    email_provider_id: null,
    email_error: null,
    email_sent_at: null,
  };
  runsMap.set(id, run);
  return run;
}

export function getRun(id: string): AutomationRun | undefined {
  return runsMap.get(id);
}

export function updateRun(
  id: string,
  data: Partial<Pick<AutomationRun, "status" | "output" | "error" | "finishedAt" | "durationMs" | "tokens" | "email_to" | "email_status" | "email_provider_id" | "email_error" | "email_sent_at">>,
): AutomationRun | null {
  const run = runsMap.get(id);
  if (!run) return null;

  Object.assign(run, data);
  runsMap.set(id, run);
  return run;
}

export function getRunsForAutomation(
  automationId: string,
  opts?: { status?: string; page?: number; perPage?: number },
): { runs: AutomationRun[]; total: number } {
  const perPage = opts?.perPage ?? 20;
  const page = opts?.page ?? 1;

  let runs = Array.from(runsMap.values())
    .filter((r) => r.automationId === automationId)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

  if (opts?.status) runs = runs.filter((r) => r.status === opts.status);

  const total = runs.length;
  const offset = (page - 1) * perPage;
  return { runs: runs.slice(offset, offset + perPage), total };
}

export function getAllRuns(
  opts?: { status?: string; automationId?: string; page?: number; perPage?: number },
): { runs: AutomationRun[]; total: number } {
  const perPage = opts?.perPage ?? 20;
  const page = opts?.page ?? 1;

  let runs = Array.from(runsMap.values()).sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );

  if (opts?.status) runs = runs.filter((r) => r.status === opts.status);
  if (opts?.automationId) runs = runs.filter((r) => r.automationId === opts.automationId);

  const total = runs.length;
  const offset = (page - 1) * perPage;
  return { runs: runs.slice(offset, offset + perPage), total };
}

/* ── Scheduler helpers ───────────────────────────────────── */

/** Track consecutive failures per automation */
const consecutiveFailures = new Map<string, number>();

export function getConsecutiveFailures(id: string): number {
  return consecutiveFailures.get(id) ?? 0;
}

export function incrementConsecutiveFailures(id: string): number {
  const count = (consecutiveFailures.get(id) ?? 0) + 1;
  consecutiveFailures.set(id, count);
  return count;
}

export function resetConsecutiveFailures(id: string): void {
  consecutiveFailures.set(id, 0);
}

export function getDueAutomations(): Automation[] {
  const now = new Date();
  return Array.from(automationsMap.values()).filter(
    (a) => a.status === "active" && a.nextRunAt && new Date(a.nextRunAt) <= now,
  );
}
