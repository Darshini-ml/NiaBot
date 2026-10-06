"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Settings,
  Key,
  BarChart3,
  ToggleLeft,
  ToggleRight,
  Download,
  Check,
  AlertCircle,
  Sparkles,
  Brain,
  Zap,
  Globe,
  Server,
  Search,
  Link,
  Wifi,
  WifiOff,
  Send,
  Hash,
  ChevronDown,
  ChevronRight,
  Trash2,
  Pin,
  PinOff,
  Image as ImageIcon,
  Mic,
  MessageSquare,
  Database,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConfigureModelsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  filterChatId?: string;
}

type Tab = "models" | "usage" | "keys" | "integrations";

type ModelTypeFilter = "chat" | "image" | "audio" | "embedding";

interface CatalogModel {
  id: string;
  label: string;
  modelId: string;
  contextWindow: string;
  inputPrice: string;
  outputPrice: string;
  enabled: boolean;
  isDefault: boolean;
  type: ModelTypeFilter;
  pinned: boolean;
}

interface ProviderGroup {
  provider: string;
  hint: string;
  icon: typeof Sparkles;
  models: CatalogModel[];
}

interface ChatUsageRow {
  chatId: string;
  chatTitle: string;
  models: string[];
  requests: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cost: number;
  lastUsed: string;
  messages: ChatMessage[];
}

interface ChatMessage {
  role: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cost: number;
  latency: string;
}

interface ModelUsageRow {
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cost: number;
  avgTTFT: string;
}

interface DailyBar {
  date: string;
  label: string;
  providers: Record<string, number>;
}

type DateRange = "today" | "7d" | "30d" | "custom";
type ChatSortKey = "cost" | "inputTokens" | "outputTokens" | "reasoningTokens" | "requests";

interface ProviderKey {
  provider: string;
  icon: typeof Sparkles;
  placeholder: string;
  key: string;
  savedAt: string | null;
  lastTested: string | null;
  testResult: "success" | "error" | null;
  isUrl?: boolean;
}

// ---------------------------------------------------------------------------
// Provider colors for chart
// ---------------------------------------------------------------------------

const PROVIDER_COLORS: Record<string, string> = {
  Anthropic: "#d97706",
  OpenAI: "#10b981",
  Google: "#3b82f6",
  Ollama: "#8b5cf6",
};

// ---------------------------------------------------------------------------
// Hardcoded catalog data
// ---------------------------------------------------------------------------

const defaultCatalog: ProviderGroup[] = [
  {
    provider: "Anthropic",
    hint: "Direct API access via your Anthropic key",
    icon: Sparkles,
    models: [
      { id: "claude-sonnet-4.5", label: "Claude Sonnet 4.5", modelId: "anthropic/claude-sonnet-4.5", contextWindow: "200K", inputPrice: "$3/M", outputPrice: "$15/M", enabled: true, isDefault: true, type: "chat", pinned: true },
      { id: "claude-haiku-4.5", label: "Claude Haiku 4.5", modelId: "anthropic/claude-haiku-4.5", contextWindow: "200K", inputPrice: "$0.80/M", outputPrice: "$4/M", enabled: true, isDefault: false, type: "chat", pinned: true },
      { id: "claude-opus-4.1", label: "Claude Opus 4.1", modelId: "anthropic/claude-opus-4.1", contextWindow: "200K", inputPrice: "$15/M", outputPrice: "$75/M", enabled: true, isDefault: false, type: "chat", pinned: false },
    ],
  },
  {
    provider: "OpenAI",
    hint: "Connect with your OpenAI API key",
    icon: Brain,
    models: [
      { id: "gpt-5", label: "GPT-5", modelId: "openai/gpt-5", contextWindow: "1M", inputPrice: "$2/M", outputPrice: "$8/M", enabled: true, isDefault: false, type: "chat", pinned: true },
      { id: "gpt-5-mini", label: "GPT-5 mini", modelId: "openai/gpt-5-mini", contextWindow: "1M", inputPrice: "$0.40/M", outputPrice: "$1.60/M", enabled: true, isDefault: false, type: "chat", pinned: true },
      { id: "o4-mini", label: "o4-mini", modelId: "openai/o4-mini", contextWindow: "200K", inputPrice: "$1.10/M", outputPrice: "$4.40/M", enabled: false, isDefault: false, type: "chat", pinned: false },
    ],
  },
  {
    provider: "Google",
    hint: "Access Gemini models with your Google AI key",
    icon: Globe,
    models: [
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", modelId: "google/gemini-2.5-pro", contextWindow: "1M", inputPrice: "$1.25/M", outputPrice: "$10/M", enabled: true, isDefault: false, type: "chat", pinned: true },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", modelId: "google/gemini-2.5-flash", contextWindow: "1M", inputPrice: "$0.15/M", outputPrice: "$0.60/M", enabled: true, isDefault: false, type: "chat", pinned: true },
    ],
  },
  {
    provider: "Ollama (Local)",
    hint: "Run models locally via Ollama",
    icon: Server,
    models: [
      { id: "llama-3.3-70b", label: "Llama 3.3 70B", modelId: "ollama/llama3.3:70b", contextWindow: "128K", inputPrice: "Free", outputPrice: "Free", enabled: false, isDefault: false, type: "chat", pinned: false },
      { id: "qwen-2.5-72b", label: "Qwen 2.5 72B", modelId: "ollama/qwen2.5:72b", contextWindow: "128K", inputPrice: "Free", outputPrice: "Free", enabled: false, isDefault: false, type: "chat", pinned: false },
    ],
  },
];

// ---------------------------------------------------------------------------
// Date range helpers
// ---------------------------------------------------------------------------

function getDateRangeBounds(range: DateRange, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString();
  if (range === "custom") {
    return { from: customFrom ? new Date(customFrom).toISOString() : new Date(now.getTime() - 30 * 86400000).toISOString(), to: customTo ? new Date(customTo + "T23:59:59").toISOString() : to };
  }
  const days = range === "today" ? 1 : range === "7d" ? 7 : 30;
  const from = new Date(now.getTime() - days * 86400000);
  from.setHours(0, 0, 0, 0);
  return { from: from.toISOString(), to };
}

const defaultProviderKeys: ProviderKey[] = [
  { provider: "Anthropic", icon: Sparkles, placeholder: "sk-ant-...", key: "", savedAt: null, lastTested: null, testResult: null },
  { provider: "OpenAI", icon: Brain, placeholder: "sk-...", key: "", savedAt: null, lastTested: null, testResult: null },
  { provider: "Google", icon: Globe, placeholder: "AIza...", key: "", savedAt: null, lastTested: null, testResult: null },
  { provider: "Ollama", icon: Server, placeholder: "http://localhost:11434", key: "", savedAt: null, lastTested: null, testResult: null, isUrl: true },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

function maskKey(key: string, isUrl?: boolean): string {
  if (!key) return "";
  if (isUrl) return key;
  if (key.length <= 8) return key.slice(0, 2) + "••••••" + key.slice(-2);
  const prefix = key.slice(0, Math.min(8, key.indexOf("-") > 0 ? key.indexOf("-", key.indexOf("-") + 1) + 1 : 8));
  const suffix = key.slice(-4);
  return prefix + "••••••••" + suffix;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function providerHasKey(provider: string, keys: ProviderKey[]): boolean {
  const pk = keys.find((k) => k.provider === provider || (provider === "Ollama (Local)" && k.provider === "Ollama"));
  return !!(pk && pk.key);
}

// ---------------------------------------------------------------------------
// Stacked Bar Chart (SVG)
// ---------------------------------------------------------------------------

function StackedBarChart({ data }: { data: DailyBar[] }) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string; details: string } | null>(null);
  const providers = Object.keys(PROVIDER_COLORS);
  const maxTotal = Math.max(...data.map((d) => providers.reduce((s, p) => s + (d.providers[p] || 0), 0)));
  const chartW = 420;
  const chartH = 160;
  const barW = 36;
  const gap = (chartW - barW * data.length) / (data.length + 1);

  return (
    <div className="relative">
      <svg width={chartW} height={chartH + 30} style={{ display: "block", margin: "0 auto" }}>
        {data.map((day, i) => {
          const x = gap + i * (barW + gap);
          let yOffset = 0;
          const total = providers.reduce((s, p) => s + (day.providers[p] || 0), 0);
          return (
            <g key={day.date}>
              {providers.map((p) => {
                const val = day.providers[p] || 0;
                const h = maxTotal > 0 ? (val / maxTotal) * chartH : 0;
                const y = chartH - yOffset - h;
                yOffset += h;
                return (
                  <rect
                    key={p}
                    x={x}
                    y={y}
                    width={barW}
                    height={Math.max(h, 0)}
                    fill={PROVIDER_COLORS[p]}
                    rx={2}
                    style={{ cursor: "pointer" }}
                    onMouseEnter={(e) => {
                      const rect = (e.target as SVGRectElement).getBoundingClientRect();
                      const parent = (e.target as SVGRectElement).closest("div")?.getBoundingClientRect();
                      setTooltip({
                        x: rect.left - (parent?.left || 0) + barW / 2,
                        y: rect.top - (parent?.top || 0) - 8,
                        label: day.label,
                        details: `${p}: ${formatNumber(val)} tokens\nTotal: ${formatNumber(total)}`,
                      });
                    }}
                    onMouseLeave={() => setTooltip(null)}
                  />
                );
              })}
              <text
                x={x + barW / 2}
                y={chartH + 16}
                textAnchor="middle"
                style={{ fontSize: 9, fill: "var(--text-faint)" }}
              >
                {day.label.split(",")[0].split(" ")[0]}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 mt-1">
        {providers.map((p) => (
          <div key={p} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: PROVIDER_COLORS[p] }} />
            <span className="text-[10px] text-[var(--text-muted)]">{p}</span>
          </div>
        ))}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute pointer-events-none z-10 px-2.5 py-1.5 rounded-lg text-[11px] leading-tight"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: "translate(-50%, -100%)",
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
            color: "var(--text-primary)",
            whiteSpace: "pre-line",
          }}
        >
          <div className="font-semibold mb-0.5" style={{ color: "var(--text-secondary)" }}>{tooltip.label}</div>
          {tooltip.details}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ConfigureModelsPanel({ isOpen, onClose, filterChatId }: ConfigureModelsPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>("models");
  const [catalog, setCatalog] = useState<ProviderGroup[]>(defaultCatalog);
  const [dateRange, setDateRange] = useState<DateRange>("7d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [providerKeys, setProviderKeys] = useState<ProviderKey[]>(defaultProviderKeys);
  const [mounted, setMounted] = useState(false);
  const [chatSearch, setChatSearch] = useState("");
  const [chatSort, setChatSort] = useState<ChatSortKey>("cost");
  const [chatSortAsc, setChatSortAsc] = useState(false);
  const [expandedChat, setExpandedChat] = useState<string | null>(null);
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { served_model: string; request_id: string; error?: string }>>({});
  const [niaApiBase, setNiaApiBase] = useState("");
  const [niaApiKey, setNiaApiKey] = useState("");
  const [niaTestResult, setNiaTestResult] = useState<{ success: boolean; modelCount?: number; error?: string } | null>(null);
  const [niaTesting, setNiaTesting] = useState(false);
  const [directKeysExpanded, setDirectKeysExpanded] = useState(false);
  const [modelTypeTab, setModelTypeTab] = useState<ModelTypeFilter>("chat");
  const [modelSearch, setModelSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState<string>("all");

  // Slack integration state
  const [slackStatus, setSlackStatus] = useState<{ connected: boolean; workspace?: string; botUser?: string; lastEventTime?: string } | null>(null);
  const [slackTestSending, setSlackTestSending] = useState(false);
  const [slackTestResult, setSlackTestResult] = useState<string | null>(null);

  // Discord integration state
  const [discordStatus, setDiscordStatus] = useState<{ connected: boolean; guild?: string; botUser?: string; lastEventTime?: string } | null>(null);

  // Real usage data from API
  const [chatRows, setChatRows] = useState<ChatUsageRow[]>([]);
  const [modelRows, setModelRows] = useState<ModelUsageRow[]>([]);
  const [barData, setBarData] = useState<DailyBar[]>([]);
  const [usageLoading, setUsageLoading] = useState(false);

  // Fetch real usage data from API when tab is active
  useEffect(() => {
    if (!isOpen || activeTab !== "usage") return;

    const { from, to } = getDateRangeBounds(dateRange, customFrom, customTo);
    const qs = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    setUsageLoading(true);

    Promise.all([
      fetch(`/api/usage?group_by=chat&${qs}`).then((r) => r.json()).catch(() => ({ chats: [] })),
      fetch(`/api/usage?group_by=model&${qs}`).then((r) => r.json()).catch(() => ({ models: [] })),
      fetch(`/api/usage?group_by=day&${qs}`).then((r) => r.json()).catch(() => ({ days: [] })),
    ]).then(([chatData, modelData, dayData]) => {
      // Map chat data
      const rows: ChatUsageRow[] = (chatData.chats || []).map((c: Record<string, unknown>) => ({
        chatId: c.chat_id as string,
        chatTitle: (c.chat_title as string) || "Untitled",
        models: (c.models_used as string[]) || [],
        requests: (c.requests as number) || 0,
        inputTokens: (c.input_tokens as number) || 0,
        outputTokens: (c.output_tokens as number) || 0,
        reasoningTokens: (c.reasoning_tokens as number) || 0,
        cost: (c.cost_usd as number) || 0,
        lastUsed: c.last_used ? timeAgo(c.last_used as string) : "",
        messages: [],
      }));
      setChatRows(rows);

      // Map model data
      const mRows: ModelUsageRow[] = (modelData.models || []).map((m: Record<string, unknown>) => ({
        model: m.model as string,
        requests: (m.requests as number) || 0,
        inputTokens: (m.input_tokens as number) || 0,
        outputTokens: (m.output_tokens as number) || 0,
        reasoningTokens: 0,
        cost: (m.cost_usd as number) || 0,
        avgTTFT: m.avg_ttft_ms ? `${m.avg_ttft_ms}ms` : "—",
      }));
      setModelRows(mRows);

      // Map day data for chart
      const bars: DailyBar[] = (dayData.days || []).map((d: Record<string, unknown>) => {
        const dateObj = new Date(d.date as string);
        const label = dateObj.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
        const providers: Record<string, number> = {};
        const provs = d.providers as Record<string, { input_tokens: number; output_tokens: number }> | undefined;
        if (provs) {
          for (const [prov, vals] of Object.entries(provs)) {
            providers[prov] = (vals.input_tokens || 0) + (vals.output_tokens || 0);
          }
        }
        return { date: d.date as string, label, providers };
      });
      setBarData(bars);

      setUsageLoading(false);
    });
  }, [isOpen, activeTab, dateRange, customFrom, customTo]);

  // Body scroll lock
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // If opened with filterChatId, switch to usage tab
  useEffect(() => {
    if (isOpen && filterChatId) {
      setActiveTab("usage");
    }
  }, [isOpen, filterChatId]);

  // Fetch integration statuses when Integrations tab is active
  useEffect(() => {
    if (!isOpen || activeTab !== "integrations") return;
    fetch("/api/integrations/heartbeat")
      .then((r) => r.json())
      .then((data) => {
        if (data.slack) setSlackStatus(data.slack);
        else setSlackStatus({ connected: false });
        if (data.discord) setDiscordStatus(data.discord);
        else setDiscordStatus({ connected: false });
      })
      .catch(() => {
        setSlackStatus({ connected: false });
        setDiscordStatus({ connected: false });
      });
  }, [isOpen, activeTab]);

  const handleSlackTestMessage = async () => {
    setSlackTestSending(true);
    setSlackTestResult(null);
    try {
      const res = await fetch("/api/slack/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "Hello! This is a test message from NiaAI.",
          slack_user_id: "test",
          channel_id: "test",
          chatId: "slack-test",
          chatTitle: "Slack Test",
        }),
      });
      if (res.ok) {
        setSlackTestResult("Test message sent successfully!");
      } else {
        const data = await res.json().catch(() => ({}));
        setSlackTestResult(`Failed: ${data.error || res.statusText}`);
      }
    } catch (err: any) {
      setSlackTestResult(`Error: ${err.message}`);
    }
    setSlackTestSending(false);
  };

  // Load keys from localStorage on mount
  useEffect(() => {
    setMounted(true);
    try {
      const saved = localStorage.getItem("nia_api_keys");
      if (saved) {
        const parsed = JSON.parse(saved) as ProviderKey[];
        setProviderKeys(parsed);
      }
    } catch {
      // ignore
    }
    const savedNiaBase = localStorage.getItem("nia_api_base_url");
    const savedNiaKey = localStorage.getItem("nia_api_key_user");
    if (savedNiaBase) setNiaApiBase(savedNiaBase);
    if (savedNiaKey) setNiaApiKey(savedNiaKey);
  }, []);

  // Fetch dynamic model catalog from gateway API
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    async function fetchCatalog() {
      try {
        const res = await fetch("/api/models");
        if (!res.ok || cancelled) return;
        const data = await res.json();

        const iconMap: Record<string, typeof Sparkles> = {
          anthropic: Brain, openai: Zap, google: Globe, ollama: Server,
          "meta-llama": Sparkles, deepseek: Sparkles, mistralai: Sparkles,
        };

        const formatCtx = (n?: number) => {
          if (!n) return "";
          if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
          if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
          return String(n);
        };
        const formatPrice = (n?: number) => {
          if (n === undefined || n === null) return "";
          if (n === 0) return "Free";
          if (n < 1) return `$${n.toFixed(2)}/M`;
          return `$${n.toFixed(0)}/M`;
        };

        // Load pinned models from localStorage
        let pinnedSet: Set<string>;
        try {
          const raw = localStorage.getItem("nia_pinned_models");
          pinnedSet = raw ? new Set(JSON.parse(raw)) : new Set();
        } catch {
          pinnedSet = new Set();
        }

        const groups: ProviderGroup[] = (data.providers || []).map((p: any) => ({
          provider: p.name + (p.id === "ollama" ? " (Local)" : ""),
          hint: p.id === "ollama" ? "Run models locally via Ollama" : `Models via ${p.name}`,
          icon: iconMap[p.id] || Sparkles,
          models: (p.models || []).map((m: any, i: number) => ({
            id: m.id.split("/").pop() || m.id,
            label: m.label || m.id.split("/").pop() || m.id,
            modelId: m.id,
            contextWindow: formatCtx(m.context),
            inputPrice: formatPrice(m.pricing?.in_per_1m),
            outputPrice: formatPrice(m.pricing?.out_per_1m),
            enabled: true,
            isDefault: i === 0 && p.id === (data.providers?.[0]?.id || "anthropic"),
            type: (m.type as ModelTypeFilter) || "chat",
            pinned: pinnedSet.has(m.id),
          })),
        }));

        if (!cancelled && groups.length > 0) {
          setCatalog(groups);
        }
      } catch (err) {
        console.error("[ConfigureModelsPanel] Failed to fetch models:", err);
      }
    }
    fetchCatalog();
    return () => { cancelled = true; };
  }, [isOpen]);

  // Save keys to localStorage
  const saveKeys = useCallback((keys: ProviderKey[]) => {
    setProviderKeys(keys);
    try {
      localStorage.setItem("nia_api_keys", JSON.stringify(keys));
    } catch {
      // ignore
    }
  }, []);

  const toggleModel = (groupIdx: number, modelIdx: number) => {
    setCatalog((prev) =>
      prev.map((g, gi) => ({
        ...g,
        models: g.models.map((m, mi) =>
          gi === groupIdx && mi === modelIdx ? { ...m, enabled: !m.enabled } : m
        ),
      }))
    );
  };

  const setDefault = (groupIdx: number, modelIdx: number) => {
    setCatalog((prev) =>
      prev.map((g, gi) => ({
        ...g,
        models: g.models.map((m, mi) => ({
          ...m,
          isDefault: gi === groupIdx && mi === modelIdx,
        })),
      }))
    );
  };

  const togglePin = (groupIdx: number, modelIdx: number) => {
    setCatalog((prev) => {
      const updated = prev.map((g, gi) => ({
        ...g,
        models: g.models.map((m, mi) =>
          gi === groupIdx && mi === modelIdx ? { ...m, pinned: !m.pinned } : m
        ),
      }));
      // Persist pinned models to localStorage
      const pinnedIds: string[] = [];
      for (const g of updated) {
        for (const m of g.models) {
          if (m.pinned) pinnedIds.push(m.modelId);
        }
      }
      try {
        localStorage.setItem("nia_pinned_models", JSON.stringify(pinnedIds));
      } catch {
        // ignore
      }
      return updated;
    });
  };

  const handleTestModel = async (modelId: string, provider: string) => {
    setTestingModelId(modelId);
    try {
      const strippedModel = modelId.replace(/^[^/]+\//, "");
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Say OK" }],
          model: modelId,
          stream: false,
          max_tokens: 1,
          provider: provider.toLowerCase().replace(" (local)", ""),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setTestResults((prev) => ({ ...prev, [modelId]: { served_model: "", request_id: "", error: err.error || `HTTP ${res.status}` } }));
      } else {
        const data = await res.json();
        const usage = data._usage || {};
        setTestResults((prev) => ({
          ...prev,
          [modelId]: {
            served_model: usage.served_model || data.model || strippedModel,
            request_id: usage.request_id || data.id || "",
          },
        }));
      }
    } catch (err) {
      setTestResults((prev) => ({ ...prev, [modelId]: { served_model: "", request_id: "", error: err instanceof Error ? err.message : "Test failed" } }));
    } finally {
      setTestingModelId(null);
    }
  };

  const handleTestKey = async (idx: number) => {
    const updated = [...providerKeys];
    try {
      const res = await fetch("/api/models");
      updated[idx] = {
        ...updated[idx],
        testResult: res.ok ? "success" : "error",
        lastTested: new Date().toISOString(),
      };
    } catch {
      updated[idx] = {
        ...updated[idx],
        testResult: "error",
        lastTested: new Date().toISOString(),
      };
    }
    saveKeys(updated);
  };

  const handleRemoveKey = (idx: number) => {
    const updated = [...providerKeys];
    updated[idx] = { ...updated[idx], key: "", savedAt: null, lastTested: null, testResult: null };
    saveKeys(updated);
  };

  const handleSaveKey = (idx: number, value: string) => {
    const updated = [...providerKeys];
    updated[idx] = { ...updated[idx], key: value, savedAt: new Date().toISOString(), testResult: null };
    saveKeys(updated);
  };

  const handleTestNiaApi = async () => {
    setNiaTesting(true);
    setNiaTestResult(null);
    try {
      const base = niaApiBase || "https://api.nia.naslabs.ai/v1";
      const res = await fetch(`${base}/models`, {
        headers: niaApiKey ? { Authorization: `Bearer ${niaApiKey}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const count = data.data?.length || data.models?.length || 0;
      setNiaTestResult({ success: true, modelCount: count });
      // Save to localStorage
      if (niaApiBase) localStorage.setItem("nia_api_base_url", niaApiBase);
      if (niaApiKey) localStorage.setItem("nia_api_key_user", niaApiKey);
    } catch (err) {
      setNiaTestResult({ success: false, error: err instanceof Error ? err.message : "Connection failed" });
    } finally {
      setNiaTesting(false);
    }
  };

  // Chat rows - filtered and sorted
  const filteredChatRows = useMemo(() => {
    let rows = filterChatId ? chatRows.filter((r) => r.chatId === filterChatId) : chatRows;
    if (chatSearch) {
      const q = chatSearch.toLowerCase();
      rows = rows.filter((r) => r.chatTitle.toLowerCase().includes(q) || r.models.some((m) => m.toLowerCase().includes(q)));
    }
    rows = [...rows].sort((a, b) => {
      const av = a[chatSort] as number;
      const bv = b[chatSort] as number;
      return chatSortAsc ? av - bv : bv - av;
    });
    return rows;
  }, [chatRows, filterChatId, chatSearch, chatSort, chatSortAsc]);

  // Summary stats from chat rows (same query so totals reconcile)
  const totalRequests = filteredChatRows.reduce((s, r) => s + r.requests, 0);
  const totalInput = filteredChatRows.reduce((s, r) => s + r.inputTokens, 0);
  const totalOutput = filteredChatRows.reduce((s, r) => s + r.outputTokens, 0);
  const totalReasoning = filteredChatRows.reduce((s, r) => s + r.reasoningTokens, 0);
  const totalCost = filteredChatRows.reduce((s, r) => s + r.cost, 0);
  const totalAvgLatency = filteredChatRows.length > 0 ? "—" : "—";

  const handleExportCSV = () => {
    const header = "Chat,Models,Requests,Input Tokens,Output Tokens,Reasoning Tokens,Cost,Last Used\n";
    const rows = filteredChatRows
      .map((r) =>
        `"${r.chatTitle}","${r.models.join("; ")}",${r.requests},${r.inputTokens},${r.outputTokens},${r.reasoningTokens},${r.cost.toFixed(4)},${r.lastUsed}`
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "usage_export.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleChatSortToggle = (key: ChatSortKey) => {
    if (chatSort === key) {
      setChatSortAsc(!chatSortAsc);
    } else {
      setChatSort(key);
      setChatSortAsc(false);
    }
  };

  if (!mounted) return null;

  const tabs: { id: Tab; label: string; icon: typeof Settings }[] = [
    { id: "models", label: "Models", icon: Settings },
    { id: "usage", label: "Usage", icon: BarChart3 },
    { id: "keys", label: "Keys", icon: Key },
    { id: "integrations", label: "Integrations", icon: Link },
  ];

  const SortIndicator = ({ field }: { field: ChatSortKey }) => (
    <span className="text-[9px] ml-0.5" style={{ color: chatSort === field ? "var(--accent)" : "var(--text-faint)" }}>
      {chatSort === field ? (chatSortAsc ? "\u25B2" : "\u25BC") : ""}
    </span>
  );

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[50] transition-opacity duration-300"
        style={{
          backgroundColor: isOpen ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0)",
          pointerEvents: isOpen ? "auto" : "none",
        }}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className="fixed top-0 right-0 bottom-0 z-[50] flex flex-col"
        style={{
          width: 480,
          background: "var(--bg-elevated)",
          borderLeft: "1px solid var(--border)",
          boxShadow: "var(--shadow-lg)",
          transform: isOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 300ms cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        {/* Header */}
        <div className="shrink-0 px-5 pt-5 pb-0">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[16px] font-bold text-[var(--text-primary)]">Configure models</h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] transition-colors text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <X size={18} />
            </button>
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 p-1 rounded-xl bg-[var(--bg-secondary)]">
            {tabs.map((t) => {
              const Icon = t.icon;
              const active = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-semibold transition-all duration-200 ${
                    active
                      ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
                      : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  <Icon size={14} />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab content — single scroll container */}
        <div className="flex-1 overflow-y-auto px-5 pt-4 pb-5" style={{ overflowX: "hidden" }}>
          {/* ---- MODELS TAB ---- */}
          {activeTab === "models" && (
            <div className="space-y-4">
              {/* Model type sub-tabs */}
              <div className="flex gap-1 p-0.5 rounded-lg bg-[var(--bg-secondary)]">
                {([
                  { id: "chat" as ModelTypeFilter, label: "Chat", icon: MessageSquare },
                  { id: "image" as ModelTypeFilter, label: "Image", icon: ImageIcon },
                  { id: "audio" as ModelTypeFilter, label: "Audio", icon: Mic },
                  { id: "embedding" as ModelTypeFilter, label: "Embed", icon: Database },
                ]).map((t) => {
                  const TIcon = t.icon;
                  const active = modelTypeTab === t.id;
                  const count = catalog.reduce((s, g) => s + g.models.filter((m) => m.type === t.id).length, 0);
                  return (
                    <button
                      key={t.id}
                      onClick={() => setModelTypeTab(t.id)}
                      className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-semibold transition-all ${
                        active
                          ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
                          : "text-[var(--text-faint)] hover:text-[var(--text-muted)]"
                      }`}
                    >
                      <TIcon size={12} />
                      {t.label}
                      {count > 0 && <span className="text-[9px] opacity-60">({count})</span>}
                    </button>
                  );
                })}
              </div>

              {/* Search + provider filter row */}
              <div className="flex items-center gap-2">
                <div className="flex-1 relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
                  <input
                    type="text"
                    placeholder="Search models…"
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent-border)]"
                  />
                </div>
                <select
                  value={providerFilter}
                  onChange={(e) => setProviderFilter(e.target.value)}
                  className="shrink-0 px-2 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[11px] text-[var(--text-secondary)] focus:outline-none"
                >
                  <option value="all">All providers</option>
                  {catalog.map((g) => (
                    <option key={g.provider} value={g.provider}>{g.provider}</option>
                  ))}
                </select>
              </div>

              {/* Model list by provider */}
              {catalog
                .filter((g) => providerFilter === "all" || g.provider === providerFilter)
                .map((group, gi) => {
                const GIcon = group.icon;
                const hasKey = providerHasKey(group.provider, providerKeys);
                const isOllama = group.provider.includes("Ollama");

                // Filter models by type and search
                const filteredModels = group.models.filter((m) => {
                  if (m.type !== modelTypeTab) return false;
                  if (modelSearch) {
                    const q = modelSearch.toLowerCase();
                    return m.label.toLowerCase().includes(q) || m.modelId.toLowerCase().includes(q);
                  }
                  return true;
                });

                if (filteredModels.length === 0) return null;

                // Find original indices for callbacks
                const getOriginalIndex = (model: CatalogModel) =>
                  group.models.findIndex((m) => m.id === model.id);
                const originalGi = catalog.findIndex((g) => g.provider === group.provider);

                return (
                  <div key={group.provider}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <GIcon size={14} className="text-[var(--accent)]" />
                      <span className="text-[12px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                        {group.provider}
                      </span>
                    </div>

                    <div className="space-y-1">
                      {filteredModels.map((model) => {
                        const mi = getOriginalIndex(model);
                        return (
                          <React.Fragment key={model.id}>
                          <div
                            className={`flex items-center gap-2 px-3 py-2 rounded-xl transition-colors ${model.enabled ? "bg-[var(--bg-secondary)]" : "bg-[var(--bg-secondary)] opacity-60"} hover:bg-[var(--bg-hover)]`}
                          >
                            {/* Label + model id */}
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-medium text-[var(--text-primary)] truncate">
                                {model.label}
                              </p>
                              <p className="text-[10px] text-[var(--text-faint)] truncate font-mono">{model.modelId}</p>
                            </div>

                            {/* Badges */}
                            <div className="flex items-center gap-1 shrink-0">
                              {model.contextWindow && (
                                <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-[var(--bg-elevated)] text-[var(--text-muted)] border border-[var(--border)]">
                                  {model.contextWindow}
                                </span>
                              )}
                              {model.inputPrice && (
                                <span className="px-1 py-0.5 text-[9px] rounded bg-[var(--bg-elevated)] text-[var(--text-faint)] border border-[var(--border)]">
                                  {model.inputPrice}
                                </span>
                              )}
                            </div>

                            {/* Pin to Featured toggle */}
                            <button
                              onClick={() => togglePin(originalGi, mi)}
                              className={`shrink-0 p-1 rounded transition-colors ${model.pinned ? "text-[var(--accent)]" : "text-[var(--text-faint)] hover:text-[var(--accent)]"}`}
                              title={model.pinned ? "Unpin from Featured" : "Pin to Featured"}
                            >
                              {model.pinned ? <Pin size={14} /> : <PinOff size={14} />}
                            </button>

                            {/* Enabled toggle */}
                            <button
                              onClick={() => toggleModel(originalGi, mi)}
                              className="shrink-0 text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
                              title={model.enabled ? "Disable" : "Enable"}
                            >
                              {model.enabled ? (
                                <ToggleRight size={20} className="text-[var(--accent)]" />
                              ) : (
                                <ToggleLeft size={20} />
                              )}
                            </button>

                            {/* Default radio */}
                            <button
                              onClick={() => setDefault(originalGi, mi)}
                              className="shrink-0"
                              title={model.isDefault ? "Default model" : "Set as default"}
                            >
                              {model.isDefault ? (
                                <div className="rounded-full border-2 border-[var(--accent)] flex items-center justify-center" style={{ width: 16, height: 16 }}>
                                  <div className="rounded-full bg-[var(--accent)]" style={{ width: 8, height: 8 }} />
                                </div>
                              ) : (
                                <div className="rounded-full border-2 border-[var(--text-faint)] hover:border-[var(--accent)] transition-colors" style={{ width: 16, height: 16 }} />
                              )}
                            </button>

                            {/* Test button */}
                            <button
                              onClick={() => handleTestModel(model.modelId, group.provider)}
                              disabled={testingModelId === model.modelId}
                              className={`shrink-0 px-2 py-1 rounded-lg text-[10px] font-semibold border transition-all ${
                                testResults[model.modelId]?.error
                                  ? "border-red-500/30 text-red-400 bg-red-500/5"
                                  : testResults[model.modelId]?.served_model
                                    ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/5"
                                    : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--accent)] hover:border-[var(--accent-border)]"
                              }`}
                              title={testResults[model.modelId]?.served_model ? `Served: ${testResults[model.modelId].served_model}\nID: ${testResults[model.modelId].request_id}` : "Test 1-token call"}
                            >
                              {testingModelId === model.modelId ? "…" : testResults[model.modelId]?.error ? "Fail" : testResults[model.modelId]?.served_model ? "OK" : "Test"}
                            </button>
                          </div>
                          {/* Test result details */}
                          {testResults[model.modelId] && (
                            <div className={`mx-3 mb-1 px-2 py-1 rounded text-[10px] font-mono ${testResults[model.modelId].error ? "text-red-400 bg-red-500/5" : "text-emerald-400 bg-emerald-500/5"}`}>
                              {testResults[model.modelId].error
                                ? testResults[model.modelId].error
                                : `served: ${testResults[model.modelId].served_model} · id: ${testResults[model.modelId].request_id}`}
                            </div>
                          )}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* Empty state for filtered results */}
              {catalog
                .filter((g) => providerFilter === "all" || g.provider === providerFilter)
                .every((g) => g.models.filter((m) => m.type === modelTypeTab && (!modelSearch || m.label.toLowerCase().includes(modelSearch.toLowerCase()) || m.modelId.toLowerCase().includes(modelSearch.toLowerCase()))).length === 0) && (
                <div className="flex flex-col items-center justify-center py-12 gap-2">
                  <Search size={24} className="text-[var(--text-faint)]" />
                  <p className="text-[13px] text-[var(--text-faint)]">
                    {modelSearch ? `No ${modelTypeTab} models matching "${modelSearch}"` : `No ${modelTypeTab} models available`}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ---- USAGE TAB ---- */}
          {activeTab === "usage" && (
            <div className="space-y-4">
              {/* Date range selector */}
              <div className="flex gap-1 p-1 rounded-xl bg-[var(--bg-secondary)]">
                {(["today", "7d", "30d", "custom"] as DateRange[]).map((r) => (
                  <button
                    key={r}
                    onClick={() => setDateRange(r)}
                    className={`flex-1 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all duration-200 ${
                      dateRange === r
                        ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
                        : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                    }`}
                  >
                    {r === "today" ? "Today" : r === "7d" ? "7d" : r === "30d" ? "30d" : "Custom"}
                  </button>
                ))}
              </div>

              {/* Custom date pickers */}
              {dateRange === "custom" && (
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="flex-1 px-3 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[12px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-border)]"
                  />
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="flex-1 px-3 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[12px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-border)]"
                  />
                </div>
              )}

              {usageLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                </div>
              ) : totalRequests === 0 ? (
                /* Empty state */
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <BarChart3 size={32} className="text-[var(--text-faint)]" />
                  <p className="text-[14px] font-semibold text-[var(--text-secondary)]">No usage yet</p>
                  <p className="text-[12px] text-[var(--text-faint)] text-center max-w-[260px]">Send a message to see tokens here</p>
                </div>
              ) : (
                <>
                  {/* Summary cards - 3x2 grid */}
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "INPUT TOKENS", value: formatNumber(totalInput) },
                      { label: "OUTPUT TOKENS", value: formatNumber(totalOutput) },
                      { label: "REASONING", value: formatNumber(totalReasoning) },
                      { label: "TOTAL COST", value: `$${totalCost.toFixed(2)}` },
                      { label: "REQUESTS", value: totalRequests.toString() },
                      { label: "AVG LATENCY", value: totalAvgLatency },
                    ].map((card) => (
                      <div
                        key={card.label}
                        className="p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]"
                        style={{ minWidth: 0 }}
                      >
                        <p
                          className="font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1"
                          style={{ fontSize: 11, lineHeight: 1.2, whiteSpace: "nowrap" }}
                        >
                          {card.label}
                        </p>
                        <p
                          className="font-bold text-[var(--text-primary)]"
                          style={{ fontSize: 22, lineHeight: 1.2, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}
                        >
                          {card.value}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* Stacked bar chart */}
                  {barData.length > 0 && (
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
                      <p className="text-[12px] font-semibold text-[var(--text-secondary)] mb-3">Tokens per day by provider</p>
                      <StackedBarChart data={barData} />
                    </div>
                  )}

                  {/* By chat table - search + export */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex-1 relative">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
                        <input
                          type="text"
                          placeholder="Search chats..."
                          value={chatSearch}
                          onChange={(e) => setChatSearch(e.target.value)}
                          className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent-border)]"
                        />
                      </div>
                      <button
                        onClick={handleExportCSV}
                        className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[12px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
                      >
                        <Download size={12} />
                        Export CSV
                      </button>
                    </div>

                    {/* By chat table — table-layout:fixed, no horizontal scroll */}
                    <div className="rounded-xl border border-[var(--border)] overflow-hidden" style={{ overflowX: "hidden" }}>
                      <table className="w-full text-[11px]" style={{ tableLayout: "fixed", fontVariantNumeric: "tabular-nums" }}>
                        <colgroup>
                          <col style={{ width: "38%" }} />
                          <col style={{ width: "16%" }} />
                          <col style={{ width: "8%" }} />
                          <col style={{ width: "10%" }} />
                          <col style={{ width: "10%" }} />
                          <col style={{ width: "9%" }} />
                          <col style={{ width: "9%" }} />
                        </colgroup>
                        <thead>
                          <tr className="bg-[var(--bg-secondary)]">
                            <th className="text-left px-2 py-2 font-semibold text-[var(--text-muted)] whitespace-nowrap overflow-hidden">Chat</th>
                            <th className="text-left px-2 py-2 font-semibold text-[var(--text-muted)] whitespace-nowrap overflow-hidden">Models</th>
                            <th
                              className="text-right px-2 py-2 font-semibold text-[var(--text-muted)] whitespace-nowrap cursor-pointer hover:text-[var(--text-primary)]"
                              onClick={() => handleChatSortToggle("requests")}
                            >
                              Req<SortIndicator field="requests" />
                            </th>
                            <th
                              className="text-right px-2 py-2 font-semibold text-[var(--text-muted)] whitespace-nowrap cursor-pointer hover:text-[var(--text-primary)]"
                              onClick={() => handleChatSortToggle("inputTokens")}
                            >
                              In<SortIndicator field="inputTokens" />
                            </th>
                            <th
                              className="text-right px-2 py-2 font-semibold text-[var(--text-muted)] whitespace-nowrap cursor-pointer hover:text-[var(--text-primary)]"
                              onClick={() => handleChatSortToggle("outputTokens")}
                            >
                              Out<SortIndicator field="outputTokens" />
                            </th>
                            <th
                              className="text-right px-2 py-2 font-semibold text-[var(--text-muted)] whitespace-nowrap cursor-pointer hover:text-[var(--text-primary)]"
                              onClick={() => handleChatSortToggle("reasoningTokens")}
                            >
                              Rsn.<SortIndicator field="reasoningTokens" />
                            </th>
                            <th
                              className="text-right px-2 py-2 font-semibold text-[var(--text-muted)] whitespace-nowrap cursor-pointer hover:text-[var(--text-primary)]"
                              onClick={() => handleChatSortToggle("cost")}
                            >
                              Cost<SortIndicator field="cost" />
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredChatRows.map((row) => (
                            <React.Fragment key={row.chatId}>
                              <tr
                                className="border-t border-[var(--border)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                                onClick={() => setExpandedChat(expandedChat === row.chatId ? null : row.chatId)}
                              >
                                <td className="px-2 py-2 text-[var(--text-primary)] font-medium overflow-hidden text-ellipsis whitespace-nowrap" title={row.chatTitle}>
                                  <div className="flex items-center gap-1 min-w-0">
                                    {expandedChat === row.chatId ? <ChevronDown size={10} className="shrink-0 text-[var(--text-faint)]" /> : <ChevronRight size={10} className="shrink-0 text-[var(--text-faint)]" />}
                                    <span className="truncate text-[var(--accent)]">{row.chatTitle}</span>
                                  </div>
                                </td>
                                <td className="px-2 py-2 text-[var(--text-faint)] overflow-hidden text-ellipsis whitespace-nowrap" title={row.models.join(", ")}>
                                  {row.models.length === 0 ? "—" : row.models[0].split("/")[1]}{row.models.length > 1 ? ` +${row.models.length - 1}` : ""}
                                </td>
                                <td className="px-2 py-2 text-right text-[var(--text-secondary)]">{row.requests}</td>
                                <td className="px-2 py-2 text-right text-[var(--text-secondary)]">{formatNumber(row.inputTokens)}</td>
                                <td className="px-2 py-2 text-right text-[var(--text-secondary)]">{formatNumber(row.outputTokens)}</td>
                                <td className="px-2 py-2 text-right text-[var(--text-secondary)]">{formatNumber(row.reasoningTokens)}</td>
                                <td className="px-2 py-2 text-right text-[var(--accent)] font-medium">{row.cost < 0 ? "—" : `$${row.cost.toFixed(2)}`}</td>
                              </tr>
                              {/* Expanded row detail: TTFT, last used, per-message breakdown */}
                              {expandedChat === row.chatId && (
                                <tr className="border-t border-[var(--border)] bg-[var(--bg-secondary)]">
                                  <td colSpan={7} className="px-4 py-2">
                                    <div className="text-[10px] text-[var(--text-faint)] mb-1">
                                      Last used: {row.lastUsed}
                                    </div>
                                    {row.messages.length > 0 ? (
                                      <div className="space-y-0.5">
                                        {row.messages.map((msg, msgIdx) => (
                                          <div key={msgIdx} className="flex items-center gap-3 text-[10px] text-[var(--text-faint)]">
                                            <span className="w-6">{msg.role === "user" ? "You" : "AI"}</span>
                                            <span className="w-20 truncate">{msg.model.split("/")[1]}</span>
                                            <span>{formatNumber(msg.inputTokens)} in</span>
                                            <span>{formatNumber(msg.outputTokens)} out</span>
                                            <span>{msg.cost < 0 ? "—" : `$${msg.cost.toFixed(3)}`}</span>
                                            <span>{msg.latency}</span>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="text-[10px] text-[var(--text-faint)]">No per-message details available</p>
                                    )}
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* By model table (compact) — table-layout:fixed */}
                  {modelRows.length > 0 && (
                    <div>
                      <p className="text-[12px] font-semibold text-[var(--text-secondary)] mb-2">By model</p>
                      <div className="rounded-xl border border-[var(--border)] overflow-hidden" style={{ overflowX: "hidden" }}>
                        <table className="w-full text-[11px]" style={{ tableLayout: "fixed", fontVariantNumeric: "tabular-nums" }}>
                          <colgroup>
                            <col style={{ width: "36%" }} />
                            <col style={{ width: "10%" }} />
                            <col style={{ width: "14%" }} />
                            <col style={{ width: "14%" }} />
                            <col style={{ width: "12%" }} />
                            <col style={{ width: "14%" }} />
                          </colgroup>
                          <thead>
                            <tr className="bg-[var(--bg-secondary)]">
                              <th className="text-left px-2 py-1.5 font-semibold text-[var(--text-muted)] whitespace-nowrap overflow-hidden">Model</th>
                              <th className="text-right px-2 py-1.5 font-semibold text-[var(--text-muted)] whitespace-nowrap">Req</th>
                              <th className="text-right px-2 py-1.5 font-semibold text-[var(--text-muted)] whitespace-nowrap">In</th>
                              <th className="text-right px-2 py-1.5 font-semibold text-[var(--text-muted)] whitespace-nowrap">Out</th>
                              <th className="text-right px-2 py-1.5 font-semibold text-[var(--text-muted)] whitespace-nowrap">Cost</th>
                              <th className="text-right px-2 py-1.5 font-semibold text-[var(--text-muted)] whitespace-nowrap">TTFT</th>
                            </tr>
                          </thead>
                          <tbody>
                            {modelRows.map((row) => (
                              <tr key={row.model} className="border-t border-[var(--border)] hover:bg-[var(--bg-hover)] transition-colors">
                                <td className="px-2 py-1.5 text-[var(--text-primary)] font-medium overflow-hidden text-ellipsis whitespace-nowrap" title={row.model}>{row.model}</td>
                                <td className="px-2 py-1.5 text-right text-[var(--text-secondary)]">{row.requests}</td>
                                <td className="px-2 py-1.5 text-right text-[var(--text-secondary)]">{formatNumber(row.inputTokens)}</td>
                                <td className="px-2 py-1.5 text-right text-[var(--text-secondary)]">{formatNumber(row.outputTokens)}</td>
                                <td className="px-2 py-1.5 text-right text-[var(--accent)] font-medium">{row.cost < 0 ? "—" : `$${row.cost.toFixed(2)}`}</td>
                                <td className="px-2 py-1.5 text-right text-[var(--text-muted)]">{row.avgTTFT}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ---- KEYS TAB ---- */}
          {activeTab === "keys" && (
            <div className="space-y-5">
              {/* NiaAI API section */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Sparkles size={14} className="text-[var(--accent)]" />
                  <span className="text-[13px] font-bold text-[var(--text-primary)]">NiaAI API</span>
                </div>
                <p className="text-[11px] text-[var(--text-faint)] pl-[22px]">
                  Routes all models through the NiaAI gateway. No provider keys needed.
                </p>

                {/* Base URL */}
                <div className="space-y-1 pl-[22px]">
                  <label className="text-[11px] text-[var(--text-muted)] font-medium">Base URL</label>
                  <input
                    type="text"
                    value={niaApiBase}
                    onChange={(e) => setNiaApiBase(e.target.value)}
                    onBlur={() => { if (niaApiBase) localStorage.setItem("nia_api_base_url", niaApiBase); }}
                    placeholder="https://api.nia.naslabs.ai/v1"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent-border)] transition-colors font-mono"
                  />
                </div>

                {/* API Key */}
                <div className="space-y-1 pl-[22px]">
                  <label className="text-[11px] text-[var(--text-muted)] font-medium">API Key</label>
                  <input
                    type="password"
                    value={niaApiKey}
                    onChange={(e) => setNiaApiKey(e.target.value)}
                    onBlur={() => { if (niaApiKey) localStorage.setItem("nia_api_key_user", niaApiKey); }}
                    placeholder="nia-..."
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent-border)] transition-colors font-mono"
                  />
                </div>

                {/* Test button */}
                <div className="flex items-center gap-2 pl-[22px]">
                  <button
                    onClick={handleTestNiaApi}
                    disabled={niaTesting}
                    className={`px-4 py-2 rounded-lg text-[12px] font-semibold transition-colors border ${
                      niaTestResult?.success
                        ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/5"
                        : niaTestResult?.error
                        ? "border-red-500/30 text-red-400 bg-red-500/5"
                        : "border-[var(--accent-border)] text-[var(--accent)] bg-[var(--accent-subtle)] hover:bg-[var(--accent-subtle)]"
                    }`}
                  >
                    {niaTesting ? "Testing\u2026" : niaTestResult?.success ? `Connected \u00B7 ${niaTestResult.modelCount} models` : niaTestResult?.error ? "Failed" : "Test connection"}
                  </button>
                  {niaTestResult?.error && (
                    <span className="text-[10px] text-red-400">{niaTestResult.error}</span>
                  )}
                </div>
              </div>

              {/* Divider */}
              <div className="border-t border-[var(--border)]" />

              {/* Direct provider keys - collapsible */}
              <div>
                <button
                  onClick={() => setDirectKeysExpanded(!directKeysExpanded)}
                  className="flex items-center gap-2 w-full text-left"
                >
                  {directKeysExpanded ? <ChevronDown size={14} className="text-[var(--text-muted)]" /> : <ChevronRight size={14} className="text-[var(--text-muted)]" />}
                  <span className="text-[13px] font-semibold text-[var(--text-secondary)]">Direct provider keys</span>
                  <span className="text-[10px] text-[var(--text-faint)] ml-1">(optional)</span>
                </button>
                <p className="text-[11px] text-[var(--text-faint)] pl-[22px] mt-1">
                  Only needed to bypass the gateway or for provider-only features.
                </p>

                {directKeysExpanded && (
                  <div className="space-y-4 mt-3">
                    {providerKeys.map((pk, idx) => {
                      const PIcon = pk.icon;
                      const hasSavedKey = !!pk.key;

                      return (
                        <div key={pk.provider} className="space-y-2">
                          <div className="flex items-center gap-2">
                            <PIcon size={14} className="text-[var(--accent)]" />
                            <span className="text-[13px] font-semibold text-[var(--text-primary)]">{pk.provider}</span>
                            {pk.isUrl && (
                              <span className="text-[10px] text-[var(--text-faint)]">(Base URL)</span>
                            )}
                          </div>

                          {hasSavedKey ? (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[13px] text-[var(--text-secondary)] font-mono truncate">
                                {maskKey(pk.key, pk.isUrl)}
                              </div>
                              <button
                                onClick={() => handleTestKey(idx)}
                                className={`shrink-0 px-3 py-2 rounded-lg text-[12px] font-semibold transition-colors border ${
                                  pk.testResult === "success"
                                    ? "border-[var(--success)] text-[var(--success)]"
                                    : pk.testResult === "error"
                                    ? "border-[var(--error)] text-[var(--error)]"
                                    : "border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                                }`}
                              >
                                {pk.testResult === "success" ? (
                                  <span className="flex items-center gap-1"><Check size={12} /> OK</span>
                                ) : pk.testResult === "error" ? (
                                  <span className="flex items-center gap-1"><AlertCircle size={12} /> Fail</span>
                                ) : pk.isUrl ? "Detect models" : "Test"}
                              </button>
                              <button
                                onClick={() => handleRemoveKey(idx)}
                                className="shrink-0 p-2 rounded-lg text-[var(--text-faint)] hover:text-[var(--error)] hover:bg-[var(--bg-hover)] transition-colors border border-[var(--border)]"
                                title="Remove"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <input
                                type={pk.isUrl ? "text" : "password"}
                                onBlur={(e) => {
                                  if (e.target.value) handleSaveKey(idx, e.target.value);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && (e.target as HTMLInputElement).value) {
                                    handleSaveKey(idx, (e.target as HTMLInputElement).value);
                                  }
                                }}
                                placeholder={pk.placeholder}
                                className="flex-1 px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent-border)] transition-colors"
                              />
                              {pk.isUrl && (
                                <button
                                  className="shrink-0 px-3 py-2 rounded-lg text-[12px] font-semibold border border-[var(--border)] text-[var(--text-faint)] cursor-not-allowed"
                                  disabled
                                >
                                  Detect models
                                </button>
                              )}
                            </div>
                          )}

                          {pk.savedAt && (
                            <p className="text-[10px] text-[var(--text-faint)] pl-1">
                              Saved {timeAgo(pk.savedAt)}
                              {pk.lastTested && ` \u00B7 Tested ${timeAgo(pk.lastTested)}`}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "integrations" && (
            <div className="space-y-5">
              {/* Slack Integration */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Hash size={16} className="text-[#E01E5A]" />
                  <span className="text-[14px] font-bold text-[var(--text-primary)]">Slack</span>
                  {slackStatus?.connected ? (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      <Wifi size={10} /> Connected
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/10 text-red-400 border border-red-500/20">
                      <WifiOff size={10} /> Disconnected
                    </span>
                  )}
                </div>

                <p className="text-[11px] text-[var(--text-faint)] leading-relaxed">
                  Connect NiaAI to Slack so your team can ask questions, search the web, and generate content directly from Slack channels and DMs.
                </p>

                {slackStatus?.connected && (
                  <div className="space-y-2 p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-[var(--text-muted)]">Workspace</span>
                      <span className="text-[12px] text-[var(--text-primary)] font-medium">{slackStatus.workspace || "—"}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-[var(--text-muted)]">Bot user</span>
                      <span className="text-[12px] text-[var(--text-primary)] font-medium">@{slackStatus.botUser || "—"}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-[var(--text-muted)]">Last event</span>
                      <span className="text-[12px] text-[var(--text-primary)] font-medium">
                        {slackStatus.lastEventTime ? new Date(slackStatus.lastEventTime).toLocaleTimeString() : "—"}
                      </span>
                    </div>
                  </div>
                )}

                {/* Test message button */}
                <button
                  onClick={handleSlackTestMessage}
                  disabled={slackTestSending}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold transition-colors border border-[var(--accent-border)] text-[var(--accent)] bg-[var(--accent-subtle)] hover:bg-[var(--accent-subtle)]"
                >
                  <Send size={12} />
                  {slackTestSending ? "Sending…" : "Test message"}
                </button>
                {slackTestResult && (
                  <p className={`text-[11px] ${slackTestResult.startsWith("Test") ? "text-emerald-400" : "text-red-400"}`}>
                    {slackTestResult}
                  </p>
                )}

                {/* Setup instructions */}
                <div className="border-t border-[var(--border)] pt-4">
                  <p className="text-[12px] font-semibold text-[var(--text-secondary)] mb-2">Setup</p>
                  <ol className="text-[11px] text-[var(--text-muted)] space-y-1.5 list-decimal list-inside leading-relaxed">
                    <li>Create a Slack app at <span className="text-[var(--accent)]">api.slack.com</span> → "From scratch" → your workspace</li>
                    <li>Enable <strong>Socket Mode</strong> → generate App-Level Token with <code className="text-[10px] px-1 py-0.5 rounded bg-[var(--bg-secondary)]">connections:write</code></li>
                    <li>Add Bot Token Scopes: <code className="text-[10px] px-1 py-0.5 rounded bg-[var(--bg-secondary)]">app_mentions:read, chat:write, channels:history, im:history, im:write, files:read, files:write, reactions:write, users:read</code></li>
                    <li>Enable Event Subscriptions: <code className="text-[10px] px-1 py-0.5 rounded bg-[var(--bg-secondary)]">app_mention, message.im</code></li>
                    <li>Add slash command: <code className="text-[10px] px-1 py-0.5 rounded bg-[var(--bg-secondary)]">/nia</code></li>
                    <li>Install app → copy <strong>SLACK_BOT_TOKEN</strong>, <strong>SLACK_APP_TOKEN</strong>, and <strong>SLACK_SIGNING_SECRET</strong></li>
                    <li>Set env vars and run: <code className="text-[10px] px-1 py-0.5 rounded bg-[var(--bg-secondary)]">npm run slack</code></li>
                  </ol>
                </div>

                {/* Features */}
                <div className="border-t border-[var(--border)] pt-4">
                  <p className="text-[12px] font-semibold text-[var(--text-secondary)] mb-2">Features</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: "Channel mentions", desc: "@NiaAI in any channel" },
                      { label: "Direct messages", desc: "DM the bot directly" },
                      { label: "Threaded replies", desc: "Context kept per thread" },
                      { label: "File analysis", desc: "Attach PDFs & images" },
                      { label: "Web search", desc: "Auto-searches when needed" },
                      { label: "Model switching", desc: "/nia model <name>" },
                    ].map((f) => (
                      <div key={f.label} className="p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
                        <p className="text-[11px] font-semibold text-[var(--text-primary)]">{f.label}</p>
                        <p className="text-[10px] text-[var(--text-faint)]">{f.desc}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Divider between integrations */}
              <div className="border-t border-[var(--border)]" />

              {/* Discord Integration */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <MessageSquare size={16} className="text-[#5865F2]" />
                  <span className="text-[14px] font-bold text-[var(--text-primary)]">Discord</span>
                  {discordStatus?.connected ? (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      <Wifi size={10} /> Connected
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/10 text-red-400 border border-red-500/20">
                      <WifiOff size={10} /> Disconnected
                    </span>
                  )}
                </div>

                <p className="text-[11px] text-[var(--text-faint)] leading-relaxed">
                  Connect NiaAI to Discord so your team can ask questions, search the web, and generate content directly from Discord channels, threads, and DMs.
                </p>

                {discordStatus?.connected && (
                  <div className="space-y-2 p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-[var(--text-muted)]">Server</span>
                      <span className="text-[12px] text-[var(--text-primary)] font-medium">{discordStatus.guild || "—"}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-[var(--text-muted)]">Bot user</span>
                      <span className="text-[12px] text-[var(--text-primary)] font-medium">{discordStatus.botUser || "—"}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-[var(--text-muted)]">Last event</span>
                      <span className="text-[12px] text-[var(--text-primary)] font-medium">
                        {discordStatus.lastEventTime ? new Date(discordStatus.lastEventTime).toLocaleTimeString() : "—"}
                      </span>
                    </div>
                  </div>
                )}

                {/* Setup instructions */}
                <div className="border-t border-[var(--border)] pt-4">
                  <p className="text-[12px] font-semibold text-[var(--text-secondary)] mb-2">Setup</p>
                  <ol className="text-[11px] text-[var(--text-muted)] space-y-1.5 list-decimal list-inside leading-relaxed">
                    <li>Create an app at <span className="text-[var(--accent)]">discord.com/developers</span> → New Application</li>
                    <li>Go to <strong>Bot</strong> → Reset Token → copy it. Enable <strong>Message Content Intent</strong></li>
                    <li>Go to <strong>OAuth2 → URL Generator</strong>: scopes <code className="text-[10px] px-1 py-0.5 rounded bg-[var(--bg-secondary)]">bot, applications.commands</code></li>
                    <li>Bot permissions: <code className="text-[10px] px-1 py-0.5 rounded bg-[var(--bg-secondary)]">Send Messages, Create Threads, Read History, Add Reactions, Attach Files, Use Slash Commands</code></li>
                    <li>Open the invite URL → add bot to your server</li>
                    <li>Set env vars: <strong>DISCORD_BOT_TOKEN</strong>, <strong>DISCORD_APP_ID</strong>, <strong>DISCORD_GUILD_ID</strong> (optional)</li>
                    <li>Run: <code className="text-[10px] px-1 py-0.5 rounded bg-[var(--bg-secondary)]">npm run discord</code></li>
                  </ol>
                </div>

                {/* Features */}
                <div className="border-t border-[var(--border)] pt-4">
                  <p className="text-[12px] font-semibold text-[var(--text-secondary)] mb-2">Features</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: "Channel mentions", desc: "@NiaAI in any channel" },
                      { label: "Direct messages", desc: "DM the bot directly" },
                      { label: "Thread follow-ups", desc: "Context kept per thread" },
                      { label: "File analysis", desc: "Attach any file type" },
                      { label: "Slash commands", desc: "/nia and /nia-new" },
                      { label: "PDF & image gen", desc: "Delivered as attachments" },
                    ].map((f) => (
                      <div key={f.label} className="p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
                        <p className="text-[11px] font-semibold text-[var(--text-primary)]">{f.label}</p>
                        <p className="text-[10px] text-[var(--text-faint)]">{f.desc}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
