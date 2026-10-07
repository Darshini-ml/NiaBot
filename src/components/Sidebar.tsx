"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import {
  Plus,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  FolderOpen,
  MoreHorizontal,
  Zap,
  MessageCircle,
  Activity,
  Plug,
} from "lucide-react";
import type { Project, ProjectPreviewKind } from "./ProjectsView";
import { detectCategory, CATEGORY_PALETTES, hashString } from "./ProjectsView";
import ChatContextMenu from "./ChatContextMenu";
import UserDropdown from "./UserDropdown";

export type NavView =
  | "chat"
  | "history"
  | "projects"
  | "project-workspace"
  | "explore"
  | "automations"
  | "logs"
  | "connectors"
  | "connector-detail"
;

export interface SidebarChat {
  id: string;
  title: string;
  updatedAt: string;
  pinned: boolean;
}

interface SidebarProps {
  activeView: NavView;
  onNavigate: (view: NavView) => void;
  onNewChat: () => void;
  collapsed: boolean;
  onToggle: () => void;
  activeProjectId?: string | null;
  activeProjectName?: string;
  onLogout?: () => void;
  chats?: SidebarChat[];
  activeChatId?: string | null;
  onSelectChat?: (id: string) => void;
  onTogglePin?: (id: string) => void;
  onDeleteChat?: (id: string) => void;
  onRenameChat?: (id: string, newTitle: string) => void;
  onArchiveChat?: (id: string) => void;
  onShareChat?: (id: string) => void;
  onMoveToProject?: (chatId: string, projectId: string) => void;
  projects?: Project[];
  onOpenProject?: (projectId: string) => void;
  onCreateProject?: () => void;
  onCommandPalette?: () => void;
  onOpenConnectorDetail?: (provider: "slack" | "discord") => void;
  userName?: string;
}

/* ─── Thumbnail content mini-renders ─── */
function ChatPreview() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ width: "55%", height: 4, borderRadius: 2, background: "#5a5566" }} />
      <div style={{ width: "85%", height: 4, borderRadius: 2, background: "#c9c5d1" }} />
      <div style={{ width: "70%", height: 4, borderRadius: 2, background: "#c9c5d1" }} />
      <div style={{ width: "90%", height: 4, borderRadius: 2, background: "#c9c5d1" }} />
      <div style={{ width: "60%", height: 4, borderRadius: 2, background: "#c9c5d1" }} />
    </div>
  );
}

function DeckPreview() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 4 }}>
        <div style={{ width: 28, height: 10, borderRadius: 5, background: "#c9c5d1" }} />
        <div style={{ width: 22, height: 10, borderRadius: 5, background: "#c9c5d1" }} />
        <div style={{ width: 32, height: 10, borderRadius: 5, background: "#c9c5d1" }} />
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 28, marginTop: 4 }}>
        {[18, 28, 14, 24, 20].map((h, i) => (
          <div
            key={i}
            style={{
              width: 10, height: h, borderRadius: 2,
              background: `linear-gradient(to top, #7c3aed, #c026d3)`,
              opacity: 0.7 + i * 0.06,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function CodePreview() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, fontFamily: "monospace" }}>
      <div style={{ display: "flex", gap: 4 }}>
        <div style={{ width: 20, height: 4, borderRadius: 2, background: "#7c3aed" }} />
        <div style={{ width: 36, height: 4, borderRadius: 2, background: "#c9c5d1" }} />
      </div>
      <div style={{ display: "flex", gap: 4, marginLeft: 12 }}>
        <div style={{ width: 28, height: 4, borderRadius: 2, background: "#c9c5d1" }} />
        <div style={{ width: 18, height: 4, borderRadius: 2, background: "#c9c5d1" }} />
      </div>
      <div style={{ display: "flex", gap: 4, marginLeft: 12 }}>
        <div style={{ width: 16, height: 4, borderRadius: 2, background: "#7c3aed" }} />
        <div style={{ width: 30, height: 4, borderRadius: 2, background: "#c9c5d1" }} />
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: "#c9c5d1" }} />
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <div style={{ width: 24, height: 4, borderRadius: 2, background: "#c9c5d1" }} />
      </div>
    </div>
  );
}

function EmptyPreview() {
  return (
    <div style={{
      width: "100%", height: "100%",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 8,
        border: "2px dashed rgba(90,85,102,.4)",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#8e8a96", fontSize: 16, fontWeight: 300,
      }}>
        +
      </div>
      <span style={{ fontSize: 9, color: "#8e8a96", fontWeight: 500, letterSpacing: "0.04em" }}>New</span>
    </div>
  );
}

function ThumbnailContent({ kind }: { kind: ProjectPreviewKind }) {
  switch (kind) {
    case "slides": return <DeckPreview />;
    case "code": return <CodePreview />;
    case "image": return <ChatPreview />; /* fallback — real images would use blurred thumbnail */
    case "plan": return <ChatPreview />;
    case "chat": return <ChatPreview />;
    case "empty":
    default: return <EmptyPreview />;
  }
}

/* Stacked document-preview project card for sidebar */
function ProjectCardThumb({
  name,
  subtitle,
  previewKind = "empty",
  isActive,
}: {
  name: string;
  category?: string;
  subtitle?: string;
  previewKind?: ProjectPreviewKind;
  isActive?: boolean;
}) {
  return (
    <div
      className="project-stack-card"
      style={{
        position: "relative",
        cursor: "pointer",
        paddingTop: 8, /* space for back sheets */
      }}
    >
      {/* Back sheet 2 (furthest) */}
      <div style={{
        position: "absolute",
        top: 0,
        left: 6,
        right: 6,
        height: 78,
        background: "#2a2731",
        borderRadius: 8,
        transition: "transform .2s ease",
      }} className="stack-sheet-back" />

      {/* Back sheet 1 */}
      <div style={{
        position: "absolute",
        top: 4,
        left: 3,
        right: 3,
        height: 78,
        background: "#36333f",
        borderRadius: 8,
        transition: "transform .2s ease",
      }} className="stack-sheet-mid" />

      {/* Front sheet (thumbnail) */}
      <div
        style={{
          position: "relative",
          height: 78,
          background: "#f3f1f6",
          borderRadius: 8,
          border: isActive ? "2px solid var(--accent)" : "1px solid rgba(255,255,255,.1)",
          overflow: "hidden",
          padding: 12,
          transition: "transform .2s ease, border-color .2s ease",
          zIndex: 1,
        }}
        className="stack-sheet-front"
      >
        <ThumbnailContent kind={previewKind} />
      </div>

      {/* Title & meta below the stack */}
      <p style={{
        fontSize: 14, fontWeight: 600, color: "#f1eff5",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        marginTop: 8, lineHeight: 1.3, paddingLeft: 2,
      }}>
        {name}
      </p>
      <p style={{
        fontSize: 12.5, color: "#8e8a96",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        marginTop: 2, lineHeight: 1.3, paddingLeft: 2,
      }}>
        {subtitle || "0 chats"}
      </p>
    </div>
  );
}

function getDateGroup(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday.getTime() - 86400000);
  const startOf7DaysAgo = new Date(startOfToday.getTime() - 7 * 86400000);

  if (date >= startOfToday) return "Today";
  if (date >= startOfYesterday) return "Yesterday";
  if (date >= startOf7DaysAgo) return "Previous 7 days";
  return "Older";
}

const GROUP_ORDER = ["Today", "Yesterday", "Previous 7 days", "Older"];

export default function Sidebar({
  activeView,
  onNavigate,
  onNewChat,
  collapsed,
  onToggle,
  activeProjectId,
  chats = [],
  activeChatId,
  onSelectChat,
  onTogglePin,
  onDeleteChat,
  onRenameChat,
  onArchiveChat,
  onShareChat,
  onMoveToProject,
  projects = [],
  onOpenProject,
  onCommandPalette,
  onOpenConnectorDetail,
  userName,
  onLogout,
}: SidebarProps) {
  const [workspacesExpanded, setWorkspacesExpanded] = useState(true);
  const [connectorsHover, setConnectorsHover] = useState(false);
  const [connectorsFlyout, setConnectorsFlyout] = useState(false);
  const [connectorStatuses, setConnectorStatuses] = useState<Record<string, { id: string; enabled: boolean; name: string }[]>>({});
  const [connectorConfig, setConnectorConfig] = useState<Record<string, boolean> | null>(null);
  const connectorsRef = useRef<HTMLDivElement>(null);
  const [hoveredChatId, setHoveredChatId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ chat: SidebarChat; x: number; y: number; anchorRect?: DOMRect | null } | null>(null);
  const [plusRotation, setPlusRotation] = useState(0);
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const moreButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const filteredChats = useMemo(() => {
    return chats.filter((c) => c.title && c.title.trim());
  }, [chats]);

  const slackChats = useMemo(() => filteredChats.filter((c) => c.id?.startsWith("slack-") || c.title?.startsWith("Slack:")), [filteredChats]);
  const nonSlackChats = useMemo(() => filteredChats.filter((c) => !c.id?.startsWith("slack-") && !c.title?.startsWith("Slack:")), [filteredChats]);
  const pinnedChats = useMemo(() => nonSlackChats.filter((c) => c.pinned), [nonSlackChats]);
  const unpinnedChats = useMemo(() => nonSlackChats.filter((c) => !c.pinned), [nonSlackChats]);

  const groupedChats = useMemo(() => {
    const groups: Record<string, SidebarChat[]> = {};
    for (const chat of unpinnedChats) {
      const group = getDateGroup(chat.updatedAt);
      if (!groups[group]) groups[group] = [];
      groups[group].push(chat);
    }
    return groups;
  }, [unpinnedChats]);

  const startRename = useCallback((chatId: string, currentTitle: string) => {
    setRenamingChatId(chatId);
    setRenameValue(currentTitle);
  }, []);

  const commitRename = useCallback((chatId: string) => {
    if (renameValue.trim() && renameValue.trim() !== (chats.find(c => c.id === chatId)?.title || "")) {
      onRenameChat?.(chatId, renameValue.trim());
    }
    setRenamingChatId(null);
  }, [renameValue, chats, onRenameChat]);

  // Fetch connector statuses + config for the flyout
  const fetchConnectorStatuses = useCallback(async () => {
    try {
      const res = await fetch("/api/connectors");
      if (!res.ok) return;
      const data = await res.json();
      const map: Record<string, { id: string; enabled: boolean; name: string }[]> = {};
      for (const c of data.connectors || []) {
        if (!map[c.provider]) map[c.provider] = [];
        map[c.provider].push({ id: c.id, enabled: c.enabled, name: c.external_name || c.external_id });
      }
      setConnectorStatuses(map);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchConnectorStatuses();
  }, [fetchConnectorStatuses, activeView]);

  useEffect(() => {
    let cancelled = false;
    async function loadConfig() {
      try {
        const res = await fetch("/api/connectors/config");
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setConnectorConfig(data);
      } catch { /* silent */ }
    }
    loadConfig();
    return () => { cancelled = true; };
  }, []);

  // Refresh connector statuses after OAuth callback (?connected=...)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") || params.get("connectorSuccess")) {
      fetchConnectorStatuses();
    }
  }, [fetchConnectorStatuses]);

  // Close flyout on outside click or Escape
  useEffect(() => {
    if (!connectorsFlyout) return;
    function handleClickOutside(e: MouseEvent) {
      if (connectorsRef.current && !connectorsRef.current.contains(e.target as Node)) {
        setConnectorsFlyout(false);
        setConnectorsHover(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setConnectorsFlyout(false);
        setConnectorsHover(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [connectorsFlyout]);

  const isProviderConfigured = useCallback((provider: string): boolean => {
    if (!connectorConfig) return true; // Don't block while loading
    if (!connectorConfig.encryption) return false;
    return connectorConfig[provider] ?? false;
  }, [connectorConfig]);

  const handleConnectorToggle = useCallback(async (provider: string, connectorId: string, enabled: boolean) => {
    // Optimistic update
    setConnectorStatuses((prev) => ({
      ...prev,
      [provider]: (prev[provider] || []).map(c => c.id === connectorId ? { ...c, enabled } : c),
    }));
    try {
      await fetch(`/api/connectors/${provider}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, id: connectorId }),
      });
    } catch {
      // Revert on error
      setConnectorStatuses((prev) => ({
        ...prev,
        [provider]: (prev[provider] || []).map(c => c.id === connectorId ? { ...c, enabled: !enabled } : c),
      }));
    }
  }, []);

  const handleConnectorRowClick = useCallback((provider: string) => {
    if (!isProviderConfigured(provider)) return; // disabled row
    const workspaces = connectorStatuses[provider];
    if (!workspaces || workspaces.length === 0) {
      // Not connected → start OAuth
      window.location.href = `/api/connectors/${provider}/start`;
    } else {
      // Connected → navigate to detail page
      onOpenConnectorDetail?.(provider as "slack" | "discord");
    }
    setConnectorsFlyout(false);
    setConnectorsHover(false);
  }, [connectorStatuses, isProviderConfigured, onOpenConnectorDetail]);

  /* ─── Collapsed mode ─── */
  if (collapsed) return null;

  /* ─── Chat item renderer ─── */
  const renderChatItem = (chat: SidebarChat) => {
    const isRenaming = renamingChatId === chat.id;

    return (
      <div
        key={chat.id}
        className={`group flex items-center gap-2 rounded-[9px] cursor-pointer transition-all duration-150 ${
          activeChatId === chat.id
            ? "bg-[var(--sidebar-active)] text-[var(--text-primary)] border-l-2 border-l-[var(--accent)]"
            : "text-[var(--text-secondary)] hover:bg-[rgba(255,255,255,.05)]"
        }`}
        style={{ height: 36, paddingLeft: activeChatId === chat.id ? 8 : 10, paddingRight: 10 }}
        onClick={() => { if (!isRenaming) onSelectChat?.(chat.id); }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setContextMenu({ chat, x: e.clientX, y: e.clientY, anchorRect: null });
        }}
        onMouseEnter={() => setHoveredChatId(chat.id)}
        onMouseLeave={() => setHoveredChatId(null)}
      >
        <MessageCircle size={14} className="shrink-0 opacity-40" />
        {isRenaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename(chat.id);
              if (e.key === "Escape") setRenamingChatId(null);
            }}
            onBlur={() => commitRename(chat.id)}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 text-[13px] min-w-0 bg-transparent border border-[var(--accent-border)] rounded px-1.5 py-0.5 text-[var(--text-primary)] outline-none"
          />
        ) : (
          <span className="flex-1 text-[13px] truncate min-w-0">{chat.title}</span>
        )}
        {!isRenaming && (hoveredChatId === chat.id || activeChatId === chat.id) && (
          <button
            ref={(el) => { if (el) moreButtonRefs.current.set(chat.id, el); else moreButtonRefs.current.delete(chat.id); }}
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              setContextMenu({ chat, x: rect.left, y: rect.bottom, anchorRect: rect });
            }}
            className="shrink-0 flex items-center justify-center rounded-md text-[var(--text-faint)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)] transition-all"
            style={{ width: 26, height: 26 }}
            title="More options"
          >
            <MoreHorizontal size={15} />
          </button>
        )}
      </div>
    );
  };

  /* ─── Expanded mode ─── */
  return (
    <aside
      className="h-full flex-none flex flex-col transition-all duration-300 glass-sidebar"
      style={{ width: 252 }}
    >
      {/* ── Logo row ── */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <button onClick={() => onNavigate("chat")} className="flex items-center gap-2 group">
          <div className="w-6 h-6 rounded-full bg-white flex items-center justify-center">
            <div className="w-2.5 h-2.5 rounded-full bg-gradient-to-br from-[#8b3dff] to-[#c13bd9]" />
          </div>
          <span className="text-[15px] font-semibold text-[var(--text-primary)]">NiaAI</span>
        </button>
        <button
          onClick={onToggle}
          className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] transition-colors"
          title="Collapse sidebar"
        >
          <PanelLeftClose size={16} />
        </button>
      </div>

      {/* ── New Chat button ── */}
      <div className="px-3 pb-1.5 pt-1">
        <button
          onClick={() => {
            setPlusRotation((c) => c + 1);
            onNewChat();
          }}
          className="new-chat-btn w-full flex items-center gap-2 px-3 cursor-pointer"
          style={{
            height: 40,
            borderRadius: 11,
            border: "1px solid var(--border)",
            background: "linear-gradient(135deg, var(--accent-subtle), rgba(181,59,211,.08))",
            position: "relative",
            overflow: "hidden",
            transition: "transform 180ms cubic-bezier(.2,.8,.2,1), border-color 180ms cubic-bezier(.2,.8,.2,1), box-shadow 180ms cubic-bezier(.2,.8,.2,1)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "translateY(-1px)";
            e.currentTarget.style.borderColor = "var(--accent-glow)";
            e.currentTarget.style.boxShadow = "0 6px 24px rgba(139,61,255,.28)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "none";
            e.currentTarget.style.borderColor = "var(--border)";
            e.currentTarget.style.boxShadow = "none";
          }}
          onMouseDown={(e) => { e.currentTarget.style.transform = "scale(.97)"; }}
          onMouseUp={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; }}
        >
          {/* Plus icon tile */}
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 7,
              background: "linear-gradient(135deg, #8b3dff, #c13bd9)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 0 12px rgba(199,125,255,.5)",
              flexShrink: 0,
              transition: "transform 250ms cubic-bezier(.2,.8,.2,1)",
              transform: `rotate(${plusRotation * 90}deg)`,
            }}
          >
            <Plus size={13} strokeWidth={2.5} color="white" />
          </div>
          <span
            style={{
              flex: 1,
              textAlign: "left",
              color: "var(--text-primary)",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            New chat
          </span>
          {/* Sheen overlay */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(110deg, transparent 30%, rgba(255,255,255,.14) 50%, transparent 70%)",
              backgroundSize: "220% 100%",
              animation: "newChatSheen 3.2s ease-in-out infinite",
              pointerEvents: "none",
              borderRadius: 11,
            }}
          />
        </button>
      </div>

      {/* ── Logs row ── */}
      <div className="px-2 pt-2 pb-0">
        <button
          onClick={() => onNavigate("logs")}
          className={`w-full flex items-center gap-2.5 px-3 rounded-[9px] transition-all duration-150 ${
            activeView === "logs"
              ? "bg-[var(--sidebar-active)] text-[var(--text-primary)]"
              : "text-[var(--text-muted)] hover:bg-[var(--sidebar-hover)]"
          }`}
          style={{ height: 36 }}
        >
          <Activity size={15} strokeWidth={1.8} />
          <span className="flex-1 text-left text-[13px]">Logs</span>
        </button>
      </div>

      {/* ── Connectors row with flyout ── */}
      <div className="px-2 pt-1 pb-0 relative" ref={connectorsRef}
        onMouseEnter={() => { setConnectorsHover(true); setConnectorsFlyout(true); }}
        onMouseLeave={() => { setConnectorsHover(false); setConnectorsFlyout(false); }}
      >
        <button
          onClick={() => setConnectorsFlyout((v) => !v)}
          className={`w-full flex items-center gap-2.5 px-3 rounded-[9px] transition-all duration-150 ${
            activeView === "connectors"
              ? "bg-[var(--sidebar-active)] text-[var(--text-primary)]"
              : "text-[var(--text-muted)] hover:bg-[var(--sidebar-hover)]"
          }`}
          style={{ height: 36 }}
        >
          <Plug size={15} strokeWidth={1.8} />
          <span className="flex-1 text-left text-[13px]">Connectors</span>
          <ChevronRight size={12} className="text-[var(--text-faint)] opacity-60" />
        </button>

        {/* Flyout */}
        {connectorsFlyout && (
          <div
            className="absolute left-full top-0 ml-1 z-50 w-56 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] shadow-xl overflow-hidden"
            style={{ animation: "scaleIn 120ms cubic-bezier(.2,.8,.2,1)" }}
          >
            {/* Provider rows */}
            {(["slack", "discord"] as const).map((provider) => {
              const configured = isProviderConfigured(provider);
              const workspaces = connectorStatuses[provider] || [];
              const label = provider === "slack" ? "Slack" : "Discord";
              const icon = provider === "slack" ? "💬" : "🎮";

              return (
                <div key={provider}>
                  {/* Provider header */}
                  <div
                    onClick={() => handleConnectorRowClick(provider)}
                    className={`flex items-center gap-2.5 px-3 py-2.5 transition-colors ${
                      configured ? "hover:bg-[var(--bg-hover)] cursor-pointer" : "opacity-50 cursor-not-allowed"
                    }`}
                    title={!configured ? "Not set up on this server yet" : undefined}
                  >
                    <span className="text-sm">{icon}</span>
                    <span className="flex-1 text-[13px] text-[var(--text-primary)]">{label}</span>
                    {!configured ? (
                      <span className="text-[10px] text-[var(--text-faint)] italic">Not configured</span>
                    ) : workspaces.length === 0 ? (
                      <span className="text-[11px] text-[var(--text-faint)]">Not connected</span>
                    ) : (
                      <span className="text-[10px] text-[var(--text-faint)]">{workspaces.length} connected</span>
                    )}
                  </div>

                  {/* Per-workspace rows */}
                  {workspaces.map((ws) => (
                    <div
                      key={ws.id}
                      className="flex items-center gap-2 pl-9 pr-3 py-1.5 hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
                      onClick={() => {
                        setConnectorsFlyout(false);
                        setConnectorsHover(false);
                        onOpenConnectorDetail?.(provider);
                      }}
                    >
                      <span className="flex-1 text-[12px] text-[var(--text-secondary)] truncate">{ws.name}</span>
                      <div className="flex items-center gap-1.5">
                        {!ws.enabled && (
                          <span className="text-[10px] text-[var(--text-faint)]">Paused</span>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleConnectorToggle(provider, ws.id, !ws.enabled); }}
                          className="relative w-8 h-[18px] rounded-full transition-colors duration-200"
                          style={{
                            background: ws.enabled ? "var(--accent)" : "var(--bg-hover)",
                            border: `1px solid ${ws.enabled ? "var(--accent)" : "var(--border)"}`,
                          }}
                        >
                          <div
                            className="absolute top-[2px] w-3 h-3 rounded-full bg-white transition-transform duration-200"
                            style={{ transform: ws.enabled ? "translateX(15px)" : "translateX(2px)" }}
                          />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}

            {/* Divider */}
            <div className="mx-2 border-t border-[var(--border)]" />

            {/* Add connector — scrolls to first unconnected */}
            <button
              onClick={() => { setConnectorsFlyout(false); setConnectorsHover(false); onNavigate("connectors"); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
            >
              <Plus size={13} />
              Add connector
            </button>

            {/* Manage connectors */}
            <button
              onClick={() => { setConnectorsFlyout(false); setConnectorsHover(false); onNavigate("connectors"); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
            >
              <Plug size={13} />
              Manage connectors
            </button>
          </div>
        )}
      </div>

      {/* ── Automations row ── */}
      <div className="px-2 pt-1 pb-0">
        <button
          onClick={() => onNavigate("automations")}
          className={`w-full flex items-center gap-2.5 px-3 rounded-[9px] transition-all duration-150 ${
            activeView === "automations"
              ? "bg-[var(--sidebar-active)] text-[var(--text-primary)]"
              : "text-[var(--text-muted)] hover:bg-[var(--sidebar-hover)]"
          }`}
          style={{ height: 36 }}
        >
          <Zap size={15} strokeWidth={1.8} />
          <span className="flex-1 text-left text-[13px]">Automations</span>
        </button>
      </div>

      {/* ── Projects section ── */}
      <div className="px-2 pt-2 pb-1">
        <div className="flex items-center">
          <button
            onClick={() => {
              setWorkspacesExpanded(!workspacesExpanded);
              if (!workspacesExpanded && projects.length === 0) onNavigate("projects");
            }}
            className="flex-1 flex items-center gap-2.5 px-3 rounded-[9px] hover:bg-[var(--sidebar-hover)] transition-all duration-150"
            style={{ height: 34 }}
          >
            <FolderOpen size={15} strokeWidth={1.8} className="text-[var(--text-muted)]" />
            <span className="flex-1 text-left text-[13px] text-[var(--text-muted)]">All projects</span>
            <ChevronDown
              size={13}
              className="text-[var(--text-muted)] transition-transform duration-200"
              style={{ transform: workspacesExpanded ? "rotate(0deg)" : "rotate(-180deg)" }}
            />
          </button>
          <button
            onClick={() => onNavigate("projects")}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-faint)] hover:text-[var(--accent)] transition-colors shrink-0"
            title="New project"
          >
            <Plus size={14} />
          </button>
        </div>

        {/* Project card grid */}
        {workspacesExpanded && projects.length > 0 && (
          <div
            className="sidebar-project-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)",
              gap: 14,
              padding: "6px 8px 4px",
            }}
          >
            {projects.map((project) => {
              const chatCount = project.chat_count ?? 0;
              const subtitle = project.last_artifact_title
                ? `${project.last_artifact_title} · ${chatCount} chat${chatCount !== 1 ? "s" : ""}`
                : (() => {
                    const d = new Date(project.updated_at || project.createdAt);
                    return !isNaN(d.getTime())
                      ? `${chatCount} chat${chatCount !== 1 ? "s" : ""} · ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                      : `${chatCount} chat${chatCount !== 1 ? "s" : ""}`;
                  })();
              return (
                <button
                  key={project.id}
                  onClick={() => onOpenProject?.(project.id)}
                  className="text-left"
                  style={{ cursor: "pointer", minWidth: 0 }}
                >
                  <ProjectCardThumb
                    name={project.name}
                    category={project.category}
                    subtitle={subtitle}
                    previewKind={project.preview_kind || "empty"}
                    isActive={activeProjectId === project.id}
                  />
                </button>
              );
            })}
          </div>
        )}

        {workspacesExpanded && projects.length === 0 && (
          <div className="px-3 py-4 text-center">
            <p className="text-[12px] text-[var(--text-faint)]">No projects yet</p>
          </div>
        )}
      </div>

      {/* ── Divider ── */}
      <div className="mx-4 my-1.5 border-t border-[var(--border)]" />

      {/* ── Chat History ── */}
      <div className="flex-1 overflow-y-auto min-h-0 px-2 sidebar-chat-list">
        {/* Pinned */}
        {pinnedChats.length > 0 && (
          <div className="mb-1">
            <div className="px-3 py-1">
              <span className="text-[11px] font-semibold text-[#6f6a78] uppercase tracking-[0.08em]">Pinned</span>
            </div>
            {pinnedChats.map(renderChatItem)}
          </div>
        )}

        {/* Grouped by date */}
        {GROUP_ORDER.map((group) => {
          const items = groupedChats[group];
          if (!items || items.length === 0) return null;
          return (
            <div key={group} className="mb-1">
              <div className="px-3 py-1 mt-5">
                <span className="text-[11px] font-semibold text-[#6f6a78] uppercase tracking-[0.08em]">{group}</span>
              </div>
              {items.map(renderChatItem)}
            </div>
          );
        })}

        {/* Slack project group */}
        {slackChats.length > 0 && (
          <div className="mb-1">
            <div className="px-3 py-1 mt-5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: "#E01E5A" }}># Slack</span>
            </div>
            {slackChats.map(renderChatItem)}
          </div>
        )}

        {filteredChats.length === 0 && (
          <div className="px-3 py-6 text-center">
            <p className="text-[12px] text-[var(--text-faint)]">No chats yet</p>
          </div>
        )}
      </div>

      {/* ── Profile card with user dropdown ── */}
      <div className="px-3 pb-3 pt-2">
        <UserDropdown
          onLogout={onLogout}
          user={userName ? { name: userName, email: "" } : undefined}
          sidebarMode
        />
      </div>

      {/* ── Chat Context Menu ── */}
      {contextMenu && (
        <ChatContextMenu
          chat={{
            id: contextMenu.chat.id,
            title: contextMenu.chat.title,
            time: contextMenu.chat.updatedAt,
            pinned: contextMenu.chat.pinned,
            archived: false,
          }}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          anchorRect={contextMenu.anchorRect}
          onClose={() => setContextMenu(null)}
          onShare={(chatId) => { onShareChat?.(chatId); }}
          onRename={(chatId) => { startRename(chatId, contextMenu.chat.title); setContextMenu(null); }}
          onPin={(chatId) => { onTogglePin?.(chatId); }}
          onArchive={(chatId) => { onArchiveChat?.(chatId); }}
          onDelete={(chatId) => { onDeleteChat?.(chatId); }}
          onMoveToProject={(chatId, projectId) => { onMoveToProject?.(chatId, projectId); }}
          projects={projects.map(p => ({ id: p.id, name: p.name }))}
        />
      )}
    </aside>
  );
}
