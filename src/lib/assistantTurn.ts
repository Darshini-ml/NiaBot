/**
 * Shared orchestration logic for both /api/chat (web) and /api/slack/chat.
 * Handles: intent detection, document generation, image generation, guards.
 */

import { generateDocument, type DocType } from "@/lib/documentGenerator";
import { NIA_GATEWAY_URL, NIA_API_KEY } from "@/lib/config";
import { recordUsage } from "@/lib/recordUsage";
import { writeFile, mkdir } from "fs/promises";
import { randomUUID, createHash } from "crypto";
import path from "path";

// ── Intent detection patterns ──────────────────────────────────────────────

export const IMAGE_INTENT = /\b(generate|create|make|draw|render|design|paint|produce)\b.{0,40}\b(image|picture|photo|illustration|logo|icon|artwork|wallpaper|poster|banner|portrait|sketch)\b/i;
export const IMAGE_OF = /\b(image|picture|photo)\s+of\b/i;
export const DOC_INTENT = /\b(generate|create|make|write|build|prepare|draft|produce)\b.{0,30}\b(pdf|document|report|brochure|docx|slides|pptx|spreadsheet)\b/i;
export const CODE_INTENT = /\b(write|build|implement|fix)\b.{0,30}\b(code|function|script|component|api)\b/i;
export const DOC_KEYWORDS = /\b(create|make|generate|write|export|build|prepare|draft)\b.{0,30}\b(pdf|document|report|brochure|guide|docx|word\s*file|excel|spreadsheet|csv|pptx|powerpoint|slides|deck|presentation|file)\b/i;

/** Detect hallucinated refusals */
export const HALLUCINATION_PATTERN = /as of my (last|latest) (update|knowledge)|hasn't been (released|announced)|not (yet )?(released|announced|available|launched)|my training data|knowledge cutoff|I don't have (access to |information about )?(real-time|current|latest)|no information (available )?about|does not exist|is not a real/i;

/** Detect intent bypass — recommending external tools instead of producing */
export const INTENT_BYPASS_PATTERN = /you can (use|generate|try)|platforms like|tools such as|canva|midjourney|dall-e|dall·e|nightcafe|adobe firefly|stable diffusion|copilot designer/i;

/** Detect "cannot create" refusals */
export const CANNOT_CREATE_PATTERN = /\b(cannot create|can't create|I cannot|I can't|I'm unable to|unable to create|copy and paste|Image Suggestion|how to create the pdf|use Word|use Canva|I don't have the ability)\b/i;

export type DetectedIntent = "image" | "document" | "code" | "chat";

export function detectIntent(userText: string, task?: string): {
  intent: DetectedIntent;
  isImageIntent: boolean;
  isDocIntent: boolean;
  isCodeIntent: boolean;
  isGenerationIntent: boolean;
} {
  const isImageIntent = task === "image" || IMAGE_INTENT.test(userText) || IMAGE_OF.test(userText);
  const isDocIntent = task === "document" || task === "slides" || DOC_INTENT.test(userText);
  const isCodeIntent = task === "code" || CODE_INTENT.test(userText);
  const isGenerationIntent = isImageIntent || isDocIntent || isCodeIntent;

  const intent: DetectedIntent = isImageIntent ? "image" : isDocIntent ? "document" : isCodeIntent ? "code" : "chat";

  return { intent, isImageIntent, isDocIntent, isCodeIntent, isGenerationIntent };
}

// ── Task instructions (shared with web route) ──────────────────────────────

export const taskInstructions: Record<string, string> = {
  image:
    "The user wants an image. Describe what the image should look like in detail but do NOT attempt to generate, link, or fabricate any image URL. The image will be generated separately by the system.",
  brainstorm:
    "Produce 8–12 distinct ideas as a bulleted list, each one line with a short why. End with the 2 strongest picks.",
  plan:
    "Produce a step-by-step plan with phases, timeline, owners/resources, and risks. Use numbered steps and a short checklist.",
  analyze:
    "Analyze the attached file(s) first. Give a summary, key findings, and suggested next steps. If nothing is attached, ask for the file.",
  slides:
    "Produce a slide deck outline: title slide, 6–10 slides with slide title + 3 bullets + speaker note each, and a closing slide. Use markdown headings per slide.",
  code:
    "Act as a senior engineer. Return working, well-commented code in fenced blocks with the language tag, followed by a brief explanation and how to run/test it.",
  document: `Do not label sections 'Page N'. Use descriptive section titles. The document title must be a short noun phrase (8 words or fewer).
Put ONLY the finished document in your response. No preamble, no notes to the user, no "Image Suggestion", no "How to create the PDF", no "copy and paste", no export instructions. Start with the # title.
Write the FULL content in well-structured markdown: H1 for the document title, H2 for major sections, H3 for subsections, with paragraphs, bullet lists, numbered lists, and tables where appropriate. Write comprehensive, detailed content — not an outline or summary. Aim for at least 1500 words for reports/guides. Include real content, facts, and details — not placeholders.
CRITICAL: Your response must contain ONLY the document content in markdown. Do NOT write conversational text like "Okay, I will generate...", "Here's the content...", "Sure, let me create...", or any explanation before or after the document. The very first line of your response must be the # title heading.`,
};

// ── System prompt building ─────────────────────────────────────────────────

export function getTodayString(timezone?: string): string {
  const tz = timezone || "UTC";
  const now = new Date();
  const weekday = now.toLocaleDateString("en-US", { weekday: "long", timeZone: tz });
  const dateStr = now.toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD
  return `Today is ${weekday}, ${dateStr} (${tz}). Do not mention or repeat today's date unless the user asks about dates or time-sensitive facts.`;
}

/**
 * Build the system prompt with all required injections.
 * Returns the system prompt string.
 */
export function buildSystemPrompt(opts: {
  userText: string;
  task?: string;
  timezone?: string;
  targetPages?: number;
  strictPages?: boolean;
  isDocRequest: boolean;
  isGenerationIntent: boolean;
  source: "web" | "slack" | "discord";
  existingSystemPrompt?: string;
}): string {
  const parts: string[] = [];

  // 1. Date instruction
  const dateString = getTodayString(opts.timezone);
  parts.push(`${dateString} Your training data may be outdated; for anything that could have changed since then (prices, releases, news, people in roles, versions, scores, weather), use the search results provided rather than guessing. Never say an event "hasn't happened yet" without checking the search results.`);

  // 2. Task-specific instruction
  if (opts.task && taskInstructions[opts.task]) {
    parts.push(taskInstructions[opts.task]);
  }

  // 3. Auto-inject document instruction
  if (opts.isDocRequest && !opts.task) {
    let docInstruction = taskInstructions["document"];
    const pageMatch = opts.userText.match(/\b(\d{1,3})\s*[-\s]?pages?\b/i);
    const targetPages = pageMatch ? parseInt(pageMatch[1], 10) : null;
    if (targetPages) {
      docInstruction = `Write approximately ${targetPages * 450} words across ${targetPages} top-level H1 sections.${targetPages <= 5 ? ' Do NOT include a Table of Contents.' : ''}\n\n` + docInstruction;
    }
    parts.push(docInstruction);
  }

  // 4. Page budget for explicit task
  if (opts.isDocRequest && opts.task && opts.targetPages) {
    const WORDS_PER_PAGE = 430;
    const hasCover = opts.targetPages >= 4;
    const contentPages = hasCover ? opts.targetPages - 1 : opts.targetPages;
    const targetWords = contentPages * WORDS_PER_PAGE;
    const numSections = Math.max(2, Math.min(contentPages, 8));
    const perSection = Math.round(targetWords / numSections);
    const strictNote = opts.strictPages ? `EXACTLY ${opts.targetPages} pages — do not write more or fewer.` : `Target approximately ${opts.targetPages} pages.`;
    parts.push(`${strictNote} Write approximately ${targetWords} words (±5%), split into ${numSections} top-level sections of ~${perSection} words each. No section may be shorter than 60% of its budget. ${hasCover ? "The first page will be a cover page." : "No cover page — title block is on page 1."}${opts.targetPages >= 8 ? " Include a Table of Contents." : " No Table of Contents needed."}`);
  }

  // 5. Document creation capability
  if (opts.isDocRequest || opts.isGenerationIntent) {
    parts.push("You CAN create files via tools. Never say you cannot create PDFs, images, documents, or any files. Produce the asset directly — never recommend external tools, platforms, or services. Never describe how to do it elsewhere.");
  }

  // 6. File context rule
  parts.push("When file content is provided in <file> tags, answer from the file content; cite page/slide/sheet when relevant. Do not repeat the entire file back — summarize, analyze, or answer the question about it.");

  // 7. Safety instruction
  parts.push("Never fabricate URLs, file paths, or links. If you cannot produce an asset, say so.");

  // 7. Formatting rule
  parts.push("Formatting rule: Use bold only for 1–3 key terms per answer; prefer plain sentences and short lists. Do not bold entire phrases or sentences.");

  // 8. Thread grounding (shared across integrations)
  if (opts.source === "slack" || opts.source === "discord") {
    parts.push("You are in a conversation thread; prior turns are provided as conversation history. Never say you lack memory or cannot remember previous messages — the full thread history is available to you.");
    parts.push("Never contradict a prior answer you gave in this thread without citing a new source that justifies the correction.");
    parts.push("When sources give different prices for the same product, state the official/manufacturer base price once and attribute higher figures to a variant or retailer in a short clause.");
    parts.push("Answer directly with the information requested; do not talk about the search results themselves or say phrases like \"In the provided search results\" or \"Based on the search results\".");
  }

  // 9. Slack-specific additions
  if (opts.source === "slack") {
    parts.push("You are NiaAI, a helpful AI assistant responding in a Slack thread.");
    parts.push("Don't wrap quoted user text in code formatting (backticks or code blocks) — use normal text or bold.");
    parts.push("Be concise and helpful. Format with Slack-compatible markdown (use * for bold, _ for italic, ` for code, ``` for code blocks). Keep responses focused and well-structured.");
  }

  // 10. Discord-specific additions
  if (opts.source === "discord") {
    parts.push("You are NiaAI, a helpful AI assistant responding in a Discord thread.");
    parts.push("Be concise and helpful. Format with Discord-compatible markdown (use **bold**, *italic*, `code`, ```code blocks```). Keep responses focused and well-structured.");
  }

  // Merge with existing system prompt if provided
  if (opts.existingSystemPrompt) {
    return parts.join("\n\n") + "\n\n" + opts.existingSystemPrompt;
  }

  return parts.join("\n\n");
}

// ── Tool definitions (OpenAI function-calling schema) ──────────────────────

export const TOOL_CREATE_PDF = {
  type: "function" as const,
  function: {
    name: "create_pdf",
    description: "Generate and save a real PDF file. Use this whenever the user asks for a PDF, document, report, brochure, or guide.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Document title (short noun phrase, ≤8 words)" },
        subtitle: { type: "string", description: "Optional subtitle" },
        content_markdown: {
          type: "string",
          description: "Full, final document body in Markdown. Use # for page-level sections, ## for subsections, lists, tables. No image suggestions, no 'how to' instructions, no placeholders. Minimum 1200 words for guides.",
        },
        pages: {
          type: "integer",
          description: "Exact number of pages requested by the user. Only set this if the user explicitly asks for N pages (e.g. '5 page pdf'). The renderer will fit content to exactly this many pages.",
        },
        theme: { type: "string", enum: ["travel", "business", "academic", "minimal"] },
      },
      required: ["title", "content_markdown"],
    },
  },
};

export const TOOL_CREATE_IMAGE = {
  type: "function" as const,
  function: {
    name: "create_image",
    description: "Generate an image from a text description. Use this when the user asks for an image, picture, photo, illustration, logo, or artwork.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Detailed visual description of the image to generate (subject, style, lighting, composition). ≤80 words." },
        size: { type: "string", enum: ["1024x1024", "1024x1792", "1792x1024"], description: "Image dimensions" },
      },
      required: ["prompt"],
    },
  },
};

/** All available tools */
export const ALL_TOOLS = [TOOL_CREATE_PDF, TOOL_CREATE_IMAGE];

/** Get tools array for a given intent */
export function getToolsForIntent(intent: DetectedIntent): typeof ALL_TOOLS | undefined {
  if (intent === "document" || intent === "image") return ALL_TOOLS;
  return undefined;
}

/** Get tool_choice for forced tool calling */
export function getToolChoice(intent: DetectedIntent, isDocRequest: boolean, isImageIntent: boolean): any {
  if (isDocRequest) return { type: "function", function: { name: "create_pdf" } };
  if (isImageIntent) return { type: "function", function: { name: "create_image" } };
  return undefined;
}

// ── Document generation (server-side) ──────────────────────────────────────

/** Extract doc type from user text */
export function detectDocType(userText: string, task?: string): DocType {
  const lower = userText.toLowerCase();
  if (/\b(docx|word)\b/.test(lower)) return "docx";
  if (/\b(xlsx|excel|spreadsheet)\b/.test(lower)) return "xlsx";
  if (/\b(csv)\b/.test(lower)) return "csv";
  if (/\b(pptx|powerpoint|slides|deck|presentation)\b/.test(lower) || task === "slides") return "pptx";
  if (/\b(md|markdown)\b/.test(lower)) return "md";
  return "pdf";
}

/** Detect theme from user text */
export function detectTheme(userText: string): "travel" | "business" | "academic" | "minimal" {
  const lower = userText.toLowerCase();
  if (/\b(travel|tourism|trip|vacation|destination|adventure|explore)\b/.test(lower)) return "travel";
  if (/\b(business|corporate|professional|company|enterprise|startup|investor)\b/.test(lower)) return "business";
  if (/\b(academic|research|study|thesis|paper|journal|university|school|education)\b/.test(lower)) return "academic";
  return "minimal";
}

/** Parse target pages from user text */
export function parseTargetPages(text: string): { target: number; strict: boolean } | null {
  const WORD_NUMS: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
    nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
    fifteen: 15, twenty: 20, thirty: 30,
  };

  const digitMatch = text.match(/\b(\d{1,3})\s*[-\s]?pages?\b/i);
  if (digitMatch) {
    return { target: parseInt(digitMatch[1], 10), strict: /\bexactly\b/i.test(text) };
  }

  const wordMatch = text.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty)\s*[-\s]?pages?\b/i);
  if (wordMatch) {
    const num = WORD_NUMS[wordMatch[1].toLowerCase()];
    if (num) return { target: num, strict: /\bexactly\b/i.test(text) };
  }

  return null;
}

/**
 * Generate a document from the LLM's markdown output.
 * Returns the file URL and metadata, or null if generation fails.
 */
export async function generateDocumentFromContent(
  fullContent: string,
  userText: string,
  chatId: string,
  messageId: string,
  task?: string,
  overridePages?: number,
): Promise<{
  url: string;
  filename: string;
  mimeType: string;
  pages: number;
  size_bytes: number;
  file_id: string;
  title: string;
} | null> {
  // Strip preamble: find first heading
  let docContent = fullContent;
  if (docContent.length > 200) {
    const headingIdx = docContent.indexOf("\n# ");
    const altHeadingIdx = docContent.indexOf("# ");
    const startIdx = altHeadingIdx === 0 ? 0 : (headingIdx >= 0 ? headingIdx + 1 : -1);
    if (startIdx >= 0) {
      docContent = docContent.slice(startIdx);
    }
  }

  if (docContent.length < 100) return null;

  const docType = detectDocType(userText, task);
  const theme = detectTheme(userText);
  const titleMatch = docContent.match(/^#\s+(.+)$/m);
  const docTitle = titleMatch ? titleMatch[1].trim() : (userText.length > 60 ? userText.slice(0, 60) : userText);
  const subtitleMatch = docContent.match(/^##\s+(.+)$/m);
  const docSubtitle = subtitleMatch ? subtitleMatch[1].trim() : undefined;
  const parsedPages = parseTargetPages(userText);
  const targetPages = overridePages || parsedPages?.target;
  const strictPages = overridePages ? true : parsedPages?.strict;

  console.log(`[doc-gen] target_pages=${targetPages ?? 'auto'} strict=${strictPages ?? false} override=${overridePages ?? 'none'} parsed=${parsedPages?.target ?? 'none'}`);

  try {
    const result = await generateDocument(docType, docTitle, docContent, {
      theme,
      subtitle: docSubtitle,
      target_pages: targetPages,
      strict_pages: strictPages,
    });

    const fileId = randomUUID();
    const contentHash = createHash("sha256").update(docTitle + docContent).digest("hex");

    // Store in the global file store (shared with /api/documents/generate)
    const fileStore = getFileStore();
    fileStore.set(fileId, {
      buffer: result.buffer,
      filename: result.filename,
      mimeType: result.mimeType,
      type: result.type,
      size_bytes: result.size_bytes,
      pages: result.pages,
      created_at: new Date().toISOString(),
      content_hash: contentHash,
      request_message_id: messageId,
    });

    console.log(`[doc-gen] source=slack file_id=${fileId} type=${docType} title="${docTitle}" pages=${result.pages} size=${result.size_bytes}`);

    recordUsage({
      chat_id: chatId,
      message_id: messageId,
      kind: "tool_pdf",
      provider: "local",
      model: docType,
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
      latency_ms: 0,
    });

    return {
      url: `/api/files/${fileId}`,
      filename: result.filename,
      mimeType: result.mimeType,
      pages: result.pages,
      size_bytes: result.size_bytes,
      file_id: fileId,
      title: docTitle,
    };
  } catch (err) {
    console.error("[doc-gen] failed:", err);
    recordUsage({
      chat_id: chatId,
      message_id: messageId,
      kind: "tool_pdf",
      provider: "local",
      model: docType,
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
      latency_ms: 0,
      status: "error",
      error_message: err instanceof Error ? err.message : "Document generation failed",
    });
    return null;
  }
}

// Global file store accessor (shared with /api/documents/generate/route.ts)
function getFileStore() {
  if (!(globalThis as any).__niaFileStore) {
    (globalThis as any).__niaFileStore = new Map();
  }
  return (globalThis as any).__niaFileStore as Map<string, {
    buffer: Buffer;
    filename: string;
    mimeType: string;
    type: DocType;
    size_bytes: number;
    pages: number;
    created_at: string;
    content_hash: string;
    request_message_id?: string;
  }>;
}

// ── Image generation (server-side) ─────────────────────────────────────────

const ENHANCE_MODEL = process.env.ENHANCE_MODEL || "google/gemini-2.5-flash";
const IMAGE_MODEL = process.env.IMAGE_MODEL || "openai/gpt-image-1";

async function rewriteImagePrompt(userMessage: string): Promise<string> {
  try {
    const res = await fetch(`${NIA_GATEWAY_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${NIA_API_KEY}`,
      },
      body: JSON.stringify({
        model: ENHANCE_MODEL,
        messages: [
          {
            role: "system",
            content:
              "Extract what should be depicted from the user's message. The user may have mixed instructions and image requests in one sentence (e.g. 'explain how to make tea create image of it'). Focus on the visual subject. Return a single vivid description (≤80 words) of the scene, subject, style, and lighting. Never add people unless the user explicitly requested them. Output ONLY the image prompt, nothing else.",
          },
          { role: "user", content: userMessage },
        ],
        max_tokens: 150,
        temperature: 0.4,
        stream: false,
      }),
    });
    if (!res.ok) {
      console.error(`[image-rewrite] LLM returned ${res.status}`);
      return "";
    }
    const data = await res.json();
    const rewritten = data.choices?.[0]?.message?.content?.trim();
    console.log(`[image-rewrite] source=slack input=${JSON.stringify(userMessage)} → output=${JSON.stringify(rewritten)}`);
    return rewritten || "";
  } catch (err) {
    console.error("[image-rewrite] error:", err);
    return "";
  }
}

/**
 * Generate an image from user text.
 * Returns the image URL and metadata, or null if generation fails.
 */
export async function generateImageFromText(
  userText: string,
  chatId: string,
  messageId: string,
): Promise<{
  url: string;
  revised_prompt: string;
  id: string;
  model: string;
  provider: string;
} | null> {
  try {
    // Step 1: Rewrite prompt
    const imagePrompt = await rewriteImagePrompt(userText);
    if (!imagePrompt || imagePrompt.length < 5) {
      console.error(`[image-gen] source=slack empty prompt from: ${JSON.stringify(userText)}`);
      return null;
    }

    // Step 2: Generate image
    const requestBody = {
      model: IMAGE_MODEL,
      prompt: imagePrompt,
      n: 1,
      size: "1024x1024",
    };
    console.log(`[image-gen] source=slack request:`, JSON.stringify(requestBody));

    const genRes = await fetch(`${NIA_GATEWAY_URL}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${NIA_API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!genRes.ok) {
      const errText = await genRes.text();
      console.error(`[image-gen] source=slack provider error ${genRes.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    const genData = await genRes.json();
    const imageItem = genData.data?.[0];
    if (!imageItem) return null;

    // Step 3: Save locally
    const isBase64 = !!imageItem.b64_json;
    const rawImage = imageItem.b64_json || imageItem.url;
    if (!rawImage) return null;

    const id = randomUUID();
    const uploadsDir = path.join(process.cwd(), "uploads", "images");
    await mkdir(uploadsDir, { recursive: true });
    const filePath = path.join(uploadsDir, `${id}.png`);

    let buffer: Buffer;
    if (isBase64) {
      buffer = Buffer.from(rawImage, "base64");
    } else {
      const imgRes = await fetch(rawImage);
      if (!imgRes.ok) throw new Error("Failed to download image from provider");
      buffer = Buffer.from(await imgRes.arrayBuffer());
    }

    const sha256 = createHash("sha256").update(buffer).digest("hex");
    await writeFile(filePath, buffer);

    const provider = IMAGE_MODEL.split("/")[0] || "unknown";
    const revisedPrompt = imageItem.revised_prompt || imagePrompt;

    console.log(`[image] source=slack provider=${provider} model=${IMAGE_MODEL} prompt="${imagePrompt.slice(0, 120)}" file=${id}.png sha256=${sha256}`);

    recordUsage({
      chat_id: chatId,
      message_id: messageId,
      kind: "tool_image",
      provider,
      model: IMAGE_MODEL,
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0.04,
      latency_ms: 0,
    });

    return {
      url: `/api/images/${id}`,
      revised_prompt: revisedPrompt,
      id,
      model: IMAGE_MODEL,
      provider,
    };
  } catch (err) {
    console.error("[image-gen] source=slack error:", err);
    return null;
  }
}
