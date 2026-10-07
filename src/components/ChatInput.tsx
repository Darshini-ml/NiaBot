"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Send,
  Mic,
  Wand2,
  X,
  FileText,
  Square,
  Sparkles,
  Paperclip,
  Library,
  Search,
  Image,
  FileCode,
  File,
  Check,
  Loader2,
  Activity,
  Globe,
  MessageSquare,
  Hash,
  Plug,
} from "lucide-react";
import ModelSelector, { type ModelOption } from "@/components/ModelSelector";
import { showToast } from "@/components/Toast";
import type { TaskType } from "@/components/WelcomeScreen";

interface PendingAttachment {
  name: string;
  extension: string;
  size: number;
  previewUrl?: string;
  file: File;
}

const taskPlaceholders: Record<string, string> = {
  image: "Describe the image you want...",
  brainstorm: "What should we brainstorm?",
  plan: "What are you planning?",
  analyze: "Ask about your file...",
  slides: "What is the presentation about?",
  code: "What should I build or fix?",
};

const taskLabels: Record<string, string> = {
  image: "Create image",
  brainstorm: "Brainstorm",
  plan: "Make a plan",
  analyze: "Analyze file",
  slides: "Make slides",
  code: "Generate code",
};

export interface ConnectorChipData {
  provider: "slack" | "discord";
  connectorId: string;
  workspaceName: string;
}

export type ConnectorChip = ConnectorChipData | null;

export interface ConnectorStatus {
  id: string; // connector row id
  provider: "slack" | "discord";
  enabled: boolean;
  connected: boolean;
  name: string; // workspace/server name
}

interface ChatInputProps {
  onSend: (message: string, attachments?: File[], features?: Set<string>) => void;
  isGenerating?: boolean;
  onStop?: () => void;
  selectedModel?: ModelOption;
  onModelChange?: (model: ModelOption) => void;
  hasMessages?: boolean;
  allAttachments?: PendingAttachment[];
  activeTask?: TaskType;
  onTaskChange?: (task: TaskType) => void;
  onRegisterFilePicker?: (trigger: () => void) => void;
  onOpenVoiceMode?: () => void;
  webSearchEnabled?: boolean;
  onToggleWebSearch?: () => void;
  thinkingLevel?: "off" | "low" | "medium" | "high";
  onThinkingChange?: (level: "off" | "low" | "medium" | "high") => void;
  onOpenConfigPanel?: () => void;
  connectorStatuses?: ConnectorStatus[];
  activeConnector?: ConnectorChip;
  onConnectorChange?: (connector: ConnectorChip) => void;
  onOpenConnectors?: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

function getFileExtension(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

function getFileIcon(ext: string) {
  const imageExts = ["jpg", "jpeg", "png", "gif", "svg", "webp", "bmp", "ico"];
  const codeExts = ["js", "ts", "tsx", "jsx", "py", "java", "cpp", "c", "html", "css", "json", "md"];
  if (imageExts.includes(ext)) return Image;
  if (codeExts.includes(ext)) return FileCode;
  return File;
}

export default function ChatInput({ onSend, isGenerating, onStop, selectedModel, onModelChange, hasMessages, allAttachments, activeTask, onTaskChange, onRegisterFilePicker, onOpenVoiceMode, webSearchEnabled = true, onToggleWebSearch, thinkingLevel, onThinkingChange, onOpenConfigPanel, connectorStatuses = [], activeConnector, onConnectorChange, onOpenConnectors }: ChatInputProps) {
  const [input, setInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // Attach menu
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [attachMenuVisible, setAttachMenuVisible] = useState(false);
  const [attachMenuPos, setAttachMenuPos] = useState<{ x: number; y: number; openUp: boolean }>({ x: 0, y: 0, openUp: false });
  const attachBtnRef = useRef<HTMLButtonElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const attachMenuTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const MENU_HEIGHT = 156; // ~140px content + 16px margin

  // Library modal
  const [showLibrary, setShowLibrary] = useState(false);
  const [librarySearch, setLibrarySearch] = useState("");
  const [librarySelected, setLibrarySelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    return () => { recognitionRef.current?.abort(); };
  }, []);

  useEffect(() => {
    if (onRegisterFilePicker) {
      onRegisterFilePicker(() => fileInputRef.current?.click());
    }
  }, [onRegisterFilePicker]);

  // Compute attach menu position from button rect
  const computeMenuPos = useCallback(() => {
    if (!attachBtnRef.current) return { x: 0, y: 0, openUp: false };
    const rect = attachBtnRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = hasMessages || spaceBelow < MENU_HEIGHT + 16;
    return {
      x: rect.left,
      y: openUp ? rect.top - 6 : rect.bottom + 6,
      openUp,
    };
  }, [hasMessages]);

  // Open attach menu with transition
  const openAttachMenu = useCallback(() => {
    setAttachMenuPos(computeMenuPos());
    setShowAttachMenu(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setAttachMenuVisible(true));
    });
  }, [computeMenuPos]);

  // Close attach menu with transition
  const closeAttachMenu = useCallback(() => {
    setAttachMenuVisible(false);
    if (attachMenuTimer.current) clearTimeout(attachMenuTimer.current);
    attachMenuTimer.current = setTimeout(() => setShowAttachMenu(false), 160);
  }, []);

  const toggleAttachMenu = useCallback(() => {
    if (showAttachMenu) closeAttachMenu();
    else openAttachMenu();
  }, [showAttachMenu, openAttachMenu, closeAttachMenu]);

  // Reposition on resize while open
  useEffect(() => {
    if (!showAttachMenu) return;
    const onResize = () => setAttachMenuPos(computeMenuPos());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [showAttachMenu, computeMenuPos]);

  // Close on outside click
  useEffect(() => {
    if (!showAttachMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (
        attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node) &&
        attachBtnRef.current && !attachBtnRef.current.contains(e.target as Node)
      ) {
        closeAttachMenu();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showAttachMenu, closeAttachMenu]);

  // Close on Escape
  useEffect(() => {
    if (!showAttachMenu) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAttachMenu();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [showAttachMenu, closeAttachMenu]);

  // Speech recognition
  const startRecording = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { alert("Speech recognition not supported."); return; }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setInput(transcript);
    };
    recognition.onerror = () => { setIsRecording(false); recognitionRef.current = null; };
    recognition.onend = () => { setIsRecording(false); recognitionRef.current = null; };
    recognition.start();
    recognitionRef.current = recognition;
    setIsRecording(true);
  }, []);

  const stopRecording = useCallback(() => {
    recognitionRef.current?.stop();
    setIsRecording(false);
    recognitionRef.current = null;
  }, []);

  const toggleRecording = useCallback(() => {
    if (isRecording) stopRecording();
    else startRecording();
  }, [isRecording, startRecording, stopRecording]);

  // Connector suggestion prompts — [channel] triggers a channel picker
  const connectorSuggestions: Record<string, string[]> = {
    slack: [
      "Summarize [channel] — last 7 days",
      "What decisions were made this week?",
      "Find messages about ",
    ],
    discord: [
      "Summarize [channel] — last 7 days",
      "What decisions were made this week?",
      "Find messages about ",
    ],
  };

  // Channel picker state
  const [channelPickerOpen, setChannelPickerOpen] = useState(false);
  const [channelPickerTemplate, setChannelPickerTemplate] = useState("");
  const [channelList, setChannelList] = useState<{ name: string; id: string }[]>([]);
  const [channelListLoading, setChannelListLoading] = useState(false);
  const [channelSearch, setChannelSearch] = useState("");

  const fetchChannels = useCallback(async () => {
    if (channelList.length > 0) return; // already cached
    setChannelListLoading(true);
    try {
      const provider = activeConnector?.provider || "slack";
      const res = await fetch(`/api/connectors/${provider}/channels`);
      if (res.ok) {
        const data = await res.json();
        setChannelList((data.channels || []).map((ch: any) => ({ name: ch.name?.replace(/^#/, "") || ch.name, id: ch.id })));
      }
    } catch { /* ignore */ }
    setChannelListLoading(false);
  }, [activeConnector, channelList.length]);

  const handleSuggestionClick = useCallback((suggestion: string) => {
    if (suggestion.includes("[channel]")) {
      setChannelPickerTemplate(suggestion);
      setChannelPickerOpen(true);
      setChannelSearch("");
      fetchChannels();
    } else {
      setInput(suggestion);
      textareaRef.current?.focus();
    }
  }, [fetchChannels]);

  const handleChannelSelect = useCallback((channelName: string) => {
    const filled = channelPickerTemplate.replace("[channel]", `#${channelName}`);
    setInput(filled);
    setChannelPickerOpen(false);
    setChannelPickerTemplate("");
    textareaRef.current?.focus();
  }, [channelPickerTemplate]);

  const handleSend = () => {
    if (input.trim() || pendingAttachments.length > 0) {
      if (isRecording) stopRecording();
      const features = new Set<string>();
      const files = pendingAttachments.map(a => a.file);
      onSend(input, files, features);
      setInput("");
      // Revoke object URLs
      pendingAttachments.forEach(a => { if (a.previewUrl) URL.revokeObjectURL(a.previewUrl); });
      setPendingAttachments([]);
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      // Clear task after sending
      if (activeTask) onTaskChange?.(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
    // Backspace on empty textarea clears the task or connector chip
    if (e.key === "Backspace" && !input) {
      if (activeTask) onTaskChange?.(null);
      else if (activeConnector) onConnectorChange?.(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newAttachments: PendingAttachment[] = Array.from(e.target.files).map(file => {
        const ext = getFileExtension(file.name);
        const isImage = file.type.startsWith("image/");
        return {
          name: file.name,
          extension: ext,
          size: file.size,
          previewUrl: isImage ? URL.createObjectURL(file) : undefined,
          file,
        };
      });
      setPendingAttachments(prev => [...prev, ...newAttachments]);
      // Clear input so same file can be re-selected
      e.target.value = "";
    }
  };

  const removeAttachment = (index: number) => {
    setPendingAttachments(prev => {
      const removed = prev[index];
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  };

  // Pre-warm: on first composer focus, ping the enhance endpoint so DNS/TLS are warm
  const preWarmedRef = useRef(false);
  const handleComposerFocus = useCallback(() => {
    if (preWarmedRef.current) return;
    preWarmedRef.current = true;
    fetch("/api/enhance-prompt", { method: "HEAD" }).catch(() => {});
  }, []);

  // Debounce guard for enhance
  const enhancingGuardRef = useRef(false);
  // Accumulator ref for streaming — avoids stale closure state
  const enhanceAccRef = useRef("");

  // AbortController ref — survives re-renders so streaming isn't cancelled
  const enhanceAbortRef = useRef<AbortController | null>(null);

  const handleEnhance = async () => {
    // Debounce double-click
    if (enhancingGuardRef.current) return;
    enhancingGuardRef.current = true;

    const text = input.trim();
    if (!text) {
      showToast("Type a prompt first");
      enhancingGuardRef.current = false;
      return;
    }
    const originalText = input;
    setIsEnhancing(true);

    const abortCtrl = new AbortController();
    enhanceAbortRef.current = abortCtrl;
    const timeout = setTimeout(() => abortCtrl.abort(), 20_000);

    try {
      const res = await fetch("/api/enhance-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          model: selectedModel?.modelId,
        }),
        signal: abortCtrl.signal,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        const reason = errBody?.error || `HTTP ${res.status}`;
        throw new Error(reason);
      }

      const contentType = res.headers.get("content-type") || "";

      if (contentType.includes("text/event-stream")) {
        // ── Stream mode: accumulate in ref, commit once at the end ──
        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder("utf-8", { fatal: false });
        let sseBuffer = "";
        let degraded = false;
        let finalEnhanced = "";

        enhanceAccRef.current = "";

        // Read all chunks — do NOT call setInput per chunk (avoids re-renders
        // that could unmount the component and cancel the fetch)
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split("\n");
          sseBuffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            if (payload === "[DONE]") continue;

            try {
              const parsed = JSON.parse(payload);
              if (parsed.token) {
                enhanceAccRef.current += parsed.token;
              }
              if (parsed.done) {
                if (parsed.degraded) degraded = true;
                if (parsed.enhanced) {
                  finalEnhanced = parsed.enhanced;
                }
              }
            } catch {
              // skip malformed
            }
          }
        }

        // Use the server's final `enhanced` text (which may be retried/trimmed),
        // falling back to the accumulated tokens
        const resultText = finalEnhanced || enhanceAccRef.current.trim();

        if (!resultText) {
          throw new Error("Empty response from server");
        }

        // Commit to state ONCE
        setInput(resultText);

        // Auto-grow + focus + cursor at end
        requestAnimationFrame(() => {
          if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
            textareaRef.current.style.height =
              Math.min(textareaRef.current.scrollHeight, 200) + "px";
            textareaRef.current.focus();
            textareaRef.current.setSelectionRange(resultText.length, resultText.length);
          }
        });

        if (degraded) {
          showToast("Took too long — kept your original");
        } else {
          showToast("Prompt enhanced", {
            duration: 6000,
            action: {
              label: "Undo",
              onClick: () => {
                setInput(originalText);
                requestAnimationFrame(() => {
                  if (textareaRef.current) {
                    textareaRef.current.style.height = "auto";
                    textareaRef.current.style.height =
                      Math.min(textareaRef.current.scrollHeight, 200) + "px";
                  }
                });
              },
            },
          });
        }
      } else {
        // ── JSON fallback (cache hit) ──
        const data = await res.json();
        const enhanced: string = data.enhanced;

        setInput(enhanced);
        requestAnimationFrame(() => {
          if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
            textareaRef.current.style.height =
              Math.min(textareaRef.current.scrollHeight, 200) + "px";
            textareaRef.current.focus();
            textareaRef.current.setSelectionRange(enhanced.length, enhanced.length);
          }
        });

        if (data.degraded) {
          showToast("Took too long — kept your original");
        } else {
          showToast("Prompt enhanced", {
            duration: 6000,
            action: {
              label: "Undo",
              onClick: () => {
                setInput(originalText);
                requestAnimationFrame(() => {
                  if (textareaRef.current) {
                    textareaRef.current.style.height = "auto";
                    textareaRef.current.style.height =
                      Math.min(textareaRef.current.scrollHeight, 200) + "px";
                  }
                });
              },
            },
          });
        }
      }
    } catch (err) {
      if (abortCtrl.signal.aborted) {
        showToast("Enhance cancelled");
      } else {
        const reason = err instanceof Error ? err.message : "Unknown error";
        console.error("Enhance error:", reason, err);
        showToast(`Couldn't enhance: ${reason}`);
      }
    } finally {
      clearTimeout(timeout);
      enhanceAbortRef.current = null;
      setIsEnhancing(false);
      enhancingGuardRef.current = false;
    }
  };

  // Drag and drop
  const [composerDragOver, setComposerDragOver] = useState(false);
  const composerDragCounter = useRef(0);

  const onComposerDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    composerDragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) setComposerDragOver(true);
  }, []);

  const onComposerDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    composerDragCounter.current--;
    if (composerDragCounter.current === 0) setComposerDragOver(false);
  }, []);

  const onComposerDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const onComposerDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    composerDragCounter.current = 0;
    setComposerDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      const newAttachments: PendingAttachment[] = files.map(file => {
        const ext = getFileExtension(file.name);
        const isImage = file.type.startsWith("image/");
        return {
          name: file.name,
          extension: ext,
          size: file.size,
          previewUrl: isImage ? URL.createObjectURL(file) : undefined,
          file,
        };
      });
      setPendingAttachments(prev => [...prev, ...newAttachments]);
      textareaRef.current?.focus();
    }
  }, []);

  // Library: collect files from allAttachments prop
  const libraryFiles = allAttachments || [];
  const filteredLibraryFiles = libraryFiles.filter(f =>
    f.name.toLowerCase().includes(librarySearch.toLowerCase())
  );

  const toggleLibrarySelect = (idx: number) => {
    setLibrarySelected(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const addFromLibrary = () => {
    const selected = Array.from(librarySelected).map(i => filteredLibraryFiles[i]).filter(Boolean);
    setPendingAttachments(prev => [...prev, ...selected]);
    setShowLibrary(false);
    setLibrarySelected(new Set());
    setLibrarySearch("");
  };

  // Composer hygiene: when a task chip (e.g. Image) is selected and there's
  // already text in the composer (e.g. from Enhance), keep the text but let
  // the user know they can clear it by pressing backspace.
  const prevTaskRef = useRef<TaskType>(activeTask ?? null);
  useEffect(() => {
    if (activeTask === "image" && prevTaskRef.current !== "image" && input.trim()) {
      // User just clicked Image chip while text exists — keep text, it will
      // become the image prompt. The placeholder already shows "Describe the image you want..."
    }
    prevTaskRef.current = activeTask ?? null;
  }, [activeTask, input]);

  const hasContent = input.trim() || pendingAttachments.length > 0;

  return (
    <div className="px-4 pb-6 pt-2 w-full min-w-0 overflow-hidden">
      <div className="mx-auto w-full min-w-0" style={{ maxWidth: 920 }}>
        {/* Main Composer */}
        <div
          className={`relative rounded-[20px] glass-composer transition-all duration-200 ${composerDragOver ? "ring-2 ring-[var(--accent)] ring-opacity-60" : ""}`}
          onDragEnter={onComposerDragEnter}
          onDragLeave={onComposerDragLeave}
          onDragOver={onComposerDragOver}
          onDrop={onComposerDrop}
        >
          {/* Pending attachments chips */}
          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-5 pt-4 animate-fade-in">
              {pendingAttachments.map((att, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)]">
                  {att.previewUrl ? (
                    <img src={att.previewUrl} alt="" className="w-5 h-5 rounded object-cover" />
                  ) : (
                    <FileText size={13} className="text-[var(--accent)]" />
                  )}
                  <span className="truncate max-w-[140px] font-medium text-[var(--text-secondary)]">{att.name}</span>
                  <span className="text-[var(--text-faint)]">{formatFileSize(att.size)}</span>
                  <button onClick={() => removeAttachment(i)} className="text-[var(--text-muted)] hover:text-red-400 transition-colors">
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Task chip */}
          {activeTask && (
            <div className="flex items-center gap-2 px-5 pt-3 animate-fade-in">
              <span className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium rounded-full bg-[var(--accent-subtle)] text-[var(--accent)] border border-[var(--accent-border)]">
                {taskLabels[activeTask] || activeTask}
                <button onClick={() => onTaskChange?.(null)} className="ml-0.5 hover:text-white transition-colors">
                  <X size={11} />
                </button>
              </span>
            </div>
          )}

          {/* Connector chip */}
          {activeConnector && (
            <div className="flex items-center gap-2 px-5 pt-3 animate-fade-in">
              <span className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium rounded-full bg-[var(--accent-subtle)] text-[var(--accent)] border border-[var(--accent-border)]">
                {activeConnector.provider === "slack" ? <Hash size={12} /> : <MessageSquare size={12} />}
                {activeConnector.provider === "slack" ? "Slack" : "Discord"}
                {activeConnector.workspaceName && (
                  <span className="opacity-70">· {activeConnector.workspaceName}</span>
                )}
                <button onClick={() => onConnectorChange?.(null)} className="ml-0.5 hover:text-white transition-colors">
                  <X size={11} />
                </button>
              </span>
            </div>
          )}

          {/* Textarea row */}
          <div className="flex items-start gap-3 px-5 pt-4 pb-2 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={(e) => { handleComposerFocus(); setIsFocused(true); }}
              onBlur={() => setIsFocused(false)}
              placeholder={activeTask ? taskPlaceholders[activeTask] || "Ask anything..." : "Ask anything..."}
              rows={1}
              className="flex-1 bg-transparent resize-none text-[14px] text-[var(--text-primary)] outline-none focus:outline-none focus-visible:outline-none shadow-none focus:shadow-none focus-visible:shadow-none border-0 focus:border-0 focus:ring-0 focus-visible:ring-0 placeholder:text-[var(--text-faint)] min-h-[56px] max-h-[200px] leading-relaxed appearance-none"
              style={{ height: "auto", overflow: input.split("\n").length > 6 ? "auto" : "hidden" }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = "auto";
                target.style.height = Math.min(target.scrollHeight, 200) + "px";
              }}
            />
            {isFocused && !input && !activeTask && !activeConnector && (
              <span className="absolute right-5 bottom-2 text-[12px] text-[var(--text-faint)] pointer-events-none animate-fade-in">
                Press <kbd className="px-1 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--text-muted)] text-[11px] font-mono">/</kbd> for commands
              </span>
            )}
          </div>

          {/* Connector suggestion prompts */}
          {activeConnector && !input.trim() && !channelPickerOpen && (
            <div className="flex flex-wrap gap-2 px-5 pb-1 animate-fade-in">
              {connectorSuggestions[activeConnector.provider]?.map((suggestion, i) => (
                <button
                  key={i}
                  onClick={() => handleSuggestionClick(suggestion)}
                  className="px-3 py-1.5 text-[12px] rounded-full transition-colors"
                  style={{
                    background: "var(--bg-tertiary)",
                    color: "var(--text-muted)",
                    border: "1px solid var(--border)",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text-primary)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-tertiary)"; e.currentTarget.style.color = "var(--text-muted)"; }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          {/* Channel picker dropdown */}
          {channelPickerOpen && (
            <div className="mx-5 mb-1 rounded-lg border animate-fade-in" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)", maxHeight: 220, overflow: "hidden" }}>
              <div className="px-3 py-2 border-b" style={{ borderColor: "var(--border)" }}>
                <input
                  autoFocus
                  type="text"
                  placeholder="Search channels..."
                  value={channelSearch}
                  onChange={(e) => setChannelSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") { setChannelPickerOpen(false); }
                  }}
                  className="w-full bg-transparent text-[13px] outline-none"
                  style={{ color: "var(--text-primary)" }}
                />
              </div>
              <div style={{ maxHeight: 170, overflowY: "auto" }}>
                {channelListLoading && (
                  <div className="flex items-center gap-2 px-3 py-3 text-[12px]" style={{ color: "var(--text-muted)" }}>
                    <Loader2 size={14} className="animate-spin" /> Loading channels...
                  </div>
                )}
                {!channelListLoading && channelList.length === 0 && (
                  <div className="px-3 py-3 text-[12px]" style={{ color: "var(--text-muted)" }}>No channels found</div>
                )}
                {channelList
                  .filter(ch => !channelSearch || ch.name.toLowerCase().includes(channelSearch.toLowerCase()))
                  .slice(0, 20)
                  .map((ch) => (
                    <button
                      key={ch.id}
                      onClick={() => handleChannelSelect(ch.name)}
                      className="w-full text-left px-3 py-1.5 text-[13px] transition-colors flex items-center gap-2"
                      style={{ color: "var(--text-primary)" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <Hash size={12} style={{ color: "var(--text-faint)" }} />
                      {ch.name}
                    </button>
                  ))
                }
              </div>
            </div>
          )}

          {/* Toolbar */}
          <div className="flex items-center justify-between px-4 pb-3">
            <div className="flex items-center gap-0">
              {/* Attach icon button */}
              <button
                ref={attachBtnRef}
                onClick={toggleAttachMenu}
                className="flex items-center justify-center transition-colors"
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  color: showAttachMenu ? "var(--text-primary)" : "var(--text-muted)",
                  background: showAttachMenu ? "var(--bg-hover)" : "transparent",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text-primary)"; }}
                onMouseLeave={(e) => { if (!showAttachMenu) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; } }}
                title="Attach"
                aria-label="Attach"
              >
                <Paperclip size={18} />
              </button>

              {/* Attach popover — rendered via portal to avoid clipping by backdrop-filter ancestors */}
              {showAttachMenu && typeof document !== "undefined" && createPortal(
                <div
                  ref={attachMenuRef}
                  style={{
                    position: "fixed",
                    left: attachMenuPos.x,
                    ...(attachMenuPos.openUp
                      ? { bottom: window.innerHeight - attachMenuPos.y }
                      : { top: attachMenuPos.y }),
                    zIndex: 1000,
                  }}
                >
                  <div
                    style={{
                      width: 280,
                      maxHeight: "calc(100vh - 32px)",
                      overflowY: "auto",
                      background: "var(--popover-bg)",
                      border: "1px solid var(--border)",
                      borderRadius: 14,
                      padding: 6,
                      boxShadow: "var(--popover-shadow)",
                      opacity: attachMenuVisible ? 1 : 0,
                      transform: attachMenuVisible
                        ? "translateY(0)"
                        : attachMenuPos.openUp ? "translateY(4px)" : "translateY(-4px)",
                      transformOrigin: attachMenuPos.openUp ? "bottom left" : "top left",
                      transition: "opacity 160ms ease, transform 160ms ease",
                    }}
                  >
                    {/* Add photos & files */}
                    <button
                      onClick={() => {
                        closeAttachMenu();
                        fileInputRef.current?.click();
                      }}
                      className="w-full flex items-center gap-3 px-3 transition-colors text-left"
                      style={{ minHeight: 52, borderRadius: 10 }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <div className="flex items-center justify-center shrink-0" style={{ width: 36, height: 36, borderRadius: 10, background: "var(--bg-hover)" }}>
                        <Paperclip size={18} style={{ color: "var(--text-muted)" }} />
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>Add photos & files</div>
                        <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Upload from computer</div>
                      </div>
                    </button>

                    {/* Add from library */}
                    <button
                      onClick={() => {
                        closeAttachMenu();
                        setShowLibrary(true);
                        setLibrarySelected(new Set());
                        setLibrarySearch("");
                      }}
                      className="w-full flex items-center gap-3 px-3 transition-colors text-left"
                      style={{ minHeight: 52, borderRadius: 10 }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <div className="flex items-center justify-center shrink-0" style={{ width: 36, height: 36, borderRadius: 10, background: "var(--bg-hover)" }}>
                        <Library size={18} style={{ color: "var(--text-muted)" }} />
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>Add from library</div>
                        <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Browse and search your files</div>
                      </div>
                    </button>

                    {/* Connectors group */}
                    {(() => {
                      const connected = connectorStatuses.filter(c => c.connected && c.enabled);
                      const notConnected = (["slack", "discord"] as const).filter(
                        p => !connectorStatuses.some(c => c.provider === p && c.connected)
                      );
                      if (connected.length === 0 && notConnected.length === 0) return null;
                      return (
                        <>
                          <div style={{ height: 1, background: "var(--border)", margin: "4px 8px" }} />
                          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-faint)", padding: "6px 12px 2px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                            Connectors
                          </div>
                          {connected.map(c => (
                            <button
                              key={c.id}
                              onClick={() => {
                                closeAttachMenu();
                                onConnectorChange?.({ provider: c.provider, connectorId: c.id, workspaceName: c.name });
                              }}
                              className="w-full flex items-center gap-3 px-3 transition-colors text-left"
                              style={{ minHeight: 44, borderRadius: 10 }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                            >
                              <div className="flex items-center justify-center shrink-0" style={{ width: 36, height: 36, borderRadius: 10, background: "var(--bg-hover)" }}>
                                {c.provider === "slack" ? <Hash size={18} style={{ color: "var(--text-muted)" }} /> : <MessageSquare size={18} style={{ color: "var(--text-muted)" }} />}
                              </div>
                              <div>
                                <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>
                                  {c.provider === "slack" ? "Slack" : "Discord"}
                                  {c.name && <span style={{ fontWeight: 400, opacity: 0.7 }}> · {c.name}</span>}
                                </div>
                                <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                                  Read and search messages
                                </div>
                              </div>
                            </button>
                          ))}
                          {notConnected.map(provider => (
                            <button
                              key={provider}
                              onClick={() => {
                                closeAttachMenu();
                                onOpenConnectors?.();
                              }}
                              className="w-full flex items-center gap-3 px-3 transition-colors text-left"
                              style={{ minHeight: 44, borderRadius: 10, opacity: 0.6 }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                            >
                              <div className="flex items-center justify-center shrink-0" style={{ width: 36, height: 36, borderRadius: 10, background: "var(--bg-hover)" }}>
                                {provider === "slack" ? <Hash size={18} style={{ color: "var(--text-muted)" }} /> : <MessageSquare size={18} style={{ color: "var(--text-muted)" }} />}
                              </div>
                              <div>
                                <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>
                                  Connect {provider === "slack" ? "Slack" : "Discord"}…
                                </div>
                                <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                                  Set up in Connectors
                                </div>
                              </div>
                            </button>
                          ))}
                        </>
                      );
                    })()}
                  </div>
                </div>,
                document.body
              )}
            </div>

            <div className="flex items-center gap-2">
              <ModelSelector
                selectedModel={selectedModel}
                onModelChange={onModelChange}
                compact
                onOpenChange={(open) => { if (open) closeAttachMenu(); }}
                thinkingLevel={thinkingLevel}
                onThinkingChange={onThinkingChange}
                onOpenConfigPanel={onOpenConfigPanel}
              />

              <button
                onClick={onToggleWebSearch}
                className={`flex items-center justify-center rounded-full transition-all duration-200 ${
                  webSearchEnabled
                    ? "text-[var(--accent)] border-[var(--accent)]/40 bg-[var(--accent-subtle)]"
                    : "text-[#b8b3c4] hover:text-[var(--text-primary)] hover:border-[rgba(255,255,255,.18)]"
                }`}
                style={{ width: 36, height: 36, border: webSearchEnabled ? "1px solid rgba(139,61,255,.3)" : "1px solid rgba(255,255,255,.08)" }}
                title={webSearchEnabled ? "Web search: ON" : "Web search: OFF"}
              >
                <Globe size={15} />
              </button>

              <button
                onPointerDown={(e) => { e.preventDefault(); handleEnhance(); }}
                disabled={isEnhancing}
                className={`flex items-center justify-center rounded-full transition-all duration-200 ${
                  isEnhancing ? "text-[#a78bfa] cursor-not-allowed" : "text-[#b8b3c4] hover:text-[var(--text-primary)] hover:border-[rgba(255,255,255,.18)]"
                }`}
                style={{ width: 36, height: 36, border: "1px solid rgba(255,255,255,.08)" }}
                title="Enhance prompt"
              >
                {isEnhancing ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
              </button>

              <button
                onClick={toggleRecording}
                className={`w-[36px] h-[36px] rounded-full flex items-center justify-center transition-all duration-200 relative ${
                  isRecording ? "bg-red-400/10 text-red-400 border-red-400/30" : "text-[#b8b3c4] hover:text-[var(--text-primary)] hover:border-[rgba(255,255,255,.18)]"
                }`}
                style={{ border: isRecording ? undefined : "1px solid rgba(255,255,255,.08)" }}
                title={isRecording ? "Stop recording" : "Voice input"}
              >
                <Mic size={16} />
                {isRecording && <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-400 animate-pulse" />}
              </button>

              {isGenerating ? (
                <button
                  onClick={onStop}
                  className="w-[36px] h-[36px] rounded-full bg-[var(--text-muted)] flex items-center justify-center hover:bg-[var(--text-secondary)] transition-colors"
                  title="Stop"
                >
                  <span className="transition-opacity duration-150" style={{ opacity: 1 }}>
                    <Square size={14} className="text-[var(--bg-primary)] fill-current" />
                  </span>
                </button>
              ) : hasContent ? (
                <button
                  onClick={handleSend}
                  className="w-[36px] h-[36px] rounded-full bg-[#8b5cf6] text-white flex items-center justify-center shadow-lg shadow-[rgba(139,61,255,0.3)] transition-all duration-200"
                  title="Send"
                >
                  <span className="transition-opacity duration-150" style={{ opacity: 1 }}>
                    <Send size={15} />
                  </span>
                </button>
              ) : (
                <button
                  onClick={() => onOpenVoiceMode?.()}
                  className="w-[36px] h-[36px] rounded-full bg-[#8b5cf6] text-white flex items-center justify-center shadow-lg shadow-[rgba(139,61,255,0.3)] transition-all duration-200"
                  title="Voice mode"
                >
                  <span className="transition-opacity duration-150" style={{ opacity: 1 }}>
                    <Activity size={16} />
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>

        <p className="text-center text-[12px] text-[#9c97a8] mt-3 font-medium">
          NiaAI can make mistakes. Verify important information.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.doc,.docx,.txt,.md,.csv,.json"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {/* Library Modal */}
      {showLibrary && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) { setShowLibrary(false); } }}
          onKeyDown={(e) => { if (e.key === "Escape") setShowLibrary(false); }}
        >
          <div
            className="flex flex-col"
            style={{
              width: 560,
              maxHeight: "70vh",
              background: "var(--popover-bg)",
              border: "1px solid var(--border)",
              borderRadius: 16,
              boxShadow: "var(--popover-shadow)",
              overflow: "hidden",
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)" }}>Add from library</h3>
              <button onClick={() => setShowLibrary(false)} className="text-[var(--text-muted)] hover:text-white transition-colors">
                <X size={18} />
              </button>
            </div>

            {/* Search */}
            <div className="px-5 py-3">
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)" }}>
                <Search size={15} style={{ color: "var(--text-muted)" }} />
                <input
                  type="text"
                  placeholder="Search files..."
                  value={librarySearch}
                  onChange={(e) => setLibrarySearch(e.target.value)}
                  className="flex-1 bg-transparent text-[13px] text-[var(--text-primary)] focus:outline-none placeholder:text-[var(--text-muted)]"
                  autoFocus
                />
              </div>
            </div>

            {/* Files list */}
            <div className="flex-1 overflow-y-auto px-3 pb-3" style={{ minHeight: 100 }}>
              {filteredLibraryFiles.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Library size={32} style={{ color: "var(--text-muted)" }} />
                  <p style={{ fontSize: 14, color: "var(--text-muted)", marginTop: 12 }}>No files yet — upload one first</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredLibraryFiles.map((file, idx) => {
                    const isSelected = librarySelected.has(idx);
                    const IconComp = getFileIcon(file.extension);
                    return (
                      <button
                        key={idx}
                        onClick={() => toggleLibrarySelect(idx)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-left"
                        style={{
                          background: isSelected ? "var(--accent-subtle)" : "transparent",
                        }}
                        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)"; }}
                        onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                      >
                        {/* Checkbox */}
                        <div
                          className="shrink-0 flex items-center justify-center"
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: 5,
                            border: isSelected ? "none" : "1.5px solid var(--border-hover)",
                            background: isSelected ? "var(--accent, #8b3dff)" : "transparent",
                          }}
                        >
                          {isSelected && <Check size={13} className="text-white" />}
                        </div>
                        {/* Icon */}
                        <div className="shrink-0 flex items-center justify-center" style={{ width: 32, height: 32, borderRadius: 8, background: "var(--bg-hover)" }}>
                          {file.previewUrl ? (
                            <img src={file.previewUrl} alt="" className="w-full h-full rounded-lg object-cover" />
                          ) : (
                            <IconComp size={16} style={{ color: "var(--text-muted)" }} />
                          )}
                        </div>
                        {/* Name + size */}
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-medium truncate" style={{ color: "var(--text-primary)" }}>{file.name}</div>
                          <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>{formatFileSize(file.size)}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            {filteredLibraryFiles.length > 0 && (
              <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-[var(--border)]">
                <button
                  onClick={() => setShowLibrary(false)}
                  className="px-4 py-2 rounded-lg text-[13px] font-medium transition-colors"
                  style={{ color: "var(--text-muted)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  Cancel
                </button>
                <button
                  onClick={addFromLibrary}
                  disabled={librarySelected.size === 0}
                  className="px-4 py-2 rounded-lg text-[13px] font-medium transition-colors"
                  style={{
                    background: librarySelected.size > 0 ? "var(--accent, #8b3dff)" : "var(--bg-tertiary)",
                    color: librarySelected.size > 0 ? "#fff" : "var(--text-muted)",
                    cursor: librarySelected.size > 0 ? "pointer" : "not-allowed",
                  }}
                >
                  {librarySelected.size > 0 ? `Add ${librarySelected.size} file${librarySelected.size > 1 ? "s" : ""}` : "Add files"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
