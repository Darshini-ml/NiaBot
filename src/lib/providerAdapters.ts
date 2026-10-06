// ── Interfaces ────────────────────────────────────────────────────────────────

export interface CompletionRequest {
  messages: Array<{ role: string; content: string | any[] }>;
  model: string;
  stream: boolean;
  max_tokens: number;
  tools?: any[];
  tool_choice?: any;
  thinking?: { level: "off" | "low" | "medium" | "high" };
}

export interface CompletionResponse {
  stream: ReadableStream | null;
  usage?: UsageData;
}

export interface UsageData {
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens?: number;
  reasoning_tokens?: number;
  latency_ms: number;
  ttft_ms?: number;
  tool_calls: number;
  cost_usd: number;
  provider: string;
  model: string;
}

export interface ProviderAdapter {
  complete(req: CompletionRequest): Promise<Response>;
}

// ── Cost tables (per 1M tokens) ──────────────────────────────────────────────

const COST_TABLE: Record<string, Record<string, { input: number; output: number }>> = {
  anthropic: {
    "claude-sonnet-4-20250514": { input: 3, output: 15 },
    "claude-opus-4-20250514": { input: 15, output: 75 },
    "claude-3-5-haiku-20241022": { input: 0.8, output: 4 },
    default: { input: 3, output: 15 },
  },
  openai: {
    "gpt-4o": { input: 2.5, output: 10 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "o3-mini": { input: 1.1, output: 4.4 },
    "o3": { input: 10, output: 40 },
    default: { input: 2.5, output: 10 },
  },
  google: {
    "gemini-2.5-pro": { input: 1.25, output: 10 },
    "gemini-2.5-flash": { input: 0.15, output: 0.6 },
    "gemini-2.0-flash": { input: 0.1, output: 0.4 },
    default: { input: 0.15, output: 0.6 },
  },
  ollama: {
    default: { input: 0, output: 0 },
  },
  nia: {
    default: { input: 0, output: 0 },
  },
  gateway: {
    default: { input: 0, output: 0 },
  },
};

export function computeCost(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  reasoningTokens?: number,
): number {
  let providerTable = COST_TABLE[provider] || COST_TABLE.nia;
  let rates = providerTable[model] || providerTable.default;

  // If the provider is "nia" or "gateway" and rates are both 0,
  // try to infer the real provider from the model ID (e.g. "google/gemini-2.5-flash")
  if (
    (provider === "nia" || provider === "gateway") &&
    rates.input === 0 &&
    rates.output === 0
  ) {
    const slashIdx = model.indexOf("/");
    if (slashIdx > 0) {
      const inferredProvider = model.substring(0, slashIdx);
      const inferredModel = model.substring(slashIdx + 1);
      const inferredTable = COST_TABLE[inferredProvider];
      if (inferredTable) {
        rates = inferredTable[inferredModel] || inferredTable.default;
      }
    }
  }

  // If no pricing found (unknown model), return -1
  if (rates.input === 0 && rates.output === 0) {
    return -1;
  }

  // Reasoning tokens count as output tokens for cost
  const totalOutputTokens = outputTokens + (reasoningTokens || 0);
  return (inputTokens * rates.input + totalOutputTokens * rates.output) / 1_000_000;
}

// ── Thinking level mappings ──────────────────────────────────────────────────

const ANTHROPIC_THINKING_BUDGETS: Record<string, number> = {
  low: 2048,
  medium: 8192,
  high: 32768,
};

const OPENAI_REASONING_EFFORT: Record<string, string> = {
  low: "low",
  medium: "medium",
  high: "high",
};

const GOOGLE_THINKING_BUDGETS: Record<string, number> = {
  low: 2048,
  medium: 8192,
  high: 32768,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function sseHeaders(): HeadersInit {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  };
}

function errorResponse(status: number, message: string): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      const payload = JSON.stringify({
        error: true,
        message,
      });
      controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(body, { status, headers: sseHeaders() });
}

// ── NIA Adapter ──────────────────────────────────────────────────────────────

class NiaAdapter implements ProviderAdapter {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl =
      process.env.NIA_GATEWAY_URL || process.env.NIA_BASE_URL || "https://api.nia.naslabs.ai/v1";
    this.apiKey = process.env.NIA_API_KEY || "";
  }

  async complete(req: CompletionRequest): Promise<Response> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      stream: req.stream,
      max_tokens: req.max_tokens,
    };

    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools;
      if (req.tool_choice) body.tool_choice = req.tool_choice;
    }

    // Include stream_options for usage tracking when streaming
    if (req.stream) {
      body.stream_options = { include_usage: true };
    }

    // Map thinking parameters per-provider through the gateway
    if (req.thinking && req.thinking.level !== "off") {
      const model = req.model;
      if (model.startsWith("anthropic/")) {
        const budget = ANTHROPIC_THINKING_BUDGETS[req.thinking.level];
        if (budget) {
          body.thinking = { type: "enabled", budget_tokens: budget };
        }
      } else if (model.startsWith("openai/")) {
        const effort = OPENAI_REASONING_EFFORT[req.thinking.level];
        if (effort) {
          body.reasoning_effort = effort;
        }
      } else if (model.startsWith("google/")) {
        const budget = GOOGLE_THINKING_BUDGETS[req.thinking.level];
        if (budget) {
          body.thinkingConfig = { thinkingBudget: budget };
        }
      }
    }

    try {
      const url = `${this.baseUrl}/chat/completions`;
      console.log(`[gateway] POST ${url} model=${req.model} stream=${!!req.stream}`);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text();
        return errorResponse(
          response.status,
          errText || `NIA API error: ${response.status}`,
        );
      }

      // Extract gateway metadata headers
      const responseHeaders: HeadersInit = sseHeaders();
      const servedModel = response.headers.get("x-served-model");
      const requestId = response.headers.get("x-request-id");
      if (servedModel) {
        (responseHeaders as Record<string, string>)["x-served-model"] = servedModel;
      }
      if (requestId) {
        (responseHeaders as Record<string, string>)["x-request-id"] = requestId;
      }

      // Pass through directly -- NIA already returns OpenAI-compatible SSE
      return new Response(response.body, {
        status: 200,
        headers: responseHeaders,
      });
    } catch (err) {
      return errorResponse(
        502,
        err instanceof Error ? err.message : "NIA request failed",
      );
    }
  }
}

// ── Anthropic Adapter ────────────────────────────────────────────────────────

class AnthropicAdapter implements ProviderAdapter {
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.ANTHROPIC_API_KEY || "";
  }

  async complete(req: CompletionRequest): Promise<Response> {
    if (!this.apiKey) {
      return errorResponse(401, "ANTHROPIC_API_KEY is not configured");
    }

    // Convert OpenAI-style messages to Anthropic format
    const systemParts: string[] = [];
    const anthropicMessages: Array<{ role: string; content: string | any[] }> =
      [];

    for (const msg of req.messages) {
      if (msg.role === "system") {
        systemParts.push(
          typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content),
        );
      } else {
        anthropicMessages.push({
          role: msg.role === "assistant" ? "assistant" : "user",
          content: msg.content,
        });
      }
    }

    const body: Record<string, unknown> = {
      model: req.model,
      messages: anthropicMessages,
      max_tokens: req.max_tokens,
      stream: req.stream,
    };

    if (systemParts.length > 0) {
      body.system = systemParts.join("\n\n");
    }

    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools;
      if (req.tool_choice) body.tool_choice = req.tool_choice;
    }

    // Map thinking levels
    if (req.thinking && req.thinking.level !== "off") {
      const budget = ANTHROPIC_THINKING_BUDGETS[req.thinking.level];
      if (budget) {
        body.thinking = { type: "enabled", budget_tokens: budget };
      }
    }

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text();
        return errorResponse(
          response.status,
          errText || `Anthropic API error: ${response.status}`,
        );
      }

      if (!req.stream) {
        // Non-streaming: convert Anthropic response to OpenAI format
        const data = await response.json();
        const content =
          data.content
            ?.filter((b: any) => b.type === "text")
            .map((b: any) => b.text)
            .join("") || "";

        const openAIResponse = {
          id: data.id,
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content },
              finish_reason: data.stop_reason === "end_turn" ? "stop" : data.stop_reason,
            },
          ],
          usage: {
            prompt_tokens: data.usage?.input_tokens || 0,
            completion_tokens: data.usage?.output_tokens || 0,
            total_tokens:
              (data.usage?.input_tokens || 0) +
              (data.usage?.output_tokens || 0),
          },
        };
        return new Response(JSON.stringify(openAIResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Streaming: transform Anthropic SSE to OpenAI-compatible SSE
      const transformed = this.transformAnthropicStream(response.body!);
      return new Response(transformed, {
        status: 200,
        headers: sseHeaders(),
      });
    } catch (err) {
      return errorResponse(
        502,
        err instanceof Error ? err.message : "Anthropic request failed",
      );
    }
  }

  private transformAnthropicStream(
    sourceBody: ReadableStream<Uint8Array>,
  ): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let buffer = "";
    let blockIndex = 0;

    return new ReadableStream({
      async start(controller) {
        const reader = sourceBody.getReader();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith(":")) continue;

              if (trimmed.startsWith("event: ")) continue;

              if (trimmed.startsWith("data: ")) {
                const jsonStr = trimmed.slice(6);
                if (jsonStr === "[DONE]") continue;

                try {
                  const event = JSON.parse(jsonStr);
                  const openAIChunk = convertAnthropicEvent(
                    event,
                    blockIndex,
                  );
                  if (openAIChunk) {
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify(openAIChunk)}\n\n`,
                      ),
                    );
                  }
                  if (event.type === "content_block_start") {
                    blockIndex++;
                  }
                } catch {
                  // Skip malformed JSON
                }
              }
            }
          }

          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } catch (err) {
          const errPayload = JSON.stringify({
            error: true,
            message:
              err instanceof Error ? err.message : "Stream transform error",
          });
          controller.enqueue(encoder.encode(`data: ${errPayload}\n\n`));
        } finally {
          controller.close();
        }
      },
    });
  }
}

function convertAnthropicEvent(
  event: any,
  _blockIndex: number,
): any | null {
  switch (event.type) {
    case "content_block_delta": {
      const delta = event.delta;
      if (delta?.type === "text_delta" && delta.text) {
        return {
          id: "chatcmpl-anthropic",
          object: "chat.completion.chunk",
          choices: [
            {
              index: 0,
              delta: { content: delta.text },
              finish_reason: null,
            },
          ],
        };
      }
      if (delta?.type === "thinking_delta" && delta.thinking) {
        return {
          id: "chatcmpl-anthropic",
          object: "chat.completion.chunk",
          choices: [
            {
              index: 0,
              delta: { reasoning_content: delta.thinking },
              finish_reason: null,
            },
          ],
        };
      }
      return null;
    }
    case "message_delta": {
      const finishReason =
        event.delta?.stop_reason === "end_turn" ? "stop" : event.delta?.stop_reason || null;
      if (finishReason) {
        return {
          id: "chatcmpl-anthropic",
          object: "chat.completion.chunk",
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: finishReason,
            },
          ],
        };
      }
      return null;
    }
    case "message_start":
    case "content_block_start":
    case "content_block_stop":
    case "message_stop":
    case "ping":
      return null;
    default:
      return null;
  }
}

// ── OpenAI Adapter ───────────────────────────────────────────────────────────

class OpenAIAdapter implements ProviderAdapter {
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY || "";
  }

  async complete(req: CompletionRequest): Promise<Response> {
    if (!this.apiKey) {
      return errorResponse(401, "OPENAI_API_KEY is not configured");
    }

    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      stream: req.stream,
      max_tokens: req.max_tokens,
    };

    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools;
      if (req.tool_choice) body.tool_choice = req.tool_choice;
    }

    // Map thinking levels to reasoning_effort
    if (req.thinking && req.thinking.level !== "off") {
      const effort = OPENAI_REASONING_EFFORT[req.thinking.level];
      if (effort) {
        body.reasoning_effort = effort;
      }
    }

    try {
      const response = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        const errText = await response.text();
        return errorResponse(
          response.status,
          errText || `OpenAI API error: ${response.status}`,
        );
      }

      // OpenAI already returns OpenAI-compatible format -- pass through
      return new Response(response.body, {
        status: 200,
        headers: req.stream
          ? sseHeaders()
          : { "Content-Type": "application/json" },
      });
    } catch (err) {
      return errorResponse(
        502,
        err instanceof Error ? err.message : "OpenAI request failed",
      );
    }
  }
}

// ── Google Adapter ───────────────────────────────────────────────────────────

class GoogleAdapter implements ProviderAdapter {
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.GOOGLE_API_KEY || "";
  }

  async complete(req: CompletionRequest): Promise<Response> {
    if (!this.apiKey) {
      return errorResponse(401, "GOOGLE_API_KEY is not configured");
    }

    // Convert OpenAI-style messages to Google Generative AI format
    const systemInstruction: string[] = [];
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> =
      [];

    for (const msg of req.messages) {
      if (msg.role === "system") {
        systemInstruction.push(
          typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content),
        );
      } else {
        const text =
          typeof msg.content === "string"
            ? msg.content
            : msg.content
                .filter((p: any) => p.type === "text")
                .map((p: any) => p.text)
                .join("\n");
        contents.push({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text }],
        });
      }
    }

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: req.max_tokens,
      },
    };

    if (systemInstruction.length > 0) {
      body.systemInstruction = {
        parts: [{ text: systemInstruction.join("\n\n") }],
      };
    }

    // Map thinking levels
    if (req.thinking && req.thinking.level !== "off") {
      const budget = GOOGLE_THINKING_BUDGETS[req.thinking.level];
      if (budget) {
        (body.generationConfig as any).thinkingConfig = {
          thinkingBudget: budget,
        };
      }
    }

    const method = req.stream ? "streamGenerateContent" : "generateContent";
    const streamParam = req.stream ? "?alt=sse" : "";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${req.model}:${method}${streamParam}&key=${this.apiKey}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text();
        return errorResponse(
          response.status,
          errText || `Google API error: ${response.status}`,
        );
      }

      if (!req.stream) {
        // Non-streaming: convert Google response to OpenAI format
        const data = await response.json();
        const candidate = data.candidates?.[0];
        const content =
          candidate?.content?.parts
            ?.filter((p: any) => p.text)
            .map((p: any) => p.text)
            .join("") || "";

        const openAIResponse = {
          id: "chatcmpl-google",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content },
              finish_reason:
                candidate?.finishReason === "STOP" ? "stop" : candidate?.finishReason || "stop",
            },
          ],
          usage: {
            prompt_tokens: data.usageMetadata?.promptTokenCount || 0,
            completion_tokens:
              data.usageMetadata?.candidatesTokenCount || 0,
            total_tokens: data.usageMetadata?.totalTokenCount || 0,
          },
        };
        return new Response(JSON.stringify(openAIResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Streaming: transform Google SSE to OpenAI-compatible SSE
      const transformed = this.transformGoogleStream(response.body!);
      return new Response(transformed, {
        status: 200,
        headers: sseHeaders(),
      });
    } catch (err) {
      return errorResponse(
        502,
        err instanceof Error ? err.message : "Google request failed",
      );
    }
  }

  private transformGoogleStream(
    sourceBody: ReadableStream<Uint8Array>,
  ): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let buffer = "";

    return new ReadableStream({
      async start(controller) {
        const reader = sourceBody.getReader();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith("data: ")) continue;

              const jsonStr = trimmed.slice(6);
              if (jsonStr === "[DONE]") continue;

              try {
                const event = JSON.parse(jsonStr);
                const candidate = event.candidates?.[0];
                const text =
                  candidate?.content?.parts
                    ?.filter((p: any) => p.text)
                    .map((p: any) => p.text)
                    .join("") || "";

                if (text) {
                  const openAIChunk = {
                    id: "chatcmpl-google",
                    object: "chat.completion.chunk",
                    choices: [
                      {
                        index: 0,
                        delta: { content: text },
                        finish_reason:
                          candidate?.finishReason === "STOP"
                            ? "stop"
                            : null,
                      },
                    ],
                  };
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify(openAIChunk)}\n\n`,
                    ),
                  );
                }

                if (candidate?.finishReason === "STOP") {
                  const stopChunk = {
                    id: "chatcmpl-google",
                    object: "chat.completion.chunk",
                    choices: [
                      {
                        index: 0,
                        delta: {},
                        finish_reason: "stop",
                      },
                    ],
                  };
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify(stopChunk)}\n\n`,
                    ),
                  );
                }
              } catch {
                // Skip malformed JSON
              }
            }
          }

          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } catch (err) {
          const errPayload = JSON.stringify({
            error: true,
            message:
              err instanceof Error ? err.message : "Stream transform error",
          });
          controller.enqueue(encoder.encode(`data: ${errPayload}\n\n`));
        } finally {
          controller.close();
        }
      },
    });
  }
}

// ── Ollama Adapter ───────────────────────────────────────────────────────────

class OllamaAdapter implements ProviderAdapter {
  private baseUrl: string;

  constructor() {
    this.baseUrl =
      process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  }

  async complete(req: CompletionRequest): Promise<Response> {
    // Ollama uses OpenAI-compatible API at /v1/chat/completions
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      stream: req.stream,
    };

    // Ollama uses num_predict instead of max_tokens in its native API,
    // but the OpenAI-compatible endpoint accepts max_tokens
    body.max_tokens = req.max_tokens;

    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools;
      if (req.tool_choice) body.tool_choice = req.tool_choice;
    }

    // Ollama does not support thinking/reasoning -- ignore the field

    try {
      const response = await fetch(
        `${this.baseUrl}/v1/chat/completions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        const errText = await response.text();
        return errorResponse(
          response.status,
          errText || `Ollama error: ${response.status}`,
        );
      }

      // Ollama's OpenAI-compatible endpoint returns the same format -- pass through
      return new Response(response.body, {
        status: 200,
        headers: req.stream
          ? sseHeaders()
          : { "Content-Type": "application/json" },
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Ollama request failed";
      // Provide a friendlier message if Ollama is not running
      const hint = message.includes("ECONNREFUSED")
        ? `Ollama is not running at ${this.baseUrl}. Start it with: ollama serve`
        : message;
      return errorResponse(502, hint);
    }
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

const adapterCache = new Map<string, ProviderAdapter>();

export function getAdapter(provider: string): ProviderAdapter {
  const key = provider.toLowerCase();

  if (adapterCache.has(key)) {
    return adapterCache.get(key)!;
  }

  let adapter: ProviderAdapter;

  switch (key) {
    case "anthropic":
      adapter = new AnthropicAdapter();
      break;
    case "openai":
      adapter = new OpenAIAdapter();
      break;
    case "google":
      adapter = new GoogleAdapter();
      break;
    case "ollama":
      adapter = new OllamaAdapter();
      break;
    case "nia":
    default:
      adapter = new NiaAdapter();
      break;
  }

  adapterCache.set(key, adapter);
  return adapter;
}

const PROVIDER_ENV_KEYS: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
  ollama: "OLLAMA_BASE_URL",
};

export function resolveAdapter(
  provider: string,
  modelId: string,
): { adapter: ProviderAdapter; via: "direct" | "gateway" } | null {
  const key = provider.toLowerCase();

  // (1) If there's a direct provider key set, use the direct provider adapter
  const envKey = PROVIDER_ENV_KEYS[key];
  if (envKey && process.env[envKey]) {
    return { adapter: getAdapter(key), via: "direct" };
  }

  // (2) If NIA_API_KEY is set, use the NiaAdapter (gateway)
  if (process.env.NIA_API_KEY) {
    return { adapter: getAdapter("nia"), via: "gateway" };
  }

  // (3) No adapter available
  return null;
}
