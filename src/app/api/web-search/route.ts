import { NextRequest } from "next/server";
import { search as ddgSearch, SafeSearchType } from "duck-duck-scrape";

import { NIA_GATEWAY_URL, NIA_API_KEY } from "@/lib/config";

/* ── 10-min LRU cache ──────────────────────────────────────── */

interface CacheEntry {
  data: SearchResult[];
  ts: number;
}

const CACHE_TTL = 10 * 60 * 1000;
const MAX_CACHE = 200;
const searchCache = new Map<string, CacheEntry>();

function normalizeQuery(q: string): string {
  return q.toLowerCase().trim().replace(/\s+/g, " ");
}

function getCached(key: string): SearchResult[] | null {
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    searchCache.delete(key);
    return null;
  }
  return entry.data;
}

function setSearchCache(key: string, data: SearchResult[]) {
  if (searchCache.size >= MAX_CACHE) {
    const oldest = searchCache.keys().next().value;
    if (oldest) searchCache.delete(oldest);
  }
  searchCache.set(key, { data, ts: Date.now() });
}

/* ── Types ─────────────────────────────────────────────────── */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  published_at?: string | null;
  favicon?: string;
  domain?: string;
}

/* ── Recency / intent signals ──────────────────────────────── */

const RECENCY_KEYWORDS = /\b(price|cost|how much|latest|current|now|today|recent|new|newest|release|launched|launch|specs?|review|news|who is|ceo|version|update|202[4-9]|score|weather|stock|this week|this month|yesterday|last week|just|announced|chart|ranking|top|president|prime minister)\b/i;

const NAMED_ENTITY_PATTERN = /\b(iphone|android|tesla|bitcoin|ethereum|google|apple|microsoft|meta|amazon|nvidia|openai|samsung|spacex|twitter|x\.com|tiktok|chatgpt|gemini|claude|vivo|xiaomi|oneplus|oppo|realme|pixel|galaxy|huawei|nothing|motorola|sony|lg|asus|lenovo|dell|hp|macbook|ipad|airpods|playstation|xbox|nintendo|switch|steam|netflix|spotify|disney|anthropic|mistral|llama|grok|copilot|cursor)\b/i;

/* Common words to exclude when detecting brand/product tokens */
const COMMON_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "can", "shall", "must", "need", "dare",
  "i", "me", "my", "we", "us", "our", "you", "your", "he", "him",
  "she", "her", "it", "its", "they", "them", "their", "this", "that",
  "what", "which", "who", "whom", "how", "when", "where", "why",
  "not", "no", "yes", "and", "or", "but", "if", "then", "else",
  "for", "from", "with", "about", "into", "of", "to", "in", "on",
  "at", "by", "up", "out", "off", "over", "under", "again", "once",
  "here", "there", "all", "each", "every", "both", "few", "more",
  "most", "other", "some", "such", "than", "too", "very", "just",
  "also", "now", "then", "so", "tell", "explain", "describe", "show",
  "help", "please", "thanks", "good", "best", "give", "make", "find",
  "let", "say", "get", "go", "come", "see", "know", "think", "take",
  "want", "use", "work", "try", "ask", "look", "run", "move", "like",
  "many", "much", "long", "new", "old", "big", "small", "great",
]);

/**
 * Detect capitalized product/brand/person tokens that aren't common words.
 * E.g. "Vivo X300", "iPhone 17", "Sam Altman"
 */
function hasNamedEntityTokens(query: string): boolean {
  // Match sequences of capitalized words or alphanumeric product names like "X300"
  const tokens = query.match(/\b[A-Z][a-zA-Z0-9]*(?:\s+[A-Z0-9][a-zA-Z0-9]*)*\b/g);
  if (!tokens) return false;
  for (const token of tokens) {
    const words = token.split(/\s+/);
    const isCommon = words.every((w) => COMMON_WORDS.has(w.toLowerCase()));
    if (!isCommon) return true;
  }
  return false;
}

/** Messages about the conversation itself — never search for these */
const CONVERSATIONAL_PATTERN = /^(what did (i|you|we)|who are you|hi\b|hii\b|hello\b|hey\b|thanks\b|thank you|ok\b|okay\b|can you|could you|please\b|repeat\b|summarize (that|this|above|it)|explain (that|this|above|it)|tell me (again|more)|yes\b|no\b|sure\b|got it|nice|cool|great|good|wow|lol|haha)/i;

/** Phrases referring to the conversation itself, not the outside world */
const SELF_REFERENTIAL_PATTERN = /\b(just (said|say|told|asked)|above|earlier|previous(ly)?|you (said|mentioned|told|wrote)|i (said|asked|mentioned|wrote)|that (message|response|answer|reply)|my (last|previous) (message|question)|what (i|we) (just|were))\b/i;

export function needsFreshData(query: string): boolean {
  const trimmed = query.trim();

  // Short messages (< 6 words) with no proper noun or number → skip
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount < 6 && !NAMED_ENTITY_PATTERN.test(trimmed) && !/\d{2,}/.test(trimmed)) {
    return false;
  }

  // Conversational / meta patterns → never search
  if (CONVERSATIONAL_PATTERN.test(trimmed)) return false;
  if (SELF_REFERENTIAL_PATTERN.test(trimmed)) return false;

  // Only search when a recency/factual signal exists
  if (RECENCY_KEYWORDS.test(query)) return true;
  if (NAMED_ENTITY_PATTERN.test(query)) return true;
  if (hasNamedEntityTokens(query)) return true;
  return false;
}

/* ── Shared search helper (used by chat route too) ─────────── */

/* ── DuckDuckGo search via library (zero API key) ────────── */

async function searchDDG(query: string, maxResults: number): Promise<SearchResult[]> {
  try {
    const ddgResults = await ddgSearch(query, {
      safeSearch: SafeSearchType.MODERATE,
    });

    if (!ddgResults.results || ddgResults.results.length === 0) return [];

    return ddgResults.results.slice(0, maxResults).map((r) => {
      let domain = "";
      try {
        domain = new URL(r.url).hostname.replace(/^www\./, "");
      } catch { /* skip */ }
      return {
        title: r.title || "",
        url: r.url || "",
        snippet: r.description || "",
        published_at: null,
        favicon: `https://www.google.com/s2/favicons?domain=${domain}&sz=16`,
        domain,
      };
    });
  } catch (err) {
    console.error("[search] DDG library search failed:", err);
    return [];
  }
}

/* ── DuckDuckGo HTML lite fallback (when library rate-limits) */

async function searchDDGHtml(query: string, maxResults: number): Promise<SearchResult[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const html = await res.text();

    const results: SearchResult[] = [];
    // Parse DDG HTML lite results — each result is in a <div class="result">
    const resultBlocks = html.split(/class="result\s/g).slice(1);

    for (const block of resultBlocks) {
      if (results.length >= maxResults) break;

      // Extract URL from <a class="result__a" href="...">
      const urlMatch = block.match(/class="result__a"\s+href="([^"]+)"/);
      // Extract title from the same <a> tag content
      const titleMatch = block.match(/class="result__a"[^>]*>([^<]+)</);
      // Extract snippet from <a class="result__snippet"...>
      const snippetMatch = block.match(/class="result__snippet"[^>]*>([^<]+(?:<[^>]+>[^<]*)*)/);

      if (urlMatch && titleMatch) {
        let resultUrl = urlMatch[1];
        // DDG wraps URLs in redirects
        if (resultUrl.startsWith("//duckduckgo.com/l/")) {
          const uddg = resultUrl.match(/uddg=([^&]+)/);
          if (uddg) resultUrl = decodeURIComponent(uddg[1]);
        }
        let domain = "";
        try {
          domain = new URL(resultUrl).hostname.replace(/^www\./, "");
        } catch { /* skip */ }

        const snippet = (snippetMatch?.[1] || "").replace(/<[^>]+>/g, "").trim();

        results.push({
          title: titleMatch[1].trim(),
          url: resultUrl,
          snippet,
          published_at: null,
          favicon: `https://www.google.com/s2/favicons?domain=${domain}&sz=16`,
          domain,
        });
      }
    }

    return results;
  } catch (err) {
    console.error("[search] DDG HTML fallback failed:", err);
    return [];
  }
}

/* ── Nia API search (fallback) ───────────────────────────── */

async function searchNiaAPI(query: string, recency: string | undefined, maxResults: number): Promise<SearchResult[]> {
  try {
    const searchBody: Record<string, unknown> = { query, maxResults };
    if (recency) searchBody.recency = recency;

    const response = await fetch(`${NIA_GATEWAY_URL}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${NIA_API_KEY}`,
      },
      body: JSON.stringify(searchBody),
    });

    if (!response.ok) return [];

    const data = await response.json();
    const rawResults = data.results || data.data || data;

    return (Array.isArray(rawResults) ? rawResults : []).map(
      (r: Record<string, string>) => {
        const url = r.url || r.link || "";
        let domain = "";
        try {
          domain = new URL(url).hostname.replace(/^www\./, "");
        } catch { /* skip */ }
        return {
          title: r.title || "",
          url,
          snippet: r.snippet || r.description || "",
          published_at: r.published_at || r.publishedAt || r.date || null,
          favicon: `https://www.google.com/s2/favicons?domain=${domain}&sz=16`,
          domain,
        };
      },
    );
  } catch (err) {
    console.error("[search] Nia API search failed:", err);
    return [];
  }
}

/* ── Rank & filter results ────────────────────────────────── */

const SEARCH_ENGINE_HOSTS = new Set([
  "duckduckgo.com",
  "bing.com",
  "google.com",
  "search.yahoo.com",
]);

const OFFICIAL_DOMAINS = new Set([
  "apple.com",
  "samsung.com",
  "oneplus.com",
  "xiaomi.com",
  "oppo.com",
  "realme.com",
  "vivo.com",
  "nothing.tech",
  "motorola.com",
  "sony.com",
  "lg.com",
  "asus.com",
  "lenovo.com",
  "dell.com",
  "hp.com",
  "microsoft.com",
  "nvidia.com",
  "huawei.com",
]);

const REVIEWER_RETAILER_DOMAINS = new Set([
  "gsmarena.com",
  "gadgets360.com",
  "flipkart.com",
  "amazon.com",
  "amazon.in",
  "croma.com",
  "bestbuy.com",
  "theverge.com",
  "tomsguide.com",
  "techradar.com",
  "cnet.com",
  "91mobiles.com",
  "smartprix.com",
  "pricebaba.com",
]);

function isOfficialDomain(domain: string): boolean {
  return OFFICIAL_DOMAINS.has(domain) || domain.startsWith("store.google.") || domain === "store.google.com";
}

function isReviewerRetailerDomain(domain: string): boolean {
  return REVIEWER_RETAILER_DOMAINS.has(domain);
}

export function rankAndFilterResults(results: SearchResult[]): SearchResult[] {
  // 1. Drop search engine / aggregator redirect results
  const filtered = results.filter((r) => {
    try {
      const host = new URL(r.url).hostname.replace(/^www\./, "");
      return !SEARCH_ENGINE_HOSTS.has(host);
    } catch {
      return true;
    }
  });

  // 2. Rank: official first, then reviewers/retailers, then everything else
  const official: SearchResult[] = [];
  const reviewers: SearchResult[] = [];
  const rest: SearchResult[] = [];

  for (const r of filtered) {
    const domain = r.domain || "";
    if (isOfficialDomain(domain)) {
      official.push(r);
    } else if (isReviewerRetailerDomain(domain)) {
      reviewers.push(r);
    } else {
      rest.push(r);
    }
  }

  return [...official, ...reviewers, ...rest];
}

/* ── Combined search: DDG primary, Nia fallback ──────────── */

export async function performSearch(
  query: string,
  recency?: string,
  maxResults?: number,
): Promise<SearchResult[]> {
  const max = maxResults || 8;
  const cacheKey = normalizeQuery(query) + (recency || "");
  const cached = getCached(cacheKey);
  if (cached) return cached;

  // Try DuckDuckGo library first (no API key needed)
  console.log(`[search] performSearch query="${query}"`);
  let results = await searchDDG(query, max);
  let provider = "ddg-lib";

  // Fallback to DDG HTML scrape if library got rate-limited
  if (results.length === 0) {
    console.log(`[search] DDG library returned 0, trying HTML fallback`);
    results = await searchDDGHtml(query, max);
    provider = "ddg-html";
  }

  // Last resort: Nia API
  if (results.length === 0) {
    console.log(`[search] DDG HTML also returned 0, trying Nia API`);
    results = await searchNiaAPI(query, recency, max);
    provider = "nia-api";
  }

  // Rank and filter before caching
  results = rankAndFilterResults(results);

  console.log(`[search] performSearch done: provider=${provider} resultsCount=${results.length}`);
  if (results.length > 0) {
    setSearchCache(cacheKey, results);
  }
  return results;
}

/* ── POST: full web-search SSE pipeline (for WebSearchView) ── */

export async function POST(req: NextRequest) {
  const { query, maxResults, conversationHistory } = await req.json();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        send({ type: "search_started", query });
        send({ type: "activity", message: "Searching the web", status: "active" });

        const results = await performSearch(query, undefined, maxResults || 10);

        send({
          type: "activity",
          message: "Searching the web",
          status: "completed",
          detail: `${results.length} results found`,
        });

        send({
          type: "sources_discovered",
          sources: results.map((r, i) => ({ id: `src-${i}`, ...r, status: "discovered" })),
          count: results.length,
        });

        if (results.length === 0) {
          send({ type: "activity", message: "No results found", status: "completed" });
          send({ type: "search_completed" });
          controller.close();
          return;
        }

        // Reading sources
        send({
          type: "activity",
          message: "Reading sources",
          status: "active",
          detail: `0 of ${results.length}`,
        });

        for (let i = 0; i < results.length; i++) {
          send({ type: "source_status_update", sourceId: `src-${i}`, status: "fetching" });
          await new Promise((r) => setTimeout(r, 100));
          send({ type: "source_status_update", sourceId: `src-${i}`, status: "read" });
          send({ type: "search_progress", completed: i + 1, total: results.length });
        }

        send({
          type: "activity",
          message: "Reading sources",
          status: "completed",
          detail: `${results.length} of ${results.length} completed`,
        });

        // Generate AI answer
        send({ type: "activity", message: "Preparing answer", status: "active" });

        const searchContext = results
          .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}\nURL: ${r.url}`)
          .join("\n\n");

        const chatMessages = [
          {
            role: "system",
            content: `You are a research assistant. Based on the web search results below, provide a comprehensive, well-structured answer to the user's query. Cite sources using [n] notation where n is the source number. Be thorough but concise.\n\n--- Web Search Results ---\n${searchContext}\n--- End Search Results ---`,
          },
          ...(conversationHistory || []),
          { role: "user", content: query },
        ];

        const chatRes = await fetch(`${NIA_GATEWAY_URL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${NIA_API_KEY}`,
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: chatMessages,
            stream: true,
            max_tokens: 4096,
          }),
        });

        if (!chatRes.ok || !chatRes.body) {
          send({ type: "error", message: "Failed to generate answer." });
          controller.close();
          return;
        }

        send({ type: "answer_started" });

        const reader = chatRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            const d = trimmed.slice(6);
            if (d === "[DONE]") continue;
            try {
              const parsed = JSON.parse(d);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                send({ type: "answer_chunk", text: delta });
              }
            } catch { /* skip */ }
          }
        }

        send({ type: "activity", message: "Preparing answer", status: "completed" });
        send({ type: "search_completed" });
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : "An unexpected error occurred.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

/* ── GET: fetch_page(?url=...) returns readable text ≤4k chars ── */

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return Response.json({ error: "url param required" }, { status: 400 });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(url, {
      headers: {
        "User-Agent": "NiaAI-Bot/1.0 (web-grounding)",
        Accept: "text/html,application/xhtml+xml,text/plain",
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return Response.json({ error: `HTTP ${res.status}` }, { status: 502 });
    }

    const html = await res.text();

    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);

    return Response.json({ url, text });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Fetch failed" },
      { status: 502 },
    );
  }
}
