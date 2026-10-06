"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Plus,
  MoreHorizontal,
  Newspaper,
  Brain,
  TrendingUp,
  DollarSign,
  Mail,
  Calendar,
  Search,
  BookOpen,
  BarChart3,
  Bell,
  Zap,
  Target,
  Globe,
  FileText,
  Lightbulb,
  Heart,
  ChevronRight,
  ChevronLeft,
  X,
  Play,
  Pause,
  Trash2,
  Edit3,
  Eye,
  Copy,
  Check,
  AlertCircle,
  RefreshCw,
  Clock,
  Send,
} from "lucide-react";
import type {
  Automation,
  AutomationTemplate,
  AutomationRun,
} from "@/lib/automations";
import {
  TEMPLATE_CATEGORIES,
  CATEGORY_COLORS,
  formatRelativeTime,
  formatDuration,
} from "@/lib/automations";

// ---------------------------------------------------------------------------
// Icon helper
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, React.ComponentType<any>> = {
  Newspaper,
  Brain,
  TrendingUp,
  DollarSign,
  Mail,
  Calendar,
  Search,
  BookOpen,
  BarChart3,
  Bell,
  Zap,
  Target,
  Globe,
  FileText,
  Lightbulb,
  Heart,
};

function DynamicIcon({ name, ...props }: { name: string } & any) {
  const Icon = ICON_MAP[name] || Zap;
  return <Icon {...props} />;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AutomationsPageProps {
  onOpenModal: (
    automation?: Automation | null,
    template?: AutomationTemplate | null
  ) => void;
}

// ---------------------------------------------------------------------------
// Schedule label helper
// ---------------------------------------------------------------------------

function formatScheduleLabel(automation: Automation): string {
  const trigger = automation.triggers?.[0];
  if (!trigger) return "No schedule";
  const [h, m] = trigger.time.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const displayH = h % 12 || 12;
  const displayM = m.toString().padStart(2, "0");
  const timeStr = `${displayH}:${displayM} ${ampm}`;

  switch (trigger.type) {
    case "hourly":
      return "Every hour";
    case "daily":
      return `Daily at ${timeStr}`;
    case "weekdays":
      return `Weekdays at ${timeStr}`;
    case "weekly": {
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const days = (trigger.weekdays ?? [1]).map((d) => dayNames[d]).join(", ");
      return `Weekly ${days} at ${timeStr}`;
    }
    case "monthly":
      return `Monthly on the ${trigger.dayOfMonth ?? 1}${ordinal(trigger.dayOfMonth ?? 1)} at ${timeStr}`;
    case "cron":
      return trigger.cron ?? "Custom (cron)";
    default:
      return "Custom";
  }
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

// ---------------------------------------------------------------------------
// Simple markdown-to-html (very basic)
// ---------------------------------------------------------------------------

function simpleMarkdownToHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/\n/g, "<br />");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AutomationsPage({ onOpenModal }: AutomationsPageProps) {
  const [activeTab, setActiveTab] = useState<"automations" | "runs">(
    "automations"
  );

  // --- Data fetching state ---
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [templates, setTemplates] = useState<AutomationTemplate[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [loadingAutomations, setLoadingAutomations] = useState(true);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [loadingRuns, setLoadingRuns] = useState(true);

  // --- Template filter ---
  const [templateFilter, setTemplateFilter] = useState("All");

  // --- Runs tab state ---
  const [runsFilterAutomation, setRunsFilterAutomation] = useState("all");
  const [runsFilterStatus, setRunsFilterStatus] = useState("all");
  const [runsPage, setRunsPage] = useState(1);
  const RUNS_PER_PAGE = 20;

  // --- Run detail drawer ---
  const [selectedRun, setSelectedRun] = useState<AutomationRun | null>(null);

  // --- Confirm delete ---
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // --- Context menu ---
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; flipUp: boolean }>({ top: 0, left: 0, flipUp: false });

  // --- Failed error drawer ---
  const [errorDrawerAutomation, setErrorDrawerAutomation] = useState<Automation | null>(null);

  // --- Fetch automations ---
  useEffect(() => {
    setLoadingAutomations(true);
    fetch("/api/automations")
      .then((r) => r.json())
      .then((data) => setAutomations(data.automations ?? data ?? []))
      .catch(() => setAutomations([]))
      .finally(() => setLoadingAutomations(false));
  }, []);

  // --- Fetch templates ---
  useEffect(() => {
    setLoadingTemplates(true);
    fetch("/api/automation-templates")
      .then((r) => r.json())
      .then((data) => setTemplates(data.templates ?? data ?? []))
      .catch(() => setTemplates([]))
      .finally(() => setLoadingTemplates(false));
  }, []);

  // --- Fetch runs ---
  useEffect(() => {
    setLoadingRuns(true);
    fetch("/api/automation-runs")
      .then((r) => r.json())
      .then((data) => setRuns(data.runs ?? data ?? []))
      .catch(() => setRuns([]))
      .finally(() => setLoadingRuns(false));
  }, []);

  // --- Run history dot strip (last 30 days) ---
  const runDots = useMemo(() => {
    const dots: Array<"none" | "success" | "failed"> = [];
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const day = new Date(now);
      day.setDate(day.getDate() - i);
      const dayStr = day.toISOString().slice(0, 10);
      const dayRuns = runs.filter(
        (r) => r.startedAt && r.startedAt.slice(0, 10) === dayStr
      );
      if (dayRuns.length === 0) {
        dots.push("none");
      } else if (dayRuns.some((r) => r.status === "failed")) {
        dots.push("failed");
      } else {
        dots.push("success");
      }
    }
    return dots;
  }, [runs]);

  const totalRunsCount = runs.length;

  // --- Filtered templates ---
  const filteredTemplates = useMemo(() => {
    if (templateFilter === "All") return templates;
    return templates.filter((t) => t.category === templateFilter);
  }, [templates, templateFilter]);

  // --- Filtered runs for Runs tab ---
  const filteredRuns = useMemo(() => {
    let result = [...runs];
    if (runsFilterAutomation !== "all") {
      result = result.filter((r) => r.automationId === runsFilterAutomation);
    }
    if (runsFilterStatus !== "all") {
      result = result.filter((r) => r.status === runsFilterStatus);
    }
    result.sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
    return result;
  }, [runs, runsFilterAutomation, runsFilterStatus]);

  const totalRunPages = Math.max(1, Math.ceil(filteredRuns.length / RUNS_PER_PAGE));
  const pagedRuns = filteredRuns.slice(
    (runsPage - 1) * RUNS_PER_PAGE,
    runsPage * RUNS_PER_PAGE
  );

  // --- Actions ---
  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/automations/${id}`, { method: "DELETE" });
        setAutomations((prev) => prev.filter((a) => a.id !== id));
      } catch {
        // silent
      }
      setDeleteTarget(null);
      setMenuOpenId(null);
    },
    []
  );

  const handleTogglePause = useCallback(async (automation: Automation) => {
    const endpoint = automation.status === "active" ? "pause" : "resume";
    const newStatus: Automation["status"] = automation.status === "active" ? "paused" : "active";
    try {
      await fetch(`/api/automations/${automation.id}/${endpoint}`, {
        method: "POST",
      });
      setAutomations((prev) =>
        prev.map((a) => (a.id === automation.id ? { ...a, status: newStatus } : a))
      );
    } catch {
      // silent
    }
    setMenuOpenId(null);
  }, []);

  const handleRunNow = useCallback(async (id: string) => {
    try {
      await fetch(`/api/automations/${id}/run`, { method: "POST" });
    } catch {
      // silent
    }
    setMenuOpenId(null);
  }, []);

  const handleDuplicate = useCallback(async (automation: Automation) => {
    try {
      const body = {
        name: `${automation.name} (copy)`,
        icon: automation.icon,
        color: automation.color,
        instructions: automation.instructions,
        model: automation.model,
        skills: automation.skills,
        connectors: automation.connectors,
        attachments: automation.attachments,
        notification: automation.notification,
        notify_email: automation.notify_email,
        timezone: automation.timezone,
        triggers: automation.triggers.map((t) => ({
          type: t.type,
          time: t.time,
          weekdays: t.weekdays,
          dayOfMonth: t.dayOfMonth,
          cron: t.cron,
        })),
      };
      const res = await fetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.automation) {
        setAutomations((prev) => [...prev, data.automation]);
      }
    } catch {
      // silent
    }
    setMenuOpenId(null);
  }, []);

  const handleRetry = useCallback(async (automationId: string) => {
    try {
      await fetch(`/api/automations/${automationId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      setAutomations((prev) =>
        prev.map((a) => (a.id === automationId ? { ...a, status: "active" as const } : a))
      );
      await fetch(`/api/automations/${automationId}/run`, { method: "POST" });
    } catch {
      // silent
    }
    setErrorDrawerAutomation(null);
  }, []);

  // --- Automation name lookup for runs ---
  const automationNameMap = useMemo(() => {
    const map: Record<string, Automation> = {};
    automations.forEach((a) => {
      map[a.id] = a;
    });
    return map;
  }, [automations]);

  // --- Close menu on outside click ---
  useEffect(() => {
    if (!menuOpenId) return;
    const handler = () => setMenuOpenId(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [menuOpenId]);

  // ---------------------------------------------------------------------------
  // Status badge helper
  // ---------------------------------------------------------------------------
  function StatusBadge({ status }: { status: string }) {
    const map: Record<string, { bg: string; color: string; label: string }> = {
      active: {
        bg: "rgba(34,197,94,.12)",
        color: "var(--success)",
        label: "Active",
      },
      paused: {
        bg: "rgba(120,120,130,.12)",
        color: "var(--text-muted)",
        label: "Paused",
      },
      failed: {
        bg: "rgba(239,68,68,.12)",
        color: "var(--error)",
        label: "Failed",
      },
      success: {
        bg: "rgba(34,197,94,.12)",
        color: "var(--success)",
        label: "Success",
      },
      running: {
        bg: "var(--accent-subtle)",
        color: "var(--accent)",
        label: "Running",
      },
    };
    const s = map[status] ?? map.paused;
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          fontWeight: 500,
          color: s.color,
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            backgroundColor: s.color,
            flexShrink: 0,
          }}
        />
        {s.label}
      </span>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-6 pt-5 pb-3"
        style={{ flexShrink: 0 }}
      >
        {/* Segmented control */}
        <div
          style={{
            display: "inline-flex",
            height: 36,
            borderRadius: 9999,
            padding: 3,
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border)",
          }}
        >
          {(["automations", "runs"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                height: 30,
                padding: "0 18px",
                borderRadius: 9999,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                border: "none",
                background:
                  activeTab === tab ? "rgba(255,255,255,.08)" : "transparent",
                color:
                  activeTab === tab
                    ? "var(--text-primary)"
                    : "var(--text-muted)",
                transition: "all 200ms cubic-bezier(.2,.8,.2,1)",
              }}
            >
              {tab === "automations" ? "Automations" : "Runs"}
            </button>
          ))}
        </div>

        {/* New Automation button */}
        <button
          onClick={() => onOpenModal(null, null)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 40,
            padding: "0 20px",
            borderRadius: 9999,
            background: "var(--accent-gradient)",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            border: "none",
            cursor: "pointer",
            transition: "all 200ms cubic-bezier(.2,.8,.2,1)",
          }}
        >
          <Plus size={16} />
          New Automation
        </button>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {activeTab === "automations" ? (
          <AutomationsTabContent
            automations={automations}
            templates={filteredTemplates}
            runs={runs}
            runDots={runDots}
            totalRunsCount={totalRunsCount}
            loadingAutomations={loadingAutomations}
            loadingTemplates={loadingTemplates}
            loadingRuns={loadingRuns}
            templateFilter={templateFilter}
            onSetTemplateFilter={setTemplateFilter}
            onOpenModal={onOpenModal}
            onSwitchToRuns={() => setActiveTab("runs")}
            menuOpenId={menuOpenId}
            menuPos={menuPos}
            onSetMenuOpenId={setMenuOpenId}
            onSetMenuPos={setMenuPos}
            deleteTarget={deleteTarget}
            onSetDeleteTarget={setDeleteTarget}
            onDelete={handleDelete}
            onTogglePause={handleTogglePause}
            onRunNow={handleRunNow}
            onDuplicate={handleDuplicate}
            onOpenErrorDrawer={setErrorDrawerAutomation}
            onSetSelectedRun={setSelectedRun}
            StatusBadge={StatusBadge}
          />
        ) : (
          <RunsTabContent
            runs={pagedRuns}
            allRuns={filteredRuns}
            automations={automations}
            automationNameMap={automationNameMap}
            loadingRuns={loadingRuns}
            runsFilterAutomation={runsFilterAutomation}
            onSetRunsFilterAutomation={setRunsFilterAutomation}
            runsFilterStatus={runsFilterStatus}
            onSetRunsFilterStatus={setRunsFilterStatus}
            runsPage={runsPage}
            totalRunPages={totalRunPages}
            onSetRunsPage={setRunsPage}
            selectedRun={selectedRun}
            onSetSelectedRun={setSelectedRun}
            StatusBadge={StatusBadge}
          />
        )}
      </div>

      {/* Delete confirmation dialog */}
      {deleteTarget && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            background: "rgba(0,0,0,.45)",
          }}
          onClick={() => setDeleteTarget(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--popover-bg)",
              border: "1px solid var(--border)",
              borderRadius: 16,
              padding: 24,
              maxWidth: 380,
              width: "90%",
              boxShadow: "var(--popover-shadow)",
            }}
          >
            <h3
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: "var(--text-primary)",
                marginBottom: 8,
              }}
            >
              Delete Automation
            </h3>
            <p
              style={{
                fontSize: 13,
                color: "var(--text-secondary)",
                marginBottom: 20,
                lineHeight: 1.5,
              }}
            >
              Are you sure you want to delete this automation? This action
              cannot be undone.
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => setDeleteTarget(null)}
                style={{
                  padding: "8px 16px",
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 600,
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "var(--text-secondary)",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteTarget)}
                style={{
                  padding: "8px 16px",
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 600,
                  border: "none",
                  background: "var(--error)",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Failed error drawer */}
      {errorDrawerAutomation && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            justifyContent: "flex-end",
            zIndex: 1000,
            background: "rgba(0,0,0,.35)",
          }}
          onClick={() => setErrorDrawerAutomation(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 480,
              maxWidth: "90vw",
              height: "100%",
              background: "var(--popover-bg)",
              borderLeft: "1px solid var(--border)",
              boxShadow: "var(--popover-shadow)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "16px 20px",
                borderBottom: "1px solid var(--border)",
                flexShrink: 0,
              }}
            >
              <h3
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: "var(--error)",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <AlertCircle size={16} />
                Failed — {errorDrawerAutomation.name}
              </h3>
              <button
                onClick={() => setErrorDrawerAutomation(null)}
                style={{
                  padding: 4,
                  borderRadius: 8,
                  border: "none",
                  background: "transparent",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                }}
              >
                <X size={18} />
              </button>
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
              {(() => {
                const lastFailedRun = runs
                  .filter((r) => r.automationId === errorDrawerAutomation.id && r.status === "failed")
                  .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];
                return lastFailedRun ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <div
                      style={{
                        padding: 14,
                        borderRadius: 12,
                        background: "rgba(239,68,68,.08)",
                        border: "1px solid rgba(239,68,68,.2)",
                      }}
                    >
                      <p style={{ fontSize: 12, fontWeight: 600, color: "var(--error)", marginBottom: 6 }}>
                        Error Message
                      </p>
                      <pre
                        style={{
                          fontSize: 12,
                          color: "var(--text-secondary)",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          margin: 0,
                          fontFamily: "var(--font-geist-mono), monospace",
                          lineHeight: 1.6,
                        }}
                      >
                        {lastFailedRun.error || "Unknown error"}
                      </pre>
                    </div>
                    {lastFailedRun.email_error && (
                      <div
                        style={{
                          padding: 14,
                          borderRadius: 12,
                          background: "rgba(239,68,68,.08)",
                          border: "1px solid rgba(239,68,68,.2)",
                        }}
                      >
                        <p style={{ fontSize: 12, fontWeight: 600, color: "var(--error)", marginBottom: 6 }}>
                          Email Error
                        </p>
                        <pre
                          style={{
                            fontSize: 12,
                            color: "var(--text-secondary)",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            margin: 0,
                            fontFamily: "var(--font-geist-mono), monospace",
                            lineHeight: 1.6,
                          }}
                        >
                          {lastFailedRun.email_error}
                        </pre>
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8, fontSize: 12, color: "var(--text-muted)" }}>
                      <span>Run ID: {lastFailedRun.id}</span>
                      <span>·</span>
                      <span>{new Date(lastFailedRun.startedAt).toLocaleString()}</span>
                      {lastFailedRun.durationMs != null && (
                        <>
                          <span>·</span>
                          <span>{formatDuration(lastFailedRun.durationMs)}</span>
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <p style={{ fontSize: 13, color: "var(--text-muted)" }}>No failed run data available.</p>
                );
              })()}
            </div>
            <div
              style={{
                padding: "16px 20px",
                borderTop: "1px solid var(--border)",
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
                flexShrink: 0,
              }}
            >
              <button
                onClick={() => setErrorDrawerAutomation(null)}
                style={{
                  height: 36,
                  padding: "0 16px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "var(--text-secondary)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Close
              </button>
              <button
                onClick={() => handleRetry(errorDrawerAutomation.id)}
                style={{
                  height: 36,
                  padding: "0 18px",
                  borderRadius: 10,
                  border: "none",
                  background: "var(--accent-gradient)",
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <RefreshCw size={14} />
                Retry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Run detail drawer */}
      {selectedRun && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            justifyContent: "flex-end",
            zIndex: 1000,
            background: "rgba(0,0,0,.35)",
          }}
          onClick={() => setSelectedRun(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 480,
              maxWidth: "90vw",
              height: "100%",
              background: "var(--popover-bg)",
              borderLeft: "1px solid var(--border)",
              boxShadow: "var(--popover-shadow)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Drawer header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "16px 20px",
                borderBottom: "1px solid var(--border)",
                flexShrink: 0,
              }}
            >
              <h3
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: "var(--text-primary)",
                }}
              >
                Run Details
              </h3>
              <button
                onClick={() => setSelectedRun(null)}
                style={{
                  padding: 4,
                  borderRadius: 8,
                  border: "none",
                  background: "transparent",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Drawer meta */}
            <div
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 13,
                }}
              >
                <span style={{ color: "var(--text-muted)" }}>Status</span>
                <StatusBadge status={selectedRun.status} />
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 13,
                }}
              >
                <span style={{ color: "var(--text-muted)" }}>Started</span>
                <span style={{ color: "var(--text-secondary)" }}>
                  {new Date(selectedRun.startedAt).toLocaleString()}
                </span>
              </div>
              {selectedRun.durationMs != null && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 13,
                  }}
                >
                  <span style={{ color: "var(--text-muted)" }}>Duration</span>
                  <span style={{ color: "var(--text-secondary)" }}>
                    {formatDuration(selectedRun.durationMs)}
                  </span>
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 13,
                }}
              >
                <span style={{ color: "var(--text-muted)" }}>Triggered by</span>
                <span style={{ color: "var(--text-secondary)" }}>
                  {selectedRun.triggeredBy === "manual" ? "Manual" : "Schedule"}
                </span>
              </div>
            </div>

            {/* Drawer body */}
            <div
              style={{
                flex: 1,
                overflow: "auto",
                padding: 20,
              }}
            >
              {selectedRun.error && (
                <div
                  style={{
                    padding: 12,
                    borderRadius: 10,
                    background: "rgba(239,68,68,.08)",
                    border: "1px solid rgba(239,68,68,.2)",
                    marginBottom: 16,
                    fontSize: 13,
                    color: "var(--error)",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {selectedRun.error}
                </div>
              )}
              {selectedRun.output ? (
                <div
                  style={{
                    fontSize: 13,
                    lineHeight: 1.7,
                    color: "var(--text-secondary)",
                    whiteSpace: "pre-wrap",
                  }}
                  dangerouslySetInnerHTML={{
                    __html: simpleMarkdownToHtml(selectedRun.output),
                  }}
                />
              ) : (
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--text-faint)",
                    textAlign: "center",
                    paddingTop: 40,
                  }}
                >
                  No output available.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Automations Tab Content
// ===========================================================================

function AutomationsTabContent({
  automations,
  templates,
  runs,
  runDots,
  totalRunsCount,
  loadingAutomations,
  loadingTemplates,
  loadingRuns,
  templateFilter,
  onSetTemplateFilter,
  onOpenModal,
  onSwitchToRuns,
  menuOpenId,
  menuPos,
  onSetMenuOpenId,
  onSetMenuPos,
  deleteTarget,
  onSetDeleteTarget,
  onDelete,
  onTogglePause,
  onRunNow,
  onDuplicate,
  onOpenErrorDrawer,
  onSetSelectedRun,
  StatusBadge,
}: {
  automations: Automation[];
  templates: AutomationTemplate[];
  runs: AutomationRun[];
  runDots: Array<"none" | "success" | "failed">;
  totalRunsCount: number;
  loadingAutomations: boolean;
  loadingTemplates: boolean;
  loadingRuns: boolean;
  templateFilter: string;
  onSetTemplateFilter: (f: string) => void;
  onOpenModal: (
    automation?: Automation | null,
    template?: AutomationTemplate | null
  ) => void;
  onSwitchToRuns: () => void;
  menuOpenId: string | null;
  menuPos: { top: number; left: number; flipUp: boolean };
  onSetMenuOpenId: (id: string | null) => void;
  onSetMenuPos: (pos: { top: number; left: number; flipUp: boolean }) => void;
  deleteTarget: string | null;
  onSetDeleteTarget: (id: string | null) => void;
  onDelete: (id: string) => void;
  onTogglePause: (a: Automation) => void;
  onRunNow: (id: string) => void;
  onDuplicate: (a: Automation) => void;
  onOpenErrorDrawer: (a: Automation) => void;
  onSetSelectedRun: (r: AutomationRun | null) => void;
  StatusBadge: React.ComponentType<{ status: string }>;
}) {
  // Helper: get last run for an automation
  const lastRunMap = useMemo(() => {
    const map: Record<string, AutomationRun> = {};
    for (const r of runs) {
      if (!map[r.automationId] || new Date(r.startedAt) > new Date(map[r.automationId].startedAt)) {
        map[r.automationId] = r;
      }
    }
    return map;
  }, [runs]);

  // Open the menu with portal positioning
  const handleOpenMenu = useCallback(
    (e: React.MouseEvent, automationId: string) => {
      e.stopPropagation();
      if (menuOpenId === automationId) {
        onSetMenuOpenId(null);
        return;
      }
      const btn = e.currentTarget as HTMLElement;
      const rect = btn.getBoundingClientRect();
      const menuH = 280; // approximate menu height
      const flipUp = rect.bottom + menuH > window.innerHeight;
      onSetMenuPos({
        top: flipUp ? rect.top : rect.bottom + 4,
        left: rect.right - 200,
        flipUp,
      });
      onSetMenuOpenId(automationId);
    },
    [menuOpenId, onSetMenuOpenId, onSetMenuPos]
  );

  // Find the automation for the open menu
  const menuAutomation = menuOpenId ? automations.find((a) => a.id === menuOpenId) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Run History Card */}
      <div
        style={{
          background: "var(--bg-secondary)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          padding: "18px 20px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
          }}
        >
          <div>
            <h3
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: "var(--text-primary)",
                margin: 0,
              }}
            >
              Run history
            </h3>
            <p
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                margin: "2px 0 0",
              }}
            >
              Last 30 days
            </p>
          </div>
          <button
            onClick={onSwitchToRuns}
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: "var(--accent)",
              background: "none",
              border: "none",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
            }}
          >
            {totalRunsCount} run{totalRunsCount !== 1 ? "s" : ""}{" "}
            <ChevronRight size={14} />
          </button>
        </div>

        {/* Dot strip */}
        <div
          style={{
            display: "flex",
            gap: 4,
            alignItems: "center",
          }}
        >
          {runDots.map((dot, i) => (
            <div
              key={i}
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                flexShrink: 0,
                background:
                  dot === "success"
                    ? "var(--accent)"
                    : dot === "failed"
                      ? "var(--error)"
                      : "var(--border)",
                transition: "background 200ms",
              }}
              title={
                dot === "none"
                  ? "No runs"
                  : dot === "success"
                    ? "Success"
                    : "Failed"
              }
            />
          ))}
        </div>
      </div>

      {/* My Automations Table */}
      {automations.length > 0 && (
        <div>
          <h3
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "var(--text-primary)",
              marginBottom: 12,
            }}
          >
            My Automations
          </h3>
          <div
            style={{
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              borderRadius: 16,
              overflow: "visible",
            }}
          >
            {/* Header — 6 columns: Automation · Schedule · Last run · Next run · Delivery · Status · menu */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 150px 120px 100px 160px 90px 42px",
                padding: "10px 16px",
                fontSize: 11,
                fontWeight: 600,
                color: "var(--text-faint)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <span>Automation</span>
              <span>Schedule</span>
              <span>Last run</span>
              <span>Next run</span>
              <span>Delivery</span>
              <span>Status</span>
              <span />
            </div>

            {/* Rows */}
            {automations.map((a) => {
              const lastRun = lastRunMap[a.id];
              const nextRunDisplay =
                a.status === "paused" || a.status === "failed"
                  ? "—"
                  : a.nextRunAt
                    ? formatRelativeTime(a.nextRunAt)
                    : "—";

              // Delivery display
              const emailTrunc = a.notify_email
                ? a.notify_email.length > 18
                  ? a.notify_email.slice(0, 15) + "…"
                  : a.notify_email
                : "—";
              const emailStatus = lastRun?.email_status;
              const emailSentTime = lastRun?.email_sent_at
                ? new Date(lastRun.email_sent_at).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : null;

              return (
                <div
                  key={a.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 150px 120px 100px 160px 90px 42px",
                    alignItems: "center",
                    padding: "0 16px",
                    height: 56,
                    borderBottom: "1px solid var(--border-subtle)",
                    transition: "background 150ms",
                  }}
                  className="hover:bg-[var(--sidebar-hover)]"
                >
                  {/* Automation name */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: a.color || "var(--accent)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <DynamicIcon name={a.icon} size={16} color="#fff" />
                    </div>
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 500,
                        color: "var(--text-primary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {a.name}
                    </span>
                  </div>

                  {/* Schedule */}
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--text-secondary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {formatScheduleLabel(a)}
                  </span>

                  {/* Last run — relative time + result dot */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      cursor: lastRun ? "pointer" : "default",
                    }}
                    onClick={() => lastRun && onSetSelectedRun(lastRun)}
                    title={lastRun ? "Click to view run details" : undefined}
                  >
                    {lastRun ? (
                      <>
                        <span
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: "50%",
                            background:
                              lastRun.status === "success"
                                ? "var(--success)"
                                : lastRun.status === "failed"
                                  ? "var(--error)"
                                  : "var(--accent)",
                            flexShrink: 0,
                          }}
                        />
                        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                          {formatRelativeTime(lastRun.startedAt)}
                        </span>
                      </>
                    ) : (
                      <span style={{ fontSize: 12, color: "var(--text-faint)" }}>—</span>
                    )}
                  </div>

                  {/* Next run */}
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--text-muted)",
                    }}
                  >
                    {nextRunDisplay}
                  </span>

                  {/* Delivery — email (truncated) + icon state */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      minWidth: 0,
                    }}
                    title={
                      lastRun?.email_error
                        ? `Error: ${lastRun.email_error}`
                        : lastRun?.email_provider_id
                          ? `Provider ID: ${lastRun.email_provider_id}`
                          : a.notify_email || ""
                    }
                  >
                    <span
                      style={{
                        fontSize: 11,
                        color: "var(--text-muted)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: 90,
                      }}
                    >
                      {emailTrunc}
                    </span>
                    {emailStatus === "sent" && (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 3,
                          fontSize: 10,
                          color: "var(--success)",
                          fontWeight: 500,
                          whiteSpace: "nowrap",
                        }}
                      >
                        <Check size={10} />
                        {emailSentTime}
                      </span>
                    )}
                    {emailStatus === "sending" && (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 3,
                          fontSize: 10,
                          color: "var(--accent)",
                          fontWeight: 500,
                        }}
                      >
                        <RefreshCw size={10} className="animate-spin" />
                      </span>
                    )}
                    {emailStatus === "failed" && (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 3,
                          fontSize: 10,
                          color: "var(--error)",
                          fontWeight: 500,
                        }}
                      >
                        <X size={10} />
                        Failed
                      </span>
                    )}
                  </div>

                  {/* Status — clickable if failed */}
                  {a.status === "failed" ? (
                    <button
                      onClick={() => onOpenErrorDrawer(a)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 12,
                        fontWeight: 500,
                        color: "var(--error)",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: 0,
                        textDecoration: "underline",
                        textDecorationStyle: "dotted" as const,
                        textUnderlineOffset: 2,
                      }}
                    >
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          backgroundColor: "var(--error)",
                          flexShrink: 0,
                        }}
                      />
                      Failed
                    </button>
                  ) : (
                    <StatusBadge status={a.status} />
                  )}

                  {/* Menu button */}
                  <button
                    onClick={(e) => handleOpenMenu(e, a.id)}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      border: "none",
                      background: menuOpenId === a.id ? "var(--bg-hover)" : "transparent",
                      color: "var(--text-muted)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                    className="hover:bg-[var(--bg-hover)]"
                  >
                    <MoreHorizontal size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Portal-rendered action menu */}
      {menuOpenId && menuAutomation && typeof document !== "undefined" &&
        createPortal(
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 9999,
            }}
            onClick={() => onSetMenuOpenId(null)}
          >
            <div
              style={{
                position: "fixed",
                top: menuPos.flipUp ? undefined : menuPos.top,
                bottom: menuPos.flipUp ? window.innerHeight - menuPos.top + 4 : undefined,
                left: menuPos.left,
                width: 200,
                background: "var(--popover-bg)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                boxShadow: "var(--popover-shadow)",
                padding: 4,
                overflow: "hidden",
                animation: "scaleIn 0.12s cubic-bezier(.2,.8,.2,1) forwards",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => onRunNow(menuAutomation.id)}
                style={menuItemStyle}
              >
                <Play size={14} />
                Run now
              </button>
              <button
                onClick={() => {
                  onOpenModal(menuAutomation, null);
                  onSetMenuOpenId(null);
                }}
                style={menuItemStyle}
              >
                <Edit3 size={14} />
                Edit
              </button>
              <button
                onClick={() => onTogglePause(menuAutomation)}
                style={menuItemStyle}
              >
                {menuAutomation.status === "active" ? (
                  <Pause size={14} />
                ) : (
                  <Play size={14} />
                )}
                {menuAutomation.status === "active" ? "Pause" : "Resume"}
              </button>
              <button
                onClick={() => onSwitchToRuns()}
                style={menuItemStyle}
              >
                <Eye size={14} />
                View runs
              </button>
              <button
                onClick={() => onDuplicate(menuAutomation)}
                style={menuItemStyle}
              >
                <Copy size={14} />
                Duplicate
              </button>
              <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
              <button
                onClick={() => {
                  onSetDeleteTarget(menuAutomation.id);
                  onSetMenuOpenId(null);
                }}
                style={{
                  ...menuItemStyle,
                  color: "var(--error)",
                }}
              >
                <Trash2 size={14} />
                Delete
              </button>
            </div>
          </div>,
          document.body
        )
      }

      {/* Templates Section */}
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 14,
            flexWrap: "wrap",
          }}
        >
          <h3
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "var(--text-primary)",
              margin: 0,
            }}
          >
            Templates
          </h3>
          <div
            style={{
              display: "flex",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            {TEMPLATE_CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => onSetTemplateFilter(cat)}
                style={{
                  height: 30,
                  padding: "0 14px",
                  borderRadius: 9999,
                  fontSize: 12,
                  fontWeight: 600,
                  border: "1px solid",
                  borderColor:
                    templateFilter === cat
                      ? "var(--accent-border)"
                      : "var(--border)",
                  background:
                    templateFilter === cat
                      ? "var(--accent-subtle)"
                      : "transparent",
                  color:
                    templateFilter === cat
                      ? "var(--accent)"
                      : "var(--text-muted)",
                  cursor: "pointer",
                  transition: "all 200ms cubic-bezier(.2,.8,.2,1)",
                }}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Template grid — auto-fill with minmax */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
            gap: 10,
          }}
        >
          {templates.map((t: AutomationTemplate) => (
            <div
              key={t.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: "12px 14px",
                borderRadius: 14,
                border: "1px solid var(--border)",
                background: "var(--bg-secondary)",
                transition: "all 200ms cubic-bezier(.2,.8,.2,1)",
                minWidth: 0,
              }}
              className="hover:border-[var(--accent-border)]"
            >
              {/* Icon */}
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: t.color || "var(--accent)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <DynamicIcon name={t.icon} size={18} color="#fff" />
              </div>

              {/* Text */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    margin: 0,
                    lineHeight: 1.3,
                  }}
                >
                  {t.name}
                </p>
                <p
                  style={{
                    fontSize: 12,
                    color: "var(--text-muted)",
                    margin: "2px 0 0",
                    overflow: "hidden",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical" as const,
                    lineHeight: 1.4,
                  }}
                >
                  {t.description}
                </p>
              </div>

              {/* Add button */}
              <button
                onClick={() => onOpenModal(null, t)}
                style={{
                  height: 30,
                  padding: "0 14px",
                  borderRadius: 9999,
                  fontSize: 12,
                  fontWeight: 600,
                  border: "1px solid var(--accent-border)",
                  background: "var(--accent-subtle)",
                  color: "var(--accent)",
                  cursor: "pointer",
                  flexShrink: 0,
                  transition: "all 200ms cubic-bezier(.2,.8,.2,1)",
                  marginTop: 5,
                }}
              >
                Add
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Runs Tab Content
// ===========================================================================

function RunsTabContent({
  runs,
  allRuns,
  automations,
  automationNameMap,
  loadingRuns,
  runsFilterAutomation,
  onSetRunsFilterAutomation,
  runsFilterStatus,
  onSetRunsFilterStatus,
  runsPage,
  totalRunPages,
  onSetRunsPage,
  selectedRun,
  onSetSelectedRun,
  StatusBadge,
}: {
  runs: AutomationRun[];
  allRuns: AutomationRun[];
  automations: Automation[];
  automationNameMap: Record<string, Automation>;
  loadingRuns: boolean;
  runsFilterAutomation: string;
  onSetRunsFilterAutomation: (v: string) => void;
  runsFilterStatus: string;
  onSetRunsFilterStatus: (v: string) => void;
  runsPage: number;
  totalRunPages: number;
  onSetRunsPage: (n: number) => void;
  selectedRun: AutomationRun | null;
  onSetSelectedRun: (r: AutomationRun | null) => void;
  StatusBadge: React.ComponentType<{ status: string }>;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Filters */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <select
          value={runsFilterAutomation}
          onChange={(e) => {
            onSetRunsFilterAutomation(e.target.value);
            onSetRunsPage(1);
          }}
          style={selectStyle}
        >
          <option value="all">All automations</option>
          {automations.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        <select
          value={runsFilterStatus}
          onChange={(e) => {
            onSetRunsFilterStatus(e.target.value);
            onSetRunsPage(1);
          }}
          style={selectStyle}
        >
          <option value="all">All statuses</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          <option value="running">Running</option>
        </select>
      </div>

      {/* Table */}
      {runs.length === 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "64px 20px",
          }}
        >
          <Zap
            size={36}
            style={{ color: "var(--text-faint)", marginBottom: 12 }}
          />
          <p
            style={{
              fontSize: 14,
              color: "var(--text-muted)",
              textAlign: "center",
            }}
          >
            No runs yet — your automations will appear here once they run.
          </p>
        </div>
      ) : (
        <div
          style={{
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            borderRadius: 16,
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 160px 100px 100px 64px",
              padding: "10px 16px",
              fontSize: 11,
              fontWeight: 600,
              color: "var(--text-faint)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <span>Automation</span>
            <span>Started</span>
            <span>Duration</span>
            <span>Status</span>
            <span />
          </div>

          {/* Rows */}
          {runs.map((r) => {
            const auto = automationNameMap[r.automationId];
            return (
              <div
                key={r.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 160px 100px 100px 64px",
                  alignItems: "center",
                  padding: "0 16px",
                  height: 52,
                  borderBottom: "1px solid var(--border-subtle)",
                  transition: "background 150ms",
                }}
                className="hover:bg-[var(--sidebar-hover)]"
              >
                {/* Automation name */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    minWidth: 0,
                  }}
                >
                  {auto ? (
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 7,
                        background: auto.color || "var(--accent)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <DynamicIcon name={auto.icon} size={14} color="#fff" />
                    </div>
                  ) : (
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 7,
                        background: "var(--bg-tertiary)",
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: "var(--text-primary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {auto?.name ?? r.automationId}
                  </span>
                </div>

                {/* Started */}
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {new Date(r.startedAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>

                {/* Duration */}
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {r.durationMs != null ? formatDuration(r.durationMs) : "—"}
                </span>

                {/* Status */}
                <StatusBadge status={r.status} />

                {/* View */}
                <button
                  onClick={() => onSetSelectedRun(r)}
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--accent)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <Eye size={13} />
                  View
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalRunPages > 1 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            paddingTop: 4,
          }}
        >
          <button
            onClick={() => onSetRunsPage(Math.max(1, runsPage - 1))}
            disabled={runsPage === 1}
            style={{
              ...paginationBtnStyle,
              opacity: runsPage === 1 ? 0.4 : 1,
              cursor: runsPage === 1 ? "default" : "pointer",
            }}
          >
            <ChevronLeft size={16} />
          </button>
          <span
            style={{
              fontSize: 13,
              color: "var(--text-muted)",
              minWidth: 80,
              textAlign: "center",
            }}
          >
            Page {runsPage} of {totalRunPages}
          </span>
          <button
            onClick={() =>
              onSetRunsPage(Math.min(totalRunPages, runsPage + 1))
            }
            disabled={runsPage === totalRunPages}
            style={{
              ...paginationBtnStyle,
              opacity: runsPage === totalRunPages ? 0.4 : 1,
              cursor: runsPage === totalRunPages ? "default" : "pointer",
            }}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Shared inline styles
// ===========================================================================

const menuItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  padding: "8px 12px",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 500,
  color: "var(--text-secondary)",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  textAlign: "left" as const,
  transition: "background 150ms",
};

const selectStyle: React.CSSProperties = {
  height: 36,
  padding: "0 12px",
  paddingRight: 32,
  borderRadius: 10,
  fontSize: 13,
  border: "1px solid var(--border)",
  background: "var(--bg-secondary)",
  color: "var(--text-secondary)",
  cursor: "pointer",
  appearance: "auto" as any,
};

const paginationBtnStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg-secondary)",
  color: "var(--text-secondary)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
