"use client";

import { useState, useRef, useEffect } from "react";
import {
  FolderClosed,
  Plus,
  X,
  Search,
  ChevronDown,
  MoreHorizontal,
  ExternalLink,
  Pencil,
  Image as ImageIcon,
  Settings,
  Trash2,
} from "lucide-react";

export type ProjectPreviewKind = "slides" | "image" | "code" | "plan" | "chat" | "empty";

export interface Project {
  id: string;
  name: string;
  icon?: string;
  memoryMode: string;
  instructions?: string;
  createdAt: string;
  coverImage?: string;
  category?: string;
  preview_kind?: ProjectPreviewKind;
  last_artifact_title?: string;
  chat_count?: number;
  updated_at?: string;
}

interface ProjectsViewProps {
  projects: Project[];
  onCreateProject: (project: Omit<Project, "id" | "createdAt">) => void;
  onOpenProject: (projectId: string) => void;
  onDeleteProject?: (projectId: string) => void;
  onRenameProject?: (projectId: string, newName: string) => void;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "0 chats";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Deterministic hash from string
export function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

// Detect project category from name
export function detectCategory(name: string): string {
  const lower = name.toLowerCase();
  if (/security|phishing|hack|cyber|attack|defense|threat|malware|firewall/.test(lower)) return "security";
  if (/market|campaign|brand|seo|advertis|social media|growth/.test(lower)) return "marketing";
  if (/data|analy|chart|dashboard|report|metric|statistic|insight/.test(lower)) return "analytics";
  if (/travel|trip|flight|hotel|destination|vacation|itinerary/.test(lower)) return "travel";
  if (/code|develop|program|api|app|software|web|frontend|backend|react|python/.test(lower)) return "code";
  if (/design|ui|ux|figma|sketch|prototype|wireframe|layout/.test(lower)) return "design";
  if (/image|photo|video|media|creative|art|illustration/.test(lower)) return "creative";
  if (/doc|write|essay|blog|article|content|story|book/.test(lower)) return "writing";
  if (/research|study|paper|experiment|thesis|academic/.test(lower)) return "research";
  if (/finance|budget|invest|money|revenue|profit|cost/.test(lower)) return "finance";
  if (/learn|course|tutorial|education|training|lesson/.test(lower)) return "education";
  if (/plan|strategy|roadmap|goal|objective|project/.test(lower)) return "planning";
  return "general";
}

// Category-specific color palettes
export const CATEGORY_PALETTES: Record<string, { primary: string; secondary: string; accent: string; bg: string }> = {
  security: { primary: "#00D4AA", secondary: "#0A2F23", accent: "#00FFD0", bg: "#0B1A14" },
  marketing: { primary: "#FF6B6B", secondary: "#2D1A1A", accent: "#FF9B9B", bg: "#1A0F0F" },
  analytics: { primary: "#4ECDC4", secondary: "#1A2D2B", accent: "#7EEEE4", bg: "#0F1A19" },
  travel: { primary: "#F7B731", secondary: "#2D2510", accent: "#FFD866", bg: "#1A170A" },
  code: { primary: "#A78BFA", secondary: "#1E1A2E", accent: "#C4B5FD", bg: "#13101F" },
  design: { primary: "#F472B6", secondary: "#2D1A26", accent: "#F9A8D4", bg: "#1A0F17" },
  creative: { primary: "#FB923C", secondary: "#2D1F10", accent: "#FDBA74", bg: "#1A130A" },
  writing: { primary: "#94A3B8", secondary: "#1E2028", accent: "#CBD5E1", bg: "#12141A" },
  research: { primary: "#60A5FA", secondary: "#1A2235", accent: "#93C5FD", bg: "#0F1525" },
  finance: { primary: "#34D399", secondary: "#1A2D23", accent: "#6EE7B7", bg: "#0F1A15" },
  education: { primary: "#FBBF24", secondary: "#2D2510", accent: "#FDE68A", bg: "#1A170A" },
  planning: { primary: "#818CF8", secondary: "#1E1A30", accent: "#A5B4FC", bg: "#131020" },
  general: { primary: "#8476EB", secondary: "#1E1A30", accent: "#A18FF9", bg: "#15151F" },
};

// Generate deterministic SVG cover based on project name and category
export function ProjectCover({ name, category: catOverride }: { name: string; category?: string }) {
  const category = catOverride || detectCategory(name);
  const palette = CATEGORY_PALETTES[category] || CATEGORY_PALETTES.general;
  const hash = hashString(name);

  // Generate deterministic pattern elements
  const elements: React.ReactNode[] = [];

  if (category === "security") {
    // Shield/network pattern
    elements.push(
      <g key="sec" opacity="0.6">
        {/* Grid lines */}
        {Array.from({ length: 6 }, (_, i) => (
          <line key={`h${i}`} x1="0" y1={30 + i * 25} x2="300" y2={30 + i * 25} stroke={palette.primary} strokeWidth="0.5" opacity="0.15" />
        ))}
        {Array.from({ length: 8 }, (_, i) => (
          <line key={`v${i}`} x1={20 + i * 35} y1="0" x2={20 + i * 35} y2="180" stroke={palette.primary} strokeWidth="0.5" opacity="0.15" />
        ))}
        {/* Shield */}
        <path d="M150 35 L185 50 L185 85 Q185 110 150 125 Q115 110 115 85 L115 50 Z" fill="none" stroke={palette.primary} strokeWidth="1.5" opacity="0.5" />
        <path d="M150 50 L170 60 L170 82 Q170 100 150 110 Q130 100 130 82 L130 60 Z" fill={palette.primary} opacity="0.08" />
        {/* Lock icon */}
        <rect x="142" y="72" width="16" height="14" rx="2" fill="none" stroke={palette.accent} strokeWidth="1.2" opacity="0.6" />
        <path d="M145 72 L145 66 Q145 60 150 60 Q155 60 155 66 L155 72" fill="none" stroke={palette.accent} strokeWidth="1.2" opacity="0.6" />
        {/* Data nodes */}
        {[{ x: 60, y: 45 }, { x: 240, y: 55 }, { x: 80, y: 120 }, { x: 220, y: 115 }, { x: 40, y: 85 }, { x: 260, y: 90 }].map((p, i) => (
          <g key={`node${i}`}>
            <circle cx={p.x} cy={p.y} r="3" fill={palette.primary} opacity={0.3 + (hash % 4) * 0.1} />
            <line x1={p.x} y1={p.y} x2="150" y2="80" stroke={palette.primary} strokeWidth="0.5" opacity="0.1" strokeDasharray="3 3" />
          </g>
        ))}
        {/* Status bars */}
        <rect x="30" y="140" width="60" height="4" rx="2" fill={palette.primary} opacity="0.2" />
        <rect x="30" y="148" width="40" height="4" rx="2" fill={palette.accent} opacity="0.15" />
        <rect x="210" y="140" width="55" height="4" rx="2" fill={palette.primary} opacity="0.2" />
        <rect x="210" y="148" width="35" height="4" rx="2" fill={palette.accent} opacity="0.15" />
      </g>
    );
  } else if (category === "analytics") {
    // Chart/dashboard pattern
    elements.push(
      <g key="analytics" opacity="0.6">
        {/* Bar chart */}
        {Array.from({ length: 7 }, (_, i) => {
          const height = 20 + ((hash * (i + 1)) % 80);
          return (
            <rect key={`bar${i}`} x={35 + i * 34} y={150 - height} width="20" height={height} rx="3" fill={palette.primary} opacity={0.15 + (i % 3) * 0.1} />
          );
        })}
        {/* Line chart overlay */}
        <polyline
          points={Array.from({ length: 7 }, (_, i) => `${45 + i * 34},${50 + ((hash * (i + 2)) % 60)}`).join(" ")}
          fill="none" stroke={palette.accent} strokeWidth="1.5" opacity="0.4"
        />
        {Array.from({ length: 7 }, (_, i) => (
          <circle key={`dot${i}`} cx={45 + i * 34} cy={50 + ((hash * (i + 2)) % 60)} r="2.5" fill={palette.accent} opacity="0.5" />
        ))}
        {/* Axes */}
        <line x1="30" y1="150" x2="280" y2="150" stroke={palette.primary} strokeWidth="0.5" opacity="0.3" />
        <line x1="30" y1="30" x2="30" y2="150" stroke={palette.primary} strokeWidth="0.5" opacity="0.3" />
      </g>
    );
  } else if (category === "code") {
    // Code editor pattern
    elements.push(
      <g key="code" opacity="0.6">
        {/* Line numbers */}
        {Array.from({ length: 8 }, (_, i) => (
          <text key={`ln${i}`} x="25" y={35 + i * 18} fontSize="9" fill={palette.primary} opacity="0.25" textAnchor="end" fontFamily="monospace">{i + 1}</text>
        ))}
        <line x1="32" y1="20" x2="32" y2="170" stroke={palette.primary} strokeWidth="0.5" opacity="0.15" />
        {/* Code lines */}
        {[
          { indent: 0, width: 45, color: palette.accent },
          { indent: 0, width: 80, color: palette.primary },
          { indent: 15, width: 60, color: palette.accent },
          { indent: 15, width: 100, color: palette.primary },
          { indent: 30, width: 70, color: palette.accent },
          { indent: 30, width: 50, color: palette.primary },
          { indent: 15, width: 30, color: palette.accent },
          { indent: 0, width: 20, color: palette.primary },
        ].map((line, i) => (
          <g key={`cl${i}`}>
            <rect x={42 + line.indent} y={28 + i * 18} width={line.width} height="8" rx="2" fill={line.color} opacity="0.15" />
            {i === 2 && <rect x={42 + line.indent + line.width + 8} y={28 + i * 18} width="35" height="8" rx="2" fill={palette.primary} opacity="0.1" />}
            {i === 4 && <rect x={42 + line.indent + line.width + 8} y={28 + i * 18} width="45" height="8" rx="2" fill="#34D399" opacity="0.12" />}
          </g>
        ))}
        {/* Terminal window hint */}
        <rect x="180" y="40" width="100" height="70" rx="6" fill={palette.bg} stroke={palette.primary} strokeWidth="0.8" opacity="0.4" />
        <rect x="180" y="40" width="100" height="14" rx="6" fill={palette.primary} opacity="0.08" />
        <circle cx="188" cy="47" r="2" fill="#FF5F57" opacity="0.4" />
        <circle cx="195" cy="47" r="2" fill="#FEBC2E" opacity="0.4" />
        <circle cx="202" cy="47" r="2" fill="#28C840" opacity="0.4" />
        <rect x="186" y="60" width="50" height="5" rx="1.5" fill={palette.accent} opacity="0.15" />
        <rect x="186" y="70" width="70" height="5" rx="1.5" fill={palette.primary} opacity="0.1" />
        <rect x="186" y="80" width="40" height="5" rx="1.5" fill={palette.accent} opacity="0.12" />
      </g>
    );
  } else if (category === "travel") {
    // Map/destination pattern
    elements.push(
      <g key="travel" opacity="0.6">
        {/* Horizon line */}
        <path d="M0 100 Q75 75 150 90 Q225 105 300 85" fill="none" stroke={palette.primary} strokeWidth="0.8" opacity="0.2" />
        <path d="M0 110 Q60 95 120 100 Q200 115 300 95" fill="none" stroke={palette.primary} strokeWidth="0.5" opacity="0.15" />
        {/* Location pins */}
        {[{ x: 80, y: 60 }, { x: 180, y: 50 }, { x: 240, y: 70 }].map((p, i) => (
          <g key={`pin${i}`}>
            <path d={`M${p.x} ${p.y - 15} Q${p.x - 8} ${p.y - 15} ${p.x - 8} ${p.y - 7} Q${p.x - 8} ${p.y} ${p.x} ${p.y + 5} Q${p.x + 8} ${p.y} ${p.x + 8} ${p.y - 7} Q${p.x + 8} ${p.y - 15} ${p.x} ${p.y - 15}`} fill={palette.primary} opacity={0.25 + i * 0.1} />
            <circle cx={p.x} cy={p.y - 8} r="3" fill={palette.accent} opacity="0.4" />
          </g>
        ))}
        {/* Route */}
        <path d="M80 55 Q130 40 180 45 Q210 48 240 63" fill="none" stroke={palette.accent} strokeWidth="1" opacity="0.3" strokeDasharray="4 3" />
        {/* Sun */}
        <circle cx="260" cy="30" r="12" fill={palette.primary} opacity="0.08" />
        <circle cx="260" cy="30" r="8" fill={palette.accent} opacity="0.12" />
        {/* Mountains */}
        <path d="M0 140 L50 90 L80 120 L120 70 L160 130 L200 85 L240 125 L280 80 L300 110 L300 180 L0 180 Z" fill={palette.primary} opacity="0.06" />
      </g>
    );
  } else if (category === "marketing") {
    // Campaign/presentation pattern
    elements.push(
      <g key="marketing" opacity="0.6">
        {/* Pie chart */}
        <circle cx="80" cy="80" r="35" fill="none" stroke={palette.primary} strokeWidth="1" opacity="0.2" />
        <path d="M80 45 A35 35 0 0 1 115 80 L80 80 Z" fill={palette.primary} opacity="0.2" />
        <path d="M115 80 A35 35 0 0 1 80 115 L80 80 Z" fill={palette.accent} opacity="0.15" />
        <path d="M80 115 A35 35 0 0 1 45 80 L80 80 Z" fill={palette.primary} opacity="0.1" />
        {/* Trend arrow */}
        <path d="M160 110 L200 70 L240 85 L270 50" fill="none" stroke={palette.accent} strokeWidth="1.5" opacity="0.35" />
        <polygon points="270,50 262,52 265,58" fill={palette.accent} opacity="0.35" />
        {/* Metrics */}
        <rect x="160" y="120" width="50" height="6" rx="3" fill={palette.primary} opacity="0.15" />
        <rect x="160" y="132" width="35" height="6" rx="3" fill={palette.accent} opacity="0.12" />
        <rect x="220" y="120" width="45" height="6" rx="3" fill={palette.primary} opacity="0.15" />
        <rect x="220" y="132" width="30" height="6" rx="3" fill={palette.accent} opacity="0.12" />
      </g>
    );
  } else if (category === "design") {
    // UI/design pattern
    elements.push(
      <g key="design" opacity="0.6">
        {/* Artboard frame */}
        <rect x="40" y="30" width="220" height="120" rx="8" fill="none" stroke={palette.primary} strokeWidth="0.8" opacity="0.25" />
        {/* Header */}
        <rect x="50" y="40" width="200" height="18" rx="4" fill={palette.primary} opacity="0.06" />
        <circle cx="60" cy="49" r="4" fill={palette.accent} opacity="0.2" />
        <rect x="70" y="46" width="40" height="6" rx="2" fill={palette.primary} opacity="0.12" />
        {/* Content blocks */}
        <rect x="50" y="65" width="95" height="70" rx="6" fill={palette.primary} opacity="0.06" />
        <rect x="155" y="65" width="95" height="32" rx="6" fill={palette.accent} opacity="0.06" />
        <rect x="155" y="103" width="95" height="32" rx="6" fill={palette.primary} opacity="0.04" />
        {/* Design elements */}
        <circle cx="98" cy="95" r="15" fill={palette.accent} opacity="0.08" />
        <rect x="165" y="73" width="50" height="5" rx="2" fill={palette.primary} opacity="0.12" />
        <rect x="165" y="82" width="35" height="5" rx="2" fill={palette.accent} opacity="0.1" />
      </g>
    );
  } else if (category === "finance") {
    // Finance chart pattern
    elements.push(
      <g key="finance" opacity="0.6">
        {/* Candlestick chart */}
        {Array.from({ length: 10 }, (_, i) => {
          const base = 60 + ((hash * (i + 3)) % 60);
          const top = base - 10 - ((hash * (i + 7)) % 30);
          const isGreen = (hash + i) % 2 === 0;
          return (
            <g key={`candle${i}`}>
              <line x1={40 + i * 24} y1={top - 5} x2={40 + i * 24} y2={base + 5} stroke={isGreen ? palette.primary : palette.accent} strokeWidth="0.8" opacity="0.3" />
              <rect x={36 + i * 24} y={top} width="8" height={base - top} rx="1" fill={isGreen ? palette.primary : palette.accent} opacity={isGreen ? 0.2 : 0.15} />
            </g>
          );
        })}
        {/* Grid */}
        {Array.from({ length: 4 }, (_, i) => (
          <line key={`grid${i}`} x1="20" y1={40 + i * 35} x2="280" y2={40 + i * 35} stroke={palette.primary} strokeWidth="0.3" opacity="0.15" />
        ))}
      </g>
    );
  } else if (category === "writing") {
    // Document/text pattern
    elements.push(
      <g key="writing" opacity="0.6">
        {/* Page */}
        <rect x="60" y="25" width="180" height="130" rx="6" fill={palette.primary} opacity="0.04" stroke={palette.primary} strokeWidth="0.5" />
        {/* Title */}
        <rect x="80" y="40" width="120" height="8" rx="2" fill={palette.primary} opacity="0.2" />
        {/* Paragraphs */}
        {Array.from({ length: 6 }, (_, i) => (
          <rect key={`line${i}`} x="80" y={60 + i * 14} width={100 + ((hash * (i + 1)) % 40)} height="5" rx="1.5" fill={palette.primary} opacity={0.08 + (i % 2) * 0.04} />
        ))}
        {/* Cursor */}
        <rect x="80" y="130" width="2" height="12" rx="1" fill={palette.accent} opacity="0.4" />
      </g>
    );
  } else if (category === "research") {
    // Research/academic pattern
    elements.push(
      <g key="research" opacity="0.6">
        {/* Atom/molecule */}
        <ellipse cx="150" cy="80" rx="50" ry="20" fill="none" stroke={palette.primary} strokeWidth="0.8" opacity="0.2" transform="rotate(-30 150 80)" />
        <ellipse cx="150" cy="80" rx="50" ry="20" fill="none" stroke={palette.accent} strokeWidth="0.8" opacity="0.15" transform="rotate(30 150 80)" />
        <ellipse cx="150" cy="80" rx="50" ry="20" fill="none" stroke={palette.primary} strokeWidth="0.8" opacity="0.2" />
        <circle cx="150" cy="80" r="5" fill={palette.accent} opacity="0.3" />
        {/* Data points */}
        {[{ x: 50, y: 50 }, { x: 70, y: 110 }, { x: 230, y: 45 }, { x: 250, y: 120 }].map((p, i) => (
          <g key={`rp${i}`}>
            <rect x={p.x - 20} y={p.y - 5} width="40" height="4" rx="2" fill={palette.primary} opacity="0.12" />
            <rect x={p.x - 15} y={p.y + 3} width="30" height="4" rx="2" fill={palette.accent} opacity="0.08" />
          </g>
        ))}
      </g>
    );
  } else if (category === "education") {
    // Learning/book pattern
    elements.push(
      <g key="edu" opacity="0.6">
        {/* Open book */}
        <path d="M150 50 Q120 45 80 55 L80 130 Q120 120 150 125" fill={palette.primary} opacity="0.06" stroke={palette.primary} strokeWidth="0.8" />
        <path d="M150 50 Q180 45 220 55 L220 130 Q180 120 150 125" fill={palette.accent} opacity="0.04" stroke={palette.accent} strokeWidth="0.8" />
        {/* Text lines on pages */}
        {Array.from({ length: 5 }, (_, i) => (
          <g key={`pg${i}`}>
            <rect x="90" y={65 + i * 12} width={40 + ((hash * i) % 15)} height="4" rx="1" fill={palette.primary} opacity="0.1" />
            <rect x="160" y={65 + i * 12} width={40 + ((hash * (i + 3)) % 15)} height="4" rx="1" fill={palette.accent} opacity="0.08" />
          </g>
        ))}
        {/* Graduation cap hint */}
        <path d="M150 30 L170 38 L150 46 L130 38 Z" fill={palette.primary} opacity="0.15" />
      </g>
    );
  } else {
    // General/abstract pattern — geometric network
    const nodeCount = 5 + (hash % 4);
    const nodes = Array.from({ length: nodeCount }, (_, i) => ({
      x: 30 + ((hash * (i + 1) * 17) % 240),
      y: 25 + ((hash * (i + 2) * 13) % 130),
      r: 2 + ((hash * (i + 3)) % 3),
    }));
    elements.push(
      <g key="general" opacity="0.5">
        {/* Connections */}
        {nodes.map((n, i) =>
          nodes.slice(i + 1).filter((_, j) => (hash + i + j) % 3 === 0).map((n2, j) => (
            <line key={`conn${i}-${j}`} x1={n.x} y1={n.y} x2={n2.x} y2={n2.y} stroke={palette.primary} strokeWidth="0.5" opacity="0.15" />
          ))
        )}
        {/* Nodes */}
        {nodes.map((n, i) => (
          <circle key={`n${i}`} cx={n.x} cy={n.y} r={n.r} fill={i % 2 === 0 ? palette.primary : palette.accent} opacity={0.2 + (i % 3) * 0.1} />
        ))}
        {/* Central glow */}
        <circle cx="150" cy="85" r="30" fill={palette.primary} opacity="0.04" />
        <circle cx="150" cy="85" r="15" fill={palette.accent} opacity="0.06" />
      </g>
    );
  }

  return (
    <div className="project-cover-container w-full aspect-[16/10] relative overflow-hidden rounded-t-xl bg-[#0D0D15]">
      <svg viewBox="0 0 300 180" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id={`bg-${hash}`} cx="50%" cy="40%" r="70%">
            <stop offset="0%" stopColor={palette.primary} stopOpacity="0.08" />
            <stop offset="100%" stopColor={palette.bg} stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="300" height="180" fill={palette.bg} />
        <rect width="300" height="180" fill={`url(#bg-${hash})`} />
        {elements}
      </svg>
      {/* Bottom gradient overlay */}
      <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[rgba(0,0,0,0.45)] to-transparent" />
    </div>
  );
}

// Context menu for project cards
function ProjectMenu({
  project,
  onOpen,
  onRename,
  onDelete,
  onClose,
}: {
  project: Project;
  onOpen: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const items = [
    { icon: ExternalLink, label: "Open project", action: onOpen },
    { icon: Pencil, label: "Rename", action: onRename },
    { icon: ImageIcon, label: "Change cover", action: undefined },
    { icon: Settings, label: "Project settings", action: undefined },
    { icon: Trash2, label: "Delete", action: onDelete, danger: true },
  ];

  return (
    <div
      ref={menuRef}
      className="absolute top-2 right-2 z-20 w-[180px] py-1.5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-card)] shadow-lg animate-scale-in"
      style={{ transformOrigin: "top right" }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          onClick={(e) => {
            e.stopPropagation();
            item.action?.();
            onClose();
          }}
          className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] transition-colors text-left ${
            item.danger
              ? "text-[var(--error)] hover:bg-[var(--error)]/10"
              : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          }`}
        >
          <item.icon size={14} />
          {item.label}
        </button>
      ))}
    </div>
  );
}

export default function ProjectsView({
  projects,
  onCreateProject,
  onOpenProject,
  onDeleteProject,
  onRenameProject,
}: ProjectsViewProps) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newIcon, setNewIcon] = useState("");
  const [memoryMode, setMemoryMode] = useState("Default memory");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "created" | "shared">("all");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showCreateModal && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [showCreateModal]);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const handleCreate = () => {
    if (!newName.trim()) return;
    onCreateProject({
      name: newName.trim(),
      icon: newIcon || undefined,
      memoryMode,
    });
    setNewName("");
    setNewIcon("");
    setMemoryMode("Default memory");
    setShowCreateModal(false);
  };

  const handleRename = (projectId: string) => {
    if (!renameValue.trim() || !onRenameProject) return;
    onRenameProject(projectId, renameValue.trim());
    setRenamingId(null);
    setRenameValue("");
  };

  const filteredProjects = projects.filter((p) => {
    if (searchQuery) {
      return p.name.toLowerCase().includes(searchQuery.toLowerCase());
    }
    return true;
  });

  const tabs = [
    { key: "all" as const, label: "All" },
    { key: "created" as const, label: "Created by you" },
    { key: "shared" as const, label: "Shared with you" },
  ];

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-8 pt-8 pb-2">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[28px] font-bold text-[var(--text-primary)]">Projects</h1>
            <p className="text-[13px] text-[var(--text-muted)] mt-0.5">Create a workspace for your chats, files and instructions.</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
              <input
                type="text"
                placeholder="Search projects"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-4 py-2 w-[200px] rounded-full border border-[var(--border)] bg-[var(--bg-secondary)] text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent-border)] transition-colors"
              />
            </div>
            {/* New button */}
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-1.5 px-5 py-2 rounded-full bg-[var(--accent)] text-white text-[13px] font-semibold hover:opacity-90 active:scale-[0.97] transition-all"
            >
              <Plus size={14} />
              New project
            </button>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-1 mb-4">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-1.5 rounded-full text-[13px] font-medium transition-all ${
                activeTab === tab.key
                  ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Cards Grid */}
      <div className="flex-1 overflow-y-auto px-8 pb-6">
        {filteredProjects.length === 0 && projects.length === 0 ? (
          /* Empty State */
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-20 h-20 rounded-2xl bg-[var(--accent-subtle)] border border-[var(--accent-border)] flex items-center justify-center mb-5">
              <FolderClosed size={32} className="text-[var(--accent)]" />
            </div>
            <h3 className="text-[17px] font-semibold text-[var(--text-primary)] mb-1.5">
              Projects
            </h3>
            <p className="text-[13px] text-[var(--text-muted)] mb-5 text-center max-w-xs">
              Create a workspace for your chats, files and instructions.
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-[var(--accent)] text-white text-[13px] font-semibold hover:opacity-90 transition-all"
            >
              <Plus size={15} />
              New project
            </button>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-[13px] text-[var(--text-faint)]">No projects match your search.</p>
          </div>
        ) : (
          /* Project Cards Grid */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {filteredProjects.map((project) => (
              <div
                key={project.id}
                className="project-card group relative rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] overflow-hidden cursor-pointer transition-all duration-200 hover:border-[var(--accent-border)] hover:shadow-md"
                onClick={() => onOpenProject(project.id)}
              >
                {/* Cover Image */}
                <div className="relative overflow-hidden">
                  {project.coverImage ? (
                    <div className="w-full aspect-[16/10] relative overflow-hidden rounded-t-xl">
                      <img
                        src={project.coverImage}
                        alt={project.name}
                        className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                      />
                      <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[rgba(0,0,0,0.45)] to-transparent" />
                    </div>
                  ) : (
                    <div className="transition-transform duration-200 group-hover:scale-[1.03]">
                      <ProjectCover name={project.name} category={project.category} />
                    </div>
                  )}

                  {/* Hover "..." menu trigger */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId(menuOpenId === project.id ? null : project.id);
                    }}
                    className="absolute top-2 right-2 z-10 w-7 h-7 rounded-lg bg-black/40 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/60"
                  >
                    <MoreHorizontal size={14} className="text-white" />
                  </button>

                  {/* Context Menu */}
                  {menuOpenId === project.id && (
                    <ProjectMenu
                      project={project}
                      onOpen={() => onOpenProject(project.id)}
                      onRename={onRenameProject ? () => {
                        setRenamingId(project.id);
                        setRenameValue(project.name);
                        setMenuOpenId(null);
                      } : undefined}
                      onDelete={onDeleteProject ? () => onDeleteProject(project.id) : undefined}
                      onClose={() => setMenuOpenId(null)}
                    />
                  )}
                </div>

                {/* Project Info */}
                <div className="px-3.5 py-3">
                  {renamingId === project.id ? (
                    <input
                      ref={renameInputRef}
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRename(project.id);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      onBlur={() => handleRename(project.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full text-[14px] font-medium text-[var(--text-primary)] bg-transparent border-b border-[var(--accent)] focus:outline-none pb-0.5"
                    />
                  ) : (
                    <h3 className="text-[14px] font-medium text-[var(--text-primary)] truncate group-hover:text-[var(--accent)] transition-colors">
                      {project.icon && <span className="mr-1.5">{project.icon}</span>}
                      {project.name}
                    </h3>
                  )}
                  <p className="text-[12px] text-[var(--text-muted)] mt-1">
                    {formatDate(project.createdAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Project Modal */}
      {showCreateModal && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-[100] backdrop-blur-sm"
            onClick={() => {
              setShowCreateModal(false);
              setNewName("");
            }}
          />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[101] w-[440px] max-w-[90vw] bg-[var(--bg-primary)] rounded-2xl shadow-2xl border border-[var(--border)] p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[17px] font-bold text-[var(--text-primary)]">
                Create project
              </h2>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setNewName("");
                }}
                className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] transition-colors text-[var(--text-muted)]"
              >
                <X size={18} />
              </button>
            </div>

            {/* Preview of cover */}
            {newName.trim() && (
              <div className="mb-4 rounded-xl overflow-hidden border border-[var(--border)]">
                <ProjectCover name={newName.trim()} />
              </div>
            )}

            <div className="mb-5">
              <label className="block text-[13px] font-medium text-[var(--text-secondary)] mb-2">
                Project name
              </label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const icons = ["🎯", "🚀", "📊", "🔬", "💡", "🎨", "📝", "🌐", "🔒", "⚡"];
                    setNewIcon(icons[Math.floor(Math.random() * icons.length)]);
                  }}
                  className="w-12 h-12 rounded-xl border-2 border-dashed border-[var(--border)] hover:border-[var(--accent-border)] flex items-center justify-center text-lg transition-colors shrink-0"
                >
                  {newIcon || "📁"}
                </button>
                <input
                  ref={nameInputRef}
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  placeholder="e.g. Phishing Attack Detection"
                  className="flex-1 px-4 py-3 rounded-xl border-2 border-[var(--accent)]/40 bg-[var(--bg-secondary)] text-[var(--text-primary)] text-[14px] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                />
              </div>
            </div>

            <div className="mb-6 p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border)]">
              <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
                Projects keep chats, files, and custom instructions in one place.
                Use them for ongoing work, or just to keep things tidy.
              </p>
            </div>

            <div className="flex items-center justify-between">
              <button className="flex items-center gap-2 px-3 py-2 rounded-xl text-[13px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">
                <ChevronDown size={14} />
                {memoryMode}
              </button>
              <button
                onClick={handleCreate}
                disabled={!newName.trim()}
                className={`px-6 py-2.5 rounded-xl text-[13px] font-semibold transition-all ${
                  newName.trim()
                    ? "bg-[var(--accent)] text-white hover:opacity-90 active:scale-[0.97]"
                    : "bg-[var(--bg-tertiary)] text-[var(--text-faint)] cursor-not-allowed"
                }`}
              >
                Create project
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
