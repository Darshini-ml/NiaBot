"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import {
  Plus,
  PanelLeftClose,
  Zap,
  Globe,
  ListTodo,
  Search,
  MessageSquare,
} from "lucide-react";
import type { SidebarChat } from "./Sidebar";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNewChat: () => void;
  onToggleSidebar: () => void;
  onSwitchModel?: () => void;
  onToggleWebSearch?: () => void;
  onStartTask?: () => void;
  onSelectChat?: (id: string) => void;
  chats?: SidebarChat[];
}

interface Action {
  id: string;
  label: string;
  icon: typeof Plus;
  shortcut?: string;
  action: () => void;
}

export default function CommandPalette({
  isOpen,
  onClose,
  onNewChat,
  onToggleSidebar,
  onSwitchModel,
  onToggleWebSearch,
  onStartTask,
  onSelectChat,
  chats = [],
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const actions: Action[] = useMemo(() => [
    { id: "new-chat", label: "New chat", icon: Plus, shortcut: "Shift+Cmd+O", action: () => { onNewChat(); onClose(); } },
    { id: "toggle-sidebar", label: "Toggle sidebar", icon: PanelLeftClose, shortcut: "Ctrl+\\", action: () => { onToggleSidebar(); onClose(); } },
    { id: "switch-model", label: "Switch model", icon: Zap, action: () => { onSwitchModel?.(); onClose(); } },
    { id: "web-search", label: "Toggle web search", icon: Globe, action: () => { onToggleWebSearch?.(); onClose(); } },
    { id: "start-task", label: "Start a task", icon: ListTodo, action: () => { onStartTask?.(); onClose(); } },
  ], [onNewChat, onClose, onToggleSidebar, onSwitchModel, onToggleWebSearch, onStartTask]);

  const filteredActions = useMemo(() => {
    if (!query) return actions;
    const q = query.toLowerCase();
    return actions.filter(a => a.label.toLowerCase().includes(q));
  }, [query, actions]);

  const filteredChats = useMemo(() => {
    if (!query) return chats.slice(0, 5);
    const q = query.toLowerCase();
    return chats.filter(c => c.title.toLowerCase().includes(q)).slice(0, 8);
  }, [query, chats]);

  const allItems = useMemo(() => [
    ...filteredActions.map(a => ({ type: "action" as const, actionId: a.id, ...a })),
    ...filteredChats.map(c => ({ type: "chat" as const, id: c.id, title: c.title })),
  ], [filteredActions, filteredChats]);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, allItems.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const item = allItems[selectedIndex];
      if (!item) return;
      if (item.type === "action") item.action();
      else { onSelectChat?.(item.id); onClose(); }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]">
      <div className="absolute inset-0 command-palette-backdrop" onClick={onClose} />
      <div
        className="relative w-[600px] max-h-[70vh] bg-[var(--bg-elevated)] border border-[var(--border)] rounded-2xl overflow-hidden shadow-2xl animate-scale-in flex flex-col"
        onKeyDown={handleKeyDown}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)]">
          <Search size={16} className="text-[var(--text-faint)] shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none"
          />
          <kbd className="px-1.5 py-0.5 text-[10px] font-mono text-[var(--text-faint)] bg-[var(--bg-tertiary)] rounded border border-[var(--border)]">esc</kbd>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-2" style={{ maxHeight: 360 }}>
          {/* Actions */}
          {filteredActions.length > 0 && (
            <div className="mb-2">
              <div className="px-3 py-1">
                <span className="text-[11px] font-semibold text-[var(--text-faint)] uppercase tracking-wider">Actions</span>
              </div>
              {filteredActions.map((action, i) => {
                const globalIndex = i;
                return (
                  <button
                    key={action.id}
                    onClick={action.action}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                      selectedIndex === globalIndex ? "bg-[var(--sidebar-hover)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--sidebar-hover)]"
                    }`}
                    onMouseEnter={() => setSelectedIndex(globalIndex)}
                  >
                    <action.icon size={15} className="text-[var(--text-muted)] shrink-0" />
                    <span className="flex-1 text-[13px]">{action.label}</span>
                    {action.shortcut && (
                      <span className="text-[11px] text-[var(--text-faint)] font-mono">{action.shortcut}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Chats */}
          {filteredChats.length > 0 && (
            <div>
              <div className="px-3 py-1">
                <span className="text-[11px] font-semibold text-[var(--text-faint)] uppercase tracking-wider">Chats</span>
              </div>
              {filteredChats.map((chat, i) => {
                const globalIndex = filteredActions.length + i;
                return (
                  <button
                    key={chat.id}
                    onClick={() => { onSelectChat?.(chat.id); onClose(); }}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                      selectedIndex === globalIndex ? "bg-[var(--sidebar-hover)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--sidebar-hover)]"
                    }`}
                    onMouseEnter={() => setSelectedIndex(globalIndex)}
                  >
                    <MessageSquare size={14} className="text-[var(--text-faint)] shrink-0" />
                    <span className="flex-1 text-[13px] truncate">{chat.title}</span>
                  </button>
                );
              })}
            </div>
          )}

          {allItems.length === 0 && (
            <div className="py-8 text-center">
              <p className="text-[13px] text-[var(--text-muted)]">No results found</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-[var(--border)] flex items-center gap-4 text-[10px] text-[var(--text-faint)]">
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">↵</kbd> select</span>
          <span><kbd className="font-mono">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
