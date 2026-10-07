import { NextRequest } from "next/server";
import { performSearch, needsFreshData, rankAndFilterResults, type SearchResult } from "@/app/api/web-search/route";
import { getAdapter, computeCost, resolveAdapter } from "@/lib/providerAdapters";
import { recordUsage, setChatTitle } from "@/lib/recordUsage";
import { NIA_GATEWAY_URL, NIA_API_KEY, validateConfig } from "@/lib/config";
import {
  detectIntent,
  getTodayString,
  taskInstructions as sharedTaskInstructions,
  HALLUCINATION_PATTERN,
  INTENT_BYPASS_PATTERN,
  DOC_KEYWORDS,
} from "@/lib/assistantTurn";
import { detectConnectorIntent, getConnectorToolsForUser, executeConnectorTool } from "@/lib/connectorTools";
import { getUserId } from "@/lib/session";

// Validate once at module load — throws if NIA_GATEWAY_URL === NIA_APP_URL
try { validateConfig(); } catch (e: any) { console.error(e.message); }

interface AttachmentRef {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  isImage?: boolean;
  extractedText?: string;
  pages?: number;
  base64DataUrl?: string;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
  attachments?: AttachmentRef[];
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

function buildMultimodalMessages(
  messages: ChatMessage[],
): { role: string; content: string | ContentPart[] }[] {
  const result: { role: string; content: string | ContentPart[] }[] = [];

  const userIndicesWithImages: number[] = [];
  messages.forEach((m, i) => {
    if (m.role === "user" && m.attachments?.some((a) => a.isImage)) {
      userIndicesWithImages.push(i);
    }
  });
  const recentImageIndices = new Set(userIndicesWithImages.slice(-3));

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === "system") {
      const content = typeof msg.content === "string" ? msg.content : "";
      result.push({ role: "system", content });
      continue;
    }

    if (msg.role === "assistant") {
      const content = typeof msg.content === "string" ? msg.content : "";
      result.push({ role: "assistant", content });
      continue;
    }

    const attachments = msg.attachments || [];
    const textContent = typeof msg.content === "string" ? msg.content : "";

    if (attachments.length === 0) {
      result.push({ role: "user", content: textContent || "Hello" });
      continue;
    }

    const parts: ContentPart[] = [];

    for (const att of attachments) {
      if (att.isImage && att.base64DataUrl) {
        if (recentImageIndices.has(i)) {
          parts.push({
            type: "image_url",
            image_url: { url: att.base64DataUrl },
          });
        } else {
          parts.push({
            type: "text",
            text: `[Previously attached image: ${att.name}]`,
          });
        }
      } else if (att.extractedText) {
        // Wrap in <file> tags for prompt injection safety
        const metaParts: string[] = [];
        if (att.pages) metaParts.push(`${att.pages} pages`);
        const metaStr = metaParts.length ? " " + metaParts.join(" ") : "";
        parts.push({
          type: "text",
          text: `<file name="${att.name}"${metaStr}>\n${att.extractedText}\n</file>`,
        });
      } else {
        parts.push({
          type: "text",
          text: `[Attached ${att.name} could not be read]`,
        });
      }
    }

    const userText =
      textContent.trim() ||
      "Please describe and summarise the attached file(s).";
    parts.push({ type: "text", text: userText });

    result.push({ role: "user", content: parts });
  }

  return result;
}

const taskInstructions = sharedTaskInstructions;

/* Task instructions now imported from @/lib/assistantTurn.ts */

/* getTodayString imported from @/lib/assistantTurn.ts */

/* ── Build search context string + citation instructions ───── */

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
    `IMPORTANT: Use the SEARCH RESULTS above as the source of truth. They are newer than your training data. ` +
    `If results mention a product, event, or fact — it EXISTS. Never say it is "unreleased", "unannounced", or "not available" when search results confirm otherwise. ` +
    `Cite sources with inline markers like [1], [2]. State the published date if relevant (e.g. "as of Sept 2026"). ` +
    `If results are empty or irrelevant, say you couldn't find current information.\n` +
    `When sources give different prices for the same product, state the official/manufacturer base price once and attribute higher figures to a variant or retailer in a short clause. Always state the storage variant and the date of the source (e.g. 'as of Oct 2026').\n` +
    `If two sources disagree on the same numeric quantity (spec, score) by more than 3%, mention both values with their citations instead of picking one.`
  );
}

/* ── Fetch readable page text (fail-safe, 4s hard timeout) ── */

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

    // Skip non-HTML content types
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html") && !ct.includes("text/plain") && !ct.includes("application/xhtml")) {
      clearTimeout(timer);
      return { url, status: res.status, ms: Date.now() - start, chars: 0, error: `non-html: ${ct.split(";")[0]}`, text: "" };
    }

    if (!res.ok) {
      clearTimeout(timer);
      return { url, status: res.status, ms: Date.now() - start, chars: 0, error: `HTTP ${res.status}`, text: "" };
    }

    // Race res.text() against the same abort controller — prevents slow-body hangs
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

/* ── Concurrent fetch with max concurrency ─────────────────── */

async function fetchPagesWithConcurrency(
  urls: string[],
  maxConcurrency: number,
  timeoutMs: number,
  onProgress?: (fetched: number, total: number) => void,
): Promise<FetchPageResult[]> {
  const results: FetchPageResult[] = [];
  let completed = 0;
  const queue = [...urls];

  async function worker() {
    while (queue.length > 0) {
      const url = queue.shift()!;
      const result = await fetchPageText(url, timeoutMs);
      results.push(result);
      completed++;
      onProgress?.(completed, urls.length);
    }
  }

  const workers = Array.from({ length: Math.min(maxConcurrency, urls.length) }, () => worker());
  await Promise.allSettled(workers);
  return results;
}

/* ── Linked page fetching (URL understanding) ──────────────── */

interface LinkedPage {
  url: string;
  title: string;
  description: string;
  text: string;
  thumbnail?: string;
  domain: string;
  favicon: string;
  error?: string;
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

function extractMeta(html: string): { title: string; description: string; ogImage: string; ogSiteName: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : "";

  const ogDesc = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']/i);
  const metaDesc = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
  const description = (ogDesc?.[1] || metaDesc?.[1] || "").trim();

  const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
  const ogImage = ogImageMatch?.[1] || "";

  const ogSiteMatch = html.match(/<meta[^>]*property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:site_name["']/i);
  const ogSiteName = ogSiteMatch?.[1] || "";

  // Strip HTML for text content
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > 4000) text = text.slice(0, 4000) + "\u2026";

  return { title, description, ogImage, ogSiteName, text };
}

async function tryOEmbed(url: string): Promise<{ title?: string; description?: string; thumbnail?: string } | null> {
  const domain = extractDomain(url);
  let oembedUrl: string | null = null;

  if (domain.includes("pinterest")) {
    oembedUrl = `https://www.pinterest.com/oembed.json?url=${encodeURIComponent(url)}`;
  } else if (domain.includes("twitter.com") || domain.includes("x.com")) {
    oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}`;
  } else if (domain.includes("instagram")) {
    // Instagram oembed requires access token — skip
    return null;
  }

  if (!oembedUrl) return null;

  try {
    const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      title: data.title || data.author_name,
      description: data.html ? data.html.replace(/<[^>]+>/g, " ").slice(0, 300) : undefined,
      thumbnail: data.thumbnail_url,
    };
  } catch { return null; }
}

async function fetchLinkedPages(urls: string[]): Promise<LinkedPage[]> {
  const results: LinkedPage[] = [];

  for (const url of urls.slice(0, 3)) {
    const domain = extractDomain(url);
    const favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        redirect: "follow",
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        // Try oEmbed for blocked sites
        const oembed = await tryOEmbed(url);
        results.push({
          url, domain, favicon,
          title: oembed?.title || domain,
          description: oembed?.description || "",
          text: "",
          thumbnail: oembed?.thumbnail,
          error: `Site returned ${res.status} (blocked)`,
        });
        continue;
      }

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
        results.push({
          url, domain, favicon,
          title: url.split("/").pop() || domain,
          description: `Non-HTML content: ${contentType}`,
          text: "",
          error: "Not an HTML page",
        });
        continue;
      }

      const html = await res.text();
      const meta = extractMeta(html);

      // If very little content extracted (could be JS-rendered), try oEmbed
      let oembed: { title?: string; description?: string; thumbnail?: string } | null = null;
      if (meta.text.length < 100) {
        oembed = await tryOEmbed(url);
      }

      results.push({
        url, domain, favicon,
        title: meta.title || oembed?.title || domain,
        description: meta.description || oembed?.description || "",
        text: meta.text,
        thumbnail: meta.ogImage || oembed?.thumbnail,
      });
    } catch (err) {
      // Try oEmbed as fallback
      const oembed = await tryOEmbed(url);
      results.push({
        url, domain, favicon,
        title: oembed?.title || domain,
        description: oembed?.description || "",
        text: "",
        thumbnail: oembed?.thumbnail,
        error: err instanceof Error ? err.message : "Fetch failed",
      });
    }
  }

  return results;
}

/* Hard guard patterns imported from @/lib/assistantTurn.ts */

/* ── Debug last-request store (dev-only, in-memory) ────────── */

let lastDebugRequest: {
  provider: string;
  requested_model: string;
  request_body: Record<string, unknown>;
  response_headers: Record<string, string>;
  served_model?: string;
  request_id?: string;
  timestamp: string;
} | null = null;

export function getLastDebugRequest() { return lastDebugRequest; }

/* ── Main handler ──────────────────────────────────────────── */

export async function POST(req: NextRequest) {
  const { messages, model, web_search, stream, task, timezone, target_pages, strict_pages, provider: rawProvider, thinking, chatId, messageId, chatTitle: bodyTitle, connector, connectorId } = await req.json();

    // Update chat title map for future title resolution
    if (chatId) {
      // chatTitle will be sent by the client; also auto-title updates it later
      setChatTitle(chatId, bodyTitle || "");
    }

  // Resolve adapter: (1) direct provider key → (2) NiaAI gateway → (3) error
  const requestedProvider: string = rawProvider || "niaai";
  const resolution = resolveAdapter(requestedProvider, model);
  const via = resolution?.via || "gateway";
  const effectiveProvider = via === "direct" ? requestedProvider : "nia";
  const useAdapter = via === "direct";
  const strippedModel = model ? model.replace(/^[^/]+\//, "") : model;
  const effectiveModel = useAdapter ? strippedModel : (model || "google/gemini-2.5-flash");

  // Generate a chat request ID for tracing
  const chatRequestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  if (!resolution) {
    // No adapter available — return structured error for the error card
    const providerName = requestedProvider.charAt(0).toUpperCase() + requestedProvider.slice(1);
    const modelLabel = model || "this model";
    return Response.json({
      error: true,
      error_type: "no_provider",
      title: `Can't reach ${modelLabel.replace(/^[^/]+\//, "")}`,
      message: `No API key configured for ${providerName}.`,
      provider: requestedProvider,
      model: model,
      actions: ["use_gateway", "open_settings", "retry"],
    }, { status: 400 });
  }

  const hasAttachments = messages.some(
    (m: ChatMessage) => m.attachments && m.attachments.length > 0,
  );

  let processedMessages: { role: string; content: string | ContentPart[] }[];

  if (hasAttachments) {
    processedMessages = buildMultimodalMessages(messages);

    const attachmentInstruction =
      "If files are attached, base your answer on their content and reference them by name. Never say you cannot see the file when one is attached.\nIf a file failed to process, say exactly: 'I couldn't read {file}: {reason}. Try re-uploading.' — nothing else. Never suggest workarounds, online tools, or alternative approaches for failed file reads.";

    if (
      processedMessages.length > 0 &&
      processedMessages[0].role === "system"
    ) {
      processedMessages[0].content =
        processedMessages[0].content + "\n" + attachmentInstruction;
    } else {
      processedMessages.unshift({
        role: "system",
        content: attachmentInstruction,
      });
    }
  } else {
    processedMessages = messages.map((m: ChatMessage) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : "",
    }));
  }

  // Prepend task-specific instruction
  if (task && taskInstructions[task]) {
    const taskInstruction = taskInstructions[task];
    if (
      processedMessages.length > 0 &&
      processedMessages[0].role === "system"
    ) {
      processedMessages[0].content =
        taskInstruction + "\n\n" + processedMessages[0].content;
    } else {
      processedMessages.unshift({
        role: "system",
        content: taskInstruction,
      });
    }
  }

  // Append word budget instruction for document tasks with target pages
  if (task === "document" && target_pages && typeof target_pages === "number") {
    const WORDS_PER_PAGE = 430;
    const hasCover = target_pages >= 4;
    const contentPages = hasCover ? target_pages - 1 : target_pages;
    const targetWords = contentPages * WORDS_PER_PAGE;
    const numSections = Math.max(2, Math.min(contentPages, 8));
    const perSection = Math.round(targetWords / numSections);
    const strictNote = strict_pages ? `EXACTLY ${target_pages} pages — do not write more or fewer.` : `Target approximately ${target_pages} pages.`;
    const budgetInstruction = `\n\n${strictNote} Write approximately ${targetWords} words (±5%), split into ${numSections} top-level sections of ~${perSection} words each. No section may be shorter than 60% of its budget. ${hasCover ? "The first page will be a cover page." : "No cover page — title block is on page 1."}${target_pages >= 8 ? " Include a Table of Contents." : " No Table of Contents needed."}`;

    if (processedMessages.length > 0 && processedMessages[0].role === "system") {
      processedMessages[0].content = processedMessages[0].content + budgetInstruction;
    }
  }

  // Inject document creation capability instruction
  const docKeywords = DOC_KEYWORDS;
  const lastUserMessage = processedMessages.filter(m => m.role === "user").pop();
  const lastUserText = typeof lastUserMessage?.content === "string" ? lastUserMessage.content : "";
  const isDocRequest = task === "document" || task === "slides" || docKeywords.test(lastUserText);

  // Parse target pages from user message
  const pageMatch = lastUserText.match(/\b(\d{1,3})\s*[-\s]?pages?\b/i);
  const targetPages = pageMatch ? parseInt(pageMatch[1], 10) : null;

  if (isDocRequest && !task) {
    // Auto-inject document task instruction if not already set
    let docInstruction = taskInstructions["document"];
    if (targetPages) {
      docInstruction = `Write approximately ${targetPages * 450} words across ${targetPages} top-level H1 sections.${targetPages <= 5 ? ' Do NOT include a Table of Contents.' : ''}\n\n` + docInstruction;
    }
    if (processedMessages.length > 0 && processedMessages[0].role === "system") {
      processedMessages[0].content = docInstruction + "\n\n" + processedMessages[0].content;
    } else {
      processedMessages.unshift({ role: "system", content: docInstruction });
    }
  }

  // Also inject page guidance when task is explicitly set
  if (isDocRequest && task && targetPages) {
    const pageGuidance = `Write approximately ${targetPages * 450} words across ${targetPages} top-level H1 sections.${targetPages <= 5 ? ' Do NOT include a Table of Contents.' : ''}`;
    if (processedMessages.length > 0 && processedMessages[0].role === "system") {
      processedMessages[0].content = pageGuidance + "\n\n" + processedMessages[0].content;
    } else {
      processedMessages.unshift({ role: "system", content: pageGuidance });
    }
  }

  // Safety instruction
  const safetyInstruction =
    "Never fabricate URLs, file paths, or links. If you cannot produce an asset, say so.";
  if (
    processedMessages.length > 0 &&
    processedMessages[0].role === "system"
  ) {
    processedMessages[0].content =
      processedMessages[0].content + "\n" + safetyInstruction;
  } else {
    processedMessages.unshift({ role: "system", content: safetyInstruction });
  }


  // 1. Always inject today's date at the start of the system prompt
  const dateString = getTodayString(timezone);
  const dateInstruction = `${dateString} Your training data may be outdated; for anything that could have changed since then (prices, releases, news, people in roles, versions, scores, weather), use the search results provided rather than guessing. Never say an event "hasn't happened yet" without checking the search results.`;

  if (
    processedMessages.length > 0 &&
    processedMessages[0].role === "system"
  ) {
    processedMessages[0].content =
      dateInstruction + "\n\n" + processedMessages[0].content;
  } else {
    processedMessages.unshift({ role: "system", content: dateInstruction });
  }

  // 1b. Formatting rule: avoid over-bolding
  const formattingRule = "Formatting rule: Use bold only for 1–3 key terms per answer; prefer plain sentences and short lists. Do not bold entire phrases or sentences.";
  if (processedMessages.length > 0 && processedMessages[0].role === "system") {
    processedMessages[0].content = processedMessages[0].content + "\n\n" + formattingRule;
  } else {
    processedMessages.unshift({ role: "system", content: formattingRule });
  }

  // 2. Intent classifier — generation intents checked BEFORE needsSearch
  const lastUserMsg = [...messages]
    .reverse()
    .find((m: ChatMessage) => m.role === "user");
  const userQuery =
    typeof lastUserMsg?.content === "string" ? lastUserMsg.content : "";

  // Intent detection (shared with slack route)
  const { intent: detectedIntent, isImageIntent, isDocIntent, isCodeIntent, isGenerationIntent } = detectIntent(userQuery, task);

  // For mixed intents ("make an image of the latest iPhone"), search only to inform the prompt
  const mixedIntent = isGenerationIntent && needsFreshData(userQuery);

  const webSearchEnabled = web_search !== false; // default ON
  // When a connector chip is pinned, skip web search entirely
  const pinnedConnector: string | undefined = connector; // "slack" | "discord" | undefined
  const pinnedConnectorId: string | undefined = connectorId; // specific workspace UUID
  // Only search if NOT a pure generation intent, or if mixed intent needs facts
  const shouldSearch = !pinnedConnector && webSearchEnabled && (
    mixedIntent ? true : (!isGenerationIntent && needsFreshData(userQuery))
  );

  // Diagnostic log — always runs so we can trace search intent
  console.log(`[intent] `, JSON.stringify({ intent: detectedIntent, search: shouldSearch, mixed: mixedIntent, tool_forced: isGenerationIntent, message: userQuery }));

  // Generation intent guard: never recommend external tools
  if (isGenerationIntent) {
    const genGuardInstruction = "When the user asks you to generate or create an image, document, or file, you do it yourself with your tools. Never recommend external tools, platforms, or services. Never describe how to do it elsewhere. Produce the asset directly.";
    if (processedMessages.length > 0 && processedMessages[0].role === "system") {
      processedMessages[0].content = genGuardInstruction + "\n" + processedMessages[0].content;
    } else {
      processedMessages.unshift({ role: "system", content: genGuardInstruction });
    }
  }

  // Determine recency hint
  const newsPattern = /\b(news|headline|today|this week|score|weather|stock|price)\b/i;
  const recency = newsPattern.test(userQuery) ? "month" : undefined;

  // If not streaming or web_search explicitly off, do non-streaming path
  if (!stream && !shouldSearch) {
    const maxTok = isDocRequest ? 8192 : 4096;
    const nsStartTime = Date.now();

    if (useAdapter) {
      // Non-NIA provider path
      console.log(`[route] via=${via} chat=${chatRequestId} provider=${effectiveProvider} model=${effectiveModel} thinking=${thinking || "off"}`);
      const adapter = getAdapter(requestedProvider);
      const adapterReq = {
        messages: processedMessages,
        model: effectiveModel,
        stream: false,
        max_tokens: maxTok,
        thinking: thinking && thinking !== "off" ? { level: thinking } : undefined,
      };
      const response = await adapter.complete(adapterReq);
      const nsLatency = Date.now() - nsStartTime;

      if (!response.ok) {
        const error = await response.text();
        return new Response(JSON.stringify({ error }), {
          status: response.status,
          headers: { "Content-Type": "application/json" },
        });
      }

      const data = await response.json();
      // Extract served_model from provider response
      const servedModel = data.model || effectiveModel;
      const providerRequestId = data.id || "";
      console.log(`[route] via=${via} done provider_model=${servedModel} request_id=${providerRequestId} usage=${data.usage?.prompt_tokens || 0}/${data.usage?.completion_tokens || 0}`);

      // Attach usage metadata
      const inTok = data.usage?.prompt_tokens || 0;
      const outTok = data.usage?.completion_tokens || 0;
      data._usage = {
        type: "usage",
        input_tokens: inTok,
        output_tokens: outTok,
        cached_input_tokens: 0,
        reasoning_tokens: 0,
        latency_ms: nsLatency,
        ttft_ms: nsLatency,
        cost_usd: computeCost(requestedProvider, effectiveModel, inTok, outTok),
        provider: requestedProvider,
        model: effectiveModel,
        model_id: model,
        thinking_level: thinking || "off",
        served_model: servedModel,
        request_id: providerRequestId,
        requested_model: effectiveModel,
      };

      // Store debug info
      lastDebugRequest = {
        provider: requestedProvider,
        requested_model: effectiveModel,
        request_body: { model: effectiveModel, max_tokens: maxTok, stream: false, messages: `[${processedMessages.length} messages]` },
        response_headers: {},
        served_model: servedModel,
        request_id: providerRequestId,
        timestamp: new Date().toISOString(),
      };

      // Record usage server-side
      recordUsage({
        chat_id: chatId,
        message_id: messageId,
        kind: "chat",
        provider: requestedProvider,
        model: effectiveModel,
        input_tokens: inTok,
        output_tokens: outTok,
        cost_usd: computeCost(requestedProvider, effectiveModel, inTok, outTok),
        latency_ms: nsLatency,
        ttft_ms: nsLatency,
      });

      return Response.json(data);
    }

    // Default NIA path
    const body: Record<string, unknown> = {
      model: model || "google/gemini-2.5-flash",
      messages: processedMessages,
      stream: false,
      max_tokens: maxTok,
    };

    const response = await fetch(`${NIA_GATEWAY_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${NIA_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      return new Response(JSON.stringify({ error }), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const niaData = data;
    const nsNiaLatency = Date.now() - nsStartTime;
    const nsNiaIn = niaData.usage?.prompt_tokens || 0;
    const nsNiaOut = niaData.usage?.completion_tokens || 0;
    recordUsage({
      chat_id: chatId,
      message_id: messageId,
      kind: "chat",
      provider: "niaai",
      model: model || "google/gemini-2.5-flash",
      input_tokens: nsNiaIn,
      output_tokens: nsNiaOut,
      cost_usd: computeCost("nia", model || "google/gemini-2.5-flash", nsNiaIn, nsNiaOut),
      latency_ms: nsNiaLatency,
      ttft_ms: nsNiaLatency,
    });
    return Response.json(data);
  }

  // Streaming path with optional search
  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      const sendSSE = (data: string) => {
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      const sendEvent = (event: Record<string, unknown>) => {
        sendSSE(JSON.stringify(event));
      };

      let searchResults: SearchResult[] = [];
      const searchStartTime = Date.now();
      let fetchedCount = 0;
      let totalFetchTargets = 0;
      let fallbackSnippets = 0;

      // 2b. Detect URLs in the latest user message and fetch linked pages
      const urlRegex = /https?:\/\/[^\s)}\]"']+/g;
      const detectedUrls = (userQuery.match(urlRegex) || []).slice(0, 3);
      let linkedPages: LinkedPage[] = [];

      if (detectedUrls.length > 0) {
        try {
          // Emit status for each domain being read
          const domains = detectedUrls.map((u: string) => extractDomain(u));
          for (const d of domains) {
            sendEvent({ type: "status", text: `Reading ${d}\u2026` });
          }

          linkedPages = await fetchLinkedPages(detectedUrls);
          console.log(`[url-fetch] fetched ${linkedPages.length} linked pages:`, JSON.stringify(linkedPages.map(p => ({ url: p.url, title: p.title, chars: p.text.length, error: p.error }))));

          // Record tool_link events for each URL fetch
          for (const page of linkedPages) {
            recordUsage({
              chat_id: chatId || "",
              message_id: messageId || "",
              kind: "tool_link",
              provider: "fetch",
              model: "",
              input_tokens: 0,
              output_tokens: 0,
              cost_usd: 0,
              latency_ms: 0,
              status: page.error ? "error" : "ok",
              error_message: page.error || "",
              chat_title: bodyTitle || "",
            });
          }

          // Emit link_cards event for the frontend
          const linkCardItems = linkedPages.map(p => ({
            url: p.url,
            title: p.title,
            description: p.description,
            thumbnail: p.thumbnail,
            domain: p.domain,
            favicon: p.favicon,
          }));
          if (linkCardItems.length > 0) {
            sendEvent({ type: "link_cards", items: linkCardItems });
          }

          // Build linked page context and inject into messages
          const pageContextParts: string[] = [];
          for (let i = 0; i < linkedPages.length; i++) {
            const page = linkedPages[i];
            let entry = `LINKED PAGE [${i + 1}] ${page.title} \u2014 ${page.url}\n`;
            if (page.description) entry += `${page.description}\n`;
            if (page.error) {
              entry += `Couldn't open this link (${page.error})`;
              if (page.text) entry += `\n${page.text}`;
            } else {
              if (page.thumbnail) entry += `The page has an image: ${page.thumbnail}\n`;
              entry += page.text;
            }
            pageContextParts.push(entry);
          }

          if (pageContextParts.length > 0) {
            const linkContext = "\n\n" + pageContextParts.join("\n\n") + "\n\n--- End Linked Pages ---";
            const linkInstruction = "The user shared link(s); answer about their content. If a link couldn't be fetched, say so and summarize what the URL itself suggests.";

            if (processedMessages.length > 0 && processedMessages[0].role === "system") {
              processedMessages[0].content = processedMessages[0].content + linkContext + "\n" + linkInstruction;
            } else {
              processedMessages.unshift({ role: "system", content: linkContext + "\n" + linkInstruction });
            }
          }
        } catch (err) {
          console.error("[url-fetch] failed:", err);
        }
      }

      // 3. If needs fresh data, perform search + fetch with 8s hard deadline
      if (shouldSearch) {
        try {
          // Wrap the entire grounded path in a race against 8s deadline
          const groundedPromise = (async () => {
            // Emit searching status (use lighter text for mixed generation intents)
            sendEvent({ type: "status", text: mixedIntent ? "Searching to refine prompt\u2026" : "Searching the web\u2026" });

            // Round 1: primary search
            const searchStart = Date.now();
            searchResults = await performSearch(userQuery, recency, 8);

            // Apply ranking and filtering
            searchResults = rankAndFilterResults(searchResults);

            const searchMs = Date.now() - searchStart;
            console.log(`[search] results:`, JSON.stringify({ message: userQuery, resultsCount: searchResults.length, searchMs }));

            if (searchResults.length === 0) {
              // No results — tell the model, skip fetching
              sendEvent({ type: "status", text: "No results found" });
              if (processedMessages.length > 0 && processedMessages[0].role === "system") {
                processedMessages[0].content += "\n\nWeb search returned no live results for this query. Answer from your training data with a one-line caveat that results may be outdated.";
              }
              return { searchMs, fetchMs: 0 };
            }

            // Compute latest_date from published_at fields
            let latestDate: string | null = null;
            for (const r of searchResults) {
              if (r.published_at && (!latestDate || r.published_at > latestDate)) {
                latestDate = r.published_at;
              }
            }

            // Don't show sources UI for image intents (search only informs the prompt)
            if (!isImageIntent) {
              sendEvent({
                type: "sources",
                items: searchResults.map((r) => ({
                  title: r.title,
                  url: r.url,
                  domain: r.domain,
                  favicon: r.favicon,
                  published_at: r.published_at,
                })),
                latest_date: latestDate,
              });
            }

            // Fetch full page text for top results (max 6 URLs, 3 concurrent, 4s per URL)
            const urlsToFetch = searchResults.slice(0, 6).map(r => r.url);
            totalFetchTargets = urlsToFetch.length;

            sendEvent({ type: "status", text: `Reading 0 of ${totalFetchTargets} sources\u2026` });

            const fetchStart = Date.now();
            const pageTexts = new Map<string, string>();

            const fetchResults = await fetchPagesWithConcurrency(
              urlsToFetch,
              3, // max 3 concurrent
              4000, // 4s per URL
              (completed, total) => {
                sendEvent({ type: "status", text: `Reading ${completed} of ${total} sources\u2026` });
              },
            );

            // Process results: use fetched text or fall back to snippet
            for (const fr of fetchResults) {
              if (fr.text && fr.chars > 100) {
                pageTexts.set(fr.url, fr.text);
                fetchedCount++;
              } else {
                fallbackSnippets++;
              }
            }

            const fetchMs = Date.now() - fetchStart;

            // Log per-URL diagnostics
            console.log(`[search-fetch]`, JSON.stringify({
              urls: fetchResults.map(r => r.url),
              perUrl: fetchResults.map(r => ({ url: r.url, status: r.status, ms: r.ms, chars: r.chars, error: r.error })),
            }));

            // Inject search context into the system prompt
            const searchContext = buildSearchContext(searchResults, pageTexts);
            if (processedMessages.length > 0 && processedMessages[0].role === "system") {
              processedMessages[0].content = processedMessages[0].content + searchContext;
            }

            // Also inject as the last user turn — some models ignore long system content
            const lastUserIdx = processedMessages.map(m => m.role).lastIndexOf("user");
            if (lastUserIdx >= 0) {
              const origContent = typeof processedMessages[lastUserIdx].content === "string"
                ? processedMessages[lastUserIdx].content as string
                : userQuery;
              processedMessages[lastUserIdx].content =
                `Use the search results above to answer this question. If the search results mention a product/event, it EXISTS — do not say it is "unreleased" or "unannounced". Cite with [n].\n\nQuestion: ${origContent}`;
            }

            return { searchMs, fetchMs };
          })();

          // 8s hard deadline for the entire retrieval stage
          const deadlinePromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("retrieval_deadline")), 8000)
          );

          try {
            await Promise.race([groundedPromise, deadlinePromise]);
          } catch (deadlineErr) {
            if (deadlineErr instanceof Error && deadlineErr.message === "retrieval_deadline") {
              console.log(`[search] 8s deadline hit — proceeding with whatever is ready. fetchedCount=${fetchedCount} total=${totalFetchTargets}`);
              sendEvent({ type: "status", text: `Read ${fetchedCount} of ${totalFetchTargets} sources (timed out)` });

              // Inject whatever search context we have so far
              if (searchResults.length > 0) {
                const searchContext = buildSearchContext(searchResults);
                if (processedMessages.length > 0 && processedMessages[0].role === "system") {
                  processedMessages[0].content = processedMessages[0].content + searchContext;
                }
                const lastUserIdx = processedMessages.map(m => m.role).lastIndexOf("user");
                if (lastUserIdx >= 0) {
                  const origContent = typeof processedMessages[lastUserIdx].content === "string"
                    ? processedMessages[lastUserIdx].content as string : userQuery;
                  processedMessages[lastUserIdx].content =
                    `Use the search results above to answer this question. Cite with [n].\n\nQuestion: ${origContent}`;
                }
              }
            } else {
              throw deadlineErr;
            }
          }

          // Emit final read count so UI can update the header
          sendEvent({ type: "search_read_count", fetched: fetchedCount, total: totalFetchTargets });

        } catch (err) {
          console.error("[web-search] grounded path failed:", err);
          // Fail-safe: continue with ungrounded completion
          sendEvent({ type: "status", text: "Web search unavailable" });
          // Brief pause so user sees the status before tokens start
        }
      } else if (webSearchEnabled === false) {
        // Web search explicitly off — inject disclaimer instruction
        if (
          processedMessages.length > 0 &&
          processedMessages[0].role === "system"
        ) {
          processedMessages[0].content +=
            "\n\nWeb search is disabled. If the user's question is time-sensitive, say \"I may be out of date on this topic — enable web search for the latest information.\"";
        }
      } else {
        console.log(`[web-search] query="${userQuery}" needsSearch=false`);
      }

      // Structured log for the entire retrieval stage
      if (shouldSearch) {
        const totalRetrievalMs = Date.now() - searchStartTime;
        console.log(`[search-summary]`, JSON.stringify({
          search_ms: totalRetrievalMs,
          fetch_ms: totalRetrievalMs, // approximate — includes search time too
          fetched: fetchedCount,
          total: totalFetchTargets,
          fallback_snippets: fallbackSnippets,
          results_count: searchResults.length,
        }));
      }

      // 3b. Connector tools — if user has enabled connectors and intent matches (or chip is pinned)
      const connectorUserId = getUserId(req);
      const connectorIntent = detectConnectorIntent(userQuery);
      const connectorTools = getConnectorToolsForUser(connectorUserId, pinnedConnectorId);

      const shouldUseConnectors = pinnedConnector
        ? connectorTools.length > 0
        : connectorTools.length > 0 && (connectorIntent.slack || connectorIntent.discord);

      // Resolve literal [channel] placeholder → most recently active channel
      if (pinnedConnector && userQuery.includes("[channel]")) {
        try {
          const toolName = pinnedConnector === "slack" ? "slack_list_channels" : "discord_list_channels";
          const chResult = await executeConnectorTool(toolName, {}, connectorUserId, undefined, undefined, pinnedConnectorId);
          if (!chResult.error) {
            const channels = JSON.parse(chResult.content);
            const topChannel = channels?.[0]?.name || "#general";
            const resolvedQuery = userQuery.replace(/\[channel\]/g, topChannel);
            // Update the last user message in processedMessages
            for (let i = processedMessages.length - 1; i >= 0; i--) {
              if (processedMessages[i].role === "user") {
                if (typeof processedMessages[i].content === "string") {
                  processedMessages[i].content = (processedMessages[i].content as string).replace(/\[channel\]/g, topChannel);
                }
                break;
              }
            }
            sendEvent({ type: "status", text: `Using ${topChannel} (most active)` });
            console.log(`[connector] resolved [channel] → ${topChannel}`);
          }
        } catch { /* continue without resolution */ }
      }

      if (pinnedConnector && processedMessages.length > 0 && processedMessages[0].role === "system") {
        const providerLabel = pinnedConnector === "slack" ? "Slack" : "Discord";
        processedMessages[0].content += `\n\nThe user is asking about their ${providerLabel} workspace; use the ${pinnedConnector} tools, not web search.`;
      } else if (pinnedConnector) {
        const providerLabel = pinnedConnector === "slack" ? "Slack" : "Discord";
        processedMessages.unshift({ role: "system", content: `The user is asking about their ${providerLabel} workspace; use the ${pinnedConnector} tools, not web search.` });
      }

      if (shouldUseConnectors) {
        const statusLabel = pinnedConnector === "slack" || connectorIntent.slack ? "Reading Slack\u2026" : "Reading Discord\u2026";
        sendEvent({ type: "status", text: statusLabel });

        try {
          // Make a non-streaming call with tools to let the model decide what to read
          const toolCallBody = {
            model: model || "google/gemini-2.5-flash",
            messages: processedMessages,
            tools: connectorTools,
            tool_choice: "auto",
            stream: false,
            max_tokens: 1024,
          };

          const toolCallRes = await fetch(`${NIA_GATEWAY_URL}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${NIA_API_KEY}` },
            body: JSON.stringify(toolCallBody),
          });

          if (toolCallRes.ok) {
            const toolCallData = await toolCallRes.json();
            const choice = toolCallData.choices?.[0];
            const toolCalls = choice?.message?.tool_calls;

            if (toolCalls && toolCalls.length > 0) {
              // Execute tool calls in parallel (concurrency 5) with keepalive status events
              const toolMessages: { role: string; content: string; tool_call_id?: string }[] = [
                { role: "assistant", content: choice.message.content || "", ...({ tool_calls: toolCalls } as any) },
              ];

              const toolNames = toolCalls.map((tc: any) => tc.function?.name?.replace(/_/g, " ")).filter(Boolean);
              sendEvent({ type: "status", text: `Running ${toolNames.join(", ")}\u2026` });

              // Keepalive: send status every 5s while tools are running
              let toolsDone = false;
              const keepalive = setInterval(() => {
                if (!toolsDone) sendEvent({ type: "status", text: `Still reading\u2026` });
              }, 5000);

              // Run all tool calls in parallel (up to 5 concurrent)
              const CONCURRENCY = 5;
              const toolEntries = toolCalls.map((tc: any) => {
                const fnName = tc.function?.name;
                let fnArgs: Record<string, unknown> = {};
                try { fnArgs = JSON.parse(tc.function?.arguments || "{}"); } catch { /* empty */ }
                return { tc, fnName, fnArgs };
              });

              const results: { tc: any; fnName: string; result: Awaited<ReturnType<typeof executeConnectorTool>>; durationMs: number }[] = [];
              for (let i = 0; i < toolEntries.length; i += CONCURRENCY) {
                const batch = toolEntries.slice(i, i + CONCURRENCY);
                const batchResults = await Promise.all(
                  batch.map(async ({ tc, fnName, fnArgs }: any) => {
                    const start = Date.now();
                    const result = await executeConnectorTool(fnName, fnArgs, connectorUserId, chatId, messageId, pinnedConnectorId);
                    return { tc, fnName, result, durationMs: Date.now() - start };
                  })
                );
                results.push(...batchResults);
              }

              toolsDone = true;
              clearInterval(keepalive);

              for (const { tc, fnName, result, durationMs } of results) {
                toolMessages.push({
                  role: "tool",
                  tool_call_id: tc.id,
                  content: result.content,
                });
                console.log(`[connector-tool] ${fnName} chars=${result.content.length} error=${result.error || false} ms=${durationMs}`);
              }

              // Inject tool results as context into the conversation
              // Instead of doing another tool-calling round, inject the data as system context
              const toolContext = toolMessages
                .filter(m => m.role === "tool")
                .map(m => m.content)
                .join("\n\n---\n\n");

              if (toolContext.length > 0) {
                const connectorInstruction = `\n\n--- Connector Data ---\nThe following data was retrieved from the user's connected workspace. Use it to answer their question. Include permalinks where available. Summarize with dated bullets.\n\n${toolContext}\n\n--- End Connector Data ---`;

                if (processedMessages.length > 0 && processedMessages[0].role === "system") {
                  processedMessages[0].content += connectorInstruction;
                } else {
                  processedMessages.unshift({ role: "system", content: connectorInstruction });
                }

                // Extract Slack/Discord permalinks from tool results for the sources row
                if (pinnedConnector) {
                  const permalinkRegex = /https:\/\/(?:slack\.com\/archives\/[^\s)]+|discord\.com\/channels\/[^\s)]+)/g;
                  const channelRegex = /#([\w-]+)/g;
                  const seenUrls = new Set<string>();
                  const connectorSources: { url: string; channel: string; time: string }[] = [];
                  for (const m of toolMessages.filter(m => m.role === "tool")) {
                    const urls = m.content.match(permalinkRegex) || [];
                    for (const url of urls) {
                      if (!seenUrls.has(url) && connectorSources.length < 10) {
                        seenUrls.add(url);
                        // Try to extract channel and time from the surrounding context
                        const lineMatch = m.content.split("\n").find(l => l.includes(url));
                        const channelMatch = lineMatch?.match(/#([\w-]+)/);
                        const timeMatch = lineMatch?.match(/\[([A-Z][a-z]+ \d+, \d+:\d+ [AP]M)\]/);
                        connectorSources.push({
                          url,
                          channel: channelMatch ? `#${channelMatch[1]}` : "",
                          time: timeMatch ? timeMatch[1] : "",
                        });
                      }
                    }
                  }
                  if (connectorSources.length > 0) {
                    sendEvent({
                      type: "connector_sources",
                      provider: pinnedConnector,
                      items: connectorSources,
                    });
                  }
                }
              }

              sendEvent({ type: "status", text: "" });
            }
          }
        } catch (connErr) {
          console.error("[connector-tools] tool call phase failed:", connErr);
          // Continue without connector data — non-fatal
        }
      }

      // 4. Call the AI provider with streaming
      try {
        const streamMaxTokens = isDocRequest ? 10000 : 4096;
        const streamStartTime = Date.now();
        let ttftMs: number | null = null;
        let streamInputTokens = 0;
        let streamOutputTokens = 0;
        let streamCachedInputTokens = 0;
        let streamReasoningTokens = 0;
        let servedModel = effectiveModel;
        let providerRequestId = "";

        console.log(`[route] via=${via} chat=${chatRequestId} provider=${effectiveProvider} model=${effectiveModel} thinking=${thinking || "off"}`);

        let response: Response;

        if (useAdapter) {
          // Non-NIA provider: use adapter system
          const adapter = getAdapter(requestedProvider);
          const adapterReq = {
            messages: processedMessages,
            model: effectiveModel,
            stream: true,
            max_tokens: streamMaxTokens,
            thinking: thinking && thinking !== "off" ? { level: thinking } : undefined,
          };
          response = await adapter.complete(adapterReq);
        } else {
          // Default NIA path
          const body: Record<string, unknown> = {
            model: model || "google/gemini-2.5-flash",
            messages: processedMessages,
            stream: true,
            max_tokens: streamMaxTokens,
          };

          response = await fetch(`${NIA_GATEWAY_URL}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${NIA_API_KEY}`,
            },
            body: JSON.stringify(body),
          });
        }

        if (!response.ok) {
          const errorText = await response.text();
          let parsedError: any = {};
          try { parsedError = JSON.parse(errorText); } catch {}
          const modelLabel = (model || effectiveModel).replace(/^[^/]+\//, "");
          const is404 = response.status === 404;
          console.error(`[chat] Provider error ${response.status} for model=${model || effectiveModel}, via=${via}`, errorText.slice(0, 200));
          sendEvent({
            type: "error",
            error: true,
            error_type: is404 ? "model_not_found" : "provider_error",
            title: is404 ? "Model not available on NiaAI API" : `Can't reach ${modelLabel}`,
            message: is404
              ? `The model "${model || effectiveModel}" was not found. It may have been removed or renamed. Pick another model from the catalog.`
              : (parsedError.error?.message || parsedError.message || errorText || `API error: ${response.status}`),
            provider: effectiveProvider,
            model: model || effectiveModel,
            via,
            actions: is404 ? ["pick_model", "retry"] : (via === "direct" ? ["use_gateway", "open_settings", "retry"] : ["open_settings", "retry"]),
          });
          controller.close();
          return;
        }

        if (!response.body) {
          controller.close();
          return;
        }

        // Pipe through the SSE chunks from the AI provider
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullReplyContent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // Extract content delta to track full reply for hard guard + usage tracking
            if (trimmed.startsWith("data: ") && trimmed !== "data: [DONE]") {
              try {
                const p = JSON.parse(trimmed.slice(6));
                const d = p.choices?.[0]?.delta?.content;
                if (d) {
                  fullReplyContent += d;
                  // Record time-to-first-token
                  if (ttftMs === null) {
                    ttftMs = Date.now() - streamStartTime;
                  }
                }
                // Extract served model from streaming chunks
                if (p.model) servedModel = p.model;
                if (p.id && !providerRequestId) providerRequestId = p.id;
                // Parse usage from final chunk (OpenAI format)
                if (p.usage) {
                  streamInputTokens = p.usage.prompt_tokens || p.usage.input_tokens || streamInputTokens;
                  streamOutputTokens = p.usage.completion_tokens || p.usage.output_tokens || streamOutputTokens;
                  streamCachedInputTokens = p.usage.prompt_tokens_details?.cached_tokens || p.usage.cached_input_tokens || streamCachedInputTokens;
                  streamReasoningTokens = p.usage.completion_tokens_details?.reasoning_tokens || p.usage.reasoning_tokens || streamReasoningTokens;
                }
              } catch { /* skip */ }
            }

            // Pass through SSE lines as-is (data: {...})
            controller.enqueue(encoder.encode(trimmed + "\n\n"));
          }
        }

        // Hard guard: if the model hallucinated a "not released" response
        // despite search results confirming the product/event exists, regenerate once
        if (searchResults.length > 0 && HALLUCINATION_PATTERN.test(fullReplyContent)) {
          console.log(`[web-search] HARD GUARD triggered — reply contained hallucination pattern, regenerating`);

          sendEvent({ type: "status", text: "Verifying answer\u2026" });

          // Add instruction to force answer from search results
          const guardMessages = [
            ...processedMessages,
            { role: "assistant" as const, content: fullReplyContent },
            { role: "user" as const, content: "The search results confirm this exists and is real. Answer from the search results provided. Do not say it is unreleased, unannounced, or that you lack information. Provide the factual answer with citations." },
          ];

          try {
            const guardRes = await fetch(`${NIA_GATEWAY_URL}/chat/completions`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${NIA_API_KEY}` },
              body: JSON.stringify({ model: model || "google/gemini-2.5-flash", messages: guardMessages, stream: true, max_tokens: 4096 }),
            });

            if (guardRes.ok && guardRes.body) {
              // Send a marker to the client to replace the previous content
              sendEvent({ type: "replace_content" });

              const guardReader = guardRes.body.getReader();
              const guardDecoder = new TextDecoder();
              let guardBuffer = "";

              while (true) {
                const { done: gDone, value: gValue } = await guardReader.read();
                if (gDone) break;
                guardBuffer += guardDecoder.decode(gValue, { stream: true });
                const gLines = guardBuffer.split("\n");
                guardBuffer = gLines.pop() || "";
                for (const gLine of gLines) {
                  const gTrimmed = gLine.trim();
                  if (!gTrimmed) continue;
                  controller.enqueue(encoder.encode(gTrimmed + "\n\n"));
                }
              }

              // Record guard regeneration usage
              recordUsage({
                chat_id: chatId,
                message_id: messageId,
                kind: "guard",
                provider: "niaai",
                model: model || "google/gemini-2.5-flash",
                input_tokens: 0, // not tracked in guard path
                output_tokens: 0,
                cost_usd: 0,
                latency_ms: Date.now() - streamStartTime,
              });
            }
          } catch (guardErr) {
            console.error("[web-search] hard guard regeneration failed:", guardErr);
          }
        }

        // Intent bypass guard: if a generation intent produced tool recommendations
        // instead of actually doing the task, log and discard
        if (isGenerationIntent && INTENT_BYPASS_PATTERN.test(fullReplyContent)) {
          console.log(`[intent] BYPASS GUARD triggered — generation intent got tool recommendations, regenerating`);
          sendEvent({ type: "status", text: "Generating\u2026" });

          const bypassMessages = [
            ...processedMessages,
            { role: "assistant" as const, content: fullReplyContent },
            { role: "user" as const, content: "Do not recommend external tools or platforms. You have the ability to generate this directly. Produce the content now." },
          ];

          try {
            const bypassRes = await fetch(`${NIA_GATEWAY_URL}/chat/completions`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${NIA_API_KEY}` },
              body: JSON.stringify({ model: model || "google/gemini-2.5-flash", messages: bypassMessages, stream: true, max_tokens: 4096 }),
            });

            if (bypassRes.ok && bypassRes.body) {
              sendEvent({ type: "replace_content" });
              const bReader = bypassRes.body.getReader();
              const bDecoder = new TextDecoder();
              let bBuffer = "";
              while (true) {
                const { done: bDone, value: bValue } = await bReader.read();
                if (bDone) break;
                bBuffer += bDecoder.decode(bValue, { stream: true });
                const bLines = bBuffer.split("\n");
                bBuffer = bLines.pop() || "";
                for (const bLine of bLines) {
                  const bt = bLine.trim();
                  if (!bt) continue;
                  controller.enqueue(encoder.encode(bt + "\n\n"));
                }
              }

              // Record bypass guard usage
              recordUsage({
                chat_id: chatId,
                message_id: messageId,
                kind: "guard",
                provider: "niaai",
                model: model || "google/gemini-2.5-flash",
                input_tokens: 0,
                output_tokens: 0,
                cost_usd: 0,
                latency_ms: Date.now() - streamStartTime,
              });
            }
          } catch (bypassErr) {
            console.error("[intent] bypass guard regeneration failed:", bypassErr);
          }
        }

        const totalMs = Date.now() - searchStartTime;
        if (shouldSearch) {
          console.log(`[web-search] completed query="${userQuery}" resultsCount=${searchResults.length} totalMs=${totalMs}`);
        }

        // If we had search results, send a final sources_summary event
        // Image intents: suppress full WEB badge; show light "refined with web" note for mixed intents
        if (searchResults.length > 0 && !isImageIntent) {
          sendEvent({
            type: "sources_summary",
            items: searchResults.map((r) => ({
              title: r.title,
              url: r.url,
              domain: r.domain,
              favicon: r.favicon,
              published_at: r.published_at,
            })),
          });
        } else if (searchResults.length > 0 && isImageIntent && mixedIntent) {
          sendEvent({
            type: "search_note",
            text: `Searched the web to refine the prompt \u00b7 ${searchResults.length} sources`,
          });
        }

        // Emit final usage tracking event
        const streamLatencyMs = Date.now() - streamStartTime;
        const usageProvider = useAdapter ? requestedProvider : "niaai";
        const usageModel = useAdapter ? effectiveModel : (model || "google/gemini-2.5-flash");
        console.log(`[route] via=${via} done provider_model=${servedModel} request_id=${providerRequestId} usage=${streamInputTokens}/${streamOutputTokens}`);

        // Store debug info
        lastDebugRequest = {
          provider: usageProvider,
          requested_model: usageModel,
          request_body: { model: usageModel, max_tokens: streamMaxTokens, stream: true, messages: `[${processedMessages.length} messages]` },
          response_headers: {},
          served_model: servedModel,
          request_id: providerRequestId,
          timestamp: new Date().toISOString(),
        };

        sendEvent({
          type: "usage",
          input_tokens: streamInputTokens,
          output_tokens: streamOutputTokens,
          cached_input_tokens: streamCachedInputTokens,
          reasoning_tokens: streamReasoningTokens,
          latency_ms: streamLatencyMs,
          ttft_ms: ttftMs ?? streamLatencyMs,
          cost_usd: computeCost(usageProvider === "niaai" ? "nia" : usageProvider, usageModel, streamInputTokens, streamOutputTokens),
          provider: usageProvider,
          model: usageModel,
          model_id: model || "google/gemini-2.5-flash",
          thinking_level: thinking || "off",
          served_model: servedModel,
          requested_model: usageModel,
          request_id: providerRequestId,
        });

        // Also record server-side for Logs page
        recordUsage({
          chat_id: chatId,
          message_id: messageId,
          kind: "chat",
          provider: usageProvider,
          model: usageModel,
          input_tokens: streamInputTokens,
          output_tokens: streamOutputTokens,
          reasoning_tokens: streamReasoningTokens,
          cost_usd: computeCost(usageProvider === "niaai" ? "nia" : usageProvider, usageModel, streamInputTokens, streamOutputTokens),
          latency_ms: streamLatencyMs,
          ttft_ms: ttftMs ?? streamLatencyMs,
        });
      } catch (err) {
        sendSSE(
          JSON.stringify({
            error: true,
            message:
              err instanceof Error ? err.message : "Stream error",
          }),
        );

        // Record error usage
        recordUsage({
          chat_id: chatId,
          message_id: messageId,
          kind: "chat",
          provider: useAdapter ? requestedProvider : "niaai",
          model: useAdapter ? effectiveModel : (model || "google/gemini-2.5-flash"),
          input_tokens: 0,
          output_tokens: 0,
          cost_usd: 0,
          latency_ms: Date.now() - searchStartTime,
          status: "error",
          error_message: err instanceof Error ? err.message : "Stream error",
        });
      } finally {
        controller.close();
      }
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
