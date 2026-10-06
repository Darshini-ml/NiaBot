// ---------------------------------------------------------------------------
// Model Catalog – labels, metadata, type inference, and filtering
// ---------------------------------------------------------------------------

export interface ModelSupports {
  tools: boolean;
  vision: boolean;
  thinking: boolean;
  streaming: boolean;
}

export interface ModelPricing {
  in_per_1m: number;
  out_per_1m: number;
}

export type ModelType = "chat" | "image" | "audio" | "embedding";

export interface GatewayModel {
  id: string;              // exact id from gateway e.g. "anthropic/claude-haiku-4-20250414"
  label: string;           // friendly name
  provider: string;        // provider prefix before /
  type: ModelType;         // inferred or explicit type
  context?: number;        // context window if gateway provides it
  supports?: Partial<ModelSupports>;
  pricing?: Partial<ModelPricing>;
  deprecated?: boolean;    // true for dated snapshots when alias exists
}

// ---------------------------------------------------------------------------
// Friendly labels for model IDs
// ---------------------------------------------------------------------------

const MODEL_LABELS: Record<string, { label: string; icon: string; tag?: string }> = {
  // Anthropic
  "anthropic/claude-sonnet-4-20250514": { label: "Claude Sonnet 4", icon: "brain" },
  "anthropic/claude-haiku-4-20250414": { label: "Claude Haiku 4.5", icon: "brain" },
  "anthropic/claude-opus-4-20250414": { label: "Claude Opus 4", icon: "brain" },
  "anthropic/claude-sonnet-4.5": { label: "Claude Sonnet 4.5", icon: "brain", tag: "Best reasoning" },
  "anthropic/claude-haiku-4.5": { label: "Claude Haiku 4.5", icon: "brain", tag: "Cheapest" },
  "anthropic/claude-opus-4.1": { label: "Claude Opus 4.1", icon: "brain" },
  // OpenAI
  "openai/gpt-5": { label: "GPT-5", icon: "zap", tag: "Latest" },
  "openai/gpt-5-mini": { label: "GPT-5 mini", icon: "zap" },
  "openai/gpt-4o": { label: "GPT-4o", icon: "zap" },
  "openai/gpt-4o-mini": { label: "GPT-4o mini", icon: "zap" },
  "openai/o3": { label: "o3", icon: "zap" },
  "openai/o3-mini": { label: "o3-mini", icon: "zap" },
  "openai/o4-mini": { label: "o4-mini", icon: "zap" },
  // Google
  "google/gemini-2.5-pro": { label: "Gemini 2.5 Pro", icon: "globe", tag: "1M context" },
  "google/gemini-2.5-flash": { label: "Gemini 2.5 Flash", icon: "globe", tag: "Fastest" },
  "google/gemini-2.0-flash": { label: "Gemini 2.0 Flash", icon: "globe" },
  // Meta
  "meta-llama/llama-4-maverick": { label: "Llama 4 Maverick", icon: "sparkles" },
  "meta-llama/llama-4-scout": { label: "Llama 4 Scout", icon: "sparkles" },
  // DeepSeek
  "deepseek/deepseek-r1": { label: "DeepSeek R1", icon: "sparkles" },
  "deepseek/deepseek-chat": { label: "DeepSeek V3", icon: "sparkles" },
  // Mistral
  "mistralai/mistral-large-latest": { label: "Mistral Large", icon: "sparkles" },
  "mistralai/mistral-small-latest": { label: "Mistral Small", icon: "sparkles" },
  "mistralai/codestral-latest": { label: "Codestral", icon: "sparkles" },
  // Qwen
  "qwen/qwen3-coder": { label: "Qwen3 Coder", icon: "sparkles" },
  "qwen/qwen3-235b-a22b": { label: "Qwen3 235B", icon: "sparkles" },
  "qwen/qwen-turbo-latest": { label: "Qwen Turbo", icon: "sparkles" },
  // xAI
  "x-ai/grok-3": { label: "Grok 3", icon: "sparkles" },
  "x-ai/grok-3-mini": { label: "Grok 3 Mini", icon: "sparkles" },
  // Cohere
  "cohere/command-r-plus": { label: "Command R+", icon: "sparkles" },
  "cohere/command-r": { label: "Command R", icon: "sparkles" },
  // Perplexity
  "perplexity/sonar-pro": { label: "Sonar Pro", icon: "sparkles" },
  "perplexity/sonar": { label: "Sonar", icon: "sparkles" },
};

// Provider display names
const PROVIDER_NAMES: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  "meta-llama": "Meta",
  deepseek: "DeepSeek",
  mistralai: "Mistral",
  ollama: "Ollama",
  qwen: "Alibaba / Qwen",
  "x-ai": "xAI",
  cohere: "Cohere",
  perplexity: "Perplexity",
  microsoft: "Microsoft",
  nvidia: "Nvidia",
  minimax: "Minimax",
  moonshot: "Moonshot",
};

// ---------------------------------------------------------------------------
// Image / audio / embedding provider patterns
// ---------------------------------------------------------------------------

const IMAGE_PROVIDERS = new Set(["recraft", "bfl", "klingai", "prodia", "stabilityai"]);
const AUDIO_PROVIDERS = new Set(["fish-audio"]);

// ID patterns for type inference
const IMAGE_PATTERNS = /recraft|flux|kling|sdxl|dall-e|imagen|stable-diffusion|midjourney|playground-v/i;
const AUDIO_PATTERNS = /tts|whisper|audio|voice|speech|minimax-music/i;
const EMBEDDING_PATTERNS = /embed|voyage|bge|mxbai|text-embedding|jina-embed/i;

// Dated snapshot pattern: ends with -YYYYMMDD or -YYYY-MM-DD
const DATED_SNAPSHOT = /-\d{8}$|-\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getModelLabel(id: string): string {
  if (MODEL_LABELS[id]?.label) return MODEL_LABELS[id].label;
  // Unknown IDs: show the raw model part (after provider/), never guess a name
  const raw = id.split("/").pop() || id;
  return raw;
}

export function getModelTag(id: string): string | undefined {
  return MODEL_LABELS[id]?.tag;
}

export function getModelIcon(id: string): string {
  return MODEL_LABELS[id]?.icon || "sparkles";
}

export function getProviderFromId(id: string): string {
  const slash = id.indexOf("/");
  return slash > 0 ? id.substring(0, slash) : "unknown";
}

export function getProviderName(provider: string): string {
  return PROVIDER_NAMES[provider] || provider.charAt(0).toUpperCase() + provider.slice(1);
}

/** Infer model type from its id and provider */
export function inferModelType(id: string, provider: string): ModelType {
  if (IMAGE_PROVIDERS.has(provider)) return "image";
  if (AUDIO_PROVIDERS.has(provider)) return "audio";
  const modelPart = id.split("/").pop() || id;
  if (IMAGE_PATTERNS.test(modelPart)) return "image";
  if (AUDIO_PATTERNS.test(modelPart)) return "audio";
  if (EMBEDDING_PATTERNS.test(modelPart)) return "embedding";
  return "chat";
}

/** Check if a model id looks like a dated snapshot (e.g. claude-sonnet-4-20250514) */
export function isDatedSnapshot(id: string): boolean {
  const modelPart = id.split("/").pop() || id;
  return DATED_SNAPSHOT.test(modelPart);
}

/**
 * Given a list of gateway models, deduplicate by keeping aliases over dated snapshots.
 * E.g. if both `anthropic/claude-sonnet-4.5` and `anthropic/claude-sonnet-4-20250514` exist,
 * keep only the alias.
 */
export function deduplicateModels(models: GatewayModel[]): GatewayModel[] {
  // Group by provider
  const byProvider = new Map<string, GatewayModel[]>();
  for (const m of models) {
    const list = byProvider.get(m.provider) || [];
    list.push(m);
    byProvider.set(m.provider, list);
  }

  const result: GatewayModel[] = [];
  for (const [, provModels] of byProvider) {
    // Find aliases (non-dated) and dated snapshots
    const aliases = new Set<string>();
    for (const m of provModels) {
      if (!isDatedSnapshot(m.id)) {
        aliases.add(m.id);
      }
    }

    for (const m of provModels) {
      if (isDatedSnapshot(m.id)) {
        // Check if an alias exists that likely points to this snapshot
        // e.g. "claude-sonnet-4-20250514" -> check if "claude-sonnet-4.5" or "claude-sonnet-4" alias exists
        const hasAlias = Array.from(aliases).some((alias) => {
          const aliasBase = (alias.split("/").pop() || "").replace(/[.\d]+$/, "");
          const snapBase = (m.id.split("/").pop() || "").replace(/-\d{8}$|-\d{4}-\d{2}-\d{2}$/, "");
          return aliasBase === snapBase || snapBase.startsWith(aliasBase);
        });
        if (hasAlias) {
          m.deprecated = true;
          continue; // skip dated snapshot when alias exists
        }
      }
      result.push(m);
    }
  }
  return result;
}

/** Filter to only chat models */
export function filterChatModels(models: GatewayModel[]): GatewayModel[] {
  return models.filter((m) => m.type === "chat");
}

/** Filter to only image models */
export function filterImageModels(models: GatewayModel[]): GatewayModel[] {
  return models.filter((m) => m.type === "image");
}

// ---------------------------------------------------------------------------
// Featured model IDs (pinned to top of picker)
// ---------------------------------------------------------------------------

export const FEATURED_MODEL_IDS = new Set([
  "google/gemini-2.5-flash",       // NiaAI Fast (Default)
  "deepseek/deepseek-r1",          // NiaAI Deep Think (Best reasoning)
  "anthropic/claude-sonnet-4.5",   // Claude Sonnet 4.5
  "anthropic/claude-haiku-4.5",    // Claude Haiku 4.5
  "openai/gpt-5",                  // GPT-5
  "openai/gpt-5-mini",             // GPT-5 mini
  "google/gemini-2.5-pro",         // Gemini 2.5 Pro
]);

// Ordered list for rendering Featured section — exactly 8 rows, unique tags
export const FEATURED_ORDER: { id: string; displayName: string; tag: string }[] = [
  { id: "google/gemini-2.5-flash", displayName: "NiaAI Fast", tag: "Default" },
  { id: "deepseek/deepseek-r1", displayName: "NiaAI Deep Think", tag: "Best reasoning" },
  { id: "anthropic/claude-sonnet-4.5", displayName: "Claude Sonnet 4.5", tag: "Balanced" },
  { id: "anthropic/claude-haiku-4.5", displayName: "Claude Haiku 4.5", tag: "Fastest" },
  { id: "openai/gpt-5", displayName: "GPT-5", tag: "Latest" },
  { id: "openai/gpt-5-mini", displayName: "GPT-5 mini", tag: "Cheap" },
  { id: "google/gemini-2.5-pro", displayName: "Gemini 2.5 Pro", tag: "1M context" },
  { id: "google/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", tag: "Fast & cheap" },
];

export const FEATURED_TAGS: Record<string, string> = {
  "google/gemini-2.5-flash": "Default",
  "deepseek/deepseek-r1": "Best reasoning",
  "anthropic/claude-sonnet-4.5": "Balanced",
  "anthropic/claude-haiku-4.5": "Fastest",
  "openai/gpt-5": "Latest",
  "openai/gpt-5-mini": "Cheap",
  "google/gemini-2.5-pro": "1M context",
};

// Deprecated model patterns to filter out unless "Show deprecated" is toggled
export const DEPRECATED_PATTERNS = [
  /^(anthropic|openai|google)\/claude-3-/,
  /^(anthropic|openai|google)\/claude-2/,
  /^openai\/gpt-3\.5/,
  /^openai\/gpt-4-(?!.*4\.1)/,        // gpt-4-* except 4.1
  /^openai\/o1/,
  /^google\/gemini-1\./,
  /\-preview\-/,                       // *-preview-* (older than 6 months check would need date logic)
];

export function isDeprecatedModel(id: string): boolean {
  return DEPRECATED_PATTERNS.some((p) => p.test(id));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function titleCaseFromId(id: string): string {
  const raw = id.split("/").pop() || id;
  return raw
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
