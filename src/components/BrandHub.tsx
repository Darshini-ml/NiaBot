"use client";

import { useState, useEffect, useRef } from "react";
import { X, MessageSquare, FileText, FolderOpen, Activity } from "lucide-react";

export type SystemState =
  | "ready"
  | "thinking"
  | "searching"
  | "reading"
  | "browsing"
  | "creating"
  | "analyzing"
  | "waiting"
  | "success"
  | "error";

interface BrandHubProps {
  state?: SystemState;
  contextLabel?: string;
  contextSubtitle?: string;
  conversationCount?: number;
  activeProjectName?: string;
  collapsed?: boolean;
  onNavigateHome?: () => void;
}

const STATE_CONFIG: Record<
  SystemState,
  { label: string; color: string; glowColor: string; animClass: string }
> = {
  ready: {
    label: "Ready",
    color: "#A18FF9",
    glowColor: "rgba(161, 143, 249, 0.4)",
    animClass: "brand-state-ready",
  },
  thinking: {
    label: "Thinking",
    color: "#8476EB",
    glowColor: "rgba(132, 118, 235, 0.5)",
    animClass: "brand-state-thinking",
  },
  searching: {
    label: "Searching",
    color: "#08BFD8",
    glowColor: "rgba(8, 191, 216, 0.4)",
    animClass: "brand-state-searching",
  },
  reading: {
    label: "Reading sources",
    color: "#78BDF4",
    glowColor: "rgba(120, 189, 244, 0.4)",
    animClass: "brand-state-reading",
  },
  browsing: {
    label: "Browsing",
    color: "#5A9CF5",
    glowColor: "rgba(90, 156, 245, 0.4)",
    animClass: "brand-state-browsing",
  },
  creating: {
    label: "Creating",
    color: "#E879A8",
    glowColor: "rgba(232, 121, 168, 0.4)",
    animClass: "brand-state-creating",
  },
  analyzing: {
    label: "Analyzing",
    color: "#9383F5",
    glowColor: "rgba(147, 131, 245, 0.4)",
    animClass: "brand-state-analyzing",
  },
  waiting: {
    label: "Waiting",
    color: "#A09CAE",
    glowColor: "rgba(160, 156, 174, 0.3)",
    animClass: "brand-state-waiting",
  },
  success: {
    label: "Complete",
    color: "#00C6A7",
    glowColor: "rgba(0, 198, 167, 0.4)",
    animClass: "brand-state-success",
  },
  error: {
    label: "Error",
    color: "#FF5368",
    glowColor: "rgba(255, 83, 104, 0.4)",
    animClass: "brand-state-error",
  },
};

/* ─── Intelligence Mark SVG ─── */
function IntelligenceMark({
  size = 40,
  state,
}: {
  size?: number;
  state: SystemState;
}) {
  const config = STATE_CONFIG[state];
  return (
    <div className={`intelligence-mark ${config.animClass}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Outer glow ring */}
        <circle
          cx="24"
          cy="24"
          r="22"
          stroke={config.color}
          strokeWidth="0.5"
          opacity="0.2"
          className="mark-outer-ring"
        />

        {/* Orbital paths */}
        <ellipse
          cx="24"
          cy="24"
          rx="16"
          ry="8"
          stroke={config.color}
          strokeWidth="0.6"
          opacity="0.15"
          transform="rotate(-30 24 24)"
          className="mark-orbit-1"
        />
        <ellipse
          cx="24"
          cy="24"
          rx="16"
          ry="8"
          stroke={config.color}
          strokeWidth="0.6"
          opacity="0.15"
          transform="rotate(30 24 24)"
          className="mark-orbit-2"
        />

        {/* Network connections */}
        <line x1="24" y1="12" x2="14" y2="28" stroke={config.color} strokeWidth="0.7" opacity="0.25" />
        <line x1="24" y1="12" x2="34" y2="28" stroke={config.color} strokeWidth="0.7" opacity="0.25" />
        <line x1="14" y1="28" x2="34" y2="28" stroke={config.color} strokeWidth="0.7" opacity="0.25" />
        <line x1="24" y1="12" x2="24" y2="36" stroke={config.color} strokeWidth="0.5" opacity="0.15" />

        {/* Central intelligence point */}
        <circle cx="24" cy="22" r="4" fill={config.color} opacity="0.9" className="mark-core" />
        <circle cx="24" cy="22" r="2" fill="white" opacity="0.9" />

        {/* Satellite nodes */}
        <circle cx="24" cy="12" r="2.5" fill={config.color} opacity="0.7" className="mark-node-top" />
        <circle cx="14" cy="28" r="2" fill={config.color} opacity="0.5" className="mark-node-left" />
        <circle cx="34" cy="28" r="2" fill={config.color} opacity="0.5" className="mark-node-right" />
        <circle cx="24" cy="36" r="1.5" fill={config.color} opacity="0.3" className="mark-node-bottom" />

        {/* Tiny accent dots on orbits */}
        <circle cx="10" cy="20" r="1" fill={config.color} opacity="0.3" className="mark-dot-1" />
        <circle cx="38" cy="20" r="1" fill={config.color} opacity="0.3" className="mark-dot-2" />
      </svg>
    </div>
  );
}

/* ─── System Panel Popover ─── */
function SystemPanel({
  state,
  conversationCount,
  activeProjectName,
  onClose,
}: {
  state: SystemState;
  conversationCount: number;
  activeProjectName?: string;
  onClose: () => void;
}) {
  const config = STATE_CONFIG[state];
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      className="absolute left-3 right-3 top-full mt-2 z-50 rounded-xl border border-[var(--border-card)] bg-[var(--bg-elevated)] shadow-lg animate-scale-in overflow-hidden"
    >
      {/* Header gradient bar */}
      <div
        className="h-[2px] w-full"
        style={{
          background: `linear-gradient(90deg, transparent, ${config.color}, transparent)`,
        }}
      />

      <div className="p-4">
        {/* Identity */}
        <div className="flex items-center gap-3 mb-4">
          <IntelligenceMark size={32} state={state} />
          <div>
            <div className="text-[14px] font-semibold text-[var(--text-primary)]">
              NiaAI
            </div>
            <div className="text-[11px] text-[var(--text-muted)]">
              Intelligence OS
            </div>
          </div>
          <button
            onClick={onClose}
            className="ml-auto p-1 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-faint)] transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Status */}
        <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-[var(--bg-tertiary)]">
          <span
            className="w-[6px] h-[6px] rounded-full"
            style={{ backgroundColor: config.color, boxShadow: `0 0 6px ${config.glowColor}` }}
          />
          <span className="text-[12px] font-medium" style={{ color: config.color }}>
            {config.label}
          </span>
        </div>

        {/* Session stats */}
        <div className="space-y-2.5 mb-4">
          <div className="text-[10px] font-semibold text-[var(--text-faint)] uppercase tracking-wider">
            Current Session
          </div>
          <div className="flex items-center gap-2.5 text-[12px] text-[var(--text-secondary)]">
            <MessageSquare size={13} className="text-[var(--text-faint)]" />
            <span>{conversationCount} conversation{conversationCount !== 1 ? "s" : ""}</span>
          </div>
          {activeProjectName && (
            <div className="flex items-center gap-2.5 text-[12px] text-[var(--text-secondary)]">
              <FolderOpen size={13} className="text-[var(--text-faint)]" />
              <span>{activeProjectName}</span>
            </div>
          )}
        </div>

        {/* Model */}
        <div className="space-y-1.5 mb-3">
          <div className="text-[10px] font-semibold text-[var(--text-faint)] uppercase tracking-wider">
            Model
          </div>
          <div className="text-[12px] text-[var(--text-secondary)]">Nia A-1.0</div>
        </div>

        {/* Activity button */}
        <button className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-[var(--border)] text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors">
          <Activity size={13} />
          View activity
        </button>
      </div>
    </div>
  );
}

/* ─── Main BrandHub Component ─── */
export default function BrandHub({
  state = "ready",
  contextLabel,
  contextSubtitle,
  conversationCount = 0,
  activeProjectName,
  collapsed = false,
  onNavigateHome,
}: BrandHubProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const config = STATE_CONFIG[state];

  const displayContext = contextLabel || "Intelligence OS";
  const displaySubtitle = contextSubtitle;

  if (collapsed) {
    return (
      <div className="flex flex-col items-center pt-4 pb-2">
        <button
          onClick={onNavigateHome}
          className="relative group"
          title="NiaAI - Intelligence OS"
        >
          <IntelligenceMark size={36} state={state} />
          {/* Status dot */}
          <span
            className="absolute -bottom-0.5 -right-0.5 w-[7px] h-[7px] rounded-full border border-[var(--sidebar-bg)]"
            style={{ backgroundColor: config.color, boxShadow: `0 0 4px ${config.glowColor}` }}
          />
        </button>
      </div>
    );
  }

  return (
    <div className="relative px-3 pt-4 pb-2">
      {/* Clickable brand area */}
      <button
        onClick={() => setPanelOpen(!panelOpen)}
        className="w-full flex flex-col items-center gap-1.5 py-3 rounded-xl hover:bg-[var(--sidebar-hover)] transition-all duration-300 group"
      >
        {/* Intelligence Mark */}
        <div className="relative">
          <IntelligenceMark size={44} state={state} />
          {/* Ambient glow behind mark */}
          <div
            className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500 -z-10 blur-xl"
            style={{ background: config.glowColor }}
          />
        </div>

        {/* Wordmark */}
        <div className="text-[16px] font-semibold text-gradient leading-tight mt-1">
          NiaAI
        </div>

        {/* Context label */}
        <div className="text-[11px] text-[var(--text-muted)] leading-tight">
          {displayContext}
        </div>
        {displaySubtitle && (
          <div className="text-[10px] text-[var(--text-faint)] leading-tight">
            {displaySubtitle}
          </div>
        )}

        {/* Dynamic status */}
        <div className="flex items-center gap-1.5 mt-0.5">
          <span
            className="w-[5px] h-[5px] rounded-full brand-status-dot"
            style={{
              backgroundColor: config.color,
              boxShadow: `0 0 6px ${config.glowColor}`,
            }}
          />
          <span
            className="text-[11px] font-medium tracking-wide"
            style={{ color: config.color }}
          >
            {config.label}
          </span>
        </div>
      </button>

      {/* Divider with glow accent */}
      <div className="mx-2 mt-2 relative">
        <div className="border-t border-[var(--border)]" />
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-12 h-[1px]"
          style={{
            background: `linear-gradient(90deg, transparent, ${config.color}40, transparent)`,
          }}
        />
      </div>

      {/* System Panel */}
      {panelOpen && (
        <SystemPanel
          state={state}
          conversationCount={conversationCount}
          activeProjectName={activeProjectName}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </div>
  );
}
