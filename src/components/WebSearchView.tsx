"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Search,
  ArrowLeft,
  ExternalLink,
  Loader2,
  Check,
  AlertTriangle,
  RotateCcw,
  Square,
  Send,
  Globe,
} from "lucide-react";

// Types
interface SearchSource {
  id: string;
  title: string;
  url: string;
  domain: string;
  snippet?: string;
  status: "discovered" | "fetching" | "read" | "failed";
}

interface SearchActivity {
  id: string;
  message: string;
  status: "pending" | "active" | "completed" | "failed";
  detail?: string;
}

interface SearchMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  sources?: SearchSource[];
  timestamp: string;
}

interface WebSearchSession {
  id: string;
  status: "idle" | "searching" | "completed" | "error";
  sources: SearchSource[];
  activities: SearchActivity[];
  messages: SearchMessage[];
  currentAnswer: string;
  error?: string;
}

interface WebSearchViewProps {
  onBack?: () => void;
}

function generateSessionId() {
  return `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function WebSearchView({ onBack }: WebSearchViewProps) {
  const [session, setSession] = useState<WebSearchSession>({
    id: generateSessionId(),
    status: "idle",
    sources: [],
    activities: [],
    messages: [],
    currentAnswer: "",
  });
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mainAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session.messages, session.currentAnswer]);

  const handleSearch = useCallback(
    async (query: string) => {
      if (!query.trim() || session.status === "searching") return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const userMsg: SearchMessage = {
        id: `msg-${Date.now()}`,
        role: "user",
        content: query,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };

      setSession((prev) => ({
        ...prev,
        status: "searching",
        messages: [...prev.messages, userMsg],
        activities: [],
        sources: [],
        currentAnswer: "",
        error: undefined,
      }));

      setInputValue("");

      const conversationHistory = session.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      try {
        const res = await fetch("/api/web-search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, maxResults: 10, conversationHistory }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error("Search request failed");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let answerText = "";
        let collectedSources: SearchSource[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            const d = trimmed.slice(6);
            if (d === "[DONE]") continue;

            try {
              const event = JSON.parse(d);

              switch (event.type) {
                case "activity":
                  setSession((prev) => {
                    const existing = prev.activities.find((a) => a.message === event.message);
                    if (existing) {
                      return {
                        ...prev,
                        activities: prev.activities.map((a) =>
                          a.message === event.message
                            ? { ...a, status: event.status, detail: event.detail || a.detail }
                            : a
                        ),
                      };
                    }
                    return {
                      ...prev,
                      activities: [
                        ...prev.activities,
                        {
                          id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                          message: event.message,
                          status: event.status,
                          detail: event.detail,
                        },
                      ],
                    };
                  });
                  break;

                case "sources_discovered":
                  collectedSources = event.sources || [];
                  setSession((prev) => ({
                    ...prev,
                    sources: collectedSources,
                  }));
                  break;

                case "source_status_update":
                  setSession((prev) => ({
                    ...prev,
                    sources: prev.sources.map((s) =>
                      s.id === event.sourceId ? { ...s, status: event.status } : s
                    ),
                  }));
                  break;

                case "search_progress":
                  setSession((prev) => ({
                    ...prev,
                    activities: prev.activities.map((a) =>
                      a.message === "Reading sources"
                        ? { ...a, detail: `${event.completed} of ${event.total}` }
                        : a
                    ),
                  }));
                  break;

                case "answer_chunk":
                  answerText += event.text;
                  setSession((prev) => ({ ...prev, currentAnswer: answerText }));
                  break;

                case "search_completed":
                  setSession((prev) => ({
                    ...prev,
                    status: "completed",
                    currentAnswer: "",
                    messages: [
                      ...prev.messages,
                      {
                        id: `msg-${Date.now()}`,
                        role: "assistant",
                        content: answerText,
                        sources: prev.sources.filter((s) => s.status === "read"),
                        timestamp: new Date().toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        }),
                      },
                    ],
                  }));
                  break;

                case "error":
                  setSession((prev) => ({
                    ...prev,
                    status: "error",
                    error: event.message,
                  }));
                  break;
              }
            } catch {
              /* skip parse errors */
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setSession((prev) => ({
          ...prev,
          status: "error",
          error: err instanceof Error ? err.message : "Search failed",
        }));
      }
    },
    [session.messages, session.status]
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setSession((prev) => ({
      ...prev,
      status: "completed",
      currentAnswer: "",
      messages: prev.currentAnswer
        ? [
            ...prev.messages,
            {
              id: `msg-${Date.now()}`,
              role: "assistant",
              content: prev.currentAnswer + "\n\n*(Search stopped)*",
              sources: prev.sources.filter((s) => s.status === "read"),
              timestamp: new Date().toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              }),
            },
          ]
        : prev.messages,
    }));
  }, []);

  const handleSubmit = () => {
    if (!inputValue.trim()) return;
    handleSearch(inputValue.trim());
  };

  const isSearching = session.status === "searching";
  const hasContent = session.messages.length > 0 || isSearching;

  // Idle / empty state
  if (!hasContent) {
    return (
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-5 pb-3 flex items-center gap-3 border-b border-[var(--border)]">
          {onBack && (
            <button
              onClick={onBack}
              className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)]"
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <Globe size={20} className="text-[var(--accent)]" />
          <h1 className="text-[18px] font-bold text-[var(--text-primary)]">Web Search</h1>
        </div>

        {/* Center content */}
        <div className="flex-1 flex flex-col items-center justify-center px-6">
          <div className="max-w-xl w-full text-center">
            <div className="w-16 h-16 rounded-2xl bg-[var(--accent-subtle)] border border-[var(--accent-border)] flex items-center justify-center mx-auto mb-5">
              <Search size={28} className="text-[var(--accent)]" />
            </div>
            <h2 className="text-[22px] font-bold text-[var(--text-primary)] mb-2">Web Search</h2>
            <p className="text-[14px] text-[var(--text-muted)] mb-8 leading-relaxed">
              Search the web for current information, research, sources, products, news, and more.
            </p>

            {/* Search input */}
            <div className="flex gap-2 mb-8">
              <div className="relative flex-1">
                <Search
                  size={16}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"
                />
                <input
                  ref={inputRef}
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  placeholder="Search the web..."
                  className="w-full pl-11 pr-4 py-3.5 bg-[var(--bg-elevated)] rounded-xl text-[14px] border border-[var(--border)] focus:border-[var(--accent-border)] focus:outline-none placeholder:text-[var(--text-faint)] text-[var(--text-primary)] shadow-sm"
                />
              </div>
              <button
                onClick={handleSubmit}
                disabled={!inputValue.trim()}
                className={`px-6 py-3.5 rounded-xl text-[13px] font-semibold transition-all ${
                  inputValue.trim()
                    ? "bg-[var(--accent)] text-white hover:opacity-90"
                    : "bg-[var(--bg-tertiary)] text-[var(--text-faint)] cursor-not-allowed"
                }`}
              >
                Search
              </button>
            </div>

            {/* Example queries */}
            <div className="flex flex-wrap justify-center gap-2">
              {[
                "Find recent AI security research",
                "Compare React vs Vue in 2024",
                "Latest phishing detection techniques",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => {
                    setInputValue(q);
                    handleSearch(q);
                  }}
                  className="px-4 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent-border)] transition-all"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Active search / results view
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-4 pb-3 flex items-center gap-3 border-b border-[var(--border)]">
        {onBack && (
          <button
            onClick={onBack}
            className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)]"
          >
            <ArrowLeft size={18} />
          </button>
        )}
        <Globe size={18} className="text-[var(--accent)]" />
        <h1 className="text-[16px] font-semibold text-[var(--text-primary)]">Web Search</h1>
      </div>

      {/* Main layout: content + activity sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Main content area */}
        <div ref={mainAreaRef} className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 py-5 space-y-6">
            {/* Messages */}
            {session.messages.map((msg) => (
              <div key={msg.id} className="animate-fade-in">
                {msg.role === "user" ? (
                  <div className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded-full bg-[var(--accent)] flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[11px] font-bold text-white">U</span>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-[var(--text-muted)] mb-1">You</p>
                      <p className="text-[15px] text-[var(--text-primary)] font-medium">
                        {msg.content}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded-lg bg-[var(--accent-subtle)] border border-[var(--accent-border)] flex items-center justify-center shrink-0 mt-0.5">
                      <Search size={13} className="text-[var(--accent)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-semibold text-[var(--text-muted)] mb-2">
                        NiaAI Search
                      </p>
                      {/* Answer */}
                      <div className="text-[14px] text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">
                        {msg.content}
                      </div>
                      {/* Sources */}
                      {msg.sources && msg.sources.length > 0 && (
                        <div className="mt-4">
                          <p className="text-[11px] font-semibold text-[var(--text-faint)] uppercase tracking-wider mb-2">
                            Sources ({msg.sources.length})
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {msg.sources.slice(0, 6).map((source) => (
                              <SourceCard key={source.id} source={source} compact />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Current streaming answer */}
            {isSearching && session.currentAnswer && (
              <div className="flex items-start gap-3 animate-fade-in">
                <div className="w-7 h-7 rounded-lg bg-[var(--accent-subtle)] border border-[var(--accent-border)] flex items-center justify-center shrink-0 mt-0.5">
                  <Search size={13} className="text-[var(--accent)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-[var(--text-muted)] mb-2">
                    NiaAI Search
                  </p>
                  <div className="text-[14px] text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">
                    {session.currentAnswer}
                    <span className="inline-block w-[2px] h-[14px] bg-[var(--accent)] ml-0.5 animate-cursor" />
                  </div>
                </div>
              </div>
            )}

            {/* Progressive sources during search */}
            {isSearching && session.sources.length > 0 && !session.currentAnswer && (
              <div className="animate-fade-in">
                <p className="text-[11px] font-semibold text-[var(--text-faint)] uppercase tracking-wider mb-3">
                  Sources ({session.sources.length})
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {session.sources.map((source) => (
                    <SourceCard key={source.id} source={source} />
                  ))}
                </div>
              </div>
            )}

            {/* Searching indicator (before sources arrive) */}
            {isSearching && session.sources.length === 0 && session.messages.length > 0 && (
              <div className="flex items-center gap-3 py-4 animate-fade-in">
                <Loader2 size={18} className="text-[var(--accent)] animate-spin" />
                <p className="text-[13px] text-[var(--text-muted)]">Searching the web...</p>
              </div>
            )}

            {/* Error */}
            {session.status === "error" && session.error && (
              <div className="flex items-center gap-3 p-4 rounded-xl bg-[var(--error)]/10 border border-[var(--error)]/20 animate-fade-in">
                <AlertTriangle size={18} className="text-[var(--error)] shrink-0" />
                <div className="flex-1">
                  <p className="text-[13px] text-[var(--error)] font-medium">{session.error}</p>
                </div>
                <button
                  onClick={() => {
                    const lastUserMsg = [...session.messages]
                      .reverse()
                      .find((m) => m.role === "user");
                    if (lastUserMsg) handleSearch(lastUserMsg.content);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--error)]/10 text-[var(--error)] text-[12px] font-medium hover:bg-[var(--error)]/20 transition-colors"
                >
                  <RotateCcw size={11} /> Retry
                </button>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Right: Activity sidebar */}
        {(isSearching || session.activities.length > 0) && (
          <div className="w-[260px] shrink-0 border-l border-[var(--border)] bg-[var(--bg-elevated)] flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <h3 className="text-[12px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                Search activity
              </h3>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-3">
                {session.activities.map((activity) => (
                  <div key={activity.id} className="flex items-start gap-3">
                    <div className="mt-0.5 shrink-0">
                      {activity.status === "completed" ? (
                        <div className="w-5 h-5 rounded-full bg-[var(--success)]/15 flex items-center justify-center">
                          <Check size={11} className="text-[var(--success)]" />
                        </div>
                      ) : activity.status === "active" ? (
                        <div className="w-5 h-5 rounded-full bg-[var(--accent-subtle)] border border-[var(--accent-border)] flex items-center justify-center">
                          <Loader2 size={11} className="text-[var(--accent)] animate-spin" />
                        </div>
                      ) : activity.status === "failed" ? (
                        <div className="w-5 h-5 rounded-full bg-[var(--error)]/15 flex items-center justify-center">
                          <AlertTriangle size={9} className="text-[var(--error)]" />
                        </div>
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-[var(--bg-tertiary)] border border-[var(--border)] flex items-center justify-center">
                          <div className="w-1.5 h-1.5 rounded-full bg-[var(--text-faint)]" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p
                        className={`text-[13px] ${
                          activity.status === "active"
                            ? "text-[var(--text-primary)] font-medium"
                            : activity.status === "completed"
                            ? "text-[var(--text-secondary)]"
                            : "text-[var(--text-faint)]"
                        }`}
                      >
                        {activity.message}
                      </p>
                      {activity.detail && (
                        <p className="text-[11px] text-[var(--text-faint)] mt-0.5">
                          {activity.detail}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Source mini-list in activity panel */}
              {session.sources.length > 0 && (
                <div className="mt-5 pt-4 border-t border-[var(--border)]">
                  <p className="text-[11px] font-semibold text-[var(--text-faint)] uppercase tracking-wider mb-3">
                    Sources
                  </p>
                  <div className="space-y-1.5">
                    {session.sources.map((source) => (
                      <div
                        key={source.id}
                        className="flex items-center gap-2 text-[12px]"
                      >
                        {source.status === "read" ? (
                          <Check size={10} className="text-[var(--success)] shrink-0" />
                        ) : source.status === "fetching" ? (
                          <Loader2
                            size={10}
                            className="text-[var(--accent)] animate-spin shrink-0"
                          />
                        ) : source.status === "failed" ? (
                          <AlertTriangle size={10} className="text-[var(--error)] shrink-0" />
                        ) : (
                          <div className="w-2.5 h-2.5 rounded-full border border-[var(--border)] shrink-0" />
                        )}
                        <span className="text-[var(--text-muted)] truncate">{source.domain}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Stop button */}
            {isSearching && (
              <div className="px-4 py-3 border-t border-[var(--border)]">
                <button
                  onClick={handleStop}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[var(--error)]/10 text-[var(--error)] text-[12px] font-medium hover:bg-[var(--error)]/20 transition-colors"
                >
                  <Square size={11} /> Stop search
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom composer */}
      <div className="px-6 py-3 border-t border-[var(--border)] bg-[var(--bg-elevated)]">
        <div className="max-w-3xl mx-auto flex gap-2">
          <div className="relative flex-1">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !isSearching && handleSubmit()}
              placeholder={
                isSearching
                  ? "Searching..."
                  : session.status === "error"
                  ? "Try another question..."
                  : session.messages.length > 0
                  ? "Ask a follow-up question..."
                  : "Search the web..."
              }
              disabled={isSearching}
              className="w-full px-4 py-3 bg-[var(--bg-primary)] rounded-xl text-[14px] border border-[var(--border)] focus:border-[var(--accent-border)] focus:outline-none placeholder:text-[var(--text-faint)] text-[var(--text-primary)] disabled:opacity-50"
            />
          </div>
          {isSearching ? (
            <button
              onClick={handleStop}
              className="px-4 py-3 rounded-xl bg-[var(--error)]/10 text-[var(--error)] text-[13px] font-semibold hover:bg-[var(--error)]/20 transition-all"
            >
              <Square size={16} />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!inputValue.trim()}
              className={`px-4 py-3 rounded-xl transition-all ${
                inputValue.trim()
                  ? "bg-[var(--accent)] text-white hover:opacity-90"
                  : "bg-[var(--bg-tertiary)] text-[var(--text-faint)] cursor-not-allowed"
              }`}
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Source card sub-component
function SourceCard({
  source,
  compact,
}: {
  source: SearchSource;
  compact?: boolean;
}) {
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`block rounded-xl bg-[var(--bg-elevated)] border border-[var(--border)] hover:border-[var(--accent-border)] transition-all group ${
        compact ? "p-3" : "p-3.5"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {source.status === "read" ? (
              <Check size={10} className="text-[var(--success)] shrink-0" />
            ) : source.status === "fetching" ? (
              <Loader2 size={10} className="text-[var(--accent)] animate-spin shrink-0" />
            ) : source.status === "failed" ? (
              <AlertTriangle size={10} className="text-[var(--error)] shrink-0" />
            ) : (
              <Globe size={10} className="text-[var(--text-faint)] shrink-0" />
            )}
            <span className="text-[11px] text-[var(--accent)] truncate">{source.domain}</span>
          </div>
          <p className="text-[13px] font-medium text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors truncate">
            {source.title}
          </p>
          {source.snippet && !compact && (
            <p className="text-[11px] text-[var(--text-muted)] mt-1 line-clamp-2 leading-relaxed">
              {source.snippet}
            </p>
          )}
        </div>
        <ExternalLink
          size={12}
          className="text-[var(--text-faint)] group-hover:text-[var(--accent)] shrink-0 mt-1 transition-colors"
        />
      </div>
    </a>
  );
}
