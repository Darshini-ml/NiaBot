import { NextRequest } from "next/server";
import { recordUsage } from "@/lib/recordUsage";

import { NIA_GATEWAY_URL, NIA_API_KEY } from "@/lib/config";
const ENHANCE_MODEL = process.env.ENHANCE_MODEL || "google/gemini-2.5-flash";

const SYSTEM_INSTRUCTION =
  "Rewrite the user's prompt so an AI gives a better answer. Keep intent and language. Add the likely goal, audience, format, and constraints when implied. Do not answer the prompt. Return ONLY the rewritten prompt as plain text — no quotes, no preamble, no markdown. Answer in one to three sentences, under 60 words.";

// ── LRU cache (500 entries, 10 min TTL) ──────────────────────────────
const CACHE_MAX = 500;
const CACHE_TTL = 10 * 60 * 1000;

interface CacheEntry {
  value: string;
  ts: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(prompt: string): string {
  let h = 5381;
  for (let i = 0; i < prompt.length; i++) {
    h = ((h << 5) + h + prompt.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

function cacheGet(key: string): string | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

function cacheSet(key: string, value: string) {
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, { value, ts: Date.now() });
}

const sharedHeaders = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${NIA_API_KEY}`,
};

// ── HEAD/OPTIONS for pre-warm ────────────────────────────────────────
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS" },
  });
}

export async function HEAD() {
  return new Response(null, { status: 204 });
}

// ── Helper: check if text ends with terminal punctuation ─────────────
function endsWithPunctuation(text: string): boolean {
  return /[.!?]$/.test(text.trim());
}

// ── Helper: non-streaming fallback call ──────────────────────────────
async function enhanceNonStreaming(prompt: string): Promise<string | null> {
  try {
    const res = await fetch(`${NIA_GATEWAY_URL}/chat/completions`, {
      method: "POST",
      headers: sharedHeaders,
      body: JSON.stringify({
        model: ENHANCE_MODEL,
        messages: [
          { role: "system", content: SYSTEM_INSTRUCTION },
          { role: "user", content: prompt },
        ],
        stream: false,
        temperature: 0.3,
        max_tokens: 600,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    console.log(`[enhance] retry non-streaming: finish_reason=${data.choices?.[0]?.finish_reason} len=${text?.length}`);
    return text || null;
  } catch (err) {
    console.warn(`[enhance] retry non-streaming failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

// ── POST — stream enhanced prompt to client ──────────────────────────
export async function POST(req: NextRequest) {
  const t0 = performance.now();

  let body: { prompt?: unknown; model?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { prompt } = body;

  if (typeof prompt !== "string" || prompt.length < 1 || prompt.length > 4000) {
    return Response.json(
      { error: "prompt must be a string between 1 and 4000 characters" },
      { status: 400 }
    );
  }

  // ── Cache hit → instant return ────────────────────────────────────
  const key = cacheKey(prompt);
  const cached = cacheGet(key);
  if (cached) {
    const elapsed = performance.now() - t0;
    return Response.json(
      { enhanced: cached },
      { headers: { "Server-Timing": `total;dur=${elapsed.toFixed(1)}, cache;desc="hit"` } }
    );
  }

  // ── Stream from provider ──────────────────────────────────────────
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  let providerStart = 0;

  try {
    providerStart = performance.now();
    const response = await fetch(`${NIA_GATEWAY_URL}/chat/completions`, {
      method: "POST",
      headers: sharedHeaders,
      body: JSON.stringify({
        model: ENHANCE_MODEL,
        messages: [
          { role: "system", content: SYSTEM_INSTRUCTION },
          { role: "user", content: prompt },
        ],
        stream: true,
        temperature: 0.3,
        max_tokens: 600,
        // No stop sequences — let the model finish naturally
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      clearTimeout(timeout);
      const errText = await response.text().catch(() => "");
      console.error(`[enhance] provider ${response.status}: ${errText.slice(0, 200)}`);
      return Response.json({ error: "Provider error" }, { status: 502 });
    }

    const providerTime = performance.now() - providerStart;
    const reader = response.body?.getReader();
    if (!reader) {
      clearTimeout(timeout);
      return Response.json({ error: "No response body" }, { status: 502 });
    }

    // SSE stream to client
    let fullText = "";
    let finishReason: string | null = null;
    let outputTokens = 0;
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(ctrl) {
        try {
          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const payload = line.slice(6).trim();
              if (payload === "[DONE]") continue;

              try {
                const parsed = JSON.parse(payload);
                const choice = parsed.choices?.[0];
                const delta = choice?.delta?.content;
                if (delta) {
                  fullText += delta;
                  outputTokens++;
                  ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ token: delta })}\n\n`));
                }
                if (choice?.finish_reason) {
                  finishReason = choice.finish_reason;
                }
                if (parsed.usage?.completion_tokens) {
                  outputTokens = parsed.usage.completion_tokens;
                }
              } catch {
                // skip malformed chunks
              }
            }
          }

          // Flush remaining buffer
          if (buffer.trim()) {
            const line = buffer.trim();
            if (line.startsWith("data: ") && line.slice(6).trim() !== "[DONE]") {
              try {
                const parsed = JSON.parse(line.slice(6).trim());
                const delta = parsed.choices?.[0]?.delta?.content;
                if (delta) {
                  fullText += delta;
                  ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ token: delta })}\n\n`));
                }
                if (parsed.choices?.[0]?.finish_reason) {
                  finishReason = parsed.choices[0].finish_reason;
                }
              } catch { /* skip */ }
            }
          }

          let result = fullText.trim();

          console.log(
            `[enhance] raw: finish_reason=${finishReason} tokens=${outputTokens} len=${result.length} text="${result.slice(0, 80)}..."`
          );

          // If hit max tokens, trim to last full sentence
          if (finishReason === "length" && result) {
            const lastSentenceEnd = Math.max(
              result.lastIndexOf("."),
              result.lastIndexOf("!"),
              result.lastIndexOf("?")
            );
            if (lastSentenceEnd > result.length * 0.3) {
              result = result.slice(0, lastSentenceEnd + 1);
              console.warn(
                `[enhance] finish_reason=length — trimmed to last sentence (${result.length} chars)`
              );
            } else {
              // No good boundary — retry non-streaming once
              console.warn(`[enhance] finish_reason=length — no sentence boundary, retrying non-streaming`);
              const retryResult = await enhanceNonStreaming(prompt as string);
              if (retryResult && endsWithPunctuation(retryResult)) {
                result = retryResult;
                console.log(`[enhance] retry succeeded: len=${result.length}`);
              }
            }
          }

          // Post-check: if still no terminal punctuation and finish_reason !== "stop", retry once
          if (result && !endsWithPunctuation(result) && finishReason !== "stop") {
            console.warn(`[enhance] no terminal punctuation, retrying non-streaming`);
            const retryResult = await enhanceNonStreaming(prompt as string);
            if (retryResult && endsWithPunctuation(retryResult)) {
              result = retryResult;
              console.log(`[enhance] retry succeeded: len=${result.length}`);
            }
          }

          // Cache the result
          if (result) {
            cacheSet(key, result);
          }

          const totalTime = performance.now() - t0;
          ctrl.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ done: true, enhanced: result || prompt, finish_reason: finishReason })}\n\n`
            )
          );
          ctrl.enqueue(encoder.encode(`data: [DONE]\n\n`));
          ctrl.close();

          console.log(
            `[enhance] complete: finish_reason=${finishReason} tokens=${outputTokens} provider=${providerTime.toFixed(0)}ms total=${totalTime.toFixed(0)}ms len=${result.length}`
          );

          // Record enhance usage
          recordUsage({
            kind: "enhance",
            provider: "niaai",
            model: ENHANCE_MODEL,
            input_tokens: 0,
            output_tokens: outputTokens,
            cost_usd: 0, // internal call
            latency_ms: totalTime,
          });
        } catch (err) {
          const totalTime = performance.now() - t0;
          const partial = fullText.trim();
          ctrl.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ done: true, enhanced: partial || (prompt as string), degraded: true })}\n\n`
            )
          );
          ctrl.enqueue(encoder.encode(`data: [DONE]\n\n`));
          ctrl.close();
          console.error(
            `[enhance] DEGRADED finish_reason=${finishReason} tokens=${outputTokens} provider=${providerTime.toFixed(0)}ms total=${totalTime.toFixed(0)}ms err=${err instanceof Error ? err.message : err}`
          );
          recordUsage({
            kind: "enhance",
            provider: "niaai",
            model: ENHANCE_MODEL,
            input_tokens: 0,
            output_tokens: outputTokens,
            cost_usd: 0,
            latency_ms: totalTime,
            status: "error",
            error_message: err instanceof Error ? err.message : "enhance error",
          });
        }
      },
    });

    const totalElapsed = performance.now() - t0;
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "Server-Timing": `provider;dur=${providerTime.toFixed(1)}, total;dur=${totalElapsed.toFixed(1)}`,
      },
    });
  } catch (err: unknown) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") {
      const totalTime = performance.now() - t0;
      return Response.json(
        { enhanced: prompt as string, degraded: true },
        {
          headers: {
            "Server-Timing": `provider;dur=${(performance.now() - providerStart).toFixed(1)}, total;dur=${totalTime.toFixed(1)}`,
          },
        }
      );
    }
    return Response.json({ error: "Provider error" }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
