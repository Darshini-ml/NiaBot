"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import {
  Search,
  MessageSquare,
  Share2,
  MoreHorizontal,
  Plus,
  ArrowLeft,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Paperclip,
  ArrowUp,
  Upload,
  X,
  FileText,
  FileImage,
  FileCode,
  File,
  Pin,
  Pencil,
  Trash2,
  FolderInput,
  Image,
  BookOpen,
} from "lucide-react";
import type { Project } from "./ProjectsView";

export interface ConversationItem {
  id: string;
  title: string;
  preview: string;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface HistoryViewProps {
  conversations: ConversationItem[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  projectId?: string | null;
  projectName?: string;
  project?: Project | null;
  onBackToProjects?: () => void;
  onSendInProject?: (text: string) => void;
  onUpdateProjectInstructions?: (text: string) => void;
  onRenameProject?: (name: string) => void;
  onDeleteProject?: () => void;
  onRenameChatFromProject?: (chatId: string, newName: string) => void;
  onDeleteChatFromProject?: (chatId: string) => void;
  onPinChatFromProject?: (chatId: string) => void;
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatCreatedDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(type: string) {
  if (type.startsWith("image/")) return FileImage;
  if (type.includes("pdf") || type.includes("document") || type.includes("text")) return FileText;
  if (type.includes("javascript") || type.includes("json") || type.includes("html") || type.includes("css") || type.includes("typescript")) return FileCode;
  return File;
}

export function groupByDate(items: ConversationItem[]): Record<string, ConversationItem[]> {
  const groups: Record<string, ConversationItem[]> = {};
  for (const item of items) {
    const label = formatDate(item.updatedAt);
    if (!groups[label]) groups[label] = [];
    groups[label].push(item);
  }
  return groups;
}

interface SourceFile {
  id: string;
  name: string;
  type: string;
  size: number;
  uploadedAt: string;
}

export default function HistoryView({
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewChat,
  projectId,
  projectName,
  project,
  onBackToProjects,
  onSendInProject,
  onUpdateProjectInstructions,
  onRenameProject,
  onDeleteProject,
  onRenameChatFromProject,
  onDeleteChatFromProject,
  onPinChatFromProject,
}: HistoryViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"chats" | "sources">("chats");

  // Project detail state
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState("");
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [instructionsValue, setInstructionsValue] = useState(project?.instructions || "");
  const [composerText, setComposerText] = useState("");
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [chatMenuId, setChatMenuId] = useState<string | null>(null);
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [renameChatValue, setRenameChatValue] = useState("");
  const [sourceFiles, setSourceFiles] = useState<SourceFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  const projectMenuRef = useRef<HTMLDivElement>(null);
  const chatMenuRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync instructions when project changes
  useEffect(() => {
    setInstructionsValue(project?.instructions || "");
  }, [project?.instructions]);

  // Close menus on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (projectMenuRef.current && !projectMenuRef.current.contains(e.target as Node)) {
        setShowProjectMenu(false);
      }
      if (chatMenuRef.current && !chatMenuRef.current.contains(e.target as Node)) {
        setChatMenuId(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Focus title input when editing
  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  const filtered = useMemo(() => {
    let items = conversations.filter((c) => c.title && c.title.trim());
    if (projectId !== undefined) {
      items = items.filter((c) => c.projectId === projectId);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      items = items.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.preview.toLowerCase().includes(q)
      );
    }
    return items.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }, [conversations, projectId, searchQuery]);

  const grouped = useMemo(() => groupByDate(filtered), [filtered]);

  const chatCount = filtered.length;

  const handleTitleSubmit = useCallback(() => {
    const trimmed = editTitleValue.trim();
    if (trimmed && trimmed !== project?.name) {
      onRenameProject?.(trimmed);
    }
    setIsEditingTitle(false);
  }, [editTitleValue, project?.name, onRenameProject]);

  const handleComposerSend = useCallback(() => {
    const trimmed = composerText.trim();
    if (trimmed) {
      onSendInProject?.(trimmed);
      setComposerText("");
    }
  }, [composerText, onSendInProject]);

  const handleComposerKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleComposerSend();
      }
    },
    [handleComposerSend]
  );

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    const newFiles: SourceFile[] = files.map((f) => ({
      id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: f.name,
      type: f.type || "application/octet-stream",
      size: f.size,
      uploadedAt: new Date().toISOString(),
    }));
    setSourceFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const newFiles: SourceFile[] = files.map((f) => ({
      id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: f.name,
      type: f.type || "application/octet-stream",
      size: f.size,
      uploadedAt: new Date().toISOString(),
    }));
    setSourceFiles((prev) => [...prev, ...newFiles]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const removeSourceFile = useCallback((id: string) => {
    setSourceFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const handleChatRenameSubmit = useCallback(
    (chatId: string) => {
      const trimmed = renameChatValue.trim();
      if (trimmed) {
        onRenameChatFromProject?.(chatId, trimmed);
      }
      setRenamingChatId(null);
    },
    [renameChatValue, onRenameChatFromProject]
  );

  const suggestionChips = useMemo(() => {
    const name = projectName || "this project";
    return [
      `Brainstorm ideas for ${name}`,
      `Create a plan for ${name}`,
      `Research ${name}`,
    ];
  }, [projectName]);

  // ──────────────────────────────────────────────
  // PROJECT DETAIL VIEW
  // ──────────────────────────────────────────────
  if (projectName && project) {
    return (
      <div className="flex-1 flex flex-col h-full overflow-y-auto">
        <div className="max-w-[960px] w-full mx-auto px-6 pt-8 pb-12">
          {/* Back link */}
          <button
            onClick={onBackToProjects}
            className="flex items-center gap-1.5 text-[13px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors mb-5"
          >
            <ArrowLeft size={14} />
            <span>Projects</span>
          </button>

          {/* Compact header row */}
          <div className="flex items-center gap-3 mb-4">
            {/* Project icon */}
            <div
              className="w-[24px] h-[24px] rounded-full flex items-center justify-center shrink-0 text-[12px]"
              style={{ background: "var(--accent-subtle)", color: "var(--accent)" }}
            >
              {project.icon || <FolderOpen size={13} />}
            </div>

            {/* Editable title */}
            <div className="flex-1 min-w-0">
              {isEditingTitle ? (
                <input
                  ref={titleInputRef}
                  type="text"
                  value={editTitleValue}
                  onChange={(e) => setEditTitleValue(e.target.value)}
                  onBlur={handleTitleSubmit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleTitleSubmit();
                    if (e.key === "Escape") setIsEditingTitle(false);
                  }}
                  className="text-[20px] font-bold text-[var(--text-primary)] bg-transparent border-b-2 border-[var(--accent)] outline-none w-full py-0.5"
                />
              ) : (
                <h1
                  className="text-[20px] font-bold text-[var(--text-primary)] truncate cursor-pointer hover:text-[var(--accent)] transition-colors"
                  onClick={() => {
                    setEditTitleValue(project.name);
                    setIsEditingTitle(true);
                  }}
                >
                  {project.name}
                </h1>
              )}
            </div>

            {/* Meta text */}
            <span className="text-[12px] text-[var(--text-faint)] shrink-0 whitespace-nowrap">
              {chatCount} chat{chatCount !== 1 ? "s" : ""} &middot; Created {formatCreatedDate(project.createdAt)}
            </span>

            {/* Actions */}
            <div className="flex items-center gap-1 shrink-0">
              <button className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] transition-colors">
                <Share2 size={16} />
              </button>
              <div className="relative" ref={projectMenuRef}>
                <button
                  onClick={() => setShowProjectMenu(!showProjectMenu)}
                  className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] transition-colors"
                >
                  <MoreHorizontal size={16} />
                </button>
                {showProjectMenu && (
                  <div className="absolute right-0 top-full mt-1 w-[180px] py-1 rounded-xl border border-[var(--border)] bg-[var(--popover-bg)] shadow-[var(--popover-shadow)] z-50 animate-scale-in">
                    <button
                      onClick={() => {
                        setShowProjectMenu(false);
                        setEditTitleValue(project.name);
                        setIsEditingTitle(true);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                    >
                      <Pencil size={14} />
                      Rename
                    </button>
                    <button
                      onClick={() => setShowProjectMenu(false)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                    >
                      <Image size={14} />
                      Add cover
                    </button>
                    <button
                      onClick={() => {
                        setShowProjectMenu(false);
                        setInstructionsOpen(true);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                    >
                      <BookOpen size={14} />
                      Instructions
                    </button>
                    <div className="my-1 border-t border-[var(--border)]" />
                    <button
                      onClick={() => {
                        setShowProjectMenu(false);
                        onDeleteProject?.();
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-[var(--error)] hover:bg-[var(--bg-hover)] transition-colors"
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Collapsible instructions */}
          <div className="mb-5">
            <button
              onClick={() => setInstructionsOpen(!instructionsOpen)}
              className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              {instructionsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Project instructions
            </button>
            {instructionsOpen && (
              <div className="mt-2">
                <textarea
                  value={instructionsValue}
                  onChange={(e) => setInstructionsValue(e.target.value)}
                  onBlur={() => onUpdateProjectInstructions?.(instructionsValue)}
                  placeholder="Give NiaAI context for every chat in this project..."
                  className="w-full min-h-[100px] px-3 py-2.5 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border)] focus:border-[var(--accent-border)] focus:outline-none text-[13px] text-[var(--text-secondary)] placeholder:text-[var(--text-faint)] resize-y"
                />
              </div>
            )}
          </div>

          {/* Inline project composer */}
          <div className="mb-6">
            <div className="glass-composer rounded-2xl overflow-hidden">
              <textarea
                ref={composerRef}
                value={composerText}
                onChange={(e) => setComposerText(e.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder={`Start a chat in ${projectName}...`}
                rows={2}
                className="w-full px-4 pt-3 pb-1 text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] bg-transparent resize-none outline-none border-none"
              />
              <div className="flex items-center justify-between px-3 pb-2.5">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] transition-colors"
                >
                  <Paperclip size={16} />
                </button>
                <button
                  onClick={handleComposerSend}
                  disabled={!composerText.trim()}
                  className="w-[28px] h-[28px] rounded-lg flex items-center justify-center transition-all"
                  style={{
                    background: composerText.trim() ? "var(--accent)" : "var(--bg-hover)",
                    color: composerText.trim() ? "#fff" : "var(--text-faint)",
                  }}
                >
                  <ArrowUp size={15} />
                </button>
              </div>
            </div>
          </div>

          {/* Tabs row with filter */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setActiveTab("chats")}
                className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                  activeTab === "chats"
                    ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                Chats
              </button>
              <button
                onClick={() => setActiveTab("sources")}
                className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                  activeTab === "sources"
                    ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                Sources
              </button>
            </div>
            <div className="relative" style={{ width: 240 }}>
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
              <input
                type="text"
                placeholder={activeTab === "chats" ? "Filter chats..." : "Filter sources..."}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-[var(--bg-tertiary)] rounded-xl text-[13px] border border-[var(--border)] focus:border-[var(--accent-border)] focus:outline-none placeholder:text-[var(--text-faint)] text-[var(--text-secondary)]"
              />
            </div>
          </div>

          {/* Tab content */}
          {activeTab === "chats" ? (
            chatCount === 0 ? (
              /* Empty state */
              <div className="flex flex-col items-center justify-center py-16">
                <div className="w-[56px] h-[56px] rounded-2xl bg-[var(--bg-tertiary)] flex items-center justify-center mb-4">
                  <FolderOpen size={32} className="text-[var(--text-faint)]" />
                </div>
                <p className="text-[15px] font-medium text-[var(--text-primary)] mb-1">
                  No chats yet
                </p>
                <p className="text-[13px] text-[var(--text-muted)] text-center max-w-[400px] mb-6">
                  Start a conversation below or drop files into Sources to give this project context.
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {suggestionChips.map((chip) => (
                    <button
                      key={chip}
                      onClick={() => {
                        setComposerText(chip);
                        composerRef.current?.focus();
                      }}
                      className="quick-chip px-4 flex items-center text-[13px] text-[var(--text-secondary)]"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* Chat list grouped by date */
              <div>
                {Object.entries(grouped).map(([label, items]) => (
                  <div key={label} className="mb-4">
                    <div className="px-1 py-1.5">
                      <span className="text-[11px] font-semibold text-[var(--text-faint)] uppercase tracking-wider">
                        {label}
                      </span>
                    </div>
                    {items.map((conv) => (
                      <div key={conv.id} className="relative group">
                        {renamingChatId === conv.id ? (
                          <div className="flex items-center gap-2 px-3 py-3">
                            <input
                              autoFocus
                              type="text"
                              value={renameChatValue}
                              onChange={(e) => setRenameChatValue(e.target.value)}
                              onBlur={() => handleChatRenameSubmit(conv.id)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleChatRenameSubmit(conv.id);
                                if (e.key === "Escape") setRenamingChatId(null);
                              }}
                              className="flex-1 text-[14px] font-medium text-[var(--text-primary)] bg-transparent border-b-2 border-[var(--accent)] outline-none py-0.5"
                            />
                          </div>
                        ) : (
                          <button
                            onClick={() => onSelectConversation(conv.id)}
                            className={`w-full flex items-center justify-between px-3 py-3 rounded-xl transition-all duration-150 text-left ${
                              activeConversationId === conv.id
                                ? "bg-[var(--accent-subtle)] border border-[var(--accent-border)]"
                                : "hover:bg-[var(--bg-hover)]"
                            }`}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-[14px] font-medium text-[var(--text-primary)] truncate">
                                {conv.title}
                              </p>
                              <p className="text-[12px] text-[var(--text-muted)] truncate mt-0.5 max-w-[500px]">
                                {conv.preview}
                              </p>
                            </div>
                            <span className="text-[11px] text-[var(--text-faint)] shrink-0 ml-4 group-hover:hidden">
                              {formatRelativeTime(conv.updatedAt)}
                            </span>
                          </button>
                        )}

                        {/* Hover menu button */}
                        {renamingChatId !== conv.id && (
                          <div className="absolute right-2 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center">
                            <div className="relative" ref={chatMenuId === conv.id ? chatMenuRef : undefined}>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setChatMenuId(chatMenuId === conv.id ? null : conv.id);
                                }}
                                className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] transition-colors"
                              >
                                <MoreHorizontal size={14} />
                              </button>
                              {chatMenuId === conv.id && (
                                <div className="absolute right-0 top-full mt-1 w-[160px] py-1 rounded-xl border border-[var(--border)] bg-[var(--popover-bg)] shadow-[var(--popover-shadow)] z-50 animate-scale-in">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setChatMenuId(null);
                                      setRenameChatValue(conv.title);
                                      setRenamingChatId(conv.id);
                                    }}
                                    className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                                  >
                                    <Pencil size={13} />
                                    Rename
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setChatMenuId(null);
                                    }}
                                    className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                                  >
                                    <FolderInput size={13} />
                                    Move
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setChatMenuId(null);
                                      onPinChatFromProject?.(conv.id);
                                    }}
                                    className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                                  >
                                    <Pin size={13} />
                                    Pin
                                  </button>
                                  <div className="my-1 border-t border-[var(--border)]" />
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setChatMenuId(null);
                                      onDeleteChatFromProject?.(conv.id);
                                    }}
                                    className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-[var(--error)] hover:bg-[var(--bg-hover)] transition-colors"
                                  >
                                    <Trash2 size={13} />
                                    Delete
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )
          ) : (
            /* Sources tab */
            <div>
              {/* Drop zone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragOver(true);
                }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleFileDrop}
                className={`rounded-2xl border-2 border-dashed p-8 mb-4 flex flex-col items-center justify-center transition-colors cursor-pointer ${
                  isDragOver
                    ? "border-[var(--accent)] bg-[var(--accent-subtle)]"
                    : "border-[var(--border)] hover:border-[var(--border-hover)]"
                }`}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={24} className={`mb-2 ${isDragOver ? "text-[var(--accent)]" : "text-[var(--text-faint)]"}`} />
                <p className="text-[13px] text-[var(--text-muted)] mb-0.5">
                  Drag and drop files here, or click to upload
                </p>
                <p className="text-[11px] text-[var(--text-faint)]">
                  PDFs, images, code, text files
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />

              {/* File list */}
              {sourceFiles.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10">
                  <ExternalLink size={28} className="text-[var(--text-faint)] mb-2" />
                  <p className="text-[13px] text-[var(--text-muted)]">No sources yet</p>
                  <p className="text-[11px] text-[var(--text-faint)] mt-0.5">
                    Upload files to give this project context
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  {sourceFiles.map((file) => {
                    const Icon = getFileIcon(file.type);
                    return (
                      <div
                        key={file.id}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[var(--bg-hover)] transition-colors group"
                      >
                        <Icon size={18} className="text-[var(--text-muted)] shrink-0" />
                        <span className="flex-1 min-w-0 text-[13px] text-[var(--text-primary)] truncate">
                          {file.name}
                        </span>
                        <span className="text-[11px] text-[var(--text-faint)] shrink-0">
                          {formatFileSize(file.size)}
                        </span>
                        <span className="text-[11px] text-[var(--text-faint)] shrink-0">
                          {formatCreatedDate(file.uploadedAt)}
                        </span>
                        <button
                          onClick={() => removeSourceFile(file.id)}
                          className="p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--error)] transition-all"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ──────────────────────────────────────────────
  // NON-PROJECT HISTORY VIEW (unchanged)
  // ──────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Non-project header (archived/history view) */}
      {!projectName && !project && (
        <div className="px-6 pt-5 pb-3">
          <h1 className="text-[22px] font-bold text-[var(--text-primary)]">History</h1>
        </div>
      )}

      {/* New chat button */}
      <div className="px-6 py-2">
        <button
          onClick={onNewChat}
          className="w-full flex items-center gap-2 px-4 py-3 rounded-xl border border-[var(--border)] hover:border-[var(--accent-border)] hover:bg-[var(--bg-hover)] transition-all text-left"
        >
          <Plus size={16} className="text-[var(--accent)]" />
          <span className="text-[14px] text-[var(--text-secondary)]">
            New chat{projectName ? ` in ${projectName}` : ""}
          </span>
        </button>
      </div>

      {/* Search */}
      <div className="px-6 py-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-[var(--bg-tertiary)] rounded-xl text-[13px] border border-[var(--border)] focus:border-[var(--accent-border)] focus:outline-none placeholder:text-[var(--text-faint)] text-[var(--text-secondary)]"
          />
        </div>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto px-4 py-2">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <MessageSquare size={36} className="text-[var(--text-faint)] mb-3" />
            <p className="text-[14px] text-[var(--text-muted)]">
              {searchQuery ? "No matching conversations" : "No conversations yet"}
            </p>
            <p className="text-[12px] text-[var(--text-faint)] mt-1">
              Start a new chat to begin
            </p>
          </div>
        ) : (
          Object.entries(grouped).map(([label, items]) => (
            <div key={label} className="mb-4">
              <div className="px-2 py-1.5">
                <span className="text-[11px] font-semibold text-[var(--text-faint)] uppercase tracking-wider">
                  {label}
                </span>
              </div>
              {items.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => onSelectConversation(conv.id)}
                  className={`w-full flex items-start justify-between px-3 py-3 rounded-xl transition-all duration-150 text-left group ${
                    activeConversationId === conv.id
                      ? "bg-[var(--accent-subtle)] border border-[var(--accent-border)]"
                      : "hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-medium text-[var(--text-primary)] truncate">
                      {conv.title}
                    </p>
                    <p className="text-[12px] text-[var(--text-muted)] truncate mt-0.5">
                      {conv.preview}
                    </p>
                  </div>
                  <span className="text-[11px] text-[var(--text-faint)] shrink-0 ml-3 mt-0.5">
                    {formatDate(conv.updatedAt)}
                  </span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
