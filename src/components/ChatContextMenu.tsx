"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Share2,
  Pencil,
  Pin,
  Archive,
  Trash2,
  FolderInput,
  ChevronRight,
  FolderOpen,
  Check,
} from "lucide-react";

export interface ChatItem {
  id: string;
  title: string;
  time: string;
  pinned: boolean;
  archived: boolean;
  projectId?: string;
}

interface ChatContextMenuProps {
  chat: ChatItem;
  position: { x: number; y: number };
  anchorRect?: DOMRect | null;
  onClose: () => void;
  onShare: (chatId: string) => void;
  onRename: (chatId: string, newTitle: string) => void;
  onPin: (chatId: string) => void;
  onArchive: (chatId: string) => void;
  onDelete: (chatId: string) => void;
  onMoveToProject: (chatId: string, projectId: string) => void;
  projects: { id: string; name: string }[];
}

export default function ChatContextMenu({
  chat,
  position,
  anchorRect,
  onClose,
  onShare,
  onRename,
  onPin,
  onArchive,
  onDelete,
  onMoveToProject,
  projects,
}: ChatContextMenuProps) {
  const [showProjects, setShowProjects] = useState(false);
  const [showCopied, setShowCopied] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [visible, setVisible] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);

  // Animated entrance
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const animatedClose = useCallback(() => {
    setVisible(false);
    setTimeout(onClose, 160);
  }, [onClose]);

  // Close on Escape, scroll, outside click
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); animatedClose(); }
    };
    const handleScroll = () => animatedClose();
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) animatedClose();
    };
    window.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("mousedown", handleClick);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("mousedown", handleClick);
    };
  }, [animatedClose]);

  const handleShare = () => {
    onShare(chat.id);
    setShowCopied(true);
    setTimeout(() => { setShowCopied(false); animatedClose(); }, 1200);
  };

  type MenuItem = { type: "item"; icon: React.ElementType; label: string; onClick: () => void; color?: string; hasSubmenu?: boolean }
    | { type: "divider" };

  const items: MenuItem[] = [
    { type: "item", icon: showCopied ? Check : Share2, label: showCopied ? "Link copied!" : "Share", onClick: handleShare },
    { type: "item", icon: Pencil, label: "Rename", onClick: () => { onRename(chat.id, chat.title); animatedClose(); } },
    { type: "divider" },
    { type: "item", icon: Pin, label: chat.pinned ? "Unpin chat" : "Pin chat", onClick: () => { onPin(chat.id); animatedClose(); } },
    { type: "item", icon: Archive, label: chat.archived ? "Unarchive" : "Archive", onClick: () => { onArchive(chat.id); animatedClose(); } },
    { type: "item", icon: Trash2, label: "Delete", onClick: () => { onDelete(chat.id); animatedClose(); }, color: "#fb7185" },
    { type: "divider" },
    { type: "item", icon: FolderInput, label: "Move to project", onClick: () => setShowProjects(!showProjects), hasSubmenu: true },
  ];

  const actionItems = items.filter((it): it is MenuItem & { type: "item" } => it.type === "item");

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((prev) => (prev + 1) % actionItems.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((prev) => (prev - 1 + actionItems.length) % actionItems.length);
      } else if (e.key === "Enter" && focusedIndex >= 0) {
        e.preventDefault();
        actionItems[focusedIndex].onClick();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [focusedIndex, actionItems]);

  // Compute position — anchor to button rect or fall back to cursor position
  const menuWidth = 220;
  const menuHeight = 320;

  let top: number;
  let left: number;

  if (anchorRect) {
    top = anchorRect.bottom + 4;
    left = anchorRect.right - menuWidth;
    // Flip upward if overflows bottom
    if (top + menuHeight > window.innerHeight) top = anchorRect.top - menuHeight - 4;
    // Flip right if overflows left
    if (left < 8) left = anchorRect.left;
  } else {
    top = position.y;
    left = position.x;
    if (top + menuHeight > window.innerHeight) top = window.innerHeight - menuHeight - 8;
    if (left + menuWidth > window.innerWidth) left = window.innerWidth - menuWidth - 8;
  }

  const style: React.CSSProperties = {
    position: "fixed",
    top,
    left,
    width: menuWidth,
    zIndex: 9999,
    background: "var(--popover-bg)",
    border: "1px solid var(--border)",
    borderRadius: 14,
    padding: 6,
    boxShadow: "var(--popover-shadow)",
    opacity: visible ? 1 : 0,
    transform: visible ? "translateY(0)" : "translateY(-4px)",
    transition: "opacity 160ms ease, transform 160ms ease",
  };

  // Submenu position
  const getSubmenuStyle = (): React.CSSProperties => {
    const subWidth = 200;
    let subLeft = menuWidth + 4;
    let subTop = 0;
    // Flip left if no room on right
    if (left + menuWidth + subWidth + 8 > window.innerWidth) {
      subLeft = -(subWidth + 4);
    }
    return {
      position: "absolute",
      left: subLeft,
      top: subTop,
      width: subWidth,
      background: "var(--popover-bg)",
      border: "1px solid var(--border)",
      borderRadius: 14,
      padding: 6,
      boxShadow: "var(--popover-shadow)",
      zIndex: 10000,
    };
  };

  let actionIndex = -1;

  return (
    <div ref={menuRef} style={style} role="menu" aria-label="Chat options">
      {items.map((item, i) => {
        if (item.type === "divider") {
          return <div key={`d-${i}`} style={{ height: 1, background: "var(--border)", margin: "4px 6px" }} />;
        }

        actionIndex++;
        const idx = actionIndex;
        const isFocused = focusedIndex === idx;
        const iconColor = item.color || "var(--text-muted)";
        const labelColor = item.color || "var(--text-primary)";

        return (
          <div key={item.label} style={{ position: "relative" }}>
            <button
              role="menuitem"
              aria-label={item.label}
              onClick={(e) => { e.stopPropagation(); item.onClick(); }}
              onMouseEnter={() => { setFocusedIndex(idx); if (item.hasSubmenu) setShowProjects(true); }}
              onMouseLeave={() => { if (!item.hasSubmenu) return; }}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "0 10px",
                height: 38,
                borderRadius: 9,
                border: "none",
                background: isFocused ? "var(--bg-hover)" : "transparent",
                cursor: "pointer",
                transition: "background 120ms",
              }}
            >
              <item.icon size={16} color={iconColor} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, textAlign: "left", fontSize: 14, color: labelColor, fontWeight: 400 }}>
                {item.label}
              </span>
              {item.hasSubmenu && <ChevronRight size={14} color="var(--text-faint)" />}
            </button>

            {/* Projects submenu */}
            {item.hasSubmenu && showProjects && (
              <div ref={submenuRef} style={getSubmenuStyle()} role="menu" aria-label="Select project">
                {/* No project option */}
                <button
                  role="menuitem"
                  onClick={() => { onMoveToProject(chat.id, ""); animatedClose(); }}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 10,
                    padding: "0 10px", height: 38, borderRadius: 9, border: "none",
                    background: "transparent", cursor: "pointer", transition: "background 120ms",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <FolderOpen size={16} color="var(--text-muted)" />
                  <span style={{ flex: 1, textAlign: "left", fontSize: 14, color: "var(--text-primary)" }}>No project</span>
                </button>

                {projects.length > 0 && (
                  <div style={{ height: 1, background: "var(--border)", margin: "4px 6px" }} />
                )}

                {projects.map((proj) => (
                  <button
                    key={proj.id}
                    role="menuitem"
                    onClick={() => { onMoveToProject(chat.id, proj.id); animatedClose(); }}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", gap: 10,
                      padding: "0 10px", height: 38, borderRadius: 9, border: "none",
                      background: "transparent", cursor: "pointer", transition: "background 120ms",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <FolderOpen size={16} color="var(--text-muted)" />
                    <span style={{ flex: 1, textAlign: "left", fontSize: 14, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {proj.name}
                    </span>
                    {chat.projectId === proj.id && <Check size={14} color="#8b3dff" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
