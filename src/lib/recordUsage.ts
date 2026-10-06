/* ------------------------------------------------------------------ */
/*  Server-side usage recording helper                                 */
/*  Every provider call should go through recordUsage() so the Logs    */
/*  page and Usage tab have full coverage.                             */
/* ------------------------------------------------------------------ */

export type UsageKind =
  | "chat"
  | "tool_search"
  | "tool_image"
  | "tool_pdf"
  | "enhance"
  | "classifier"
  | "title"
  | "automation"
  | "voice"
  | "guard"
  | "tool_link"
  | "tool_file";

export interface UsageRecord {
  chat_id?: string;
  chat_title?: string;
  message_id?: string;
  kind: UsageKind;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens?: number;
  cost_usd: number;
  latency_ms: number;
  ttft_ms?: number;
  status?: "ok" | "error";
  error_message?: string;
  automation_id?: string;
}

export interface StoredUsageEvent {
  chat_id: string;
  chat_title: string;
  chat_title_snapshot: string; // frozen at write time — survives chat rename/delete
  message_id: string;
  model: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cost_usd: number;
  latency_ms: number;
  ttft_ms: number;
  kind: string;
  status: string;
  error_message: string;
  automation_id: string;
  created_at: string;
}

/* ── Shared in-memory store (same globalThis as /api/usage) ─── */

const g = globalThis as unknown as {
  __usageEvents?: StoredUsageEvent[];
  __chatTitles?: Map<string, string>;
};

if (!g.__usageEvents) g.__usageEvents = [];
if (!g.__chatTitles) g.__chatTitles = new Map();

/** Update the chat title map so usage events can join titles correctly */
export function setChatTitle(chatId: string, title: string): void {
  if (chatId && title) {
    g.__chatTitles!.set(chatId, title);
  }
}

/** Look up the latest title for a chat */
export function getChatTitle(chatId: string): string {
  return g.__chatTitles!.get(chatId) || "";
}

/**
 * Record a usage event from any provider call.
 * This pushes directly to the shared in-memory array that /api/usage reads.
 */
export function recordUsage(record: UsageRecord): StoredUsageEvent {
  // Resolve chat title: prefer explicit, fall back to title map
  const resolvedTitle =
    record.chat_title || getChatTitle(record.chat_id || "") || "";

  const event: StoredUsageEvent = {
    chat_id: record.chat_id || "",
    chat_title: resolvedTitle,
    chat_title_snapshot: resolvedTitle, // frozen at write time
    message_id: record.message_id || "",
    model: record.model || "",
    provider: record.provider || "",
    input_tokens: record.input_tokens || 0,
    output_tokens: record.output_tokens || 0,
    reasoning_tokens: record.reasoning_tokens || 0,
    cost_usd: record.cost_usd || 0,
    latency_ms: record.latency_ms || 0,
    ttft_ms: record.ttft_ms || 0,
    kind: record.kind || "chat",
    status: record.status || "ok",
    error_message: record.error_message || "",
    automation_id: record.automation_id || "",
    created_at: new Date().toISOString(),
  };

  g.__usageEvents!.push(event);

  console.log(
    `[usage] ${event.kind} provider=${event.provider} model=${event.model} in=${event.input_tokens} out=${event.output_tokens} cost=$${event.cost_usd.toFixed(4)} latency=${event.latency_ms}ms status=${event.status}` +
      (event.chat_id ? ` chat=${event.chat_id}` : "") +
      (event.automation_id ? ` automation=${event.automation_id}` : ""),
  );

  return event;
}

/* ── Dev guard: detect missing recordUsage calls ───────────── */

let _devGuardEnabled = process.env.NODE_ENV === "development";

export function enableDevGuard(enabled: boolean): void {
  _devGuardEnabled = enabled;
}

/**
 * Wraps a provider fetch call. After it resolves, starts a 2s timer.
 * If recordUsage() is not called within 2s, logs a warning with the stack.
 * Returns the fetch result unchanged.
 */
export async function guardedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (!_devGuardEnabled) return fetch(input, init);

  const stack = new Error().stack || "";
  let usageRecorded = false;

  // Temporarily monkey-patch to detect calls
  const originalPush = g.__usageEvents!.push.bind(g.__usageEvents!);
  const len = g.__usageEvents!.length;

  const result = await fetch(input, init);

  // Check after 2s if usage was recorded
  setTimeout(() => {
    if (g.__usageEvents!.length <= len && !usageRecorded) {
      console.warn(`[usage] MISSING recordUsage for provider call\n${stack}`);
    }
  }, 2000);

  return result;
}
