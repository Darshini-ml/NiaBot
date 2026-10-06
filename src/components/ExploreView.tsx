"use client";

import { useState, useRef } from "react";
import {
  Search,
  Globe,
  ExternalLink,
  Loader2,
  ArrowLeft,
  RefreshCw,
  Square,
  Play,
  RotateCcw,
  ChevronRight,
  Check,
  AlertTriangle,
  Send,
} from "lucide-react";

type ExploreMode = "menu" | "web-search" | "browser";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface BrowserAction {
  id: string;
  label: string;
  status: "done" | "active" | "pending";
}

interface ExploreViewProps {
  onBack?: () => void;
}

export default function ExploreView({ onBack }: ExploreViewProps) {
  const [mode, setMode] = useState<ExploreMode>("menu");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchAnswer, setSearchAnswer] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Browser state
  const [browserUrl, setBrowserUrl] = useState("");
  const [browserActive, setBrowserActive] = useState(false);
  const [browserActions, setBrowserActions] = useState<BrowserAction[]>([]);
  const [browserScreenshot, setBrowserScreenshot] = useState<string | null>(null);
  const [browserPaused, setBrowserPaused] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const browserInputRef = useRef<HTMLInputElement>(null);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setSearchError(null);
    setSearchResults([]);
    setSearchAnswer("");

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery, maxResults: 8 }),
      });

      if (!res.ok) throw new Error("Search failed");

      const data = await res.json();
      const results = data.results || data.data || data;

      if (Array.isArray(results)) {
        setSearchResults(
          results.map((r: { title?: string; url?: string; link?: string; snippet?: string; description?: string }) => ({
            title: r.title || "Untitled",
            url: r.url || r.link || "",
            snippet: r.snippet || r.description || "",
          }))
        );
      }

      // Get AI summary
      const chatRes = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content: `You have web search results. Provide a concise, helpful summary answering the query. Cite sources with [n] notation.\n\nSearch results:\n${
                Array.isArray(results)
                  ? results
                      .map(
                        (r: { title?: string; snippet?: string; description?: string; url?: string; link?: string }, i: number) =>
                          `[${i + 1}] ${r.title}\n${r.snippet || r.description}\nURL: ${r.url || r.link}`
                      )
                      .join("\n\n")
                  : ""
              }`,
            },
            { role: "user", content: searchQuery },
          ],
          model: "gpt-4o-mini",
          stream: true,
        }),
      });

      if (chatRes.ok && chatRes.body) {
        const reader = chatRes.body.getReader();
        const decoder = new TextDecoder();
        let content = "";
        let buffer = "";

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
              const parsed = JSON.parse(d);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                content += delta;
                setSearchAnswer(content);
              }
            } catch {
              /* skip */
            }
          }
        }
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setIsSearching(false);
    }
  };

  const handleBrowserStart = () => {
    if (!browserUrl.trim()) return;
    const url = browserUrl.startsWith("http") ? browserUrl : `https://${browserUrl}`;
    setBrowserActive(true);
    setBrowserPaused(false);
    setBrowserScreenshot(null);
    setBrowserActions([
      { id: "1", label: `Opening ${new URL(url).hostname}...`, status: "active" },
      { id: "2", label: "Reading page content", status: "pending" },
      { id: "3", label: "Analyzing results", status: "pending" },
    ]);

    // Simulate browser actions
    setTimeout(() => {
      setBrowserActions((prev) =>
        prev.map((a) =>
          a.id === "1"
            ? { ...a, status: "done", label: `Opened ${new URL(url).hostname}` }
            : a.id === "2"
            ? { ...a, status: "active" }
            : a
        )
      );
    }, 1500);

    setTimeout(() => {
      setBrowserActions((prev) =>
        prev.map((a) =>
          a.id === "2"
            ? { ...a, status: "done", label: "Read page content" }
            : a.id === "3"
            ? { ...a, status: "active", label: "Analyzing results" }
            : a
        )
      );
    }, 3000);

    setTimeout(() => {
      setBrowserActions((prev) =>
        prev.map((a) =>
          a.id === "3"
            ? { ...a, status: "done", label: "Analysis complete" }
            : a
        )
      );
      setBrowserActive(false);
    }, 4500);
  };

  const handleBrowserStop = () => {
    setBrowserActive(false);
    setBrowserPaused(false);
  };

  // Menu view
  if (mode === "menu") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <h1 className="text-[22px] font-bold text-[var(--text-primary)] mb-2">Explore</h1>
        <p className="text-[14px] text-[var(--text-muted)] mb-8">
          Search the web or browse websites interactively.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 w-full max-w-lg">
          <button
            onClick={() => {
              setMode("web-search");
              setTimeout(() => searchInputRef.current?.focus(), 100);
            }}
            className="flex-1 flex flex-col items-center gap-3 p-6 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-card)] hover:border-[var(--accent-border)] hover:bg-[var(--bg-hover)] transition-all group"
          >
            <div className="w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center group-hover:scale-105 transition-transform">
              <Search size={24} className="text-blue-400" />
            </div>
            <div className="text-center">
              <p className="text-[15px] font-semibold text-[var(--text-primary)]">Web Search</p>
              <p className="text-[12px] text-[var(--text-muted)] mt-1">
                Search the web and return relevant information.
              </p>
            </div>
          </button>

          <button
            onClick={() => {
              setMode("browser");
              setTimeout(() => browserInputRef.current?.focus(), 100);
            }}
            className="flex-1 flex flex-col items-center gap-3 p-6 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-card)] hover:border-[var(--accent-border)] hover:bg-[var(--bg-hover)] transition-all group"
          >
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center group-hover:scale-105 transition-transform">
              <Globe size={24} className="text-emerald-400" />
            </div>
            <div className="text-center">
              <p className="text-[15px] font-semibold text-[var(--text-primary)]">Browser</p>
              <p className="text-[12px] text-[var(--text-muted)] mt-1">
                Browse websites and interact with them.
              </p>
            </div>
          </button>
        </div>
      </div>
    );
  }

  // Web Search view
  if (mode === "web-search") {
    return (
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-5 pb-3 flex items-center gap-3">
          <button
            onClick={() => {
              setMode("menu");
              setSearchResults([]);
              setSearchAnswer("");
              setSearchQuery("");
              setSearchError(null);
            }}
            className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)]"
          >
            <ArrowLeft size={18} />
          </button>
          <h1 className="text-[18px] font-bold text-[var(--text-primary)]">Web Search</h1>
        </div>

        {/* Search input */}
        <div className="px-6 py-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="Search the web..."
                className="w-full pl-10 pr-4 py-3 bg-[var(--bg-tertiary)] rounded-xl text-[14px] border border-[var(--border)] focus:border-[var(--accent-border)] focus:outline-none placeholder:text-[var(--text-faint)] text-[var(--text-primary)]"
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={isSearching || !searchQuery.trim()}
              className={`px-5 py-3 rounded-xl text-[13px] font-semibold transition-all ${
                searchQuery.trim() && !isSearching
                  ? "bg-[var(--accent)] text-white hover:opacity-90"
                  : "bg-[var(--bg-tertiary)] text-[var(--text-faint)] cursor-not-allowed"
              }`}
            >
              {isSearching ? <Loader2 size={16} className="animate-spin" /> : "Search"}
            </button>
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isSearching && searchResults.length === 0 && (
            <div className="flex flex-col items-center py-12">
              <Loader2 size={28} className="text-[var(--accent)] animate-spin mb-3" />
              <p className="text-[14px] text-[var(--text-muted)]">Searching the web...</p>
            </div>
          )}

          {searchError && (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20 mb-4">
              <AlertTriangle size={18} className="text-red-400 shrink-0" />
              <div>
                <p className="text-[13px] text-red-400 font-medium">{searchError}</p>
                <button
                  onClick={handleSearch}
                  className="text-[12px] text-red-300 hover:text-red-200 mt-1 flex items-center gap-1"
                >
                  <RotateCcw size={11} /> Retry
                </button>
              </div>
            </div>
          )}

          {searchAnswer && (
            <div className="mb-6 p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-card)]">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-lg bg-[var(--accent-subtle)] flex items-center justify-center">
                  <Search size={12} className="text-[var(--accent)]" />
                </div>
                <span className="text-[12px] font-semibold text-[var(--text-muted)]">AI Summary</span>
              </div>
              <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">
                {searchAnswer}
              </p>
            </div>
          )}

          {searchResults.length > 0 && (
            <div>
              <h3 className="text-[12px] font-semibold text-[var(--text-faint)] uppercase tracking-wider mb-3">
                Sources ({searchResults.length})
              </h3>
              <div className="space-y-2">
                {searchResults.map((result, i) => (
                  <a
                    key={i}
                    href={result.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block p-3.5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border)] hover:border-[var(--accent-border)] hover:bg-[var(--bg-hover)] transition-all group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-medium text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors truncate">
                          {result.title}
                        </p>
                        <p className="text-[11px] text-[var(--accent)] mt-0.5 truncate">
                          {result.url}
                        </p>
                        <p className="text-[12px] text-[var(--text-muted)] mt-1.5 line-clamp-2 leading-relaxed">
                          {result.snippet}
                        </p>
                      </div>
                      <ExternalLink
                        size={13}
                        className="text-[var(--text-faint)] group-hover:text-[var(--accent)] shrink-0 mt-1 transition-colors"
                      />
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Browser view
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-5 pb-3 flex items-center gap-3">
        <button
          onClick={() => {
            setMode("menu");
            setBrowserUrl("");
            setBrowserActions([]);
            setBrowserActive(false);
            setBrowserScreenshot(null);
          }}
          className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)]"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-[18px] font-bold text-[var(--text-primary)]">Browser</h1>
      </div>

      {/* URL input */}
      <div className="px-6 py-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Globe size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
            <input
              ref={browserInputRef}
              type="text"
              value={browserUrl}
              onChange={(e) => setBrowserUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleBrowserStart()}
              placeholder="Enter a URL to browse..."
              className="w-full pl-10 pr-4 py-3 bg-[var(--bg-tertiary)] rounded-xl text-[14px] border border-[var(--border)] focus:border-[var(--accent-border)] focus:outline-none placeholder:text-[var(--text-faint)] text-[var(--text-primary)]"
            />
          </div>
          <button
            onClick={browserActive ? handleBrowserStop : handleBrowserStart}
            disabled={!browserUrl.trim() && !browserActive}
            className={`px-5 py-3 rounded-xl text-[13px] font-semibold transition-all ${
              browserActive
                ? "bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20"
                : browserUrl.trim()
                ? "bg-[var(--accent)] text-white hover:opacity-90"
                : "bg-[var(--bg-tertiary)] text-[var(--text-faint)] cursor-not-allowed"
            }`}
          >
            {browserActive ? "Stop" : "Browse"}
          </button>
        </div>
      </div>

      {/* Browser content */}
      <div className="flex-1 flex overflow-hidden px-6 py-3 gap-4">
        {/* Left: Browser preview */}
        <div className="flex-1 rounded-xl bg-[var(--bg-card)] border border-[var(--border-card)] flex flex-col overflow-hidden">
          {browserActions.length > 0 ? (
            <>
              {/* Browser toolbar */}
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-elevated)]">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-400/40" />
                  <div className="w-3 h-3 rounded-full bg-yellow-400/40" />
                  <div className="w-3 h-3 rounded-full bg-green-400/40" />
                </div>
                <div className="flex-1 px-3 py-1 bg-[var(--bg-tertiary)] rounded-lg text-[11px] text-[var(--text-muted)] truncate">
                  {browserUrl}
                </div>
                <button
                  onClick={() => handleBrowserStart()}
                  className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)]"
                >
                  <RefreshCw size={13} />
                </button>
              </div>

              {/* Preview area */}
              <div className="flex-1 flex items-center justify-center bg-[var(--bg-primary)]">
                {browserActive ? (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 size={32} className="text-[var(--accent)] animate-spin" />
                    <p className="text-[13px] text-[var(--text-muted)]">
                      {browserActions.find((a) => a.status === "active")?.label || "Loading..."}
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Check size={28} className="text-emerald-400" />
                    <p className="text-[13px] text-[var(--text-muted)]">Browse complete</p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Globe size={40} className="text-[var(--text-faint)] mx-auto mb-3" />
                <p className="text-[14px] text-[var(--text-muted)]">Enter a URL to start browsing</p>
              </div>
            </div>
          )}
        </div>

        {/* Right: Activity timeline */}
        {browserActions.length > 0 && (
          <div className="w-[280px] shrink-0 rounded-xl bg-[var(--bg-card)] border border-[var(--border-card)] flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">
                Browser activity
              </h3>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-3">
                {browserActions.map((action) => (
                  <div key={action.id} className="flex items-start gap-3">
                    <div className="mt-0.5">
                      {action.status === "done" ? (
                        <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
                          <Check size={11} className="text-emerald-400" />
                        </div>
                      ) : action.status === "active" ? (
                        <div className="w-5 h-5 rounded-full bg-[var(--accent-subtle)] border border-[var(--accent-border)] flex items-center justify-center">
                          <Loader2 size={11} className="text-[var(--accent)] animate-spin" />
                        </div>
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-[var(--bg-tertiary)] border border-[var(--border)] flex items-center justify-center">
                          <div className="w-1.5 h-1.5 rounded-full bg-[var(--text-faint)]" />
                        </div>
                      )}
                    </div>
                    <p
                      className={`text-[13px] ${
                        action.status === "active"
                          ? "text-[var(--text-primary)] font-medium"
                          : action.status === "done"
                          ? "text-[var(--text-secondary)]"
                          : "text-[var(--text-faint)]"
                      }`}
                    >
                      {action.label}
                    </p>
                  </div>
                ))}
              </div>

              {/* Controls */}
              <div className="mt-6 flex items-center gap-2">
                {browserActive && (
                  <>
                    <button
                      onClick={handleBrowserStop}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 text-[12px] font-medium hover:bg-red-500/20 transition-colors"
                    >
                      <Square size={11} /> Stop
                    </button>
                    <button
                      onClick={() => setBrowserPaused(!browserPaused)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-hover)] text-[var(--text-secondary)] text-[12px] font-medium hover:bg-[var(--bg-active)] transition-colors"
                    >
                      {browserPaused ? (
                        <>
                          <Play size={11} /> Resume
                        </>
                      ) : (
                        <>
                          <Square size={11} /> Pause
                        </>
                      )}
                    </button>
                  </>
                )}
                {!browserActive && browserActions.some((a) => a.status === "done") && (
                  <button
                    onClick={handleBrowserStart}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-hover)] text-[var(--text-secondary)] text-[12px] font-medium hover:bg-[var(--bg-active)] transition-colors"
                  >
                    <RotateCcw size={11} /> Restart
                  </button>
                )}
              </div>

              {/* Current action label */}
              {browserActive && (
                <div className="mt-4 p-3 rounded-lg bg-[var(--accent-subtle)] border border-[var(--accent-border)]">
                  <p className="text-[11px] font-medium text-[var(--text-muted)] mb-1">
                    Current action
                  </p>
                  <p className="text-[13px] text-[var(--accent)] font-medium">
                    {browserActions.find((a) => a.status === "active")?.label || "Processing..."}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
