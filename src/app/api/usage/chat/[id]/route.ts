import { NextRequest } from "next/server";

// Import the shared in-memory store from the parent route.
// Next.js App Router compiles each route independently, so we use a shared
// module-level reference. Because both files live in the same server process
// and Node caches modules, they share the same array instance.
//
// We re-export the store from a well-known location to keep things simple.
// The parent route.ts pushes events into `usageEvents`; we read from it here.

type UsageEvent = {
  chat_id: string;
  chat_title: string;
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
  created_at: string;
};

let usageEvents: UsageEvent[] | null = null;

function getEvents(): UsageEvent[] {
  if (!usageEvents) {
    const g = globalThis as unknown as { __usageEvents?: UsageEvent[] };
    if (!g.__usageEvents) {
      g.__usageEvents = [];
    }
    usageEvents = g.__usageEvents;
  }
  return usageEvents;
}

/* ------------------------------------------------------------------ */
/*  GET /api/usage/chat/:id                                           */
/* ------------------------------------------------------------------ */

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const events = getEvents();

  const chatEvents = events.filter((e) => e.chat_id === id);

  if (chatEvents.length === 0) {
    return Response.json(
      { error: "No usage data found for this chat" },
      { status: 404 },
    );
  }

  const chatTitle = chatEvents[chatEvents.length - 1].chat_title || "";
  const modelsUsed = Array.from(new Set(chatEvents.map((e) => e.model)));

  const messages = chatEvents.map((e) => ({
    message_id: e.message_id,
    model: e.model,
    provider: e.provider,
    input_tokens: e.input_tokens,
    output_tokens: e.output_tokens,
    reasoning_tokens: e.reasoning_tokens,
    cost_usd: e.cost_usd,
    latency_ms: e.latency_ms,
    ttft_ms: e.ttft_ms,
    kind: e.kind,
    created_at: e.created_at,
  }));

  return Response.json({
    chat_id: id,
    chat_title: chatTitle,
    models_used: modelsUsed,
    messages,
  });
}
