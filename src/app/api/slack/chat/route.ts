import { NextRequest } from "next/server";
import { performSearch, needsFreshData, rankAndFilterResults, type SearchResult } from "@/app/api/web-search/route";
import { getAdapter, computeCost, resolveAdapter } from "@/lib/providerAdapters";
import { recordUsage, setChatTitle } from "@/lib/recordUsage";
import {
  detectIntent,
  buildSystemPrompt,
  generateDocumentFromContent,
  generateImageFromText,
  parseTargetPages,
  HALLUCINATION_PATTERN,
  INTENT_BYPASS_PATTERN,
  CANNOT_CREATE_PATTERN,
  DOC_KEYWORDS,
  ALL_TOOLS,
  getToolChoice,
} from "@/lib/assistantTurn";
import { NIA_GATEWAY_URL, NIA_API_KEY } from "@/lib/config";

export const runtime = "nodejs";

const NIA_INTERNAL_TOKEN = process.env.NIA_INTERNAL_TOKEN || "";

/* ── Server-side thread memory ─────────────────────────────────────────────── */

interface ThreadMessage {
  role: "user" | "assistant";
  content: string;
  ts: number;
}

const integrationThreads = new Map<string, { chatId: string; messages: ThreadMessage[] }>();
const MAX_HISTORY = 30;

function resolveThread(conversationKey: string, src: string): { chatId: string; messages: ThreadMessage[] } {
  let thread = integrationThreads.get(conversationKey);
  if (!thread) {
    thread = { chatId: `${src}-${conversationKey}`, messages: [] };
    integrationThreads.set(conversationKey, thread);
  }
  return thread;
}

function pushMessage(thread: { messages: ThreadMessage[] }, role: "user" | "assistant", content: string) {
  thread.messages.push({ role, content, ts: Date.now() });
  while (thread.messages.length > MAX_HISTORY) thread.messages.shift();
}

/* ── Request shape ──────────────────────────────────────────────────────────── */

interface IntegrationChatRequest {
  text: string;
  // Legacy Slack fields
  channel_id?: string;
  thread_ts?: string;
  slack_user_id?: string;
  slack_user_name?: string;
  // Generic integration fields
  source?: "slack" | "discord";
  conversation_key?: string;
  user_id?: string;
  user_name?: string;
  channel_name?: string;
  model?: string;
  web_search?: boolean;
  attachments?: Array<{
    id: string;
    name: string;
    mimeType: string;
    extractedText?: string;
  }>;
}

function slackError(msg: string): string {
  const clean = msg.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  const trimmed = clean.length > 180 ? clean.slice(0, 177) + "…" : clean;
  return `⚠️ NiaAI error: ${trimmed}`;
}

/* ── Fetch page text (fail-safe) ──────────────────────────────────────────── */

interface FetchPageResult {
  url: string;
  status: number;
  ms: number;
  chars: number;
  error?: string;
  text: string;
}

async function fetchPageText(url: string, timeoutMs = 4000): Promise<FetchPageResult> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,text/plain",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html") && !ct.includes("text/plain") && !ct.includes("application/xhtml")) {
      clearTimeout(timer);
      return { url, status: res.status, ms: Date.now() - start, chars: 0, error: `non-html: ${ct.split(";")[0]}`, text: "" };
    }

    if (!res.ok) {
      clearTimeout(timer);
      return { url, status: res.status, ms: Date.now() - start, chars: 0, error: `HTTP ${res.status}`, text: "" };
    }

    const bodyPromise = res.text();
    const abortPromise = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(new Error("body timeout")));
    });
    const html = await Promise.race([bodyPromise, abortPromise]);
    clearTimeout(timer);

    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);
    return { url, status: res.status, ms: Date.now() - start, chars: text.length, text };
  } catch (err) {
    return { url, status: 0, ms: Date.now() - start, chars: 0, error: err instanceof Error ? err.message : "unknown", text: "" };
  }
}

async function fetchPagesWithConcurrency(urls: string[], maxConcurrency: number, timeoutMs: number): Promise<FetchPageResult[]> {
  const results: FetchPageResult[] = [];
  const queue = [...urls];
  async function worker() {
    while (queue.length > 0) {
      const url = queue.shift()!;
      results.push(await fetchPageText(url, timeoutMs));
    }
  }
  await Promise.allSettled(Array.from({ length: Math.min(maxConcurrency, urls.length) }, () => worker()));
  return results;
}

function buildSearchContext(results: SearchResult[], pageTexts?: Map<string, string>): string {
  if (results.length === 0) return "";
  const context = results
    .map((r, i) => {
      const pageText = pageTexts?.get(r.url);
      const body = pageText ? pageText : r.snippet;
      return `[${i + 1}] ${r.title}${r.published_at ? ` (${r.published_at})` : ""} — ${r.url}\n${body}`;
    })
    .join("\n\n");
  return (
    `\n\nSEARCH RESULTS (live, newer than your training data):\n${context}\n--- End Search Results ---\n\n` +
    `IMPORTANT: Use the SEARCH RESULTS above as the source of truth. Cite sources with inline markers like [1], [2].`
  );
}

function logMessages(label: string, msgs: Array<{ role: string; content: string }>) {
  const summary = msgs.map(m => `{${m.role}: "${m.content.slice(0, 40).replace(/\n/g, "\\n")}${m.content.length > 40 ? "…" : ""}"}`).join(", ");
  console.log(`[integrations/chat] ${label} [${summary}]`);
}

/* ── Main handler ──────────────────────────────────────────────────────────── */

export async function POST(req: NextRequest) {
  // Auth check
  if (NIA_INTERNAL_TOKEN) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${NIA_INTERNAL_TOKEN}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  let body: IntegrationChatRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Normalize: support both legacy Slack fields and generic integration fields
  const source = body.source || "slack";
  const userId = body.user_id || body.slack_user_id || "";
  const userName = body.user_name || body.slack_user_name;
  const channel_name = body.channel_name;
  const attachments = body.attachments;
  const requestedModel = body.model;
  const web_search = body.web_search ?? true;
  const text = body.text;

  // conversation_key can be provided directly, or derived from channel_id + thread_ts
  let conversationKey = body.conversation_key;
  let channel_id = body.channel_id || "";
  let thread_ts = body.thread_ts || "";
  if (!conversationKey) {
    if (!channel_id || !thread_ts) {
      return new Response(JSON.stringify({ error: "Missing text, conversation_key (or channel_id + thread_ts)" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    conversationKey = `${channel_id}:${thread_ts}`;
  } else {
    // For generic requests, derive channel_id and thread_ts from conversation_key
    if (!channel_id) channel_id = conversationKey;
    if (!thread_ts) thread_ts = conversationKey;
  }

  if (!text?.trim()) {
    return new Response(JSON.stringify({ error: "Missing text" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Resolve thread and persist user message ──
  const thread = resolveThread(conversationKey, source);
  const chatId = thread.chatId;

  let userContent = text;
  if (attachments?.length) {
    const attachmentTexts = attachments
      .filter((a) => a.extractedText)
      .map((a) => `<file name="${a.name}" ${a.mimeType}>\n${a.extractedText}\n</file>`)
      .join("\n\n");
    if (attachmentTexts) userContent = `${attachmentTexts}\n\n${text}`;
  }

  pushMessage(thread, "user", userContent);

  // ── Resolve adapter ──
  const selectedModel = requestedModel || "google/gemini-2.5-flash";
  const [providerName, ...modelParts] = selectedModel.includes("/")
    ? selectedModel.split("/")
    : ["nia", selectedModel];
  const rawModelId = modelParts.join("/") || selectedModel;

  const resolution = resolveAdapter(providerName, rawModelId);
  if (!resolution) {
    const errMsg = `No API key configured for ${providerName}. Add it in Settings.`;
    console.error(`[integrations/chat] ${errMsg}`);
    return new Response(
      JSON.stringify({ error: errMsg }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const { adapter, via } = resolution;
  const useDirectAdapter = via === "direct";
  const effectiveModel = useDirectAdapter ? rawModelId : selectedModel;

  // ── Intent detection (shared with web route) ──
  const { intent, isImageIntent, isDocIntent, isGenerationIntent } = detectIntent(text);
  const isDocRequest = isDocIntent || DOC_KEYWORDS.test(text);

  // For mixed intents ("create an image of the latest iPhone"), search to inform the prompt
  const mixedIntent = isGenerationIntent && needsFreshData(text);
  const shouldSearch = web_search && (mixedIntent ? true : (!isGenerationIntent && needsFreshData(text)));

  const toolForced = isDocRequest || isImageIntent;
  const tools = toolForced ? ALL_TOOLS : undefined;
  const toolChoice = toolForced ? getToolChoice(intent, isDocRequest, isImageIntent) : undefined;

  console.log(`[turn] source=${source} user=${userId}${userName ? ` (${userName})` : ""} intent=${intent} search=${shouldSearch} mixed=${mixedIntent} tool_forced=${toolForced} model=${effectiveModel} tools=${tools ? JSON.stringify(tools.map(t => t.function.name)) : "none"}`);


  // ── Build messages from persisted history ──
  const history: Array<{ role: string; content: string }> = thread.messages.map(m => ({
    role: m.role,
    content: m.content,
  }));

  // ── Build system prompt (shared logic) ──
  let systemMsg = buildSystemPrompt({
    userText: text,
    isDocRequest,
    isGenerationIntent,
    source,
  });

  // Set chat title: #channel-name · msg_preview  or  DM · username · msg_preview
  const msgPreview = text.length > 60 ? text.slice(0, 57) + "…" : text;
  const chatTitle = channel_name
    ? `#${channel_name} · ${msgPreview}`
    : `DM · ${userName || userId} · ${msgPreview}`;
  // Only set title on the first message (don't overwrite with follow-ups)
  if (thread.messages.length <= 1) {
    setChatTitle(chatId, chatTitle);
  }

  // ── Search query reformulation for follow-ups ──
  // If the current message is short/referential and there's thread history,
  // reformulate the search query using prior context (e.g. "and in India?" → "iPhone 16 price India")
  let searchQuery = text;
  const FOLLOWUP_PATTERN = /^(and |what about |how about |also |but |in |for |price |cost |compare)/i;
  const isShortFollowUp = text.split(/\s+/).length <= 8 && thread.messages.length > 1;
  if (isShortFollowUp && (FOLLOWUP_PATTERN.test(text) || text.length < 40)) {
    // Extract topic from the most recent assistant + user messages
    const recentMsgs = thread.messages.slice(-4);
    const topicParts: string[] = [];
    for (const m of recentMsgs) {
      if (m.role === "user" && m.content !== userContent) {
        // Prior user message — extract the core topic (first 60 chars, no file tags)
        const clean = m.content.replace(/<file[\s\S]*?<\/file>/g, "").trim();
        if (clean.length > 3) topicParts.push(clean.slice(0, 60));
      }
    }
    if (topicParts.length > 0) {
      // Take the last user topic and combine with current query
      const topic = topicParts[topicParts.length - 1];
      searchQuery = `${topic} ${text}`.replace(/\s+/g, " ").trim();
      console.log(`[search] source=${source} reformulated="${searchQuery}" original="${text}"`);
    }
  }

  // ── Web search ──
  let searchResults: SearchResult[] = [];
  let fetchedCount = 0;
  let totalFetchTargets = 0;

  if (shouldSearch) {
    const searchStartTime = Date.now();
    try {
      const newsPattern = /\b(news|headline|today|this week|score|weather|stock|price)\b/i;
      const recency = newsPattern.test(searchQuery) ? "month" : undefined;

      const groundedPromise = (async () => {
        const raw = await performSearch(searchQuery, recency, 8);
        searchResults = rankAndFilterResults(raw);

        if (searchResults.length === 0) {
          systemMsg += "\n\nWeb search returned no live results for this query. Answer from your training data with a one-line caveat that results may be outdated.";
          return;
        }

        const urlsToFetch = searchResults.slice(0, 6).map(r => r.url);
        totalFetchTargets = urlsToFetch.length;

        const pageTexts = new Map<string, string>();
        const fetchResults = await fetchPagesWithConcurrency(urlsToFetch, 3, 4000);

        for (const fr of fetchResults) {
          if (fr.text && fr.chars > 100) {
            pageTexts.set(fr.url, fr.text);
            fetchedCount++;
          }
        }

        const searchContext = buildSearchContext(searchResults, pageTexts);
        systemMsg += searchContext;

        const lastUserIdx = history.map(m => m.role).lastIndexOf("user");
        if (lastUserIdx >= 0) {
          const origContent = history[lastUserIdx].content;
          history[lastUserIdx].content =
            `Use the search results above to answer this question. Cite with [n].\n\nQuestion: ${origContent}`;
        }
      })();

      const deadlinePromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("retrieval_deadline")), 8000)
      );

      try {
        await Promise.race([groundedPromise, deadlinePromise]);
      } catch (deadlineErr) {
        if (deadlineErr instanceof Error && deadlineErr.message === "retrieval_deadline") {
          console.log(`[search] source=${source} 8s deadline hit — proceeding with whatever is ready. fetchedCount=${fetchedCount} total=${totalFetchTargets}`);
          if (searchResults.length > 0) {
            const searchContext = buildSearchContext(searchResults);
            systemMsg += searchContext;
            const lastUserIdx = history.map(m => m.role).lastIndexOf("user");
            if (lastUserIdx >= 0) {
              const origContent = history[lastUserIdx].content;
              history[lastUserIdx].content =
                `Use the search results above to answer this question. Cite with [n].\n\nQuestion: ${origContent}`;
            }
          }
        } else {
          throw deadlineErr;
        }
      }

      const totalMs = Date.now() - searchStartTime;
      console.log(`[search] source=${source} query="${searchQuery}"${searchQuery !== text ? ` original="${text}"` : ""} results=${searchResults.length} fetched=${fetchedCount} total_targets=${totalFetchTargets} ms=${totalMs}`);
    } catch (err) {
      console.error("[integrations/chat] Search failed:", err);
    }
  } else if (web_search) {
    // For short follow-ups, also check if the reformulated query needs search
    if (searchQuery !== text && needsFreshData(searchQuery)) {
      // The original didn't trigger search but the reformulated one should
      const searchStartTime = Date.now();
      try {
        const newsPattern = /\b(news|headline|today|this week|score|weather|stock|price)\b/i;
        const recency = newsPattern.test(searchQuery) ? "month" : undefined;
        const raw = await performSearch(searchQuery, recency, 8);
        searchResults = rankAndFilterResults(raw);
        if (searchResults.length > 0) {
          const urlsToFetch = searchResults.slice(0, 6).map(r => r.url);
          totalFetchTargets = urlsToFetch.length;
          const pageTexts = new Map<string, string>();
          const fetchResults = await fetchPagesWithConcurrency(urlsToFetch, 3, 4000);
          for (const fr of fetchResults) {
            if (fr.text && fr.chars > 100) {
              pageTexts.set(fr.url, fr.text);
              fetchedCount++;
            }
          }
          const searchContext = buildSearchContext(searchResults, pageTexts);
          systemMsg += searchContext;
          const lastUserIdx = history.map(m => m.role).lastIndexOf("user");
          if (lastUserIdx >= 0) {
            const origContent = history[lastUserIdx].content;
            history[lastUserIdx].content =
              `Use the search results above to answer this question. Cite with [n].\n\nQuestion: ${origContent}`;
          }
        }
        const totalMs = Date.now() - searchStartTime;
        console.log(`[search] source=${source} query="${searchQuery}" reformulated="${text}" results=${searchResults.length} fetched=${fetchedCount} ms=${totalMs}`);
      } catch (err) {
        console.error("[integrations/chat] Reformulated search failed:", err);
      }
    } else {
      console.log(`[search] source=${source} query="${text}" needsSearch=false`);
    }
  }

  // Build final messages for the provider
  const messages = [
    { role: "system", content: systemMsg },
    ...history,
  ];

  logMessages("messages_to_model", messages as Array<{ role: string; content: string }>);

  // ── Stream the response (with tool calling for doc/image intents) ──
  const encoder = new TextEncoder();
  const startTime = Date.now();

  const readable = new ReadableStream({
    async start(controller) {
      const sendSSE = (data: string) => controller.enqueue(encoder.encode(`data: ${data}\n\n`));

      // Emit sources
      if (searchResults.length > 0) {
        sendSSE(JSON.stringify({
          type: "sources",
          items: searchResults.map(r => ({
            title: r.title,
            url: r.url,
            domain: r.domain,
            favicon: r.favicon,
            published_at: r.published_at,
          })),
        }));
      }

      // If doc intent, emit status
      if (isDocRequest) {
        sendSSE(JSON.stringify({ type: "status", text: "Writing content…" }));
      }

      try {
        const completionRequest: any = {
          messages: messages as any,
          model: effectiveModel,
          stream: true,
          max_tokens: isDocRequest ? 10000 : 4096,
        };
        if (tools) completionRequest.tools = tools;
        if (toolChoice) completionRequest.tool_choice = toolChoice;

        console.log(`[turn] source=${source} provider_request tools=${tools ? tools.map(t => t.function.name).join(",") : "none"} tool_choice=${toolChoice ? JSON.stringify(toolChoice) : "none"} max_tokens=${completionRequest.max_tokens}`);

        const response = await adapter.complete(completionRequest);

        // HTML guard
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("text/html")) {
          const htmlSnippet = await response.text().catch(() => "");
          console.error(`[integrations/chat] Provider returned HTML (status ${response.status}). Body: ${htmlSnippet.slice(0, 300)}`);
          sendSSE(JSON.stringify({ type: "error", text: slackError("Provider returned HTML — check base URL configuration") }));
          sendSSE("[DONE]");
          controller.close();
          return;
        }

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[integrations/chat] Provider error ${response.status}: ${errorText}`);
          sendSSE(JSON.stringify({ type: "error", text: slackError(`Provider error ${response.status}: ${errorText.replace(/<[^>]*>/g, "").slice(0, 150)}`) }));
          sendSSE("[DONE]");
          controller.close();
          return;
        }

        if (!response.body) {
          sendSSE(JSON.stringify({ type: "error", text: slackError("No response body from provider") }));
          sendSSE("[DONE]");
          controller.close();
          return;
        }

        // Parse SSE stream — also captures tool_calls
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = "";
        let fullText = "";
        let inputTokens = 0;
        let outputTokens = 0;
        let servedModel = selectedModel;

        // Tool call accumulation (streamed as deltas)
        const toolCallParts: Map<number, { id: string; name: string; arguments: string }> = new Map();
        let finishReason = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split("\n");
          sseBuffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;
            if (trimmed === "data: [DONE]") continue;

            try {
              const parsed = JSON.parse(trimmed.slice(6));

              if (parsed.error && typeof parsed.message === "string" && parsed.message.includes("<!DOCTYPE")) {
                console.error(`[integrations/chat] Provider SSE HTML error: ${parsed.message.slice(0, 300)}`);
                sendSSE(JSON.stringify({ type: "error", text: slackError("Provider returned HTML — check base URL configuration") }));
                sendSSE("[DONE]");
                controller.close();
                return;
              }

              const choice = parsed.choices?.[0];

              // Capture content delta
              const delta = choice?.delta?.content || "";
              if (delta) {
                fullText += delta;
                sendSSE(JSON.stringify({ type: "content", text: delta }));
              }

              // Capture tool_calls delta (streamed incrementally)
              const tcDeltas = choice?.delta?.tool_calls;
              if (tcDeltas && Array.isArray(tcDeltas)) {
                for (const tc of tcDeltas) {
                  const idx = tc.index ?? 0;
                  if (!toolCallParts.has(idx)) {
                    toolCallParts.set(idx, { id: tc.id || "", name: tc.function?.name || "", arguments: "" });
                  }
                  const part = toolCallParts.get(idx)!;
                  if (tc.id) part.id = tc.id;
                  if (tc.function?.name) part.name = tc.function.name;
                  if (tc.function?.arguments) part.arguments += tc.function.arguments;
                }
              }

              // Capture finish_reason
              if (choice?.finish_reason) finishReason = choice.finish_reason;

              if (parsed.usage) {
                inputTokens = parsed.usage.prompt_tokens || parsed.usage.input_tokens || inputTokens;
                outputTokens = parsed.usage.completion_tokens || parsed.usage.output_tokens || outputTokens;
              }

              if (parsed.model) servedModel = parsed.model;
            } catch {
              // Skip malformed chunks
            }
          }
        }

        // ── Handle tool calls ──
        if (toolCallParts.size > 0 || finishReason === "tool_calls") {
          for (const [idx, tc] of toolCallParts) {
            console.log(`[turn] source=${source} tool_call=${tc.name} id=${tc.id} args_len=${tc.arguments.length}`);

            if (tc.name === "create_pdf") {
              sendSSE(JSON.stringify({ type: "status", text: "Generating document…" }));

              let args: { title: string; subtitle?: string; content_markdown: string; theme?: string; pages?: number };
              try {
                args = JSON.parse(tc.arguments);
              } catch {
                console.error(`[turn] source=${source} tool=create_pdf result=parse_error args=${tc.arguments.slice(0, 200)}`);
                sendSSE(JSON.stringify({ type: "error", text: slackError("Failed to parse document content from model") }));
                continue;
              }

              // Extract requested pages: prefer tool arg, fallback to regex on user text
              const requestedPages = args.pages || parseTargetPages(text)?.target;
              console.log(`[turn] source=${source} tool=create_pdf requested_pages=${requestedPages ?? 'auto'} tool_arg_pages=${args.pages ?? 'none'}`);

              try {
                // Use the tool call's content_markdown as the full document content
                const docContent = `# ${args.title}\n\n${args.content_markdown}`;
                sendSSE(JSON.stringify({ type: "status", text: "Rendering PDF…" }));

                // Keepalive: send status events every 5s so proxies don't kill idle SSE body
                const pdfGenStart = Date.now();
                const pdfKeepalive = setInterval(() => {
                  const elapsed = Math.round((Date.now() - pdfGenStart) / 1000);
                  sendSSE(JSON.stringify({ type: "status", text: `Rendering PDF… (${elapsed}s)` }));
                }, 5000);

                let docResult;
                try {
                  docResult = await generateDocumentFromContent(docContent, text, chatId, source + "-" + tc.id, undefined, requestedPages);
                } finally {
                  clearInterval(pdfKeepalive);
                }

                if (docResult) {
                  sendSSE(JSON.stringify({
                    type: "file",
                    url: docResult.url,
                    filename: docResult.filename,
                    mimeType: docResult.mimeType,
                    pages: docResult.pages,
                    size_bytes: docResult.size_bytes,
                    file_id: docResult.file_id,
                    title: docResult.title,
                  }));
                  fullText = `[Generated PDF: ${docResult.title} (${docResult.pages} pages)]`;
                  console.log(`[turn] source=${source} tool=create_pdf requested_pages=${requestedPages ?? 'auto'} result.pages=${docResult.pages} result={filename: "${docResult.filename}", size: ${docResult.size_bytes}}`);
                } else {
                  sendSSE(JSON.stringify({ type: "error", text: slackError("Document generation failed — the renderer may not be available") }));
                  console.error(`[turn] source=${source} tool=create_pdf result=failed (generateDocumentFromContent returned null)`);
                }
              } catch (toolErr: any) {
                const errMsg = toolErr?.message || "Unknown error";
                console.error(`[turn] source=${source} tool=create_pdf result=error: ${errMsg}`, toolErr?.stack);
                sendSSE(JSON.stringify({ type: "error", text: slackError(`Document generation failed: ${errMsg}`) }));
              }
            } else if (tc.name === "create_image") {
              sendSSE(JSON.stringify({ type: "status", text: "Generating image…" }));

              let args: { prompt: string; size?: string };
              try {
                args = JSON.parse(tc.arguments);
              } catch {
                console.error(`[turn] source=${source} tool=create_image result=parse_error args=${tc.arguments.slice(0, 200)}`);
                sendSSE(JSON.stringify({ type: "error", text: slackError("Failed to parse image description from model") }));
                continue;
              }

              try {
                // Keepalive: send status events every 5s so proxies don't kill idle SSE body
                const imgGenStart = Date.now();
                const keepalive = setInterval(() => {
                  const elapsed = Math.round((Date.now() - imgGenStart) / 1000);
                  sendSSE(JSON.stringify({ type: "status", text: `Generating image… (${elapsed}s)` }));
                }, 5000);

                let imageResult;
                try {
                  imageResult = await generateImageFromText(args.prompt, chatId, source + "-" + tc.id);
                } finally {
                  clearInterval(keepalive);
                }

                if (imageResult) {
                  sendSSE(JSON.stringify({
                    type: "image",
                    url: imageResult.url,
                    revised_prompt: imageResult.revised_prompt,
                    id: imageResult.id,
                    model: imageResult.model,
                    provider: imageResult.provider,
                  }));
                  fullText = `[Generated image: ${imageResult.revised_prompt}]`;
                  console.log(`[turn] source=${source} tool=create_image result={id: "${imageResult.id}", prompt: "${(imageResult.revised_prompt || '').slice(0, 60)}"}`);
                } else {
                  sendSSE(JSON.stringify({ type: "error", text: slackError("Image generation failed. Try a more descriptive prompt.") }));
                  console.error(`[turn] source=${source} tool=create_image result=failed (generateImageFromText returned null)`);
                }
              } catch (toolErr: any) {
                const errMsg = toolErr?.message || "Unknown error";
                console.error(`[turn] source=${source} tool=create_image result=error: ${errMsg}`, toolErr?.stack);
                sendSSE(JSON.stringify({ type: "error", text: slackError(`Image generation failed: ${errMsg}`) }));
              }
            }
          }
        }

        const latencyMs = Date.now() - startTime;

        // ── "Cannot create" guard: if doc/image intent produced a refusal (no tool call), retry with forced instruction ──
        if (isGenerationIntent && toolCallParts.size === 0 && CANNOT_CREATE_PATTERN.test(fullText) && fullText.length < 500) {
          console.log(`[turn] source=${source} intent_bypass — response contains "cannot create", retrying with forced tool`);
          sendSSE(JSON.stringify({ type: "status", text: "Retrying…" }));

          const retryMessages = [
            ...messages,
            { role: "assistant" as const, content: fullText },
            { role: "user" as const, content: "Do not say you cannot create files. You have file generation tools. Produce the content now as rich markdown. Start with the # title heading." },
          ];

          try {
            const retryRes = await adapter.complete({
              messages: retryMessages as any,
              model: effectiveModel,
              stream: false,
              max_tokens: isDocRequest ? 10000 : 4096,
            });

            if (retryRes.ok) {
              const retryData = await retryRes.json();
              const retryContent = retryData.choices?.[0]?.message?.content || "";
              if (retryContent.length > 100 && !CANNOT_CREATE_PATTERN.test(retryContent)) {
                fullText = retryContent;
                // Send the full retry content as a single content event
                sendSSE(JSON.stringify({ type: "replace_content" }));
                sendSSE(JSON.stringify({ type: "content", text: retryContent }));
                console.log(`[turn] source=${source} intent_bypass retry succeeded (${retryContent.length} chars)`);
              }
            }
          } catch (retryErr) {
            console.error("[integrations/chat] Cannot-create retry failed:", retryErr);
          }
        }

        // ── Intent bypass guard (recommends external tools) — only when no tool call was made ──
        if (isGenerationIntent && toolCallParts.size === 0 && INTENT_BYPASS_PATTERN.test(fullText)) {
          console.log(`[turn] source=${source} intent_bypass — response recommends external tools, retrying`);

          const bypassMessages = [
            ...messages,
            { role: "assistant" as const, content: fullText },
            { role: "user" as const, content: "Do not recommend external tools or platforms. Produce the content directly as markdown. Start with the # title heading." },
          ];

          try {
            const bypassRes = await adapter.complete({
              messages: bypassMessages as any,
              model: effectiveModel,
              stream: false,
              max_tokens: isDocRequest ? 10000 : 4096,
            });

            if (bypassRes.ok) {
              const bypassData = await bypassRes.json();
              const bypassContent = bypassData.choices?.[0]?.message?.content || "";
              if (bypassContent.length > 100 && !INTENT_BYPASS_PATTERN.test(bypassContent)) {
                fullText = bypassContent;
                sendSSE(JSON.stringify({ type: "replace_content" }));
                sendSSE(JSON.stringify({ type: "content", text: bypassContent }));
                console.log(`[turn] source=${source} intent_bypass retry succeeded (${bypassContent.length} chars)`);
              }
            }
          } catch (bypassErr) {
            console.error("[integrations/chat] Intent bypass retry failed:", bypassErr);
          }
        }

        // ── Hallucination guard ──
        if (searchResults.length > 0 && HALLUCINATION_PATTERN.test(fullText)) {
          console.log(`[turn] source=${source} hallucination guard triggered`);

          const guardMessages = [
            ...messages,
            { role: "assistant" as const, content: fullText },
            { role: "user" as const, content: "The search results confirm this exists and is real. Answer from the search results provided. Do not say it is unreleased, unannounced, or that you lack information. Provide the factual answer with citations." },
          ];

          try {
            const guardRes = await adapter.complete({
              messages: guardMessages as any,
              model: effectiveModel,
              stream: false,
              max_tokens: 4096,
            });

            if (guardRes.ok) {
              const guardData = await guardRes.json();
              const guardContent = guardData.choices?.[0]?.message?.content || "";
              if (guardContent.length > 50 && !HALLUCINATION_PATTERN.test(guardContent)) {
                fullText = guardContent;
                sendSSE(JSON.stringify({ type: "replace_content" }));
                sendSSE(JSON.stringify({ type: "content", text: guardContent }));
              }
            }
          } catch (guardErr) {
            console.error("[integrations/chat] Hallucination guard failed:", guardErr);
          }
        }

        // ── Fallback document generation: if doc intent but no tool call produced a file ──
        if (isDocRequest && toolCallParts.size === 0 && fullText.length > 100) {
          sendSSE(JSON.stringify({ type: "status", text: "Rendering PDF…" }));

          // Keepalive for fallback doc generation
          const fbStart = Date.now();
          const fbKeepalive = setInterval(() => {
            const elapsed = Math.round((Date.now() - fbStart) / 1000);
            sendSSE(JSON.stringify({ type: "status", text: `Rendering PDF… (${elapsed}s)` }));
          }, 5000);

          try {
            let docResult;
            try {
              docResult = await generateDocumentFromContent(fullText, text, chatId, source);
            } finally {
              clearInterval(fbKeepalive);
            }

            if (docResult) {
              sendSSE(JSON.stringify({
                type: "file",
                url: docResult.url,
                filename: docResult.filename,
                mimeType: docResult.mimeType,
                pages: docResult.pages,
                size_bytes: docResult.size_bytes,
                file_id: docResult.file_id,
                title: docResult.title,
              }));
              console.log(`[turn] source=${source} tool=create_pdf(fallback) result={filename: "${docResult.filename}", pages: ${docResult.pages}}`);
            } else {
              console.error(`[turn] source=${source} tool=create_pdf(fallback) result=failed`);
              sendSSE(JSON.stringify({ type: "error", text: slackError("Document rendering failed — the renderer may not be available") }));
            }
          } catch (docErr: any) {
            console.error(`[turn] source=${source} tool=create_pdf(fallback) result=error: ${docErr?.message}`, docErr?.stack);
            sendSSE(JSON.stringify({ type: "error", text: slackError(`Document rendering failed: ${docErr?.message || "Unknown error"}`) }));
          }
        }

        // ── Persist assistant response ──
        if (fullText) {
          pushMessage(thread, "assistant", fullText);
          console.log(`[integrations/chat] persisted assistant response (${fullText.length} chars), thread now has ${thread.messages.length} messages`);
        }

        console.log(`[integrations/chat] done via=${via} served_model=${servedModel} usage=${inputTokens}/${outputTokens} latency=${latencyMs}ms`);

        recordUsage({
          chat_id: chatId,
          chat_title: chatTitle,
          kind: "chat",
          provider: providerName,
          model: selectedModel,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cost_usd: computeCost(providerName, rawModelId, inputTokens, outputTokens),
          latency_ms: latencyMs,
          status: "ok",
        });

        sendSSE(
          JSON.stringify({
            type: "done",
            finish_reason: "stop",
            usage: {
              input_tokens: inputTokens,
              output_tokens: outputTokens,
              served_model: servedModel,
              requested_model: selectedModel,
            },
          })
        );
        sendSSE("[DONE]");
      } catch (err: any) {
        const fullErr = err?.stack || err?.message || "Provider request failed";
        console.error("[integrations/chat] Provider error (full):", fullErr);
        sendSSE(JSON.stringify({ type: "error", text: slackError(err?.message || "Provider request failed") }));
        sendSSE("[DONE]");
      }

      controller.close();
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
