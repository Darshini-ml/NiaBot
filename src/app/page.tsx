"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Sparkles, Search, PanelLeft, Info } from "lucide-react";
import { models, type ModelOption } from "@/components/ModelSelector";
import ModelSelector from "@/components/ModelSelector";
import ChatMessage, { type Message, type UploadedAttachment, type ImageData, type SourceItem, type LinkCardData } from "@/components/ChatMessage";
import ChatInput from "@/components/ChatInput";
import WelcomeScreen, { type TaskType } from "@/components/WelcomeScreen";
import AuthModal, { type UserData } from "@/components/AuthModal";
import Sidebar, { type NavView } from "@/components/Sidebar";
import CommandPalette from "@/components/CommandPalette";
import ToastContainer, { showToast } from "@/components/Toast";
import LanguageSelector, { languages, type Language } from "@/components/LanguageSelector";
import NotificationsPanel from "@/components/NotificationsPanel";
import DeleteChatDialog from "@/components/DeleteChatDialog";

import HistoryView, { type ConversationItem } from "@/components/HistoryView";
import ProjectsView, { type Project, type ProjectPreviewKind } from "@/components/ProjectsView";
import WebSearchView from "@/components/WebSearchView";
import AutomationsPage from "@/components/AutomationsPage";
import AutomationModal, { type AutomationFormData } from "@/components/AutomationModal";
import type { Automation, AutomationTemplate } from "@/lib/automations";
import VoiceMode from "@/components/VoiceMode";
import ConfigureModelsPanel from "@/components/ConfigureModelsPanel";
import LogsPage from "@/components/LogsPage";
import ConnectorsPage from "@/components/ConnectorsPage";
import ConnectorDetailPage from "@/components/ConnectorDetailPage";

function parseTargetPages(text: string): { target: number; strict: boolean } | null {
  const WORD_NUMS: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
    nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
    fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  };

  // Match "exactly 5 pages", "5-page", "a 10 page", "in 5 pages"
  const numMatch = text.match(/(?:exactly|precisely|strictly|only)?\s*(\d{1,2})\s*[-\s]?pages?\b/i)
    || text.match(/\bin\s+(\d{1,2})\s+pages?\b/i)
    || text.match(/(\d{1,2})-page\b/i);
  if (numMatch) {
    const target = parseInt(numMatch[1], 10);
    const strict = /\b(exactly|precisely|strictly|no\s+more|only)\b/i.test(text);
    return { target, strict };
  }

  // Match word numbers: "exactly five page", "a ten page report"
  const wordPattern = new RegExp(`(?:exactly|precisely|strictly|only)?\\s*(${Object.keys(WORD_NUMS).join("|")})\\s*[-\\s]?pages?\\b`, "i");
  const wordMatch = text.match(wordPattern);
  if (wordMatch) {
    const target = WORD_NUMS[wordMatch[1].toLowerCase()];
    const strict = /\b(exactly|precisely|strictly|no\s+more|only)\b/i.test(text);
    return { target, strict };
  }

  // Heuristic keywords
  if (/\bshort\b/i.test(text)) return { target: 3, strict: false };
  if (/\blong\b/i.test(text) || /\bdetailed\b/i.test(text)) return { target: 8, strict: false };
  return null;
}

interface Conversation {
  id: string;
  title: string;
  preview: string;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
  deletedAt?: string | null;
}

function generateId() {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateProjectId() {
  return `proj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export default function Home() {
  const [currentUser, setCurrentUser] = useState<UserData | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("nia_current_user");
    if (stored) {
      try { setCurrentUser(JSON.parse(stored)); } catch { /* invalid */ }
    }
    setAuthChecked(true);
  }, []);

  const handleAuth = (user: UserData) => setCurrentUser(user);

  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelOption>(models[0]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<Language>(languages[0]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [activeView, setActiveView] = useState<NavView>("chat");
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [newChatKey, setNewChatKey] = useState(0);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<TaskType>(null);
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);
  const filePickerTriggerRef = useRef<(() => void) | null>(null);
  const [automationModalOpen, setAutomationModalOpen] = useState(false);
  const [editingAutomation, setEditingAutomation] = useState<Automation | null>(null);
  const [prefillTemplate, setPrefillTemplate] = useState<AutomationTemplate | null>(null);
  const [thinkingLevel, setThinkingLevel] = useState<"off" | "low" | "medium" | "high">("off");
  const [configPanelOpen, setConfigPanelOpen] = useState(false);
  const [configPanelFilterChatId, setConfigPanelFilterChatId] = useState<string | undefined>(undefined);
  const [usagePopoverOpen, setUsagePopoverOpen] = useState(false);
  const [activeConnector, setActiveConnector] = useState<import("@/components/ChatInput").ConnectorChip>(null);
  const [connectorStatuses, setConnectorStatuses] = useState<import("@/components/ChatInput").ConnectorStatus[]>([]);
  const [detailProvider, setDetailProvider] = useState<"slack" | "discord">("slack");

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [pinnedChatIds, setPinnedChatIds] = useState<Set<string>>(new Set());
  const [chatDataLoaded, setChatDataLoaded] = useState(false);
  const [deleteDialogChat, setDeleteDialogChat] = useState<{ id: string; title: string } | null>(null);
  const [voiceModeOpen, setVoiceModeOpen] = useState(false);
  const [voiceAiResponse, setVoiceAiResponse] = useState("");
  const [voiceAiStreaming, setVoiceAiStreaming] = useState(false);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Cmd+K or Ctrl+K → command palette
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen(prev => !prev);
      }
      // Ctrl+\ or Cmd+\ → toggle sidebar
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        setSidebarCollapsed(prev => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Handle OAuth callback redirect: ?view=connectors&connected=slack
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get("view");
    if (viewParam === "connectors") {
      setActiveView("connectors");
    }
  }, []);

  // Fetch connector statuses for the composer menu
  useEffect(() => {
    async function fetchConnectors() {
      try {
        const res = await fetch("/api/connectors");
        if (!res.ok) return;
        const data = await res.json();
        const statuses: import("@/components/ChatInput").ConnectorStatus[] = (data.connectors || []).map((c: any) => ({
          id: c.id,
          provider: c.provider,
          enabled: c.enabled,
          connected: c.status === "connected",
          name: c.external_name || c.provider,
        }));
        setConnectorStatuses(statuses);
      } catch { /* ignore */ }
    }
    fetchConnectors();
  }, [activeView]); // re-fetch when switching views (e.g. after connecting)

  // Validate selected model against live catalog — fallback if it disappears
  useEffect(() => {
    let cancelled = false;
    async function checkModel() {
      try {
        const res = await fetch("/api/models");
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const allIds = new Set<string>();
        for (const p of data.providers || []) {
          for (const m of p.models || []) {
            allIds.add(m.id);
          }
        }
        if (allIds.size === 0) return;
        if (!allIds.has(selectedModel.modelId)) {
          // Selected model no longer in catalog — switch to default
          const defaultId = data.default_model || (data.providers?.[0]?.models?.[0]?.id);
          if (defaultId && allIds.has(defaultId)) {
            const defaultProv = (data.providers || []).find((p: any) => (p.models || []).some((m: any) => m.id === defaultId));
            const defaultModel = defaultProv?.models?.find((m: any) => m.id === defaultId);
            if (defaultModel && !cancelled) {
              const fallback: ModelOption = {
                id: defaultModel.id,
                name: defaultModel.label || defaultModel.id.split("/").pop(),
                modelId: defaultModel.id,
                provider: "niaai",
                providerName: defaultProv.name,
                icon: Sparkles,
              };
              setSelectedModel(fallback);
              showToast(`${selectedModel.name} is no longer available — switched to ${fallback.name}`);
            }
          }
        }
      } catch { /* network error, ignore */ }
    }
    checkModel();
    return () => { cancelled = true; };
  }, [selectedModel.modelId]);

  useEffect(() => {
    if (!currentUser?.email) return;
    try {
      const storedConvs = localStorage.getItem(`nia_conversations_${currentUser.email}`);
      const storedProjects = localStorage.getItem(`nia_projects_${currentUser.email}`);
      const storedActive = localStorage.getItem(`nia_activechat_${currentUser.email}`);
      const storedPinned = localStorage.getItem(`nia_pinned_${currentUser.email}`);
      if (storedConvs) setConversations(JSON.parse(storedConvs));
      if (storedProjects) setProjects(JSON.parse(storedProjects));
      if (storedActive) setActiveChatId(storedActive);
      if (storedPinned) setPinnedChatIds(new Set(JSON.parse(storedPinned)));
    } catch { /* corrupted */ }
    setChatDataLoaded(true);
  }, [currentUser?.email]);

  useEffect(() => {
    if (!currentUser?.email || !chatDataLoaded) return;
    localStorage.setItem(`nia_conversations_${currentUser.email}`, JSON.stringify(conversations));
  }, [conversations, currentUser?.email, chatDataLoaded]);

  useEffect(() => {
    if (!currentUser?.email || !chatDataLoaded) return;
    localStorage.setItem(`nia_projects_${currentUser.email}`, JSON.stringify(projects));
  }, [projects, currentUser?.email, chatDataLoaded]);

  useEffect(() => {
    if (!currentUser?.email || !chatDataLoaded) return;
    localStorage.setItem(`nia_pinned_${currentUser.email}`, JSON.stringify([...pinnedChatIds]));
  }, [pinnedChatIds, currentUser?.email, chatDataLoaded]);

  useEffect(() => {
    if (!currentUser?.email || !chatDataLoaded) return;
    if (activeChatId) localStorage.setItem(`nia_activechat_${currentUser.email}`, activeChatId);
    else localStorage.removeItem(`nia_activechat_${currentUser.email}`);
  }, [activeChatId, currentUser?.email, chatDataLoaded]);

  const messages = conversations.find((c) => c.id === activeChatId)?.messages || [];
  const activeConv = conversations.find(c => c.id === activeChatId);

  const setMessages = useCallback(
    (updater: Message[] | ((prev: Message[]) => Message[])) => {
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== activeChatId) return c;
          const newMsgs = typeof updater === "function" ? updater(c.messages) : updater;
          return { ...c, messages: newMsgs, updatedAt: new Date().toISOString() };
        })
      );
    },
    [activeChatId]
  );

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => { scrollToBottom(); }, [messages]);

  const activeProject = projects.find((p) => p.id === activeProjectId);

  const sidebarChats = conversations
    .filter((c) => c.title && c.title.trim() && !c.deletedAt)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, pinned: pinnedChatIds.has(c.id) }));

  // Map of chat_id → deletedAt for LogsPage
  const deletedChatsMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of conversations) {
      if (c.deletedAt) map[c.id] = c.deletedAt;
    }
    return map;
  }, [conversations]);

  /* Enrich projects with chat_count, preview_kind, last_artifact_title */
  const enrichedProjects = useMemo(() => {
    return projects.map((project) => {
      const projectConvs = conversations.filter(c => c.projectId === project.id);
      const chatCount = projectConvs.length;
      const sorted = [...projectConvs].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      const latestConv = sorted[0];
      let previewKind: ProjectPreviewKind = "empty";
      let lastArtifactTitle: string | undefined;
      if (latestConv) {
        const lastMsg = [...latestConv.messages].reverse().find(m => m.role === "assistant" && m.content);
        if (lastMsg?.content) {
          const c = lastMsg.content.toLowerCase();
          if (c.includes("```") || c.includes("function ") || c.includes("const ") || c.includes("import ")) previewKind = "code";
          else if (c.includes("slide") || c.includes("presentation") || c.includes("deck")) previewKind = "slides";
          else previewKind = "chat";
        } else {
          previewKind = "chat";
        }
        lastArtifactTitle = latestConv.title;
      }
      return {
        ...project,
        chat_count: chatCount,
        preview_kind: project.preview_kind || previewKind,
        last_artifact_title: project.last_artifact_title || lastArtifactTitle,
        updated_at: project.updated_at || latestConv?.updatedAt || project.createdAt,
      };
    });
  }, [projects, conversations]);

  const handleTogglePin = useCallback((chatId: string) => {
    setPinnedChatIds((prev) => {
      const next = new Set(prev);
      if (next.has(chatId)) { next.delete(chatId); showToast("Unpinned"); }
      else { next.add(chatId); showToast("Pinned"); }
      return next;
    });
  }, []);

  const handleRequestDeleteChat = useCallback((chatId: string) => {
    const conv = conversations.find(c => c.id === chatId);
    if (!conv) return;
    setDeleteDialogChat({ id: chatId, title: conv.title || "Untitled chat" });
  }, [conversations]);

  const handleConfirmDeleteChat = useCallback((chatId: string) => {
    const wasPinned = pinnedChatIds.has(chatId);
    // Soft-delete: set deletedAt timestamp instead of removing
    setConversations(prev => prev.map(c => c.id === chatId ? { ...c, deletedAt: new Date().toISOString() } : c));
    if (activeChatId === chatId) setActiveChatId(null);
    if (wasPinned) setPinnedChatIds(prev => { const next = new Set(prev); next.delete(chatId); return next; });
    setDeleteDialogChat(null);
    showToast("Chat deleted", {
      duration: 5000,
      action: {
        label: "Undo",
        onClick: () => {
          setConversations(prev => prev.map(c => c.id === chatId ? { ...c, deletedAt: null } : c));
          if (wasPinned) setPinnedChatIds(prev => new Set([...prev, chatId]));
        },
      },
    });
  }, [activeChatId, pinnedChatIds]);

  const handleRenameChat = useCallback((chatId: string, newTitle: string) => {
    setConversations(prev => prev.map(c => c.id === chatId ? { ...c, title: newTitle } : c));
    showToast("Chat renamed");
  }, []);

  const handleArchiveChat = useCallback((chatId: string) => {
    setConversations(prev => prev.map(c => c.id === chatId ? { ...c, deletedAt: new Date().toISOString() } : c));
    if (activeChatId === chatId) setActiveChatId(null);
    showToast("Chat archived");
  }, [activeChatId]);

  const handleShareChat = useCallback((chatId: string) => {
    const conv = conversations.find(c => c.id === chatId);
    if (conv) {
      const shareText = conv.messages.map(m => `${m.role === "user" ? "You" : "NiaAI"}: ${m.content}`).join("\n\n");
      navigator.clipboard.writeText(shareText);
      showToast("Chat link copied");
    }
  }, [conversations]);

  const handleMoveChatToProject = useCallback((chatId: string, projectId: string) => {
    setConversations(prev => prev.map(c => c.id === chatId ? { ...c, projectId } : c));
    showToast("Moved to project");
  }, []);

  const handleNavigate = useCallback((view: NavView) => {
    setActiveView(view);
    if (view === "chat") setActiveProjectId(null);
  }, []);

  const handleNewChat = useCallback(() => {
    setActiveChatId(null);
    setActiveProjectId(null);
    setActiveView("chat");
    setNewChatKey((k) => k + 1);
  }, []);

  const handleSelectConversation = useCallback((chatId: string) => {
    setActiveChatId(chatId);
    setConversations((prevConvs) => {
      const conv = prevConvs.find((c) => c.id === chatId);
      if (conv?.projectId) { setActiveProjectId(conv.projectId); setActiveView("project-workspace"); }
      else { setActiveView("chat"); }
      return prevConvs;
    });
  }, []);

  const handleOpenProject = useCallback((projectId: string) => {
    setActiveProjectId(projectId);
    setActiveChatId(null);
    setActiveView("project-workspace");
  }, []);

  const handleCreateProject = useCallback(
    (data: Omit<Project, "id" | "createdAt">) => {
      const newProject: Project = { ...data, id: generateProjectId(), createdAt: new Date().toISOString() };
      setProjects((prev) => [...prev, newProject]);
      setActiveProjectId(newProject.id);
      setActiveView("project-workspace");
    }, []
  );

  const handleDeleteProject = useCallback((projectId: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
    if (activeProjectId === projectId) { setActiveProjectId(null); setActiveView("projects"); }
  }, [activeProjectId]);

  const handleRenameProject = useCallback((projectId: string, newName: string) => {
    setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, name: newName } : p)));
  }, []);

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsGenerating(false);
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.isStreaming) return [...prev.slice(0, -1), { ...last, isStreaming: false }];
      return prev;
    });
  }, [setMessages]);

  const handleRegenerate = useCallback(() => {
    if (!activeChatId || messages.length < 2) return;
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) return;
    setMessages((prev) => {
      const lastAssistantIdx = prev.map((m) => m.role).lastIndexOf("assistant");
      if (lastAssistantIdx >= 0) return prev.filter((_, i) => i !== lastAssistantIdx);
      return prev;
    });
    handleSend(lastUserMsg.content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChatId, messages]);

  const handleImageGen = async (prompt: string, chatIdOverride?: string) => {
    const targetChatId = chatIdOverride || activeChatId;
    if (!targetChatId) return;

    const aiMsgId = Date.now() + 1;
    const aiMsg: Message = {
      id: aiMsgId,
      role: "assistant",
      content: "",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      isStreaming: true,
      imageStage: "enhancing",
    };

    setConversations((prev) =>
      prev.map((c) => c.id === targetChatId ? { ...c, messages: [...c.messages, aiMsg] } : c)
    );

    try {
      const res = await fetch("/api/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, size: "1024x1024", enhance: true, chat_id: targetChatId, message_id: String(aiMsgId) }),
      });

      if (!res.ok) {
        throw new Error(`Image generation failed (HTTP ${res.status})`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          try {
            const parsed = JSON.parse(data);

            if (parsed.type === "image_status") {
              setConversations((prev) =>
                prev.map((c) =>
                  c.id === targetChatId
                    ? { ...c, messages: c.messages.map((m) => m.id === aiMsgId ? { ...m, imageStage: parsed.stage } : m) }
                    : c
                )
              );
            } else if (parsed.type === "image_result") {
              const imageData: ImageData = {
                url: parsed.url,
                prompt: parsed.prompt,
                revised_prompt: parsed.revised_prompt,
                size: parsed.size,
                model: parsed.model,
                provider: parsed.provider,
                response_id: parsed.response_id,
                sha256: parsed.sha256,
                id: parsed.id,
              };
              setConversations((prev) =>
                prev.map((c) =>
                  c.id === targetChatId
                    ? {
                        ...c,
                        messages: c.messages.map((m) =>
                          m.id === aiMsgId
                            ? { ...m, content: "", imageData, imageStage: null, imageError: null, isStreaming: false }
                            : m
                        ),
                      }
                    : c
                )
              );
              // Save image usage event to localStorage
              const imgConv = conversations.find(c => c.id === targetChatId);
              const imgUsagePayload = {
                chat_id: targetChatId,
                chat_title: imgConv?.title || prompt.slice(0, 35),
                message_id: String(aiMsgId),
                model: parsed.model || "openai/gpt-image-1",
                provider: parsed.provider || "niaai",
                input_tokens: 0,
                output_tokens: 0,
                reasoning_tokens: 0,
                cost_usd: 0.04,
                latency_ms: 0,
                ttft_ms: 0,
                kind: "tool_image",
                created_at: new Date().toISOString(),
              };
              if (currentUser?.email) {
                try {
                  const key = `nia_usage_events_${currentUser.email}`;
                  const existing = JSON.parse(localStorage.getItem(key) || "[]");
                  existing.push(imgUsagePayload);
                  localStorage.setItem(key, JSON.stringify(existing));
                } catch { /* ignore */ }
              }
              fetch("/api/usage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(imgUsagePayload) }).catch(() => {});
            } else if (parsed.type === "error") {
              setConversations((prev) =>
                prev.map((c) =>
                  c.id === targetChatId
                    ? {
                        ...c,
                        messages: c.messages.map((m) =>
                          m.id === aiMsgId
                            ? { ...m, content: "", imageStage: null, imageError: parsed.message || "Image generation failed", isStreaming: false }
                            : m
                        ),
                      }
                    : c
                )
              );
            }
          } catch { /* skip malformed SSE */ }
        }
      }
    } catch (err) {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === targetChatId
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === aiMsgId
                    ? { ...m, content: "", imageStage: null, imageError: err instanceof Error ? err.message : "Unknown error", isStreaming: false }
                    : m
                ),
              }
            : c
        )
      );
    }
  };

  const handleRegenerateImage = useCallback((msgId: number) => {
    if (!activeChatId) return;
    const conv = conversations.find((c) => c.id === activeChatId);
    if (!conv) return;
    const msg = conv.messages.find((m) => m.id === msgId);
    const prompt = msg?.imageData?.prompt;
    if (!prompt) return;
    // Remove the old image message and regenerate
    setConversations((prev) =>
      prev.map((c) => c.id === activeChatId ? { ...c, messages: c.messages.filter((m) => m.id !== msgId) } : c)
    );
    setIsGenerating(true);
    handleImageGen(prompt, activeChatId).finally(() => setIsGenerating(false));
  }, [activeChatId, conversations]);

  const handleRegenerateImageWithPrompt = useCallback((msgId: number, newPrompt: string) => {
    if (!activeChatId) return;
    // Remove the old image message and regenerate with the edited prompt
    setConversations((prev) =>
      prev.map((c) => c.id === activeChatId ? { ...c, messages: c.messages.filter((m) => m.id !== msgId) } : c)
    );
    setIsGenerating(true);
    handleImageGen(newPrompt, activeChatId).finally(() => setIsGenerating(false));
  }, [activeChatId]);

  const handleExport = useCallback(() => {
    if (!messages.length) return;
    const md = messages.map(m => `**${m.role === "user" ? "You" : "NiaAI"}**: ${m.content}`).join("\n\n");
    navigator.clipboard.writeText(md);
    showToast("Chat copied as Markdown");
  }, [messages]);

  const handleSend = async (text: string, attachments?: File[], features?: Set<string>) => {
    let chatId = activeChatId;
    if (!chatId) {
      const id = generateId();
      const title = text.length > 35 ? text.slice(0, 35) + "..." : text;
      const now = new Date().toISOString();
      const newConv: Conversation = { id, title, preview: text, projectId: activeView === "project-workspace" ? activeProjectId : null, createdAt: now, updatedAt: now, messages: [] };
      setConversations((prev) => [newConv, ...prev]);
      setActiveChatId(id);
      chatId = id;
    } else {
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== chatId) return c;
          const updates: Partial<Conversation> = { updatedAt: new Date().toISOString(), preview: text };
          if (c.title === "New Chat") updates.title = text.length > 35 ? text.slice(0, 35) + "..." : text;
          return { ...c, ...updates };
        })
      );
    }

    const currentTask = activeTask;
    const currentConnector = activeConnector;
    const parsedPages = parseTargetPages(text);
    const userMsgId = Date.now();
    const userMsg: Message = {
      id: userMsgId, role: "user", content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      attachments: attachments?.map((f) => ({ name: f.name, type: f.type })),
      isUploading: attachments && attachments.length > 0 ? true : undefined,
      task: currentTask,
      connector: currentConnector,
    };

    // Add user message immediately (shows "Reading…" chip while uploading)
    setConversations((prev) => {
      const existing = prev.find((c) => c.id === chatId);
      if (existing) return prev.map((c) => c.id === chatId ? { ...c, messages: [...c.messages, userMsg] } : c);
      return prev;
    });

    // Upload files if present
    let uploadedAttachments: UploadedAttachment[] = [];
    if (attachments && attachments.length > 0) {
      const uploadResults = await Promise.allSettled(
        attachments.map(async (file) => {
          const formData = new FormData();
          formData.append("file", file);
          const res = await fetch("/api/uploads", { method: "POST", body: formData });
          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Upload failed");
          }
          return res.json();
        })
      );

      for (const result of uploadResults) {
        if (result.status === "fulfilled") {
          uploadedAttachments.push(result.value);
        } else {
          showToast(result.reason?.message || "File upload failed");
        }
      }

      // Update user message with upload results (removes "Reading…" state)
      setConversations((prev) =>
        prev.map((c) =>
          c.id === chatId
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === userMsgId
                    ? { ...m, uploadedAttachments: uploadedAttachments.length > 0 ? uploadedAttachments : undefined, isUploading: undefined }
                    : m
                ),
              }
            : c
        )
      );
    }

    setIsGenerating(true);

    // Route to image generation if task is "image" or intent detected
    const imageKeywords = /\b(generate|create|make|draw|render|design|paint|produce)\b.{0,40}\b(image|picture|photo|illustration|logo|icon|artwork|wallpaper|poster|banner|portrait|sketch)\b/i;
    const imageOfPattern = /\b(image|picture|photo)\s+of\b/i;
    if (currentTask === "image" || (features?.has("Image Gen")) || imageKeywords.test(text) || imageOfPattern.test(text)) {
      await handleImageGen(text, chatId);
      setIsGenerating(false);
      setActiveTask(null);
      return;
    }

    const currentConv = conversations.find((c) => c.id === chatId);
    // Build messages with attachment refs for the API
    const chatMessages = [
      ...(currentConv?.messages || []).map((m) => ({
        role: m.role,
        content: (m as any).docData
          ? `[Document created: ${(m as any).docData.filename}, ${(m as any).docData.pages} pages]`
          : m.content,
        ...(m.uploadedAttachments ? { attachments: m.uploadedAttachments } : {}),
      })),
      {
        role: "user" as const,
        content: text,
        ...(uploadedAttachments.length > 0 ? { attachments: uploadedAttachments } : {}),
      },
    ];

    const aiMsgId = Date.now() + 1;
    const aiMsg: Message = { id: aiMsgId, role: "assistant", content: "", timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), isStreaming: true };

    setConversations((prev) => prev.map((c) => c.id === chatId ? { ...c, messages: [...c.messages, aiMsg] } : c));

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const projectInstruction = activeProject?.instructions ? `Project "${activeProject.name}" instructions:\n${activeProject.instructions}\n\n` : "";
    const systemMsg = projectInstruction ? { role: "system" as const, content: projectInstruction.trim() } : null;
    const allMessages = systemMsg ? [systemMsg, ...chatMessages] : chatMessages;

    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: allMessages, model: selectedModel.modelId, stream: true, task: currentTask, web_search: webSearchEnabled, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, target_pages: parsedPages?.target, strict_pages: parsedPages?.strict, provider: selectedModel.provider || "niaai", thinking: thinkingLevel, chatId, messageId: String(aiMsgId), chatTitle: activeConv?.title || "", connector: currentConnector?.provider || undefined, connectorId: currentConnector?.connectorId || undefined }),
        signal: controller.signal,
      });
      if (!res.ok) { const t = await res.text(); throw new Error(t || `API error: ${res.status}`); }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let fullContent = "";
      let buffer = "";
      let collectedSources: SourceItem[] = [];
      let readCount: number | null = null;
      let firstTokenReceived = false;
      const streamStartTime = Date.now();

      // 10s/20s timeout: show warnings if no tokens arrive
      const timeoutCheck10 = setTimeout(() => {
        if (!firstTokenReceived) {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === chatId ? { ...c, messages: c.messages.map((m) => m.id === aiMsgId ? { ...m, searchStatus: m.searchStatus || "Taking longer than usual\u2026" } : m) } : c
            )
          );
        }
      }, 10000);
      const timeoutCheck20 = setTimeout(() => {
        if (!firstTokenReceived) {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === chatId ? { ...c, messages: c.messages.map((m) => m.id === aiMsgId ? { ...m, searchStatus: "Request timed out — try again", isStreaming: false } : m) } : c
            )
          );
        }
      }, 20000);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);

            // Handle custom events from our chat route
            if (parsed.type === "status") {
              setConversations((prev) =>
                prev.map((c) =>
                  c.id === chatId ? { ...c, messages: c.messages.map((m) => m.id === aiMsgId ? { ...m, searchStatus: parsed.text } : m) } : c
                )
              );
              continue;
            }

            if (parsed.type === "sources") {
              collectedSources = parsed.items || [];
              const latestDate = parsed.latest_date || null;
              setConversations((prev) =>
                prev.map((c) =>
                  c.id === chatId ? { ...c, messages: c.messages.map((m) => m.id === aiMsgId ? { ...m, sources: collectedSources, sourcesLatestDate: latestDate, webSearchUsed: true } : m) } : c
                )
              );
              continue;
            }

            if (parsed.type === "search_read_count") {
              readCount = parsed.fetched ?? 0;
              setConversations((prev) =>
                prev.map((c) =>
                  c.id === chatId ? { ...c, messages: c.messages.map((m) => m.id === aiMsgId ? { ...m, searchReadCount: readCount } : m) } : c
                )
              );
              continue;
            }

            if (parsed.type === "sources_summary") {
              collectedSources = parsed.items || collectedSources;
              setConversations((prev) =>
                prev.map((c) =>
                  c.id === chatId ? { ...c, messages: c.messages.map((m) => m.id === aiMsgId ? { ...m, sources: collectedSources, webSearchUsed: true } : m) } : c
                )
              );
              continue;
            }

            // Connector sources (Slack/Discord permalinks)
            if (parsed.type === "connector_sources") {
              setConversations((prev) =>
                prev.map((c) =>
                  c.id === chatId ? { ...c, messages: c.messages.map((m) => m.id === aiMsgId ? { ...m, connectorSearchUsed: parsed.provider, connectorSources: parsed.items } : m) } : c
                )
              );
              continue;
            }

            if (parsed.type === "link_cards") {
              setConversations((prev) =>
                prev.map((c) =>
                  c.id === chatId ? { ...c, messages: c.messages.map((m) => m.id === aiMsgId ? { ...m, linkCards: parsed.items || [] } : m) } : c
                )
              );
              continue;
            }

            // Light search note for mixed generation intents (e.g. "make an image of the latest iPhone")
            if (parsed.type === "search_note") {
              setConversations((prev) =>
                prev.map((c) =>
                  c.id === chatId ? { ...c, messages: c.messages.map((m) => m.id === aiMsgId ? { ...m, searchNote: parsed.text } : m) } : c
                )
              );
              continue;
            }

            // Usage event from the server
            if (parsed.type === "usage") {
              setConversations((prev) =>
                prev.map((c) =>
                  c.id === chatId ? { ...c, messages: c.messages.map((m) => m.id === aiMsgId ? { ...m, usage: { input_tokens: parsed.input_tokens || 0, output_tokens: parsed.output_tokens || 0, cached_input_tokens: parsed.cached_input_tokens, reasoning_tokens: parsed.reasoning_tokens, latency_ms: parsed.latency_ms || 0, ttft_ms: parsed.ttft_ms, cost_usd: parsed.cost_usd || 0 }, modelId: parsed.model_id || parsed.model, modelProvider: parsed.provider, modelLabel: selectedModel.name, thinkingLevel: parsed.thinking_level, servedModel: parsed.served_model, requestedModel: parsed.requested_model, requestId: parsed.request_id } : m) } : c
                )
              );
              // Save usage event to localStorage + POST to /api/usage
              // Resolve title: activeConv.title may still be "New Chat" due to React closure
              const resolvedTitle = (activeConv?.title && activeConv.title !== "New Chat")
                ? activeConv.title
                : (text.length > 35 ? text.slice(0, 35) + "..." : text);
              const usagePayload = { ...parsed, chat_id: chatId, chat_title: resolvedTitle, message_id: String(aiMsgId), created_at: new Date().toISOString(), kind: "chat" };
              if (currentUser?.email) {
                try {
                  const key = `nia_usage_events_${currentUser.email}`;
                  const existing = JSON.parse(localStorage.getItem(key) || "[]");
                  existing.push(usagePayload);
                  localStorage.setItem(key, JSON.stringify(existing));
                } catch { /* ignore storage errors */ }
              }
              fetch("/api/usage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(usagePayload) }).catch(() => {});
              continue;
            }

            // Hard guard: server is replacing content with a corrected answer
            if (parsed.type === "replace_content") {
              fullContent = "";
              setConversations((prev) =>
                prev.map((c) =>
                  c.id === chatId ? { ...c, messages: c.messages.map((m) => m.id === aiMsgId ? { ...m, content: "", searchStatus: "Verifying answer\u2026" } : m) } : c
                )
              );
              continue;
            }

            // Structured error from server
            if (parsed.error === true || parsed.type === "error") {
              const errorData: Message["errorData"] = {
                error_type: parsed.error_type || "provider_error",
                title: parsed.title || "Something went wrong",
                message: parsed.message || "An error occurred",
                provider: parsed.provider,
                model: parsed.model,
                via: parsed.via,
                actions: parsed.actions || ["retry"],
              };
              setConversations((prev) =>
                prev.map((c) =>
                  c.id === chatId ? { ...c, messages: c.messages.map((m) => m.id === aiMsgId ? { ...m, content: "", errorData, isStreaming: false } : m) } : c
                )
              );
              continue;
            }

            // Standard chat completion delta
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              if (!firstTokenReceived) {
                firstTokenReceived = true;
                clearTimeout(timeoutCheck10);
                clearTimeout(timeoutCheck20);
              }
              fullContent += delta;
              const updatedContent = fullContent;
              setConversations((prev) =>
                prev.map((c) =>
                  c.id === chatId ? { ...c, messages: c.messages.map((m) => m.id === aiMsgId ? { ...m, content: updatedContent, searchStatus: null } : m) } : c
                )
              );
            }
          } catch { /* skip */ }
        }
      }

      clearTimeout(timeoutCheck10);
      clearTimeout(timeoutCheck20);

      setConversations((prev) =>
        prev.map((c) => c.id === chatId ? { ...c, messages: c.messages.map((m) => m.id === aiMsgId ? { ...m, isStreaming: false, searchStatus: null, searchReadCount: readCount ?? m.searchReadCount, sources: collectedSources.length > 0 ? collectedSources : m.sources, webSearchUsed: collectedSources.length > 0 ? true : m.webSearchUsed, modelId: m.modelId || selectedModel.modelId, modelProvider: m.modelProvider || selectedModel.provider, modelLabel: m.modelLabel || selectedModel.name, thinkingLevel: m.thinkingLevel || thinkingLevel } : m) } : c)
      );

      // --- Document generation: detect intent and render file ---
      const docKeywords = /\b(create|make|generate|write|export|build|prepare|draft)\b.{0,30}\b(pdf|document|report|brochure|guide|docx|word\s*file|excel|spreadsheet|csv|pptx|powerpoint|slides|deck|presentation|file)\b/i;
      const isDocRequest = currentTask === "slides" || docKeywords.test(text);

      // Bug 3 fix: When doc intent is detected and a tool call (file generation) follows,
      // discard any streamed prose longer than 200 chars — the user only sees the file card.
      // Show at most one brief sentence in chat.
      let docContent = fullContent;
      if (isDocRequest && docContent.length > 200) {
        // Strip preamble: find the first heading and use from there
        const headingIdx = docContent.indexOf("\n# ");
        const altHeadingIdx = docContent.indexOf("# ");
        const startIdx = altHeadingIdx === 0 ? 0 : (headingIdx >= 0 ? headingIdx + 1 : -1);
        if (startIdx >= 0) {
          docContent = docContent.slice(startIdx);
        }
        // Clear streamed prose from chat — user will only see the file card
        setConversations((prev) =>
          prev.map((c) => c.id === chatId ? { ...c, messages: c.messages.map((m) => m.id === aiMsgId ? { ...m, content: "" } : m) } : c)
        );
      }

      // Post-check: if the AI refused to create a document, retry with forced instruction
      const refusalPatterns = /\b(cannot create|can't create|I cannot|copy and paste|Image Suggestion|how to create the pdf|use Word|use Canva)\b/i;
      if (isDocRequest && refusalPatterns.test(fullContent) && fullContent.length < 500) {
        // AI refused — retry with forced document instruction
        try {
          const retryRes = await fetch("/api/chat", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: [...allMessages, { role: "assistant", content: fullContent }, { role: "user", content: "Please write the COMPLETE document content now. Do not explain how to create it — write the actual content with full sections, paragraphs, and details. Minimum 1200 words." }],
              model: selectedModel.modelId, stream: false, task: "document", web_search: false, provider: selectedModel.provider || "niaai", thinking: thinkingLevel,
            }),
          });
          if (retryRes.ok) {
            const retryData = await retryRes.json();
            const retryContent = retryData.choices?.[0]?.message?.content || "";
            if (retryContent.length > 500 && !refusalPatterns.test(retryContent)) {
              docContent = retryContent;
              // Update the message content with the retry
              setConversations((prev) =>
                prev.map((c) => c.id === chatId ? { ...c, messages: c.messages.map((m) => m.id === aiMsgId ? { ...m, content: "" } : m) } : c)
              );
            }
          }
        } catch { /* retry failed, continue with original */ }
      }

      if (isDocRequest && docContent.length > 100) {
        // Determine document type from user message
        let docType: "pdf" | "docx" | "xlsx" | "csv" | "pptx" | "md" = "pdf";
        const lowerText = text.toLowerCase();
        if (/\b(docx|word)\b/.test(lowerText)) docType = "docx";
        else if (/\b(xlsx|excel|spreadsheet)\b/.test(lowerText)) docType = "xlsx";
        else if (/\b(csv)\b/.test(lowerText)) docType = "csv";
        else if (/\b(pptx|powerpoint|slides|deck|presentation)\b/.test(lowerText) || currentTask === "slides") docType = "pptx";
        else if (/\b(md|markdown)\b/.test(lowerText)) docType = "md";

        // Determine theme from user text
        let theme: "travel" | "business" | "academic" | "minimal" = "minimal";
        if (/\b(travel|tourism|trip|destination|itinerary|vacation|holiday)\b/i.test(lowerText)) theme = "travel";
        else if (/\b(business|corporate|company|strategy|market|finance|revenue)\b/i.test(lowerText)) theme = "business";
        else if (/\b(academic|research|study|thesis|paper|journal|university|school|education)\b/i.test(lowerText)) theme = "academic";

        // Extract title from first H1 or first line, fallback to user text
        const titleMatch = docContent.match(/^#\s+(.+)$/m);
        const docTitle = titleMatch ? titleMatch[1].trim() : (text.length > 60 ? text.slice(0, 60) : text);

        // Extract subtitle from first paragraph or H2
        const subtitleMatch = docContent.match(/^##\s+(.+)$/m);
        const docSubtitle = subtitleMatch ? subtitleMatch[1].trim() : undefined;

        // Show progress: writing stage (already done since content is streamed)
        setConversations((prev) =>
          prev.map((c) => c.id === chatId ? { ...c, messages: c.messages.map((m) => m.id === aiMsgId ? { ...m, content: "", docStage: "rendering" } : m) } : c)
        );

        try {
          const genRes = await fetch("/api/documents/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: docType, title: docTitle, subtitle: docSubtitle, content_markdown: docContent, options: { theme }, target_pages: parseTargetPages(text)?.target ?? null, strict_pages: parseTargetPages(text)?.strict ?? false, message_id: aiMsgId, chat_id: chatId }),
          });

          if (!genRes.ok) {
            const errData = await genRes.json();
            throw new Error(errData.error || "Document generation failed");
          }

          // Show uploading stage
          setConversations((prev) =>
            prev.map((c) => c.id === chatId ? { ...c, messages: c.messages.map((m) => m.id === aiMsgId ? { ...m, docStage: "uploading" } : m) } : c)
          );

          const fileData = await genRes.json();

          // Show completed file card — clear content so only the card shows
          setConversations((prev) =>
            prev.map((c) => c.id === chatId ? {
              ...c, messages: c.messages.map((m) => m.id === aiMsgId ? {
                ...m,
                content: "",
                docStage: null,
                docData: {
                  url: fileData.url,
                  filename: fileData.filename,
                  type: fileData.type,
                  size_bytes: fileData.size_bytes,
                  pages: fileData.pages,
                  file_id: fileData.file_id,
                  summary: docTitle,
                  target_pages: fileData.target_pages,
                  fit_exact: fileData.fit_exact,
                },
              } : m)
            } : c)
          );
        } catch (docErr) {
          setConversations((prev) =>
            prev.map((c) => c.id === chatId ? {
              ...c, messages: c.messages.map((m) => m.id === aiMsgId ? {
                ...m,
                docStage: null,
                docError: docErr instanceof Error ? docErr.message : "Document generation failed",
              } : m)
            } : c)
          );
        }
      }

      // Auto-generate title after first assistant reply
      const currentConv = conversations.find(c => c.id === chatId);
      if (currentConv && currentConv.messages.length <= 2) {
        const isUrlOnly = /^https?:\/\/[^\s]+$/.test(text.trim());

        if (isUrlOnly) {
          // For URL-only messages, use link card data directly if available
          const aiMsg = currentConv.messages.find(m => m.id === aiMsgId);
          const lc = aiMsg?.linkCards?.[0];
          if (lc && lc.title) {
            const urlTitle = `${lc.domain}: ${lc.title.slice(0, 40)}`;
            setConversations(prev =>
              prev.map(c => c.id === chatId ? { ...c, title: urlTitle } : c)
            );
          }
        } else {
          // Call the title API for regular messages
          fetch("/api/title", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userMessage: text,
              assistantMessage: fullContent.slice(0, 500),
              chatId,
              isUrl: false,
            }),
          })
            .then(r => r.json())
            .then(data => {
              if (data.title) {
                setConversations(prev =>
                  prev.map(c => c.id === chatId ? { ...c, title: data.title } : c)
                );
              }
            })
            .catch(() => {});
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      // Parse structured error from server
      let errorData: Message["errorData"] = null;
      const errMsg = err instanceof Error ? err.message : "Failed";
      try {
        const parsed = JSON.parse(errMsg);
        if (parsed.error_type) {
          errorData = {
            error_type: parsed.error_type,
            title: parsed.title || "Something went wrong",
            message: parsed.message || errMsg,
            provider: parsed.provider,
            model: parsed.model,
            via: parsed.via,
            actions: parsed.actions,
          };
        }
      } catch { /* not JSON */ }

      if (!errorData) {
        errorData = {
          error_type: "unknown",
          title: "Something went wrong",
          message: errMsg,
          actions: ["retry", "open_settings"],
        };
      }

      setConversations((prev) =>
        prev.map((c) =>
          c.id === chatId ? { ...c, messages: c.messages.map((m) => m.id === aiMsgId ? { ...m, content: "", errorData, isStreaming: false } : m) } : c
        )
      );
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  };

  const handleErrorAction = useCallback((action: string) => {
    if (action === "open_settings") {
      setConfigPanelOpen(true);
    } else if (action === "retry") {
      // Retry the last message
      if (!activeChatId) return;
      const conv = conversations.find((c) => c.id === activeChatId);
      if (!conv) return;
      const lastUserMsg = [...conv.messages].reverse().find((m) => m.role === "user");
      if (lastUserMsg) {
        // Remove the error message and resend
        setConversations((prev) =>
          prev.map((c) => c.id === activeChatId ? { ...c, messages: c.messages.filter((m) => !m.errorData) } : c)
        );
        handleSend(lastUserMsg.content);
      }
    } else if (action === "pick_model") {
      // Open the model selector so the user can pick another model
      // Remove the error message
      if (activeChatId) {
        setConversations((prev) =>
          prev.map((c) => c.id === activeChatId ? { ...c, messages: c.messages.filter((m) => !m.errorData) } : c)
        );
      }
      showToast("Pick a different model from the selector above");
    } else if (action === "use_gateway") {
      // Switch to gateway model and retry
      const niaModel = models.find((m) => m.provider === "niaai");
      if (niaModel) setSelectedModel(niaModel);
      // Then retry
      if (!activeChatId) return;
      const conv = conversations.find((c) => c.id === activeChatId);
      if (!conv) return;
      const lastUserMsg = [...conv.messages].reverse().find((m) => m.role === "user");
      if (lastUserMsg) {
        setConversations((prev) =>
          prev.map((c) => c.id === activeChatId ? { ...c, messages: c.messages.filter((m) => !m.errorData) } : c)
        );
        // Small delay to let state update
        setTimeout(() => handleSend(lastUserMsg.content), 100);
      }
    }
  }, [activeChatId, conversations, handleSend]);

  const handleOpenAutomationModal = useCallback((automation?: Automation | null, template?: AutomationTemplate | null) => {
    setEditingAutomation(automation ?? null);
    setPrefillTemplate(template ?? null);
    setAutomationModalOpen(true);
  }, []);

  const handleSaveAutomation = useCallback(async (data: AutomationFormData) => {
    try {
      const url = editingAutomation ? `/api/automations/${editingAutomation.id}` : "/api/automations";
      const method = editingAutomation ? "PUT" : "POST";
      const body = {
        ...data,
        attachments: [],
        connectors: data.connectors || [],
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json(); showToast(err.error || "Failed to save"); return; }
      showToast(editingAutomation ? "Automation updated" : "Automation saved");
      setAutomationModalOpen(false);
      setEditingAutomation(null);
      setPrefillTemplate(null);
    } catch { showToast("Failed to save automation"); }
  }, [editingAutomation]);

  const handleLogout = () => {
    const email = currentUser?.email;
    setConversations([]); setProjects([]); setPinnedChatIds(new Set());
    setActiveChatId(null); setActiveProjectId(null); setSelectedModel(models[0]);
    setCurrentUser(null);
    localStorage.removeItem("nia_current_user");
    if (email) {
      localStorage.removeItem(`nia_conversations_${email}`);
      localStorage.removeItem(`nia_projects_${email}`);
      localStorage.removeItem(`nia_activechat_${email}`);
      localStorage.removeItem(`nia_pinned_${email}`);
    }
  };


  const handleSendInProject = useCallback((text: string) => {
    const id = generateId();
    const title = text.length > 35 ? text.slice(0, 35) + "..." : text;
    const now = new Date().toISOString();
    const userMsg = {
      id: Date.now(),
      role: "user" as const,
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    const newConv: Conversation = { id, title, preview: text, projectId: activeProjectId, createdAt: now, updatedAt: now, messages: [userMsg] };
    setConversations((prev) => [newConv, ...prev]);
    setActiveChatId(id);
  }, [activeProjectId]);

  const handleUpdateProjectInstructions = useCallback((instructions: string) => {
    if (!activeProjectId) return;
    setProjects(prev => prev.map(p => p.id === activeProjectId ? { ...p, instructions } : p));
  }, [activeProjectId]);

  // Voice mode: send a voice message and get AI response
  const handleVoiceSend = useCallback(async (text: string) => {
    if (!text.trim()) return;
    let chatId = activeChatId;
    if (!chatId) {
      const id = generateId();
      const title = text.length > 35 ? text.slice(0, 35) + "..." : text;
      const now = new Date().toISOString();
      const newConv: Conversation = { id, title, preview: text, projectId: activeView === "project-workspace" ? activeProjectId : null, createdAt: now, updatedAt: now, messages: [] };
      setConversations((prev) => [newConv, ...prev]);
      setActiveChatId(id);
      chatId = id;
    }

    const userMsg: Message = {
      id: Date.now(), role: "user", content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      via: "voice",
    };

    setConversations((prev) => {
      const existing = prev.find((c) => c.id === chatId);
      if (existing) return prev.map((c) => c.id === chatId ? { ...c, messages: [...c.messages, userMsg], updatedAt: new Date().toISOString() } : c);
      return prev;
    });

    setVoiceAiResponse("");
    setVoiceAiStreaming(true);
    setIsGenerating(true);

    const aiMsgId = Date.now() + 1;
    const aiMsg: Message = { id: aiMsgId, role: "assistant", content: "", timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), isStreaming: true, via: "voice" };
    setConversations((prev) => prev.map((c) => c.id === chatId ? { ...c, messages: [...c.messages, aiMsg] } : c));

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const currentConv = conversations.find((c) => c.id === chatId);
    const chatMessages = [
      ...(currentConv?.messages || []).map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: text },
    ];

    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: chatMessages, model: selectedModel.modelId, stream: true, provider: selectedModel.provider || "niaai", thinking: thinkingLevel, chatId: activeChatId, messageId: String(aiMsgId), chatTitle: currentConv?.title || "" }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`API error: ${res.status}`);

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let fullContent = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullContent += delta;
              setVoiceAiResponse(fullContent);
              setConversations((prev) =>
                prev.map((c) => c.id === chatId ? { ...c, messages: c.messages.map((m) => m.id === aiMsgId ? { ...m, content: fullContent } : m) } : c)
              );
            }
          } catch { /* skip */ }
        }
      }

      setConversations((prev) =>
        prev.map((c) => c.id === chatId ? { ...c, messages: c.messages.map((m) => m.id === aiMsgId ? { ...m, isStreaming: false } : m) } : c)
      );

      // Auto-generate title after first voice assistant reply
      const voiceConv = conversations.find(c => c.id === chatId);
      if (voiceConv && voiceConv.messages.length <= 2) {
        fetch("/api/title", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userMessage: text,
            assistantMessage: fullContent.slice(0, 500),
            chatId,
            isUrl: false,
          }),
        })
          .then(r => r.json())
          .then(data => {
            if (data.title) {
              setConversations(prev =>
                prev.map(c => c.id === chatId ? { ...c, title: data.title } : c)
              );
            }
          })
          .catch(() => {});
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      const errMsg = err instanceof Error ? err.message : "Failed";
      setVoiceAiResponse(`Error: ${errMsg}`);
      setConversations((prev) =>
        prev.map((c) => c.id === chatId ? { ...c, messages: c.messages.map((m) => m.id === aiMsgId ? { ...m, content: `Error: ${errMsg}`, isStreaming: false } : m) } : c)
      );
    } finally {
      setIsGenerating(false);
      setVoiceAiStreaming(false);
      abortControllerRef.current = null;
    }
  }, [activeChatId, activeView, activeProjectId, conversations, selectedModel.modelId]);

  const handleVoiceInterrupt = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsGenerating(false);
    setVoiceAiStreaming(false);
  }, []);

  const conversationItems: ConversationItem[] = conversations.map((c) => ({
    id: c.id, title: c.title, preview: c.preview, projectId: c.projectId, createdAt: c.createdAt, updatedAt: c.updatedAt,
  }));

  if (!authChecked) return null;
  if (!currentUser) return <AuthModal onAuth={handleAuth} />;

  const renderContent = () => {
    switch (activeView) {
      case "history":
        return <HistoryView conversations={conversationItems} activeConversationId={activeChatId} onSelectConversation={handleSelectConversation} onNewChat={handleNewChat} />;

      case "projects":
        return <ProjectsView projects={projects} onCreateProject={handleCreateProject} onOpenProject={handleOpenProject} onDeleteProject={handleDeleteProject} onRenameProject={handleRenameProject} />;

      case "project-workspace":
        return (
          <>
            <div className="flex-1 flex flex-col" style={{ minHeight: 0, overflowY: "auto" }}>
              {activeChatId && messages.length > 0 ? (
                <div className="mx-auto w-full px-4 py-4 space-y-4" style={{ maxWidth: 920 }}>
                  {messages.flatMap((msg, idx) => {
                    const items: React.ReactNode[] = [];
                    if (msg.role === "assistant" && idx > 0) {
                      const prev = messages.slice(0, idx).reverse().find(m => m.role === "assistant" && m.modelId);
                      if (prev && msg.modelId && prev.modelId !== msg.modelId) {
                        const label = msg.modelLabel || msg.modelId?.split("/").pop() || "unknown";
                        items.push(
                          <div key={`sw-${msg.id}`} className="flex items-center gap-3 py-1">
                            <div className="flex-1 border-t border-[var(--border)]" />
                            <span className="text-[11px] text-[var(--text-faint)] font-medium whitespace-nowrap">Switched to {label}</span>
                            <div className="flex-1 border-t border-[var(--border)]" />
                          </div>
                        );
                      }
                    }
                    items.push(<ChatMessage key={msg.id} message={msg} onRegenerate={msg.role === "assistant" ? handleRegenerate : undefined} onRegenerateImage={msg.imageData ? () => handleRegenerateImage(msg.id) : undefined} onRegenerateImageWithPrompt={msg.imageData ? (p: string) => handleRegenerateImageWithPrompt(msg.id, p) : undefined} onErrorAction={handleErrorAction} modelName={selectedModel.name} />);
                    return items;
                  })}
                  {isGenerating && messages[messages.length - 1]?.role === "user" && (
                    <div className="flex gap-3 animate-bubble-in">
                      <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#8b3dff] to-[#c13bd9] flex items-center justify-center shrink-0 mt-0.5">
                        <Sparkles size={13} className="text-white" />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[11px] font-semibold text-[var(--text-muted)]">NiaAI</span>
                        <div className="shimmer text-[13px]">Thinking...</div>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              ) : (
                <HistoryView
                  conversations={conversationItems}
                  activeConversationId={activeChatId}
                  onSelectConversation={handleSelectConversation}
                  onNewChat={() => setActiveChatId(null)}
                  projectId={activeProjectId}
                  projectName={activeProject?.name}
                  project={activeProject || null}
                  onBackToProjects={() => { setActiveProjectId(null); setActiveView("projects"); }}
                  onSendInProject={handleSendInProject}
                  onUpdateProjectInstructions={handleUpdateProjectInstructions}
                  onRenameProject={(name: string) => { if (activeProjectId) handleRenameProject(activeProjectId, name); }}
                  onDeleteProject={() => { if (activeProjectId) handleDeleteProject(activeProjectId); }}
                  onRenameChatFromProject={handleRenameChat}
                  onDeleteChatFromProject={handleRequestDeleteChat}
                  onPinChatFromProject={handleTogglePin}
                />
              )}
            </div>
            {activeChatId && (
              <ChatInput onSend={handleSend} isGenerating={isGenerating} onStop={handleStop} selectedModel={selectedModel} onModelChange={setSelectedModel} hasMessages={messages.length > 0} activeTask={activeTask} onTaskChange={setActiveTask} onRegisterFilePicker={(fn) => { filePickerTriggerRef.current = fn; }} onOpenVoiceMode={() => setVoiceModeOpen(true)} webSearchEnabled={webSearchEnabled} onToggleWebSearch={() => setWebSearchEnabled((v) => !v)} thinkingLevel={thinkingLevel} onThinkingChange={setThinkingLevel} onOpenConfigPanel={() => setConfigPanelOpen(true)} connectorStatuses={connectorStatuses} activeConnector={activeConnector} onConnectorChange={setActiveConnector} onOpenConnectors={() => setActiveView("connectors")} />
            )}
          </>
        );

      case "automations":
        return <AutomationsPage onOpenModal={handleOpenAutomationModal} />;

      case "logs":
        return <LogsPage deletedChats={deletedChatsMap} />;

      case "connectors":
        return (
          <ConnectorsPage
            onBack={() => setActiveView("chat")}
            onNewChat={(seedPrompt) => {
              setActiveView("chat");
              if (seedPrompt) handleSend(seedPrompt);
            }}
            onOpenDetail={(provider: "slack" | "discord") => {
              setDetailProvider(provider);
              setActiveView("connector-detail");
            }}
          />
        );

      case "connector-detail":
        return (
          <ConnectorDetailPage
            provider={detailProvider}
            onBack={() => setActiveView("connectors")}
            onNewChat={(seedPrompt, connector, accountId, accountName) => {
              setActiveConnector(
                accountId
                  ? { provider: connector, connectorId: accountId, workspaceName: accountName || connector }
                  : { provider: connector, connectorId: "", workspaceName: connector === "slack" ? "Slack" : "Discord" }
              );
              setActiveView("chat");
              if (seedPrompt) handleSend(seedPrompt);
            }}
            onOpenConnectors={() => setActiveView("connectors")}
          />
        );

      case "explore":
        return <WebSearchView onBack={() => setActiveView("chat")} />;

      case "chat":
      default:
        return (
          <>
            <div className="flex-1 flex flex-col" style={{ minHeight: 0, overflowY: "auto" }}>
              {messages.length === 0 ? (
                <WelcomeScreen key={newChatKey} onSuggestionClick={(text) => handleSend(text)} userName={currentUser?.name} isGenerating={isGenerating} activeTask={activeTask} onSelectTask={setActiveTask} onOpenFilePicker={() => filePickerTriggerRef.current?.()} hasChats={conversations.length > 0} />
              ) : (
                <div className="mx-auto w-full px-4 py-4 space-y-4" style={{ maxWidth: 920 }}>
                  {messages.flatMap((msg, idx) => {
                    const items: React.ReactNode[] = [];
                    if (msg.role === "assistant" && idx > 0) {
                      const prev = messages.slice(0, idx).reverse().find(m => m.role === "assistant" && m.modelId);
                      if (prev && msg.modelId && prev.modelId !== msg.modelId) {
                        const label = msg.modelLabel || msg.modelId?.split("/").pop() || "unknown";
                        items.push(
                          <div key={`sw-${msg.id}`} className="flex items-center gap-3 py-1">
                            <div className="flex-1 border-t border-[var(--border)]" />
                            <span className="text-[11px] text-[var(--text-faint)] font-medium whitespace-nowrap">Switched to {label}</span>
                            <div className="flex-1 border-t border-[var(--border)]" />
                          </div>
                        );
                      }
                    }
                    items.push(<ChatMessage key={msg.id} message={msg} onRegenerate={msg.role === "assistant" ? handleRegenerate : undefined} onRegenerateImage={msg.imageData ? () => handleRegenerateImage(msg.id) : undefined} onRegenerateImageWithPrompt={msg.imageData ? (p: string) => handleRegenerateImageWithPrompt(msg.id, p) : undefined} onErrorAction={handleErrorAction} modelName={selectedModel.name} />);
                    return items;
                  })}
                  {isGenerating && messages[messages.length - 1]?.role === "user" && (
                    <div className="flex gap-3 animate-bubble-in">
                      <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#8b3dff] to-[#c13bd9] flex items-center justify-center shrink-0 mt-0.5">
                        <Sparkles size={13} className="text-white" />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[11px] font-semibold text-[var(--text-muted)]">NiaAI</span>
                        <div className="shimmer text-[13px]">Thinking...</div>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>
            <ChatInput onSend={handleSend} isGenerating={isGenerating} onStop={handleStop} selectedModel={selectedModel} onModelChange={setSelectedModel} hasMessages={messages.length > 0} activeTask={activeTask} onTaskChange={setActiveTask} onRegisterFilePicker={(fn) => { filePickerTriggerRef.current = fn; }} onOpenVoiceMode={() => setVoiceModeOpen(true)} webSearchEnabled={webSearchEnabled} onToggleWebSearch={() => setWebSearchEnabled((v) => !v)} thinkingLevel={thinkingLevel} onThinkingChange={setThinkingLevel} onOpenConfigPanel={() => setConfigPanelOpen(true)} connectorStatuses={connectorStatuses} activeConnector={activeConnector} onConnectorChange={setActiveConnector} onOpenConnectors={() => setActiveView("connectors")} />
          </>
        );
    }
  };

  return (
    <div className="h-full flex bg-[var(--bg-primary)] relative">

      {/* Sidebar */}
      <Sidebar
        activeView={activeView}
        onNavigate={handleNavigate}
        onNewChat={handleNewChat}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        activeProjectId={activeProjectId}
        activeProjectName={activeProject?.name}
        onLogout={handleLogout}
        chats={sidebarChats}
        activeChatId={activeChatId}
        onSelectChat={handleSelectConversation}
        onTogglePin={handleTogglePin}
        onDeleteChat={handleRequestDeleteChat}
        onRenameChat={handleRenameChat}
        onArchiveChat={handleArchiveChat}
        onShareChat={handleShareChat}
        onMoveToProject={handleMoveChatToProject}
        projects={enrichedProjects}
        onOpenProject={handleOpenProject}
        onCreateProject={() => setActiveView("projects")}
        onCommandPalette={() => setCommandPaletteOpen(true)}
        onOpenConnectorDetail={(provider) => {
          setDetailProvider(provider);
          setActiveView("connector-detail");
        }}
        userName={currentUser?.name}
      />

      {/* Main Panel (inset) */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden main-panel">
        {/* Header (64px) */}
        <header className="flex items-center gap-3 px-4 sticky top-0 z-30 glass-header" style={{ height: 48 }}>
          {/* Left: sidebar toggle + breadcrumb */}
          <div className="flex items-center shrink-0">
            {sidebarCollapsed && (
              <button
                onClick={() => setSidebarCollapsed(false)}
                className="p-2 rounded-lg hover:bg-[var(--bg-hover)] transition-colors text-[var(--text-muted)]"
              >
                <PanelLeft size={18} />
              </button>
            )}
          </div>
          {activeConv ? (
            <>
              <span className="text-[13px] font-medium text-[var(--text-primary)] truncate max-w-[300px]">{activeConv.title}</span>
              {messages.length > 0 && (() => {
                const chatUsage = messages.filter(m => m.usage).reduce((acc, m) => ({
                  input_tokens: acc.input_tokens + (m.usage?.input_tokens || 0),
                  output_tokens: acc.output_tokens + (m.usage?.output_tokens || 0),
                  cost_usd: acc.cost_usd + (m.usage?.cost_usd || 0),
                  requests: acc.requests + 1,
                }), { input_tokens: 0, output_tokens: 0, cost_usd: 0, requests: 0 });
                if (chatUsage.requests === 0) return null;
                const fmtTok = (n: number) => n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + "M" : n >= 1_000 ? (n / 1_000).toFixed(1) + "K" : String(n);
                return (
                  <div className="relative">
                    <button
                      onClick={() => setUsagePopoverOpen(v => !v)}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] transition-colors text-[11px]"
                      title="Chat usage"
                    >
                      <Info size={13} />
                      <span>Usage</span>
                    </button>
                    {usagePopoverOpen && (
                      <>
                        <div className="fixed inset-0 z-[100]" onClick={() => setUsagePopoverOpen(false)} />
                        <div className="absolute top-full left-0 mt-1 z-[101] bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl shadow-lg shadow-black/30 p-3 w-[220px]">
                          <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">This chat</p>
                          <div className="space-y-1 text-[12px]">
                            <div className="flex justify-between"><span className="text-[var(--text-muted)]">Requests</span><span className="text-[var(--text-primary)] font-medium" style={{ fontVariantNumeric: "tabular-nums" }}>{chatUsage.requests}</span></div>
                            <div className="flex justify-between"><span className="text-[var(--text-muted)]">Input</span><span className="text-[var(--text-primary)] font-medium" style={{ fontVariantNumeric: "tabular-nums" }}>{fmtTok(chatUsage.input_tokens)}</span></div>
                            <div className="flex justify-between"><span className="text-[var(--text-muted)]">Output</span><span className="text-[var(--text-primary)] font-medium" style={{ fontVariantNumeric: "tabular-nums" }}>{fmtTok(chatUsage.output_tokens)}</span></div>
                            <div className="flex justify-between"><span className="text-[var(--text-muted)]">Cost</span><span className="text-[var(--accent)] font-medium" style={{ fontVariantNumeric: "tabular-nums" }}>${chatUsage.cost_usd.toFixed(4)}</span></div>
                          </div>
                          <button
                            onClick={() => { setUsagePopoverOpen(false); setConfigPanelFilterChatId(activeChatId || undefined); setConfigPanelOpen(true); }}
                            className="mt-3 text-[11px] text-[var(--accent)] hover:underline w-full text-left"
                          >
                            View in Configure models
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}
            </>
          ) : null}

          {/* Centre: spacer */}
          <div className="flex-1" />

          {/* Right: search icon, language, bell, avatar */}
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => setCommandPaletteOpen(true)} className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] transition-colors" title="Search (Ctrl+K)"><Search size={16} /></button>
            <LanguageSelector selectedLanguage={selectedLanguage} onLanguageChange={setSelectedLanguage} />
            <NotificationsPanel />
            {currentUser && (
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#8b3dff] to-[#c13bd9] flex items-center justify-center text-white text-[11px] font-bold ml-1">
                {currentUser.name?.charAt(0)?.toUpperCase() || "U"}
              </div>
            )}
          </div>
        </header>

        {renderContent()}
      </div>

      {/* Automation Modal */}
      <AutomationModal
        isOpen={automationModalOpen}
        onClose={() => { setAutomationModalOpen(false); setEditingAutomation(null); setPrefillTemplate(null); }}
        onSave={handleSaveAutomation}
        automation={editingAutomation}
        template={prefillTemplate}
      />

      {/* Command Palette */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onNewChat={handleNewChat}
        onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
        onSelectChat={handleSelectConversation}
        chats={sidebarChats}
      />

      {/* Delete Chat Dialog */}
      {deleteDialogChat && (
        <DeleteChatDialog
          chatId={deleteDialogChat.id}
          chatTitle={deleteDialogChat.title}
          onConfirm={handleConfirmDeleteChat}
          onCancel={() => setDeleteDialogChat(null)}
        />
      )}

      {/* Voice Mode */}
      <VoiceMode
        isOpen={voiceModeOpen}
        onClose={() => setVoiceModeOpen(false)}
        onSendMessage={(text) => handleVoiceSend(text)}
        onInterrupt={handleVoiceInterrupt}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        aiResponse={voiceAiResponse}
        aiIsStreaming={voiceAiStreaming}
        isGenerating={isGenerating}
      />

      {/* Configure Models Panel */}
      <ConfigureModelsPanel isOpen={configPanelOpen} onClose={() => { setConfigPanelOpen(false); setConfigPanelFilterChatId(undefined); }} filterChatId={configPanelFilterChatId} />

      {/* Toast */}
      <ToastContainer />

      {/* Dev badge — fixed bottom-right, never over sidebar */}
      {process.env.NODE_ENV === "development" && (
        <div style={{ position: "fixed", right: 16, bottom: 16, zIndex: 9999, padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", background: "rgba(139,61,255,0.15)", color: "var(--accent)", border: "1px solid rgba(139,61,255,0.3)", pointerEvents: "none", userSelect: "none" }}>
          DEV
        </div>
      )}
    </div>
  );
}
