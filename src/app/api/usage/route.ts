import { NextRequest } from "next/server";
import { setChatTitle, getChatTitle, type StoredUsageEvent } from "@/lib/recordUsage";

/* ------------------------------------------------------------------ */
/*  In-memory usage event store (resets on server restart)             */
/* ------------------------------------------------------------------ */

export interface UsageEvent {
  chat_id: string;
  chat_title: string;
  chat_title_snapshot?: string; // frozen at write time
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
  created_at: string; // ISO 8601
}

// Use globalThis so that both this route and the child /chat/[id] route
// share the exact same array, even if Next.js bundles them separately.
const g = globalThis as unknown as { __usageEvents?: UsageEvent[] };
if (!g.__usageEvents) {
  g.__usageEvents = [];
}
const usageEvents: UsageEvent[] = g.__usageEvents;

/* ------------------------------------------------------------------ */
/*  POST /api/usage — store a usage event                             */
/* ------------------------------------------------------------------ */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const event: UsageEvent = {
      chat_id: body.chat_id ?? "",
      chat_title: body.chat_title ?? "",
      chat_title_snapshot: body.chat_title ?? "",
      message_id: body.message_id ?? "",
      model: body.model ?? "",
      provider: body.provider ?? "",
      input_tokens: Number(body.input_tokens) || 0,
      output_tokens: Number(body.output_tokens) || 0,
      reasoning_tokens: Number(body.reasoning_tokens) || 0,
      cost_usd: Number(body.cost_usd) || 0,
      latency_ms: Number(body.latency_ms) || 0,
      ttft_ms: Number(body.ttft_ms) || 0,
      kind: body.kind ?? "",
      status: body.status ?? "ok",
      error_message: body.error_message ?? "",
      automation_id: body.automation_id ?? "",
      created_at: body.created_at ?? new Date().toISOString(),
    };

    // Update chat title map for future lookups
    if (event.chat_id && event.chat_title) {
      setChatTitle(event.chat_id, event.chat_title);
    }

    usageEvents.push(event);

    return Response.json({ ok: true, total_events: usageEvents.length });
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
}

/* ------------------------------------------------------------------ */
/*  GET /api/usage?from=ISO&to=ISO&group_by=chat|model|day            */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const groupBy = searchParams.get("group_by") ?? "chat";

  // Filter by date range
  let filtered = usageEvents;

  if (from) {
    const fromDate = new Date(from).getTime();
    filtered = filtered.filter(
      (e) => new Date(e.created_at).getTime() >= fromDate,
    );
  }
  if (to) {
    const toDate = new Date(to).getTime();
    filtered = filtered.filter(
      (e) => new Date(e.created_at).getTime() <= toDate,
    );
  }

  const kindFilter = searchParams.get("kind");

  if (kindFilter) {
    const kinds = kindFilter.split(",");
    filtered = filtered.filter((e) => kinds.includes(e.kind));
  }

  switch (groupBy) {
    case "chat":
      return Response.json({ chats: aggregateByChat(filtered) });
    case "model":
      return Response.json({ models: aggregateByModel(filtered) });
    case "day":
      return Response.json({ days: aggregateByDay(filtered) });
    case "kind":
      return Response.json({ kinds: aggregateByKind(filtered) });
    case "events":
      return Response.json({ events: filtered.slice(-500) }); // last 500 raw events
    default:
      return Response.json(
        { error: `Invalid group_by value: ${groupBy}` },
        { status: 400 },
      );
  }
}

/* ------------------------------------------------------------------ */
/*  DELETE /api/usage — clear all usage history                        */
/* ------------------------------------------------------------------ */

export async function DELETE() {
  usageEvents.length = 0;
  return Response.json({ ok: true, cleared: true });
}

/* ------------------------------------------------------------------ */
/*  Aggregation helpers                                                */
/* ------------------------------------------------------------------ */

function aggregateByChat(events: UsageEvent[]) {

  const map = new Map<
    string,
    {
      chat_id: string;
      chat_title: string;
      chat_title_snapshot: string;
      models_used: Set<string>;
      kinds_used: Set<string>;
      requests: number;
      errors: number;
      input_tokens: number;
      output_tokens: number;
      reasoning_tokens: number;
      cost_usd: number;
      last_used: string;
    }
  >();

  for (const e of events) {
    // Skip automation events (no chat_id)
    if (!e.chat_id) continue;

    let entry = map.get(e.chat_id);
    if (!entry) {
      entry = {
        chat_id: e.chat_id,
        chat_title: e.chat_title,
        chat_title_snapshot: e.chat_title_snapshot || e.chat_title || "",
        models_used: new Set(),
        kinds_used: new Set(),
        requests: 0,
        errors: 0,
        input_tokens: 0,
        output_tokens: 0,
        reasoning_tokens: 0,
        cost_usd: 0,
        last_used: e.created_at,
      };
      map.set(e.chat_id, entry);
    }

    // Only LLM and image-gen models contribute to the Models column
    const modelKind = e.kind || "chat";
    if (e.model && (modelKind === "chat" || modelKind === "tool_image" || modelKind === "voice")) {
      entry.models_used.add(e.model);
    }
    if (e.kind) entry.kinds_used.add(e.kind);
    entry.requests += 1;
    if (e.status === "error") entry.errors += 1;
    entry.input_tokens += e.input_tokens;
    entry.output_tokens += e.output_tokens;
    entry.reasoning_tokens += e.reasoning_tokens;
    entry.cost_usd += e.cost_usd;
    if (e.chat_title) entry.chat_title = e.chat_title;
    // Keep the first snapshot (oldest, most reliable)
    if (!entry.chat_title_snapshot && e.chat_title_snapshot) {
      entry.chat_title_snapshot = e.chat_title_snapshot;
    }
    if (e.created_at > entry.last_used) entry.last_used = e.created_at;
  }

  return Array.from(map.values()).map((entry) => {
    // Resolve title: prefer snapshot, then event title, then title map
    let title = entry.chat_title_snapshot || entry.chat_title;
    if (!title || title === "Untitled") {
      const resolved = getChatTitle(entry.chat_id);
      title = resolved || "Untitled";
    }

    return {
      ...entry,
      chat_title: title,
      chat_title_snapshot: entry.chat_title_snapshot || title,
      models_used: Array.from(entry.models_used),
      kinds_used: Array.from(entry.kinds_used),
    };
  });
}

function aggregateByModel(events: UsageEvent[]) {
  const map = new Map<
    string,
    {
      model: string;
      provider: string;
      requests: number;
      input_tokens: number;
      output_tokens: number;
      reasoning_tokens: number;
      cost_usd: number;
      total_ttft_ms: number;
    }
  >();

  for (const e of events) {
    let entry = map.get(e.model);
    if (!entry) {
      entry = {
        model: e.model,
        provider: e.provider,
        requests: 0,
        input_tokens: 0,
        output_tokens: 0,
        reasoning_tokens: 0,
        cost_usd: 0,
        total_ttft_ms: 0,
      };
      map.set(e.model, entry);
    }

    entry.requests += 1;
    entry.input_tokens += e.input_tokens;
    entry.output_tokens += e.output_tokens;
    entry.reasoning_tokens += e.reasoning_tokens;
    entry.cost_usd += e.cost_usd;
    entry.total_ttft_ms += e.ttft_ms;
  }

  return Array.from(map.values()).map(({ total_ttft_ms, ...rest }) => ({
    ...rest,
    avg_ttft_ms: rest.requests > 0 ? Math.round(total_ttft_ms / rest.requests) : 0,
  }));
}

function aggregateByDay(events: UsageEvent[]) {
  const map = new Map<
    string,
    { date: string; providers: Record<string, { input_tokens: number; output_tokens: number }> }
  >();

  for (const e of events) {
    const date = e.created_at.slice(0, 10); // YYYY-MM-DD
    let entry = map.get(date);
    if (!entry) {
      entry = { date, providers: {} };
      map.set(date, entry);
    }

    if (!entry.providers[e.provider]) {
      entry.providers[e.provider] = { input_tokens: 0, output_tokens: 0 };
    }
    entry.providers[e.provider].input_tokens += e.input_tokens;
    entry.providers[e.provider].output_tokens += e.output_tokens;
  }

  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function aggregateByKind(events: UsageEvent[]) {
  const map = new Map<
    string,
    {
      kind: string;
      requests: number;
      errors: number;
      input_tokens: number;
      output_tokens: number;
      cost_usd: number;
    }
  >();

  for (const e of events) {
    const kind = e.kind || "chat";
    let entry = map.get(kind);
    if (!entry) {
      entry = { kind, requests: 0, errors: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 };
      map.set(kind, entry);
    }
    entry.requests += 1;
    if (e.status === "error") entry.errors += 1;
    entry.input_tokens += e.input_tokens;
    entry.output_tokens += e.output_tokens;
    entry.cost_usd += e.cost_usd;
  }

  return Array.from(map.values());
}
