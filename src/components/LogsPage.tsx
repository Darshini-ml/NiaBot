"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  Activity,
  MessageSquare,
  Zap,
  Wrench,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Download,
  Search,
  BarChart3,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  XCircle,
  FileText,
  Image as ImageIcon,
  Globe,
  Sparkles,
  Trash2,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DateRange = "today" | "7d" | "30d" | "custom";
type LogTab = "chats" | "automations" | "tools" | "errors";

interface RawUsageEvent {
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
  status?: string;
  error_message?: string;
  automation_id?: string;
  created_at: string;
}

interface ChatLogGroup {
  chatId: string;
  chatTitle: string;
  isDeleted: boolean;
  deletedAt: string | null;
  models: string[];
  requests: number;
  tokensIn: number;
  tokensOut: number;
  tokensReasoning: number;
  cost: number;
  lastUsed: string;
  events: {
    id: string;
    model: string;
    provider: string;
    tokensIn: number;
    tokensOut: number;
    tokensReasoning: number;
    cost: number;
    latencyMs: number;
    status: "ok" | "error";
    toolsUsed: string[];
    timestamp: string;
  }[];
}

interface AutomationRun {
  id: string;
  automationId: string;
  status: string;
  triggeredBy: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  tokens: number | null;
  output: string | null;
  error: string | null;
  email_status: string | null;
  email_error: string | null;
}

interface ToolEvent {
  id: string;
  type: string;
  chatId: string;
  chatTitle: string;
  inputSummary: string;
  resultUrl?: string;
  tokens: number;
  cost: number;
  latencyMs: number;
  status: "ok" | "error";
  timestamp: string;
}

interface ErrorLog {
  id: string;
  source: string;
  message: string;
  requestId: string;
  chatId?: string;
  timestamp: string;
}

interface DayData {
  date: string;
  providers: Record<string, { input_tokens: number; output_tokens: number }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(n: number): string {
  if (n <= 0) return "—";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

/** For summary cards — show $0.00 when total is truly zero */
function formatCostTotal(n: number): string {
  if (n < 0) return "—";
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function formatLatency(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Clean up raw-URL-like titles into readable text */
function cleanTitle(title: string): string {
  if (!title) return "Untitled";
  // If it looks like a raw URL, extract domain
  try {
    if (/^https?:\/\//.test(title)) {
      const url = new URL(title);
      const path = url.pathname.replace(/\/$/, "");
      const slug = path.split("/").pop();
      if (slug && slug.length > 2) {
        return `${url.hostname} — ${decodeURIComponent(slug).replace(/[-_]/g, " ")}`;
      }
      return url.hostname;
    }
  } catch { /* not a URL */ }
  return title;
}

function getRangeFrom(range: DateRange): string {
  const now = Date.now();
  switch (range) {
    case "today": return new Date(now - 86400000).toISOString();
    case "7d": return new Date(now - 7 * 86400000).toISOString();
    case "30d": return new Date(now - 30 * 86400000).toISOString();
    case "custom": return new Date(0).toISOString();
  }
}

function getDaysInRange(range: DateRange): string[] {
  const days: string[] = [];
  const now = new Date();
  const count = range === "today" ? 1 : range === "7d" ? 7 : 30;
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

const PROVIDER_ORDER = ["niaai", "anthropic", "openai", "google"] as const;
const PROVIDER_COLORS: Record<string, string> = {
  niaai: "#8b3dff",
  nia: "#8b3dff",
  anthropic: "#f59e0b",
  openai: "#10b981",
  google: "#3b82f6",
};
const PROVIDER_LABELS: Record<string, string> = {
  niaai: "NiaAI",
  nia: "NiaAI",
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
};

const toolTypeLabel: Record<string, string> = {
  web_search: "Web Search",
  image_gen: "Image Generation",
  pdf_gen: "PDF Generation",
  doc_gen: "Document Generation",
  enhance_prompt: "Enhance Prompt",
};

const toolTypeIcon: Record<string, typeof Globe> = {
  web_search: Globe,
  image_gen: ImageIcon,
  pdf_gen: FileText,
  doc_gen: FileText,
  enhance_prompt: Sparkles,
};

// ---------------------------------------------------------------------------
// Summary card (no icon, label 11px uppercase muted above 22px value)
// ---------------------------------------------------------------------------

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)]" style={{ minWidth: 0 }}>
      <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] leading-tight mb-1">{label}</div>
      <div className="text-[22px] font-semibold text-[var(--text-primary)] tabular-nums leading-tight">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SVG stacked bar chart (180px fixed height)
// ---------------------------------------------------------------------------

function TokensBarChart({ data, range }: {
  data: { date: string; niaai: number; anthropic: number; openai: number; google: number }[];
  range: DateRange;
}) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; date: string; providers: { label: string; tokens: number; color: string }[]; flipBelow?: boolean } | null>(null);

  if (data.length === 0) return null;

  const chartH = 140;
  const padLeft = 48;
  const padRight = 16;
  const padTop = 8;
  const padBottom = 28;
  const plotW = Math.max(data.length * 40, 300);
  const svgW = padLeft + plotW + padRight;
  const plotH = chartH - padTop - padBottom;

  const max = Math.max(...data.map(d => d.niaai + d.anthropic + d.openai + d.google), 1);
  // Round up to a nice number for y-axis
  const niceMax = (() => {
    const mag = Math.pow(10, Math.floor(Math.log10(max)));
    const norm = max / mag;
    if (norm <= 1) return mag;
    if (norm <= 2) return 2 * mag;
    if (norm <= 5) return 5 * mag;
    return 10 * mag;
  })();

  const gridlines = [0, niceMax / 3, (niceMax * 2) / 3, niceMax];
  const slotW = plotW / data.length;
  const barW = slotW * 0.6;

  // Label every day for 7d, every 5th for 30d
  const labelEvery = range === "30d" ? 5 : 1;

  return (
    <div style={{ position: "relative", height: 180, overflowX: data.length > 15 ? "auto" : "visible", overflowY: "visible" }}
      onMouseLeave={() => setTooltip(null)}>
      <svg width={svgW} height={chartH} style={{ display: "block" }}>
        {/* Y-axis gridlines & ticks */}
        {gridlines.map((val, i) => {
          const y = padTop + plotH - (val / niceMax) * plotH;
          return (
            <g key={i}>
              <line x1={padLeft} x2={padLeft + plotW} y1={y} y2={y} stroke="var(--border)" strokeWidth={1} strokeDasharray={i === 0 ? "none" : "3,3"} />
              <text x={padLeft - 6} y={y + 4} textAnchor="end" fontSize={10} fill="var(--text-faint)" fontFamily="inherit">
                {formatTokens(val)}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {data.map((d, i) => {
          const x = padLeft + i * slotW + (slotW - barW) / 2;
          const total = d.niaai + d.anthropic + d.openai + d.google;
          let yOffset = 0;

          const segments = PROVIDER_ORDER
            .map(p => ({ key: p, val: d[p] || 0, color: PROVIDER_COLORS[p] }))
            .filter(s => s.val > 0);

          // Top of the stacked bar (for anchoring tooltip)
          const barTopY = total > 0 ? padTop + plotH - (total / niceMax) * plotH : padTop + plotH;

          return (
            <g key={i}
              onMouseEnter={() => {
                // Anchor tooltip to the top of the bar; flip below if bar is short
                const ttY = barTopY > 50 ? barTopY - 8 : barTopY + 8;
                const flipBelow = barTopY <= 50;
                setTooltip({
                  x: x + barW / 2,
                  y: ttY,
                  date: d.date,
                  providers: segments.map(s => ({ label: PROVIDER_LABELS[s.key] || s.key, tokens: s.val, color: s.color })),
                  flipBelow,
                });
              }}
              onMouseLeave={() => setTooltip(null)}
              style={{ cursor: "default" }}
            >
              {/* Invisible hit area for empty slots */}
              <rect x={x} y={padTop} width={barW} height={plotH} fill="transparent" />

              {segments.map(s => {
                const h = (s.val / niceMax) * plotH;
                const y = padTop + plotH - yOffset - h;
                yOffset += h;
                return (
                  <rect key={s.key} x={x} y={y} width={barW} height={Math.max(h, 1)} fill={s.color} rx={2} />
                );
              })}

              {/* X-axis label */}
              {(i % labelEvery === 0) && (
                <text x={x + barW / 2} y={chartH - 4} textAnchor="middle" fontSize={9} fill="var(--text-faint)" fontFamily="inherit">
                  {(() => {
                    const parts = d.date.split("-");
                    return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
                  })()}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Tooltip — anchored to the hovered bar, positioned inside chart container */}
      {tooltip && (
        <div
          style={{
            position: "absolute",
            left: tooltip.x,
            top: tooltip.y,
            transform: tooltip.flipBelow
              ? "translateX(-50%)"
              : "translateX(-50%) translateY(-100%)",
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "6px 10px",
            fontSize: 11,
            pointerEvents: "none",
            zIndex: 10,
            whiteSpace: "nowrap",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 3, color: "var(--text-primary)" }}>{tooltip.date}</div>
          {tooltip.providers.map(p => (
            <div key={p.label} style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-muted)" }}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: p.color, display: "inline-block" }} />
              {p.label}: {formatTokens(p.tokens)}
            </div>
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 px-1">
        {PROVIDER_ORDER.map(p => (
          <div key={p} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ background: PROVIDER_COLORS[p] }} />
            <span className="text-[10px] text-[var(--text-faint)]">{PROVIDER_LABELS[p]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface LogsPageProps {
  deletedChats?: Record<string, string>; // chatId → deletedAt ISO
}

export default function LogsPage({ deletedChats = {} }: LogsPageProps) {
  const [activeTab, setActiveTab] = useState<LogTab>("chats");
  const [dateRange, setDateRange] = useState<DateRange>("7d");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedChatId, setExpandedChatId] = useState<string | null>(null);
  const [chartCollapsed, setChartCollapsed] = useState(false);
  const [sortKey, setSortKey] = useState<"cost" | "tokens" | "lastUsed">("lastUsed");
  const [includeDeleted, setIncludeDeleted] = useState(true);
  const [sourceFilter, setSourceFilter] = useState<"all" | "slack" | "discord" | "web">("all");

  // Real data state
  const [chatLogs, setChatLogs] = useState<ChatLogGroup[]>([]);
  const [automationRuns, setAutomationRuns] = useState<AutomationRun[]>([]);
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [errorLogs, setErrorLogs] = useState<ErrorLog[]>([]);
  const [chartDays, setChartDays] = useState<{ date: string; niaai: number; anthropic: number; openai: number; google: number }[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch real data from API + localStorage
  const fetchData = useCallback(async () => {
    setLoading(true);
    const from = getRangeFrom(dateRange);
    const qs = `from=${encodeURIComponent(from)}`;

    try {
      // Fetch from server API (in-memory store)
      const [chatRes, dayRes, automationRes] = await Promise.all([
        fetch(`/api/usage?group_by=chat&${qs}`).then(r => r.json()).catch(() => ({ chats: [] })),
        fetch(`/api/usage?group_by=day&${qs}`).then(r => r.json()).catch(() => ({ days: [] })),
        fetch(`/api/automation-runs`).then(r => r.json()).catch(() => ({ runs: [] })),
      ]);

      // Also read localStorage events as supplement (server store resets on restart)
      let localEvents: RawUsageEvent[] = [];
      try {
        const keys = Object.keys(localStorage);
        for (const key of keys) {
          if (key.startsWith("nia_usage_events_")) {
            const events = JSON.parse(localStorage.getItem(key) || "[]");
            localEvents = localEvents.concat(events);
          }
        }
      } catch { /* ignore */ }

      // Filter local events by date range
      const fromTs = new Date(from).getTime();
      localEvents = localEvents.filter(e => new Date(e.created_at).getTime() >= fromTs);

      // Merge: server data takes priority, supplement with local events for chat IDs not in server data
      const serverChatIds = new Set((chatRes.chats || []).map((c: Record<string, unknown>) => c.chat_id));

      // Build chat groups from server data
      const serverChats: ChatLogGroup[] = (chatRes.chats || []).map((c: Record<string, unknown>) => {
        const chatId = c.chat_id as string;
        // Get individual events for this chat from localStorage
        const chatEvents = localEvents.filter(e => e.chat_id === chatId);
        return {
          chatId,
          chatTitle: (c.chat_title_snapshot as string) || (c.chat_title as string) || "Untitled",
          isDeleted: !!deletedChats[chatId],
          deletedAt: deletedChats[chatId] || null,
          models: (c.models_used as string[]) || [],
          requests: (c.requests as number) || 0,
          tokensIn: (c.input_tokens as number) || 0,
          tokensOut: (c.output_tokens as number) || 0,
          tokensReasoning: (c.reasoning_tokens as number) || 0,
          cost: (c.cost_usd as number) || 0,
          lastUsed: (c.last_used as string) || new Date().toISOString(),
          events: chatEvents.map((e, i) => ({
            id: `${chatId}-${i}`,
            model: e.model,
            provider: e.provider,
            tokensIn: e.input_tokens,
            tokensOut: e.output_tokens,
            tokensReasoning: e.reasoning_tokens,
            cost: e.cost_usd,
            latencyMs: e.latency_ms,
            status: "ok" as const,
            toolsUsed: e.kind && e.kind !== "chat" && e.kind !== "assistant" ? [e.kind] : [],
            timestamp: e.created_at,
          })),
        };
      });

      // Add local-only chats (not in server data)
      const localOnlyMap = new Map<string, RawUsageEvent[]>();
      for (const e of localEvents) {
        if (!serverChatIds.has(e.chat_id)) {
          if (!localOnlyMap.has(e.chat_id)) localOnlyMap.set(e.chat_id, []);
          localOnlyMap.get(e.chat_id)!.push(e);
        }
      }

      const localChats: ChatLogGroup[] = Array.from(localOnlyMap.entries()).map(([chatId, events]) => {
        const models = [...new Set(events.map(e => e.model))];
        return {
          chatId,
          chatTitle: events[events.length - 1].chat_title || "Untitled",
          isDeleted: !!deletedChats[chatId],
          deletedAt: deletedChats[chatId] || null,
          models,
          requests: events.length,
          tokensIn: events.reduce((s, e) => s + e.input_tokens, 0),
          tokensOut: events.reduce((s, e) => s + e.output_tokens, 0),
          tokensReasoning: events.reduce((s, e) => s + e.reasoning_tokens, 0),
          cost: events.reduce((s, e) => s + e.cost_usd, 0),
          lastUsed: events[events.length - 1].created_at,
          events: events.map((e, i) => ({
            id: `${chatId}-${i}`,
            model: e.model,
            provider: e.provider,
            tokensIn: e.input_tokens,
            tokensOut: e.output_tokens,
            tokensReasoning: e.reasoning_tokens,
            cost: e.cost_usd,
            latencyMs: e.latency_ms,
            status: "ok" as const,
            toolsUsed: e.kind && e.kind !== "chat" && e.kind !== "assistant" ? [e.kind] : [],
            timestamp: e.created_at,
          })),
        };
      });

      setChatLogs([...serverChats, ...localChats]);

      // Build chart data: fill all days in range
      const allDays = getDaysInRange(dateRange);
      const dayMap = new Map<string, DayData>();
      for (const d of (dayRes.days || []) as DayData[]) {
        dayMap.set(d.date, d);
      }
      // Also aggregate local events into day data
      for (const e of localEvents) {
        const date = e.created_at.slice(0, 10);
        if (!dayMap.has(date)) {
          dayMap.set(date, { date, providers: {} });
        }
        const day = dayMap.get(date)!;
        const prov = e.provider || "niaai";
        if (!day.providers[prov]) day.providers[prov] = { input_tokens: 0, output_tokens: 0 };
        day.providers[prov].input_tokens += e.input_tokens;
        day.providers[prov].output_tokens += e.output_tokens;
      }

      const chartData = allDays.map(date => {
        const d = dayMap.get(date);
        const provs = d?.providers || {};
        return {
          date,
          niaai: (provs.niaai?.input_tokens || 0) + (provs.niaai?.output_tokens || 0) + (provs.nia?.input_tokens || 0) + (provs.nia?.output_tokens || 0),
          anthropic: (provs.anthropic?.input_tokens || 0) + (provs.anthropic?.output_tokens || 0),
          openai: (provs.openai?.input_tokens || 0) + (provs.openai?.output_tokens || 0),
          google: (provs.google?.input_tokens || 0) + (provs.google?.output_tokens || 0),
        };
      });
      setChartDays(chartData);

      // Automation runs
      const runs = (automationRes.runs || []) as AutomationRun[];
      setAutomationRuns(runs.filter(r => new Date(r.startedAt).getTime() >= fromTs));

      // Fetch raw events from server for Tools + Errors tabs
      const toolKinds = new Set(["tool_search", "tool_image", "tool_pdf", "tool_link", "enhance", "web_search", "image_gen", "pdf_gen", "doc_gen", "enhance_prompt"]);

      let serverRawEvents: RawUsageEvent[] = [];
      try {
        const rawRes = await fetch(`/api/usage?group_by=events&kind=tool_search,tool_image,tool_pdf,tool_link,enhance&${qs}`);
        const rawData = await rawRes.json();
        serverRawEvents = (rawData.events || []) as RawUsageEvent[];
      } catch { /* ignore */ }

      // Merge: server raw events + local events, dedupe by message_id+kind+created_at
      const seenToolKeys = new Set<string>();
      const allToolEvents: RawUsageEvent[] = [];
      for (const e of serverRawEvents) {
        const key = `${e.message_id}:${e.kind}:${e.created_at}`;
        if (!seenToolKeys.has(key)) { seenToolKeys.add(key); allToolEvents.push(e); }
      }
      for (const e of localEvents) {
        if (!toolKinds.has(e.kind)) continue;
        const key = `${e.message_id}:${e.kind}:${e.created_at}`;
        if (!seenToolKeys.has(key)) { seenToolKeys.add(key); allToolEvents.push(e); }
      }

      const tools: ToolEvent[] = allToolEvents
        .map((e, i) => ({
          id: `tool-${i}`,
          type: e.kind,
          chatId: e.chat_id,
          chatTitle: e.chat_title,
          inputSummary: e.chat_title,
          tokens: e.input_tokens + e.output_tokens,
          cost: e.cost_usd,
          latencyMs: e.latency_ms,
          status: (e.status === "error" ? "error" : "ok") as "ok" | "error",
          timestamp: e.created_at,
        }))
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setToolEvents(tools);

      // Error events: fetch from server + local
      let serverErrorEvents: RawUsageEvent[] = [];
      try {
        const errRes = await fetch(`/api/usage?group_by=events&${qs}`);
        const errData = await errRes.json();
        serverErrorEvents = ((errData.events || []) as RawUsageEvent[]).filter(e => e.status === "error");
      } catch { /* ignore */ }

      const seenErrKeys = new Set<string>();
      const allErrorEvents: RawUsageEvent[] = [];
      for (const e of serverErrorEvents) {
        const key = `${e.message_id}:${e.created_at}`;
        if (!seenErrKeys.has(key)) { seenErrKeys.add(key); allErrorEvents.push(e); }
      }
      for (const e of localEvents.filter(e => e.status === "error")) {
        const key = `${e.message_id}:${e.created_at}`;
        if (!seenErrKeys.has(key)) { seenErrKeys.add(key); allErrorEvents.push(e); }
      }

      const errors: ErrorLog[] = allErrorEvents
        .map((e, i) => ({
          id: `err-${i}`,
          source: e.provider,
          message: e.error_message || e.chat_title || "Unknown error",
          requestId: e.message_id,
          chatId: e.chat_id,
          timestamp: e.created_at,
        }))
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setErrorLogs(errors);

    } catch (err) {
      console.error("Failed to fetch usage data:", err);
    } finally {
      setLoading(false);
    }
  }, [dateRange, deletedChats]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Count deleted chats
  const deletedChatCount = useMemo(() => chatLogs.filter(c => c.isDeleted).length, [chatLogs]);

  // Search + deleted filter
  const searchedChats = useMemo(() => {
    let filtered = chatLogs;
    if (!includeDeleted) filtered = filtered.filter(c => !c.isDeleted);
    if (sourceFilter === "slack") {
      filtered = filtered.filter(c => c.chatId?.startsWith("slack-") || c.chatTitle?.startsWith("Slack:"));
    } else if (sourceFilter === "discord") {
      filtered = filtered.filter(c => c.chatId?.startsWith("discord-") || c.chatId?.startsWith("discord:"));
    } else if (sourceFilter === "web") {
      filtered = filtered.filter(c => !c.chatId?.startsWith("slack-") && !c.chatTitle?.startsWith("Slack:") && !c.chatId?.startsWith("discord-") && !c.chatId?.startsWith("discord:"));
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(c => c.chatTitle.toLowerCase().includes(q) || c.models.some(m => m.toLowerCase().includes(q)));
    }
    return filtered;
  }, [chatLogs, searchQuery, includeDeleted, sourceFilter]);

  // Summary stats — ALWAYS include all chats (including deleted) so totals don't change on delete
  const summary = useMemo(() => {
    let tokensIn = 0, tokensOut = 0, tokensReasoning = 0, cost = 0, requests = 0, totalLatency = 0, latencyCount = 0;

    for (const c of chatLogs) {
      tokensIn += c.tokensIn;
      tokensOut += c.tokensOut;
      tokensReasoning += c.tokensReasoning;
      if (c.cost > 0) cost += c.cost;
      requests += c.requests;
      for (const e of c.events) { totalLatency += e.latencyMs; latencyCount++; }
    }
    for (const a of automationRuns) {
      if (a.durationMs) { totalLatency += a.durationMs; latencyCount++; }
      requests++;
    }

    const avgLatency = latencyCount > 0 ? totalLatency / latencyCount : 0;
    return { tokensIn, tokensOut, tokensReasoning, cost, requests, avgLatency };
  }, [chatLogs, automationRuns]);

  const tabs: { id: LogTab; label: string; icon: typeof MessageSquare; count: number }[] = [
    { id: "chats", label: "Chats", icon: MessageSquare, count: searchedChats.length },
    { id: "automations", label: "Automations", icon: Zap, count: automationRuns.length },
    { id: "tools", label: "Tools", icon: Wrench, count: toolEvents.length },
    { id: "errors", label: "Errors", icon: AlertTriangle, count: errorLogs.length },
  ];

  const ranges: { id: DateRange; label: string }[] = [
    { id: "today", label: "Today" },
    { id: "7d", label: "7d" },
    { id: "30d", label: "30d" },
    { id: "custom", label: "Custom" },
  ];

  // Sort
  const sortedChats = useMemo(() => {
    const arr = [...searchedChats];
    switch (sortKey) {
      case "cost": return arr.sort((a, b) => b.cost - a.cost);
      case "tokens": return arr.sort((a, b) => (b.tokensIn + b.tokensOut) - (a.tokensIn + a.tokensOut));
      case "lastUsed": return arr.sort((a, b) => new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime());
    }
  }, [searchedChats, sortKey]);

  // CSV export
  const handleExport = useCallback(() => {
    const rows = [["Chat", "Models", "Requests", "Input Tokens", "Output Tokens", "Reasoning", "Cost", "Last Used"]];
    for (const c of chatLogs) {
      rows.push([c.chatTitle, c.models.join("; "), String(c.requests), String(c.tokensIn), String(c.tokensOut), String(c.tokensReasoning), c.cost.toFixed(4), c.lastUsed]);
    }
    const csv = rows.map(r => r.map(v => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nia-logs-${dateRange}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [chatLogs, dateRange]);

  return (
    <div className="flex-1 flex flex-col" style={{ minHeight: 0, overflowY: "auto" }}>
      <div className="mx-auto w-full px-6 pt-8 pb-5" style={{ maxWidth: 1100 }}>
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-[22px] font-bold text-[var(--text-primary)]">Logs</h1>
          <div className="flex items-center gap-2">
            {/* Range selector with accent fill on active */}
            <div className="flex items-center bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg overflow-hidden">
              {ranges.map(r => (
                <button
                  key={r.id}
                  onClick={() => setDateRange(r.id)}
                  className="px-3 py-1.5 text-[12px] font-medium transition-colors"
                  style={dateRange === r.id ? {
                    background: "rgba(124,58,237,0.18)",
                    color: "var(--accent)",
                    borderWidth: 1,
                    borderStyle: "solid",
                    borderColor: "var(--accent)",
                    margin: -1,
                    borderRadius: 6,
                  } : {
                    color: "var(--text-muted)",
                  }}
                  onMouseEnter={e => { if (dateRange !== r.id) (e.target as HTMLElement).style.color = "var(--text-primary)"; }}
                  onMouseLeave={e => { if (dateRange !== r.id) (e.target as HTMLElement).style.color = "var(--text-muted)"; }}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search logs..."
                className="pl-8 pr-3 py-1.5 text-[12px] rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] placeholder-[var(--text-faint)] outline-none focus:border-[var(--accent-border)]"
                style={{ width: 180 }}
              />
            </div>

            {/* Export CSV */}
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <Download size={13} />
              Export CSV
            </button>
          </div>
        </div>

        {/* Summary strip — 6 equal columns, no icons */}
        <div className="grid grid-cols-6 gap-3 mb-1">
          <SummaryCard label="Input tokens" value={formatTokens(summary.tokensIn)} />
          <SummaryCard label="Output tokens" value={formatTokens(summary.tokensOut)} />
          <SummaryCard label="Reasoning" value={formatTokens(summary.tokensReasoning)} />
          <SummaryCard label="Cost" value={formatCostTotal(summary.cost)} />
          <SummaryCard label="Requests" value={String(summary.requests)} />
          <SummaryCard label="Avg latency" value={formatLatency(summary.avgLatency)} />
        </div>
        {deletedChatCount > 0 && (
          <p className="text-[11px] text-[var(--text-faint)] mb-4 px-1">
            Includes {deletedChatCount} deleted chat{deletedChatCount > 1 ? "s" : ""}
          </p>
        )}
        {deletedChatCount === 0 && <div className="mb-3" />}

        {/* Tokens bar chart */}
        <div className="mb-4">
          <button
            onClick={() => setChartCollapsed(!chartCollapsed)}
            className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] mb-2 transition-colors"
          >
            <BarChart3 size={13} />
            Tokens/day by provider
            <ChevronDown size={12} className={`transition-transform ${chartCollapsed ? "-rotate-90" : ""}`} />
          </button>
          {!chartCollapsed && (
            <div className="p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)]" style={{ height: 180 }}>
              {chartDays.some(d => d.niaai + d.anthropic + d.openai + d.google > 0) ? (
                <TokensBarChart data={chartDays} range={dateRange} />
              ) : (
                <div className="flex items-center justify-center h-full text-[12px] text-[var(--text-faint)]">
                  No token usage in this period
                </div>
              )}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-0 border-b border-[var(--border)] mb-4">
          {tabs.map(tab => {
            const TabIcon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors ${
                  isActive
                    ? "border-[var(--accent)] text-[var(--accent)]"
                    : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                <TabIcon size={14} />
                {tab.label}
                <span className={`ml-1 text-[11px] px-1.5 py-0.5 rounded-full font-medium ${
                  isActive
                    ? "bg-[rgba(124,58,237,0.15)] text-[var(--accent)]"
                    : "bg-[var(--bg-hover)] text-[var(--text-faint)]"
                }`}>
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="text-[13px] text-[var(--text-muted)]">Loading usage data...</div>
          </div>
        )}

        {/* Tab content */}
        {!loading && activeTab === "chats" && (
          <div>
            {/* Sort + filter controls */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                {/* Source filter */}
                <div className="flex items-center bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg overflow-hidden">
                  {(["all", "web", "slack", "discord"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setSourceFilter(s)}
                      className={`px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                        sourceFilter === s
                          ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
                          : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      {s === "all" ? "All" : s === "slack" ? "# Slack" : s === "discord" ? "Discord" : "Web"}
                    </button>
                  ))}
                </div>
                {deletedChatCount > 0 && (
                  <button
                    onClick={() => setIncludeDeleted(!includeDeleted)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-lg border transition-colors ${
                      includeDeleted
                        ? "border-[var(--accent-border)] bg-[rgba(124,58,237,0.1)] text-[var(--accent)]"
                        : "border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <Trash2 size={11} />
                    Include deleted
                  </button>
                )}
              </div>
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as typeof sortKey)}
                className="text-[12px] px-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] outline-none cursor-pointer"
              >
                <option value="lastUsed">Last used</option>
                <option value="cost">Cost</option>
                <option value="tokens">Tokens</option>
              </select>
            </div>

            {sortedChats.length === 0 ? (
              <EmptyState icon={MessageSquare} message="No chat logs for this period" />
            ) : (
              <div className="rounded-xl border border-[var(--border)] overflow-hidden">
                {/* Table header */}
                <div className="grid items-center px-4 py-2.5 bg-[var(--bg-secondary)] border-b border-[var(--border)] text-[11px] font-semibold text-[var(--text-faint)] uppercase tracking-wider"
                  style={{ gridTemplateColumns: "1fr 120px 70px 80px 80px 80px 80px 100px" }}>
                  <span>Chat</span>
                  <span>Model(s)</span>
                  <span className="text-right">Req.</span>
                  <span className="text-right">In</span>
                  <span className="text-right">Out</span>
                  <span className="text-right">Reason.</span>
                  <span className="text-right">Cost</span>
                  <span className="text-right">Last used</span>
                </div>

                {sortedChats.map(chat => (
                  <div key={chat.chatId}>
                    <button
                      onClick={() => setExpandedChatId(expandedChatId === chat.chatId ? null : chat.chatId)}
                      className={`w-full grid items-center px-4 py-2.5 border-b border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] transition-colors text-left ${chat.isDeleted ? "opacity-60" : ""}`}
                      style={{ gridTemplateColumns: "1fr 120px 70px 80px 80px 80px 80px 100px" }}
                      title={chat.isDeleted && chat.deletedAt ? `This chat was deleted on ${new Date(chat.deletedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}` : undefined}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        {chat.isDeleted ? (
                          <Trash2 size={13} className="text-[var(--text-faint)] shrink-0" />
                        ) : (
                          <ChevronRight size={13} className={`text-[var(--text-faint)] shrink-0 transition-transform ${expandedChatId === chat.chatId ? "rotate-90" : ""}`} />
                        )}
                        <span className={`text-[13px] truncate ${chat.isDeleted ? "text-[var(--text-faint)]" : "text-[var(--text-primary)]"}`}>{cleanTitle(chat.chatTitle)}</span>
                        {(chat.chatId?.startsWith("slack-") || chat.chatTitle?.startsWith("Slack:")) && (
                          <span className="shrink-0 px-1.5 py-0.5 text-[9px] font-semibold rounded bg-[#E01E5A]/10 text-[#E01E5A] tracking-wider">#Slack</span>
                        )}
                        {(chat.chatId?.startsWith("discord-") || chat.chatId?.startsWith("discord:")) && (
                          <span className="shrink-0 px-1.5 py-0.5 text-[9px] font-semibold rounded bg-[#5865F2]/10 text-[#5865F2] tracking-wider">Discord</span>
                        )}
                        {chat.isDeleted && (
                          <span className="shrink-0 px-1.5 py-0.5 text-[9px] font-semibold uppercase rounded bg-[var(--bg-hover)] text-[var(--text-faint)] tracking-wider">Deleted</span>
                        )}
                      </span>
                      <span className={`text-[11px] truncate ${chat.isDeleted ? "text-[var(--text-faint)]" : "text-[var(--text-muted)]"}`}>{(() => {
                        const shortModels = chat.models.map(m => m.split("/").pop() || m);
                        if (shortModels.length === 0) return "—";
                        if (shortModels.length === 1) return shortModels[0];
                        return `${shortModels[0]} +${shortModels.length - 1}`;
                      })()}</span>
                      <span className={`text-[12px] text-right tabular-nums ${chat.isDeleted ? "text-[var(--text-faint)]" : "text-[var(--text-secondary)]"}`}>{chat.requests}</span>
                      <span className={`text-[12px] text-right tabular-nums ${chat.isDeleted ? "text-[var(--text-faint)]" : "text-[var(--text-secondary)]"}`}>{formatTokens(chat.tokensIn)}</span>
                      <span className={`text-[12px] text-right tabular-nums ${chat.isDeleted ? "text-[var(--text-faint)]" : "text-[var(--text-secondary)]"}`}>{formatTokens(chat.tokensOut)}</span>
                      <span className={`text-[12px] text-right tabular-nums ${chat.isDeleted ? "text-[var(--text-faint)]" : "text-[var(--text-secondary)]"}`}>{formatTokens(chat.tokensReasoning)}</span>
                      <span className={`text-[12px] text-right tabular-nums ${chat.isDeleted ? "text-[var(--text-faint)]" : "text-[var(--text-primary)] font-medium"}`}>{formatCost(chat.cost)}</span>
                      <span className={`text-[11px] text-right ${chat.isDeleted ? "text-[var(--text-faint)]" : "text-[var(--text-muted)]"}`}>{formatDate(chat.lastUsed)}</span>
                    </button>

                    {/* Expanded per-message rows */}
                    {expandedChatId === chat.chatId && (
                      <div className="bg-[var(--bg-primary)]">
                        {chat.isDeleted && (
                          <div className="px-4 py-2 text-[11px] text-[var(--text-faint)] italic border-b border-[var(--border-subtle)]" style={{ paddingLeft: 44 }}>
                            Message content not available for deleted chats
                          </div>
                        )}
                        {chat.events.length === 0 ? (
                          <div className="px-4 py-3 text-[11px] text-[var(--text-faint)]" style={{ paddingLeft: 44 }}>
                            No per-message detail available
                          </div>
                        ) : (
                          chat.events.map(ev => (
                            <div
                              key={ev.id}
                              className="grid items-center px-4 py-2 border-b border-[var(--border-subtle)] text-[11px]"
                              style={{ gridTemplateColumns: "1fr 120px 70px 80px 80px 80px 80px 100px", paddingLeft: 44 }}
                            >
                              <span className="text-[var(--text-muted)] flex items-center gap-2">
                                {formatTime(ev.timestamp)}
                                {ev.toolsUsed.length > 0 && (
                                  <span className="px-1.5 py-0.5 rounded bg-[var(--bg-hover)] text-[10px] text-[var(--text-faint)]">
                                    {ev.toolsUsed.join(", ")}
                                  </span>
                                )}
                                {ev.status === "error" && <XCircle size={11} className="text-[var(--error)]" />}
                              </span>
                              <span className="text-[var(--text-faint)] truncate">{ev.model.split("/").pop()}</span>
                              <span className="text-right text-[var(--text-faint)] tabular-nums">{formatLatency(ev.latencyMs)}</span>
                              <span className="text-right text-[var(--text-faint)] tabular-nums">{formatTokens(ev.tokensIn)}</span>
                              <span className="text-right text-[var(--text-faint)] tabular-nums">{formatTokens(ev.tokensOut)}</span>
                              <span className="text-right text-[var(--text-faint)] tabular-nums">{formatTokens(ev.tokensReasoning)}</span>
                              <span className="text-right text-[var(--text-faint)] tabular-nums">{formatCost(ev.cost)}</span>
                              <span className="text-right text-[var(--text-faint)]">stop</span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!loading && activeTab === "automations" && (
          <div>
            {automationRuns.length === 0 ? (
              <EmptyState icon={Zap} message="No automation runs for this period" />
            ) : (
              <div className="rounded-xl border border-[var(--border)] overflow-hidden">
                <div className="grid items-center px-4 py-2.5 bg-[var(--bg-secondary)] border-b border-[var(--border)] text-[11px] font-semibold text-[var(--text-faint)] uppercase tracking-wider"
                  style={{ gridTemplateColumns: "1fr 130px 80px 70px 70px 90px 90px" }}>
                  <span>Automation</span>
                  <span>Trigger time</span>
                  <span className="text-right">Duration</span>
                  <span className="text-right">Tokens</span>
                  <span>Status</span>
                  <span>Email</span>
                  <span>Output</span>
                </div>

                {automationRuns.map(run => (
                  <div
                    key={run.id}
                    className="grid items-center px-4 py-2.5 border-b border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] transition-colors"
                    style={{ gridTemplateColumns: "1fr 130px 80px 70px 70px 90px 90px" }}
                  >
                    <span className="text-[13px] text-[var(--text-primary)] truncate">{run.automationId}</span>
                    <span className="text-[11px] text-[var(--text-muted)]">{formatDate(run.startedAt)}</span>
                    <span className="text-[12px] text-[var(--text-secondary)] text-right tabular-nums">{run.durationMs ? formatLatency(run.durationMs) : "—"}</span>
                    <span className="text-[12px] text-[var(--text-secondary)] text-right tabular-nums">{run.tokens ? formatTokens(run.tokens) : "—"}</span>
                    <span className="flex items-center gap-1">
                      {run.status === "completed" ? (
                        <CheckCircle2 size={12} className="text-[var(--success)]" />
                      ) : run.status === "failed" ? (
                        <XCircle size={12} className="text-[var(--error)]" />
                      ) : (
                        <Activity size={12} className="text-[var(--text-muted)]" />
                      )}
                      <span className="text-[11px] text-[var(--text-muted)]">{run.status}</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      {run.email_status === "sent" && (
                        <>
                          <CheckCircle2 size={12} className="text-[var(--success)]" />
                          <span className="text-[11px] text-[var(--success)]">Sent</span>
                        </>
                      )}
                      {run.email_status === "failed" && (
                        <span className="flex items-center gap-1.5">
                          <XCircle size={12} className="text-[var(--error)]" />
                          <span className="text-[11px] text-[var(--error)]" title={run.email_error || undefined}>Failed</span>
                          <button className="ml-1 p-0.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-faint)] hover:text-[var(--accent)]" title="Retry">
                            <RefreshCw size={11} />
                          </button>
                        </span>
                      )}
                      {(!run.email_status || run.email_status === "none") && <span className="text-[11px] text-[var(--text-faint)]">—</span>}
                    </span>
                    <span className="text-[11px] text-[var(--text-muted)] truncate" title={run.output || undefined}>{run.output ? run.output.slice(0, 60) : "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!loading && activeTab === "tools" && (
          <div>
            {toolEvents.length === 0 ? (
              <EmptyState icon={Wrench} message="No tool events for this period" />
            ) : (
              <div className="rounded-xl border border-[var(--border)] overflow-hidden">
                <div className="grid items-center px-4 py-2.5 bg-[var(--bg-secondary)] border-b border-[var(--border)] text-[11px] font-semibold text-[var(--text-faint)] uppercase tracking-wider"
                  style={{ gridTemplateColumns: "100px 1fr 1fr 70px 70px 70px 60px" }}>
                  <span>Type</span>
                  <span>Chat</span>
                  <span>Input</span>
                  <span className="text-right">Tokens</span>
                  <span className="text-right">Cost</span>
                  <span className="text-right">Latency</span>
                  <span className="text-center">Status</span>
                </div>

                {toolEvents.map(ev => {
                  const ToolIcon = toolTypeIcon[ev.type] || Wrench;
                  return (
                    <div
                      key={ev.id}
                      className="grid items-center px-4 py-2.5 border-b border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] transition-colors"
                      style={{ gridTemplateColumns: "100px 1fr 1fr 70px 70px 70px 60px" }}
                    >
                      <span className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                        <ToolIcon size={12} />
                        {toolTypeLabel[ev.type] || ev.type}
                      </span>
                      <span className="text-[12px] text-[var(--text-secondary)] truncate">{cleanTitle(ev.chatTitle)}</span>
                      <span className="text-[12px] text-[var(--text-secondary)] truncate flex items-center gap-1.5">
                        {cleanTitle(ev.inputSummary)}
                        {ev.resultUrl && <ExternalLink size={10} className="text-[var(--accent)] shrink-0" />}
                      </span>
                      <span className="text-[12px] text-[var(--text-secondary)] text-right tabular-nums">{formatTokens(ev.tokens)}</span>
                      <span className="text-[12px] text-[var(--text-primary)] text-right tabular-nums font-medium">{formatCost(ev.cost)}</span>
                      <span className="text-[12px] text-[var(--text-secondary)] text-right tabular-nums">{formatLatency(ev.latencyMs)}</span>
                      <span className="flex items-center justify-center">
                        {ev.status === "ok" ? (
                          <CheckCircle2 size={13} className="text-[var(--success)]" />
                        ) : (
                          <XCircle size={13} className="text-[var(--error)]" />
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {!loading && activeTab === "errors" && (
          <div>
            {errorLogs.length === 0 ? (
              <EmptyState icon={AlertTriangle} message="No errors for this period" />
            ) : (
              <div className="rounded-xl border border-[var(--border)] overflow-hidden">
                <div className="grid items-center px-4 py-2.5 bg-[var(--bg-secondary)] border-b border-[var(--border)] text-[11px] font-semibold text-[var(--text-faint)] uppercase tracking-wider"
                  style={{ gridTemplateColumns: "130px 80px 1fr 120px 90px" }}>
                  <span>Time</span>
                  <span>Source</span>
                  <span>Message</span>
                  <span>Request ID</span>
                  <span></span>
                </div>

                {errorLogs.map(err => (
                  <div
                    key={err.id}
                    className="grid items-center px-4 py-2.5 border-b border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] transition-colors"
                    style={{ gridTemplateColumns: "130px 80px 1fr 120px 90px" }}
                  >
                    <span className="text-[11px] text-[var(--text-muted)]">{formatDate(err.timestamp)}</span>
                    <span className="text-[12px] text-[var(--text-secondary)]">{err.source}</span>
                    <span className="text-[12px] text-[var(--error)] truncate">{err.message}</span>
                    <span className="text-[11px] text-[var(--text-faint)] font-mono truncate">{err.requestId}</span>
                    <span>
                      {err.chatId && (
                        <button className="text-[11px] text-[var(--accent)] hover:underline flex items-center gap-1">
                          <ExternalLink size={10} />
                          Open chat
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, message }: { icon: typeof Activity; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-12 h-12 rounded-xl bg-[var(--bg-hover)] flex items-center justify-center mb-3">
        <Icon size={20} className="text-[var(--text-faint)]" />
      </div>
      <p className="text-[13px] text-[var(--text-muted)]">{message}</p>
    </div>
  );
}
