"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Check,
  Zap,
  Scale,
  Brain,
  Globe,
  Server,
  Sparkles,
  Search,
  Settings,
  Clock,
} from "lucide-react";
import { FEATURED_MODEL_IDS, FEATURED_TAGS, FEATURED_ORDER, isDeprecatedModel } from "@/lib/modelCatalog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelOption {
  id: string;
  name: string;
  modelId: string;
  provider: string;
  providerName: string;
  icon: typeof Zap;
  tag?: string;
  type?: "chat" | "image" | "audio" | "embedding";
  supports?: {
    tools: boolean;
    vision: boolean;
    thinking: boolean;
    streaming: boolean;
  };
  context?: number;
  pricing?: {
    in_per_1m?: number;
    out_per_1m?: number;
  };
}

// Backward-compatible default models list
export const models: ModelOption[] = [
  {
    id: "google/gemini-2.5-flash",
    name: "NiaAI Fast",
    modelId: "google/gemini-2.5-flash",
    provider: "niaai",
    providerName: "NiaAI",
    icon: Zap,
    tag: "Default",
  },
  {
    id: "anthropic/claude-sonnet-4.6",
    name: "Balanced",
    modelId: "anthropic/claude-sonnet-4.6",
    provider: "niaai",
    providerName: "NiaAI",
    icon: Scale,
  },
  {
    id: "deepseek/deepseek-r1",
    name: "NiaAI Deep Think",
    modelId: "deepseek/deepseek-r1",
    provider: "niaai",
    providerName: "NiaAI",
    icon: Brain,
    tag: "Best reasoning",
  },
];

/** Get the default model */
export function getDefaultModel(): ModelOption {
  return models[0];
}

// ---------------------------------------------------------------------------
// Provider icon map
// ---------------------------------------------------------------------------

const providerIconMap: Record<string, typeof Zap> = {
  niaai: Sparkles,
  anthropic: Brain,
  openai: Zap,
  google: Globe,
  "meta-llama": Sparkles,
  deepseek: Sparkles,
  mistralai: Sparkles,
  ollama: Server,
  qwen: Sparkles,
  "x-ai": Sparkles,
  cohere: Sparkles,
  perplexity: Sparkles,
  microsoft: Sparkles,
  nvidia: Sparkles,
  minimax: Sparkles,
  moonshot: Sparkles,
};

// ---------------------------------------------------------------------------
// Thinking levels
// ---------------------------------------------------------------------------

type ThinkingLevel = "off" | "low" | "medium" | "high";

const thinkingOptions: { level: ThinkingLevel; label: string; hint: string }[] = [
  { level: "off", label: "Off", hint: "" },
  { level: "low", label: "Low", hint: "~2K tokens" },
  { level: "medium", label: "Medium", hint: "~8K tokens" },
  { level: "high", label: "High", hint: "~32K tokens" },
];

// ---------------------------------------------------------------------------
// Recently Used persistence
// ---------------------------------------------------------------------------

const RECENT_KEY = "nia_recent_models";
const MAX_RECENT = 3;

function getRecentModels(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function addRecentModel(id: string) {
  try {
    const current = getRecentModels().filter((m) => m !== id);
    current.unshift(id);
    localStorage.setItem(RECENT_KEY, JSON.stringify(current.slice(0, MAX_RECENT + 5)));
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Pinned models persistence
// ---------------------------------------------------------------------------

const PINNED_KEY = "nia_pinned_models";

function getPinnedModels(): Set<string> {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set(FEATURED_MODEL_IDS);
  } catch {
    return new Set(FEATURED_MODEL_IDS);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pillLabel(model: ModelOption): string {
  if (model.provider === "niaai") return model.name;
  return model.name
    .replace(/^Claude\s+/, "")
    .replace(/^GPT-/, "GPT-")
    .replace(/^Default$/, model.providerName);
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ModelSelectorProps {
  selectedModel?: ModelOption;
  onModelChange?: (model: ModelOption) => void;
  compact?: boolean;
  onOpenChange?: (open: boolean) => void;
  thinkingLevel?: ThinkingLevel;
  onThinkingChange?: (level: ThinkingLevel) => void;
  onOpenConfigPanel?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ModelSelector({
  selectedModel,
  onModelChange,
  compact,
  onOpenChange,
  thinkingLevel = "off",
  onThinkingChange,
  onOpenConfigPanel,
}: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState<ModelOption>(selectedModel || models[0]);
  const [thinkingSubmenuOpen, setThinkingSubmenuOpen] = useState(false);
  const [moreModelsOpen, setMoreModelsOpen] = useState(false);
  const [moreSearch, setMoreSearch] = useState("");
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [allModels, setAllModels] = useState<ModelOption[]>([]);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set(FEATURED_MODEL_IDS));
  const [recentIds, setRecentIds] = useState<string[]>([]);

  useEffect(() => {
    if (selectedModel) setSelected(selectedModel);
  }, [selectedModel]);

  // Load pinned & recent from localStorage
  useEffect(() => {
    setPinnedIds(getPinnedModels());
    setRecentIds(getRecentModels());
  }, []);

  // Fetch models from API
  useEffect(() => {
    let cancelled = false;
    async function fetchModels() {
      try {
        const res = await fetch("/api/models");
        if (!res.ok || cancelled) return;
        const data = await res.json();

        const mapped: ModelOption[] = [];
        for (const p of data.providers || []) {
          for (const m of p.models || []) {
            // Only include chat models in the picker
            if (m.type && m.type !== "chat") continue;
            mapped.push({
              id: m.id,
              name: m.label || m.id.split("/").pop() || m.id,
              modelId: m.id,
              provider: p.id === "ollama" ? "ollama" : "niaai",
              providerName: p.name,
              icon: providerIconMap[p.id] || Sparkles,
              tag: m.tag || FEATURED_TAGS[m.id],
              type: m.type || "chat",
              supports: m.supports || { tools: true, vision: false, thinking: false, streaming: true },
              context: m.context,
              pricing: m.pricing,
            });
          }
        }

        if (!cancelled && mapped.length > 0) {
          setAllModels(mapped);
        }
      } catch (err) {
        console.error("[ModelSelector] Failed to fetch models:", err);
      }
    }
    fetchModels();
    const interval = setInterval(fetchModels, 10 * 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Build featured rows from FEATURED_ORDER (exact 8 entries with display names + tags)
  const featuredRows = useMemo(() => {
    return FEATURED_ORDER.map((entry) => {
      const found = allModels.find((m) => m.id === entry.id);
      if (found) {
        return { ...found, name: entry.displayName, tag: entry.tag };
      }
      // Fallback: create a synthetic entry from static models or defaults
      const staticMatch = models.find((m) => m.id === entry.id);
      if (staticMatch) {
        return { ...staticMatch, name: entry.displayName, tag: entry.tag };
      }
      // Final fallback: build from the entry data
      const provider = entry.id.split("/")[0];
      return {
        id: entry.id,
        name: entry.displayName,
        modelId: entry.id,
        provider: "niaai",
        providerName: provider.charAt(0).toUpperCase() + provider.slice(1),
        icon: providerIconMap[provider] || Sparkles,
        tag: entry.tag,
        type: "chat" as const,
      };
    });
  }, [allModels]);

  const recentModels = useMemo(() => {
    if (allModels.length === 0) return [];
    const featuredSet = new Set(FEATURED_ORDER.map((e) => e.id));
    return recentIds
      .filter((id) => !featuredSet.has(id))
      .slice(0, MAX_RECENT)
      .map((id) => allModels.find((m) => m.id === id))
      .filter(Boolean) as ModelOption[];
  }, [allModels, recentIds]);

  // "More models" grouped by provider — filter deprecated, exclude featured/recent
  const moreModelsByProvider = useMemo(() => {
    if (allModels.length === 0) return [];
    const featuredSet = new Set(FEATURED_ORDER.map((e) => e.id));
    const recentSet = new Set(recentModels.map((m) => m.id));
    const remaining = allModels.filter(
      (m) => !featuredSet.has(m.id) && !recentSet.has(m.id) && !isDeprecatedModel(m.id),
    );

    // Filter by search
    const filtered = moreSearch
      ? remaining.filter((m) => {
          const q = moreSearch.toLowerCase();
          return (
            m.name.toLowerCase().includes(q) ||
            m.id.toLowerCase().includes(q) ||
            m.providerName.toLowerCase().includes(q)
          );
        })
      : remaining;

    // Group by providerName
    const groups: { provider: string; providerId: string; icon: typeof Zap; models: ModelOption[] }[] = [];
    const seen = new Map<string, number>();
    for (const m of filtered) {
      const idx = seen.get(m.providerName);
      if (idx !== undefined) {
        groups[idx].models.push(m);
      } else {
        seen.set(m.providerName, groups.length);
        groups.push({
          provider: m.providerName,
          providerId: m.id.split("/")[0],
          icon: m.icon,
          models: [m],
        });
      }
    }
    return groups;
  }, [allModels, recentModels, moreSearch]);

  // Flat list of visible models in "More" panel for keyboard navigation
  const flatMoreModels = useMemo(() => {
    const flat: ModelOption[] = [];
    for (const group of moreModelsByProvider) {
      const isExpanded = expandedProvider === group.provider || !!moreSearch;
      const visible = isExpanded ? group.models : group.models.slice(0, 8);
      flat.push(...visible);
    }
    return flat;
  }, [moreModelsByProvider, expandedProvider, moreSearch]);

  // Compute position
  const computeMenuPos = useCallback(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPos({ x: rect.right, y: rect.top });
    }
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setMenuPos(null);
    setThinkingSubmenuOpen(false);
    setMoreModelsOpen(false);
    setMoreSearch("");
    setExpandedProvider(null);
    setHighlightIdx(-1);
    onOpenChange?.(false);
  }, [onOpenChange]);

  const goBackFromMore = useCallback(() => {
    setMoreModelsOpen(false);
    setMoreSearch("");
    setExpandedProvider(null);
    setHighlightIdx(-1);
  }, []);

  const handleSelectModel = useCallback(
    (model: ModelOption) => {
      setSelected(model);
      onModelChange?.(model);
      addRecentModel(model.id);
      setRecentIds(getRecentModels());
      close();
    },
    [onModelChange, close],
  );

  const toggleOpen = () => {
    const next = !isOpen;
    if (next) {
      computeMenuPos();
    } else {
      close();
      return;
    }
    setIsOpen(next);
    onOpenChange?.(next);
  };

  // Recalculate on resize
  useEffect(() => {
    if (!isOpen) return;
    const onResize = () => computeMenuPos();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isOpen, computeMenuPos]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const onClick = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        close();
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [isOpen, close]);

  // Escape key — go back from "More" or close
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (moreModelsOpen) {
          goBackFromMore();
        } else {
          close();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, moreModelsOpen, close, goBackFromMore]);

  // Focus search input when "More models" opens
  useEffect(() => {
    if (moreModelsOpen && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 60);
    }
  }, [moreModelsOpen]);

  // Keyboard navigation in More panel
  const handleMoreKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIdx((i) => Math.min(i + 1, flatMoreModels.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && highlightIdx >= 0 && highlightIdx < flatMoreModels.length) {
        e.preventDefault();
        handleSelectModel(flatMoreModels[highlightIdx]);
      }
    },
    [flatMoreModels, highlightIdx, handleSelectModel],
  );

  const selectedSupportsThinking = selected.supports?.thinking ?? false;
  const displayIcon = providerIconMap[selected.provider] || selected.icon;
  const DisplayIcon = displayIcon;

  // -----------------------------------------------------------------------
  // Render a featured model row (40px height, tag + check on selected)
  // -----------------------------------------------------------------------
  const renderFeaturedRow = (model: ModelOption, key: string) => {
    const isSelected = selected.id === model.id;
    return (
      <button
        key={key}
        onClick={() => handleSelectModel(model)}
        className={`w-full flex items-center gap-2.5 px-3 rounded-lg transition-colors text-left ${
          isSelected ? "bg-[var(--accent-subtle)]" : "hover:bg-[var(--bg-hover)]"
        }`}
        style={{ height: 40 }}
      >
        <span className="shrink-0 w-5 h-5 flex items-center justify-center">
          {(() => {
            const MIcon = model.icon;
            return <MIcon size={16} className="text-[var(--text-muted)]" />;
          })()}
        </span>
        <span className="flex-1 text-[13px] text-[var(--text-primary)] truncate" style={{ whiteSpace: "nowrap" }}>
          {model.name}
        </span>
        {/* Tag always visible */}
        {model.tag && (
          <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-medium text-[var(--text-faint)] bg-[var(--bg-elevated)] border border-[var(--border)]" style={{ whiteSpace: "nowrap" }}>
            {model.tag}
          </span>
        )}
        {/* Check next to tag with gap */}
        {isSelected && (
          <Check size={14} className="shrink-0 text-[var(--accent)]" style={{ marginLeft: model.tag ? 0 : undefined }} />
        )}
      </button>
    );
  };

  // -----------------------------------------------------------------------
  // Render a "More models" row (40px, provider icon + label + muted id + check)
  // -----------------------------------------------------------------------
  const renderMoreRow = (model: ModelOption, idx: number) => {
    const isSelected = selected.id === model.id;
    const isHighlighted = highlightIdx === idx;
    return (
      <button
        key={model.id}
        onClick={() => handleSelectModel(model)}
        onMouseEnter={() => setHighlightIdx(idx)}
        className={`w-full flex items-center gap-2.5 px-3 rounded-lg transition-colors text-left ${
          isSelected
            ? "bg-[var(--accent-subtle)]"
            : isHighlighted
              ? "bg-[var(--bg-hover)]"
              : "hover:bg-[var(--bg-hover)]"
        }`}
        style={{ height: 40 }}
      >
        <span className="shrink-0 w-5 h-5 flex items-center justify-center">
          {(() => {
            const MIcon = model.icon;
            return <MIcon size={16} className="text-[var(--text-muted)]" />;
          })()}
        </span>
        <span className="flex-1 text-[13px] text-[var(--text-primary)] truncate" style={{ whiteSpace: "nowrap" }}>
          {model.name}
        </span>
        <span className="shrink-0 text-[11px] text-[var(--text-faint)] truncate" style={{ maxWidth: 100 }}>
          {model.id.split("/").pop()}
        </span>
        {isSelected && (
          <Check size={14} className="shrink-0 text-[var(--accent)]" />
        )}
      </button>
    );
  };

  // -----------------------------------------------------------------------
  // Dropdown menu
  // -----------------------------------------------------------------------
  const renderMenu = () => {
    if (!menuPos) return null;

    return createPortal(
      <>
        {/* Backdrop */}
        <div className="fixed inset-0 z-[10000]" onClick={close} />
        {/* Menu */}
        <div
          ref={menuRef}
          style={{
            position: "fixed",
            right: window.innerWidth - menuPos.x,
            bottom: window.innerHeight - menuPos.y + 8,
            zIndex: 10001,
            width: 320,
          }}
        >
          <div
            className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl overflow-hidden animate-scale-in shadow-lg shadow-black/40 flex flex-col"
            style={{ maxHeight: 520 }}
          >
            {/* ============================================================ */}
            {/* "More models" slide-over panel                               */}
            {/* ============================================================ */}
            {moreModelsOpen ? (
              <div
                className="flex flex-col"
                style={{ maxHeight: 520, animation: "slideLeft 160ms ease-out" }}
                onKeyDown={handleMoreKeyDown}
              >
                {/* Header: Back + Search */}
                <div className="shrink-0 px-2 pt-2 pb-1 flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={goBackFromMore}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--bg-hover)] transition-colors text-[12px] text-[var(--text-muted)]"
                    >
                      <ChevronLeft size={14} />
                      Back
                    </button>
                  </div>
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
                    <Search size={13} className="text-[var(--text-faint)] shrink-0" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={moreSearch}
                      onChange={(e) => { setMoreSearch(e.target.value); setHighlightIdx(0); }}
                      onKeyDown={handleMoreKeyDown}
                      placeholder="Search 200+ models\u2026"
                      className="flex-1 bg-transparent text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] outline-none"
                    />
                  </div>
                </div>

                {/* Scrollable model list */}
                <div className="flex-1 overflow-y-auto px-1.5 pb-1.5" style={{ maxHeight: 360 }}>
                  {moreModelsByProvider.length === 0 && (
                    <div className="px-4 py-6 text-[12px] text-[var(--text-faint)] text-center">
                      No models found
                    </div>
                  )}
                  {(() => {
                    let flatIdx = 0;
                    return moreModelsByProvider.map((group) => {
                      const isExpanded = expandedProvider === group.provider || !!moreSearch;
                      const PIcon = group.icon;
                      const visibleModels = isExpanded ? group.models : group.models.slice(0, 8);
                      const hasMore = group.models.length > 8 && !isExpanded;

                      return (
                        <div key={group.provider}>
                          {/* Sticky provider header */}
                          <div
                            className="sticky top-0 z-10 bg-[var(--bg-elevated)]"
                            style={{ borderBottom: "1px solid rgba(255,255,255,.06)" }}
                          >
                            <button
                              onClick={() => setExpandedProvider(isExpanded && !moreSearch ? null : group.provider)}
                              className="w-full flex items-center gap-2 px-3 hover:bg-[var(--bg-hover)] transition-colors text-left"
                              style={{ height: 32, padding: "0 12px" }}
                            >
                              <PIcon size={14} className="text-[var(--text-muted)] shrink-0" />
                              <span className="flex-1 text-[11px] font-bold uppercase tracking-wider" style={{ color: "#8e8a96" }}>
                                {group.provider}
                              </span>
                              <span className="text-[10px] text-[var(--text-faint)]">
                                {group.models.length}
                              </span>
                              <ChevronRight
                                size={12}
                                className="text-[var(--text-faint)] shrink-0 transition-transform duration-[160ms]"
                                style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
                              />
                            </button>
                          </div>

                          {/* Models */}
                          {(isExpanded || !moreSearch) && (
                            <div>
                              {visibleModels.map((m) => {
                                const currentIdx = flatIdx++;
                                return renderMoreRow(m, currentIdx);
                              })}
                              {hasMore && (
                                <button
                                  onClick={() => setExpandedProvider(group.provider)}
                                  className="w-full px-3 text-[11px] text-[var(--accent)] hover:underline text-left"
                                  style={{ height: 32 }}
                                >
                                  Show all {group.models.length}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            ) : (
              <>
                {/* ============================================================ */}
                {/* Main panel: Featured + Recent + More + Thinking + Manage      */}
                {/* ============================================================ */}

                {/* ---- Featured section (never scrolls) ---- */}
                <div className="p-1.5 shrink-0">
                  <div className="px-3 text-[11px] font-bold uppercase tracking-wider" style={{ color: "#8e8a96", padding: "6px 12px" }}>
                    Featured
                  </div>
                  {featuredRows.map((m, i) =>
                    renderFeaturedRow(m, `featured-${i}-${m.id}`)
                  )}

                  {/* ---- Recently Used ---- */}
                  {recentModels.length > 0 && (
                    <>
                      <div className="mx-2 my-0.5" style={{ borderTop: "1px solid rgba(255,255,255,.06)" }} />
                      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: "#8e8a96", padding: "6px 12px" }}>
                        <Clock size={10} />
                        Recently used
                      </div>
                      {recentModels.map((m) => renderFeaturedRow(m, `recent-${m.id}`))}
                    </>
                  )}
                </div>

                {/* ---- More models… button ---- */}
                <div className="shrink-0">
                  <div className="mx-2" style={{ borderTop: "1px solid rgba(255,255,255,.06)" }} />
                  <button
                    onClick={() => {
                      setMoreModelsOpen(true);
                      setThinkingSubmenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-4 rounded-lg hover:bg-[var(--bg-hover)] transition-colors text-left"
                    style={{ height: 40 }}
                  >
                    <Search size={14} className="text-[var(--text-muted)] shrink-0" />
                    <span className="flex-1 text-[13px] font-medium text-[var(--text-primary)]">
                      More models&hellip;
                    </span>
                    <ChevronRight size={14} className="text-[var(--text-muted)] shrink-0" />
                  </button>
                </div>

                {/* ---- Footer: Thinking + Manage models ---- */}
                <div className="shrink-0 p-1.5" style={{ borderTop: "1px solid rgba(255,255,255,.06)" }}>
                  {/* Thinking row */}
                  <button
                    onClick={() => {
                      if (!selectedSupportsThinking) return;
                      setThinkingSubmenuOpen((v) => !v);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 rounded-lg transition-colors text-left ${
                      !selectedSupportsThinking
                        ? "opacity-40 cursor-not-allowed"
                        : "hover:bg-[var(--bg-hover)]"
                    }`}
                    style={{ height: 40 }}
                    title={!selectedSupportsThinking ? `Not supported by ${selected.name}` : "Thinking level"}
                  >
                    <Brain size={16} className="text-[var(--text-muted)] shrink-0" />
                    <span className="flex-1 text-[13px] font-medium text-[var(--text-primary)]">
                      Thinking
                    </span>
                    <span className="text-[12px] text-[var(--text-muted)]">
                      {thinkingOptions.find((o) => o.level === thinkingLevel)?.label ?? "Off"} &rsaquo;
                    </span>
                  </button>

                  {/* Thinking submenu */}
                  <div
                    style={{
                      maxHeight: thinkingSubmenuOpen && selectedSupportsThinking ? thinkingOptions.length * 34 + 4 : 0,
                      overflow: "hidden",
                      transition: "max-height 160ms ease",
                    }}
                  >
                    <div className="ml-6 mr-2 mb-1">
                      {thinkingOptions.map((opt) => {
                        const isActive = thinkingLevel === opt.level;
                        return (
                          <button
                            key={opt.level}
                            onClick={() => {
                              onThinkingChange?.(opt.level);
                              setThinkingSubmenuOpen(false);
                            }}
                            className={`w-full flex items-center gap-2 px-3 rounded-lg transition-colors text-left ${
                              isActive ? "bg-[var(--accent-subtle)]" : "hover:bg-[var(--bg-hover)]"
                            }`}
                            style={{ height: 32 }}
                          >
                            <span className="flex-1 text-[12px] text-[var(--text-primary)] flex items-center gap-2">
                              {opt.label}
                              {opt.hint && (
                                <span className="text-[10px] text-[var(--text-faint)]">{opt.hint}</span>
                              )}
                            </span>
                            {isActive && <Check size={13} className="shrink-0 text-[var(--accent)]" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Manage models link */}
                  <button
                    onClick={() => {
                      close();
                      onOpenConfigPanel?.();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 rounded-lg hover:bg-[var(--bg-hover)] transition-colors text-left"
                    style={{ height: 40 }}
                  >
                    <Settings size={14} className="text-[var(--text-muted)] shrink-0" />
                    <span className="text-[12px] text-[var(--text-muted)]">
                      Manage models
                    </span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </>,
      document.body,
    );
  };

  const displayLabel = pillLabel(selected);

  // -----------------------------------------------------------------------
  // Compact mode (composer toolbar)
  // -----------------------------------------------------------------------
  if (compact) {
    return (
      <div className="relative">
        <button
          ref={buttonRef}
          onClick={toggleOpen}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] hover:border-[var(--accent-border)] hover:bg-[var(--bg-hover)] transition-colors text-[12px]"
          title={selected.modelId}
        >
          <DisplayIcon size={14} className="text-[var(--accent)] shrink-0" />
          <span className="text-[var(--text-primary)] font-medium">{displayLabel}</span>
          <ChevronDown
            size={12}
            className={`text-[var(--text-muted)] transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          />
        </button>
        {isOpen && renderMenu()}
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Header pill mode
  // -----------------------------------------------------------------------
  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={toggleOpen}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)] transition-all text-[13px]"
        style={{ height: 34 }}
        title={selected.modelId}
      >
        <DisplayIcon size={14} className="text-[var(--accent)] shrink-0" />
        <span className="font-semibold text-[var(--text-primary)]">{displayLabel}</span>
        <ChevronDown
          size={13}
          className={`text-[var(--text-muted)] transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>
      {isOpen && renderMenu()}
    </div>
  );
}
