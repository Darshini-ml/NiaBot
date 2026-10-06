import { NextRequest } from "next/server";
import {
  getModelLabel,
  getModelIcon,
  getModelTag,
  getProviderFromId,
  getProviderName,
  inferModelType,
  isDatedSnapshot,
  type ModelType,
} from "@/lib/modelCatalog";

import { NIA_GATEWAY_URL, NIA_API_KEY } from "@/lib/config";
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "";

interface CachedCatalog {
  data: any;
  fetchedAt: number;
}

let catalogCache: CachedCatalog | null = null;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

interface GatewayModelEntry {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string; input?: number; output?: number };
  max_context_length?: number;
  top_provider?: { max_completion_tokens?: number; context_length?: number };
}

async function fetchGatewayModels(): Promise<GatewayModelEntry[]> {
  if (!NIA_API_KEY) return [];
  try {
    const res = await fetch(`${NIA_GATEWAY_URL}/models`, {
      headers: { Authorization: `Bearer ${NIA_API_KEY}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error(`[models] Gateway returned ${res.status}`);
      return [];
    }
    const json = await res.json();
    return json.data || json.models || [];
  } catch (err) {
    console.error("[models] Gateway fetch failed:", err);
    return [];
  }
}

async function fetchOllamaModels(): Promise<{ id: string; name: string }[]> {
  if (!OLLAMA_BASE_URL) return [];
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    const json = await res.json();
    return (json.models || []).map((m: any) => ({
      id: `ollama/${m.name || m.model}`,
      name: m.name || m.model,
    }));
  } catch {
    return [];
  }
}

export async function GET(_request: NextRequest) {
  // Check cache
  if (catalogCache && Date.now() - catalogCache.fetchedAt < CACHE_TTL) {
    return Response.json(catalogCache.data);
  }

  const [gatewayModels, ollamaModels] = await Promise.all([
    fetchGatewayModels(),
    fetchOllamaModels(),
  ]);

  // Group by provider, classify by type, deduplicate
  const providerMap = new Map<string, any[]>();
  // Track aliases to deduplicate dated snapshots
  const aliasIds = new Set<string>();

  // First pass: collect alias IDs (non-dated)
  for (const gm of gatewayModels) {
    if (!isDatedSnapshot(gm.id)) {
      aliasIds.add(gm.id);
    }
  }

  for (const gm of gatewayModels) {
    const provider = getProviderFromId(gm.id);
    const modelType = inferModelType(gm.id, provider);

    // Skip dated snapshots when an alias exists
    if (isDatedSnapshot(gm.id)) {
      const hasAlias = Array.from(aliasIds).some((alias) => {
        if (getProviderFromId(alias) !== provider) return false;
        const aliasBase = (alias.split("/").pop() || "").replace(/[.\d]+$/, "");
        const snapBase = (gm.id.split("/").pop() || "").replace(/-\d{8}$|-\d{4}-\d{2}-\d{2}$/, "");
        return aliasBase === snapBase || snapBase.startsWith(aliasBase);
      });
      if (hasAlias) continue;
    }

    if (!providerMap.has(provider)) providerMap.set(provider, []);

    // Parse pricing
    let pricing: { in_per_1m?: number; out_per_1m?: number } | undefined;
    if (gm.pricing) {
      const inputPrice = typeof gm.pricing.prompt === "string" ? parseFloat(gm.pricing.prompt) * 1_000_000
        : typeof gm.pricing.input === "number" ? gm.pricing.input : undefined;
      const outputPrice = typeof gm.pricing.completion === "string" ? parseFloat(gm.pricing.completion) * 1_000_000
        : typeof gm.pricing.output === "number" ? gm.pricing.output : undefined;
      if (inputPrice !== undefined || outputPrice !== undefined) {
        pricing = { in_per_1m: inputPrice, out_per_1m: outputPrice };
      }
    }

    const context = gm.context_length || gm.max_context_length || gm.top_provider?.context_length;

    providerMap.get(provider)!.push({
      id: gm.id,
      label: getModelLabel(gm.id),
      icon: getModelIcon(gm.id),
      tag: getModelTag(gm.id),
      provider,
      type: modelType,
      context: context || undefined,
      pricing: pricing || undefined,
      owned_by: gm.owned_by,
    });
  }

  // Add Ollama models (always chat type)
  if (ollamaModels.length > 0) {
    providerMap.set("ollama", ollamaModels.map(m => ({
      id: m.id,
      label: m.name,
      icon: "server",
      provider: "ollama",
      type: "chat" as ModelType,
    })));
  }

  // Build provider list, ordered
  const providerOrder = ["anthropic", "openai", "google", "meta-llama", "deepseek", "mistralai"];
  const allProviders = Array.from(providerMap.keys());
  const ordered = [
    ...providerOrder.filter(p => providerMap.has(p)),
    ...allProviders.filter(p => !providerOrder.includes(p) && p !== "ollama").sort(),
    ...(providerMap.has("ollama") ? ["ollama"] : []),
  ];

  const providers = ordered.map(pid => ({
    id: pid,
    name: getProviderName(pid),
    icon: pid === "ollama" ? "server" : getModelIcon(providerMap.get(pid)?.[0]?.id || ""),
    models: providerMap.get(pid) || [],
  }));

  const ollamaStatus = OLLAMA_BASE_URL
    ? ollamaModels.length > 0 ? "connected" : "unreachable"
    : "not_configured";

  const allModels = providers.flatMap(p => p.models);
  const chatCount = allModels.filter(m => m.type === "chat").length;
  const imageCount = allModels.filter(m => m.type === "image").length;
  const audioCount = allModels.filter(m => m.type === "audio").length;
  const embeddingCount = allModels.filter(m => m.type === "embedding").length;

  const catalog = {
    providers,
    default_model: gatewayModels[0]?.id || "google/gemini-2.5-flash",
    ollama_status: ollamaStatus,
    fetched_at: new Date().toISOString(),
    total_models: gatewayModels.length + ollamaModels.length,
    counts: { chat: chatCount, image: imageCount, audio: audioCount, embedding: embeddingCount },
  };

  catalogCache = { data: catalog, fetchedAt: Date.now() };
  return Response.json(catalog);
}
