"use client";

import { Copy, ThumbsUp, ThumbsDown, RotateCcw, Volume2, Check, VolumeX, Mic, Download, ImageIcon, X, RefreshCw, ChevronDown, ChevronUp, AlertTriangle, Paperclip, Globe, ExternalLink, FileText, ZoomIn, ZoomOut, Maximize, ArrowLeft, ArrowRight, Info, Hash, MessageSquare } from "lucide-react";
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { showToast } from "./Toast";

export interface UploadedAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  isImage?: boolean;
  extractedText?: string;
  pages?: number;
  chars?: number;
  extractionMethod?: "pdf-parse" | "tesseract-ocr" | "mammoth" | "plaintext";
  ocr?: boolean;
  extractionError?: string;
  base64DataUrl?: string;
}

export interface ImageData {
  url: string;
  prompt: string;
  revised_prompt?: string;
  size?: string;
  model?: string;
  provider?: string;
  response_id?: string;
  sha256?: string;
  id?: string;
}

export interface SourceItem {
  title: string;
  url: string;
  domain?: string;
  favicon?: string;
  published_at?: string | null;
}

export interface LinkCardData {
  url: string;
  title: string;
  description: string;
  thumbnail?: string;
  domain: string;
  favicon: string;
  error?: string;
}

export interface Message {
  id: number;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  attachments?: { name: string; type: string }[];
  uploadedAttachments?: UploadedAttachment[];
  isUploading?: boolean;
  imageUrl?: string;
  imageData?: ImageData;
  imageStage?: "enhancing" | "generating" | "uploading" | null;
  imageError?: string | null;
  isStreaming?: boolean;
  task?: string | null;
  via?: "voice" | null;
  audio_duration_ms?: number;
  voice_id?: string;
  docStage?: "writing" | "rendering" | "uploading" | "fitting" | null;
  docData?: {
    url: string;
    filename: string;
    type: "pdf" | "docx" | "xlsx" | "csv" | "pptx" | "md";
    size_bytes: number;
    pages: number;
    file_id: string;
    summary?: string;
    target_pages?: number;
    fit_exact?: boolean;
  };
  docError?: string | null;
  searchStatus?: string | null;
  sources?: SourceItem[];
  webSearchUsed?: boolean;
  connectorSearchUsed?: "slack" | "discord" | null;
  connectorSources?: { url: string; channel: string; time: string }[];
  sourcesLatestDate?: string | null;
  searchReadCount?: number | null;
  linkCards?: LinkCardData[];
  errorData?: {
    error_type: string;
    title: string;
    message: string;
    provider?: string;
    model?: string;
    via?: string;
    actions?: string[];
  } | null;
  connector?: { provider: "slack" | "discord"; connectorId?: string; workspaceName?: string } | "slack" | "discord" | null;
  // Model & usage metadata
  modelId?: string;
  modelProvider?: string;
  modelLabel?: string;
  thinkingLevel?: string;
  servedModel?: string;
  requestedModel?: string;
  requestId?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cached_input_tokens?: number;
    reasoning_tokens?: number;
    latency_ms: number;
    ttft_ms?: number;
    cost_usd: number;
  };
}

interface ChatMessageProps {
  message: Message;
  onRegenerate?: () => void;
  onRegenerateImage?: () => void;
  onRegenerateImageWithPrompt?: (prompt: string) => void;
  onErrorAction?: (action: string) => void;
  modelName?: string;
}

const STAGE_LABELS: Record<string, string> = {
  enhancing: "Enhancing prompt\u2026",
  generating: "Generating image\u2026",
  uploading: "Uploading\u2026",
};

/* ---- Lightbox ---- */
function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors">
        <X size={20} />
      </button>
      <img
        src={src}
        alt={alt}
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

/* ---- Shimmer progress card ---- */
function ImageProgressCard({ stage, startTime }: { stage: string; startTime: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(id);
  }, [startTime]);

  const stageIndex = stage === "enhancing" ? 0 : stage === "generating" ? 1 : 2;

  return (
    <div className="mt-2 rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--bg-tertiary)]" style={{ width: 512, maxWidth: "100%" }}>
      <div className="relative" style={{ aspectRatio: "1/1", maxHeight: 512 }}>
        {/* Shimmer overlay */}
        <div className="absolute inset-0 image-shimmer" />
        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <ImageIcon size={32} className="text-[var(--accent)] opacity-40" />
          <div className="flex flex-col items-center gap-1">
            <span className="text-[14px] font-medium text-[var(--text-primary)]">
              {STAGE_LABELS[stage] || "Processing\u2026"}
            </span>
            <span className="text-[12px] text-[var(--text-faint)]">{elapsed}s</span>
          </div>
          {/* Stage dots */}
          <div className="flex items-center gap-2 mt-1">
            {["Enhance", "Generate", "Upload"].map((label, i) => (
              <div key={label} className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full transition-colors duration-300 ${
                  i < stageIndex ? "bg-emerald-400" : i === stageIndex ? "bg-[var(--accent)] animate-pulse" : "bg-[var(--text-faint)]/30"
                }`} />
                <span className={`text-[11px] ${i === stageIndex ? "text-[var(--text-primary)] font-medium" : "text-[var(--text-faint)]"}`}>
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- Image card ---- */
function ImageCard({ data, onRegenerate, onRegenerateWithPrompt }: { data: ImageData; onRegenerate?: () => void; onRegenerateWithPrompt?: (prompt: string) => void }) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState(data.revised_prompt || data.prompt);

  const handleDownload = async () => {
    try {
      const res = await fetch(data.url);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nia-image-${data.id || "generated"}.png`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("Image downloaded");
    } catch {
      showToast("Download failed");
    }
  };

  const handleCopyImage = async () => {
    try {
      const res = await fetch(data.url);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      showToast("Image copied");
    } catch {
      showToast("Copy failed — try downloading instead");
    }
  };

  const handleEditSubmit = () => {
    const trimmed = editedPrompt.trim();
    if (trimmed && onRegenerateWithPrompt) {
      onRegenerateWithPrompt(trimmed);
    }
    setEditingPrompt(false);
  };

  if (imgError) {
    return (
      <div className="mt-2 rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)] p-4 flex items-center gap-3" style={{ maxWidth: 512 }}>
        <ImageIcon size={20} className="text-[var(--text-faint)]" />
        <span className="text-[13px] text-[var(--text-muted)]">Image unavailable</span>
      </div>
    );
  }

  const displayPrompt = data.revised_prompt || data.prompt;

  return (
    <>
      <div className="mt-2" style={{ maxWidth: 512 }}>
        {/* Header: provider · model */}
        {(data.provider || data.model) && (
          <div className="flex items-center gap-1.5 mb-1.5 text-[11px] text-[var(--text-faint)]">
            <ImageIcon size={12} />
            <span>{[data.provider, data.model?.split("/").pop()].filter(Boolean).join(" · ")}</span>
          </div>
        )}

        {/* Image */}
        <div
          className="rounded-xl overflow-hidden border border-[var(--border)] cursor-pointer hover:border-[var(--accent)]/50 transition-colors"
          onClick={() => setLightboxOpen(true)}
        >
          <img
            src={data.url}
            alt={data.prompt}
            className="w-full block"
            onError={() => setImgError(true)}
          />
        </div>

        {/* Prompt / revised prompt under the image */}
        <button
          onClick={() => setPromptExpanded(!promptExpanded)}
          className="flex items-center gap-1 mt-1.5 text-[12px] text-[var(--text-faint)] hover:text-[var(--text-muted)] transition-colors"
        >
          {promptExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          <span>{promptExpanded ? "Hide prompt" : `${displayPrompt.slice(0, 60)}${displayPrompt.length > 60 ? "…" : ""}`}</span>
        </button>
        {promptExpanded && (
          <div className="mt-1 pl-1">
            {editingPrompt ? (
              <div className="flex flex-col gap-2">
                <textarea
                  value={editedPrompt}
                  onChange={(e) => setEditedPrompt(e.target.value)}
                  className="w-full text-[13px] text-[var(--text-primary)] bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg p-2 resize-none outline-none focus:border-[var(--accent)]"
                  rows={3}
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleEditSubmit(); } }}
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleEditSubmit}
                    className="px-3 py-1 rounded-lg text-[12px] font-medium bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
                  >
                    Regenerate
                  </button>
                  <button
                    onClick={() => { setEditingPrompt(false); setEditedPrompt(data.revised_prompt || data.prompt); }}
                    className="px-3 py-1 rounded-lg text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                {data.revised_prompt && data.revised_prompt !== data.prompt && (
                  <p className="text-[12px] text-[var(--text-faint)]">Original: {data.prompt}</p>
                )}
                <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">{displayPrompt}</p>
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-1 mt-2">
          {[
            { icon: Download, action: handleDownload, label: "Download" },
            { icon: Copy, action: handleCopyImage, label: "Copy image" },
            ...(onRegenerateWithPrompt ? [{ icon: ImageIcon, action: () => { setPromptExpanded(true); setEditingPrompt(true); }, label: "Edit prompt" }] : []),
            { icon: RefreshCw, action: onRegenerate, label: "Regenerate" },
          ].map(({ icon: Icon, action, label }) => (
            <button
              key={label}
              onClick={action}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] text-[var(--text-faint)] hover:text-[var(--accent)] hover:bg-[var(--bg-hover)] transition-all"
              title={label}
            >
              <Icon size={13} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>
      {lightboxOpen && <Lightbox src={data.url} alt={data.prompt} onClose={() => setLightboxOpen(false)} />}
    </>
  );
}

/* ---- Error card ---- */
function ImageErrorCard({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="mt-2 rounded-xl border border-red-500/30 bg-red-500/5 p-4 flex items-start gap-3" style={{ maxWidth: 512 }}>
      <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" />
      <div className="flex flex-col gap-2">
        <span className="text-[13px] text-red-300">{error}</span>
        {onRetry && (
          <button
            onClick={onRetry}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-[12px] text-red-300 hover:text-red-200 transition-colors w-fit"
          >
            <RefreshCw size={12} />
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

/* ---- File progress card ---- */
const DOC_STAGE_LABELS: Record<string, string> = {
  writing: "Writing content…",
  rendering: "Rendering document…",
  fitting: "Fitting to target…",
  uploading: "Finalizing…",
};

const DOC_TYPE_COLORS: Record<string, string> = {
  pdf: "#ef4444",
  docx: "#3b82f6",
  xlsx: "#22c55e",
  csv: "#22c55e",
  pptx: "#f97316",
  md: "#8b5cf6",
};

const DOC_TYPE_LABELS: Record<string, string> = {
  pdf: "PDF",
  docx: "Word",
  xlsx: "Excel",
  csv: "CSV",
  pptx: "PowerPoint",
  md: "Markdown",
};

function FileProgressCard({ stage, startTime, filename, docType }: { stage: string; startTime: number; filename?: string; docType?: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(id);
  }, [startTime]);

  const stageIndex = stage === "writing" ? 0 : stage === "rendering" ? 1 : stage === "fitting" ? 2 : 3;
  const color = DOC_TYPE_COLORS[docType || "pdf"] || "#8b5cf6";

  return (
    <div className="mt-2 rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--bg-tertiary)]" style={{ width: 420, maxWidth: "100%" }}>
      <div className="p-4 flex items-start gap-3">
        {/* Doc icon */}
        <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${color}15` }}>
          <FileText size={20} style={{ color }} />
        </div>
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">
            {filename || "Generating document…"}
          </span>
          <span className="text-[12px] text-[var(--text-faint)]">
            {DOC_STAGE_LABELS[stage] || "Processing…"} · {elapsed}s
          </span>
          {/* Stage dots */}
          <div className="flex items-center gap-2 mt-1">
            {["Write", "Render", "Fit", "Upload"].map((label, i) => (
              <div key={label} className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full transition-colors duration-300 ${
                  i < stageIndex ? "bg-emerald-400" : i === stageIndex ? "animate-pulse" : "bg-[var(--text-faint)]/30"
                }`} style={i === stageIndex ? { backgroundColor: color } : i < stageIndex ? {} : {}} />
                <span className={`text-[11px] ${i === stageIndex ? "text-[var(--text-primary)] font-medium" : "text-[var(--text-faint)]"}`}>
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* Shimmer bar at bottom */}
      <div className="h-1 w-full image-shimmer" />
    </div>
  );
}

/* ---- PDF Preview Modal (in-app iframe viewer) ---- */
/* ---- PDF Preview Modal (pdf.js canvas renderer) ---- */
const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

function PdfPreviewModal({ url, filename, pages: hintPages, onClose, onRegenerate }: {
  url: string; filename: string; pages?: number; onClose: () => void; onRegenerate?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(hintPages || 0);
  const [zoomMode, setZoomMode] = useState<"fit-page" | "fit-width" | number>("fit-page");
  const [scale, setScale] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfDocRef = useRef<any>(null);
  const renderTasksRef = useRef<Map<number, { cancel: () => void }>>(new Map());
  const isMobile = typeof window !== "undefined" && window.innerWidth < 720;

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Load pdf.js and render
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
        const loadingTask = pdfjsLib.getDocument(url);
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        pdfDocRef.current = pdf;
        setTotalPages(pdf.numPages);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load PDF");
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  // Compute scale from zoom mode
  useEffect(() => {
    if (loading || error || !pdfDocRef.current) return;
    const container = scrollRef.current;
    if (!container) return;
    (async () => {
      const page = await pdfDocRef.current.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      const cw = container.clientWidth - 48; // 24px padding each side
      const ch = container.clientHeight - 24;
      if (zoomMode === "fit-page") {
        setScale(Math.min(cw / viewport.width, ch / viewport.height, 2));
      } else if (zoomMode === "fit-width") {
        setScale(Math.min(cw / viewport.width, 3));
      } else {
        setScale(zoomMode);
      }
    })();
  }, [zoomMode, loading, error, totalPages]);

  // Render visible pages
  useEffect(() => {
    if (loading || error || !pdfDocRef.current) return;
    const pdf = pdfDocRef.current;

    const renderPage = async (pageNum: number) => {
      const canvas = canvasRefs.current.get(pageNum);
      if (!canvas) return;
      // Cancel existing render
      const existing = renderTasksRef.current.get(pageNum);
      if (existing) existing.cancel();

      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
      const displayViewport = page.getViewport({ scale });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${displayViewport.width}px`;
      canvas.style.height = `${displayViewport.height}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const task = page.render({ canvasContext: ctx, viewport });
      renderTasksRef.current.set(pageNum, task);
      try { await task.promise; } catch { /* cancelled */ }
    };

    for (let i = 1; i <= pdf.numPages; i++) renderPage(i);

    return () => {
      renderTasksRef.current.forEach((t) => t.cancel());
      renderTasksRef.current.clear();
    };
  }, [scale, loading, error, totalPages]);

  // Track current page on scroll
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const onScroll = () => {
      const children = container.querySelectorAll("[data-page]");
      let closest = 1;
      let minDist = Infinity;
      const containerTop = container.scrollTop + container.clientHeight / 3;
      children.forEach((child) => {
        const dist = Math.abs((child as HTMLElement).offsetTop - containerTop);
        if (dist < minDist) { minDist = dist; closest = parseInt((child as HTMLElement).dataset.page || "1"); }
      });
      setCurrentPage(closest);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [loading]);

  // Keyboard
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        goToPage(Math.max(1, currentPage - 1));
      }
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        goToPage(Math.min(totalPages, currentPage + 1));
      }
      if ((e.key === "+" || e.key === "=") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        zoomIn();
      }
      if (e.key === "-" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        zoomOut();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [currentPage, totalPages, onClose]);

  const goToPage = (n: number) => {
    setCurrentPage(n);
    const el = scrollRef.current?.querySelector(`[data-page="${n}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const zoomIn = () => {
    const next = ZOOM_LEVELS.find((z) => z > scale + 0.01);
    setZoomMode(next || ZOOM_LEVELS[ZOOM_LEVELS.length - 1]);
  };

  const zoomOut = () => {
    const prev = [...ZOOM_LEVELS].reverse().find((z) => z < scale - 0.01);
    setZoomMode(prev || ZOOM_LEVELS[0]);
  };

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = url + (url.includes("?") ? "&" : "?") + "download=1";
    a.download = filename;
    a.click();
  };

  const handleOpenNewTab = () => {
    window.open(url + "#toolbar=1&view=FitH", "_blank", "noopener");
  };

  const zoomPercent = Math.round(scale * 100);

  const modalContent = (
    <div
      className={`fixed inset-0 z-[99999] flex items-center justify-center ${isMobile ? "" : "p-6"}`}
      style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className={`flex flex-col ${isMobile ? "w-full h-full" : "w-[90vw] h-[90vh] max-w-[960px] rounded-2xl"}`}
        style={{
          backgroundColor: "#0f0d14",
          border: isMobile ? "none" : "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 32px 64px rgba(0,0,0,0.5)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header 48px */}
        <div className="flex items-center justify-between px-4 shrink-0" style={{ height: 48, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="flex items-center gap-2 min-w-0">
            <FileText size={16} className="text-red-500 shrink-0" />
            <span className="text-[13px] font-semibold text-[#f1eff5] truncate max-w-[300px]">{filename}</span>
            <span className="text-[11px] text-[#8e8a96] shrink-0">
              {totalPages > 0 ? `${totalPages} page${totalPages > 1 ? "s" : ""}` : ""}
            </span>
          </div>
          <div className="flex items-center gap-0.5">
            <button onClick={handleDownload} className="p-2 rounded-lg text-[#8e8a96] hover:text-[#f1eff5] hover:bg-white/5 transition-colors" title="Download">
              <Download size={15} />
            </button>
            <button onClick={handleOpenNewTab} className="p-2 rounded-lg text-[#8e8a96] hover:text-[#f1eff5] hover:bg-white/5 transition-colors" title="Open in new tab">
              <ExternalLink size={15} />
            </button>
            <button onClick={onClose} className="p-2 rounded-lg text-[#8e8a96] hover:text-[#f1eff5] hover:bg-white/5 transition-colors" title="Close (Esc)">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body — canvas pages */}
        <div ref={scrollRef} className="flex-1 overflow-auto" style={{ backgroundColor: "#2a2731" }}>
          {loading && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              {/* Page skeleton shimmer */}
              <div className="relative overflow-hidden rounded-lg" style={{ width: 200, height: 260, backgroundColor: "#1a1721" }}>
                <div className="absolute inset-0 animate-pulse" style={{ background: "linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.04) 50%, transparent 70%)" }} />
              </div>
              <span className="text-[13px] text-[#8e8a96]">Loading preview…</span>
            </div>
          )}
          {error && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <FileText size={40} className="text-[#8e8a96]" />
              <span className="text-[14px] text-[#c5c0cc]">Couldn&apos;t load preview</span>
              <div className="flex items-center gap-2 mt-1">
                <button onClick={handleDownload} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium text-white bg-red-500 hover:bg-red-600 transition-colors">
                  <Download size={14} /> Download
                </button>
                <button onClick={handleOpenNewTab} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium text-[#c5c0cc] border border-white/10 hover:border-white/20 transition-colors">
                  <ExternalLink size={14} /> Open in new tab
                </button>
              </div>
            </div>
          )}
          {!loading && !error && (
            <div className="flex flex-col items-center gap-4 py-6 px-6">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                <div key={pageNum} data-page={pageNum} className="shadow-lg rounded-sm bg-white">
                  <canvas
                    ref={(el) => { if (el) canvasRefs.current.set(pageNum, el); else canvasRefs.current.delete(pageNum); }}
                    className="block rounded-sm"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer 40px — page nav + zoom */}
        {!loading && !error && (
          <div className="flex items-center justify-between px-4 shrink-0" style={{ height: 40, borderTop: "1px solid rgba(255,255,255,0.08)", backgroundColor: "#0f0d14" }}>
            {/* Page nav */}
            <div className="flex items-center gap-1">
              <button onClick={() => goToPage(Math.max(1, currentPage - 1))} disabled={currentPage <= 1}
                className="p-1 rounded text-[#8e8a96] hover:text-[#f1eff5] hover:bg-white/5 disabled:opacity-30 disabled:cursor-default transition-colors">
                <ArrowLeft size={14} />
              </button>
              <span className="text-[12px] text-[#c5c0cc] tabular-nums min-w-[60px] text-center">{currentPage} / {totalPages}</span>
              <button onClick={() => goToPage(Math.min(totalPages, currentPage + 1))} disabled={currentPage >= totalPages}
                className="p-1 rounded text-[#8e8a96] hover:text-[#f1eff5] hover:bg-white/5 disabled:opacity-30 disabled:cursor-default transition-colors">
                <ArrowRight size={14} />
              </button>
            </div>

            {/* Zoom controls */}
            <div className="flex items-center gap-1">
              <button onClick={zoomOut} className="p-1 rounded text-[#8e8a96] hover:text-[#f1eff5] hover:bg-white/5 transition-colors" title="Zoom out">
                <ZoomOut size={14} />
              </button>
              <span className="text-[11px] text-[#8e8a96] tabular-nums min-w-[36px] text-center">{zoomPercent}%</span>
              <button onClick={zoomIn} className="p-1 rounded text-[#8e8a96] hover:text-[#f1eff5] hover:bg-white/5 transition-colors" title="Zoom in">
                <ZoomIn size={14} />
              </button>
              <div className="w-px h-4 bg-white/10 mx-1" />
              <button
                onClick={() => setZoomMode("fit-page")}
                className={`px-2 py-0.5 rounded text-[11px] transition-colors ${zoomMode === "fit-page" ? "text-[#f1eff5] bg-white/10" : "text-[#8e8a96] hover:text-[#f1eff5] hover:bg-white/5"}`}
              >
                Fit page
              </button>
              <button
                onClick={() => setZoomMode("fit-width")}
                className={`px-2 py-0.5 rounded text-[11px] transition-colors ${zoomMode === "fit-width" ? "text-[#f1eff5] bg-white/10" : "text-[#8e8a96] hover:text-[#f1eff5] hover:bg-white/5"}`}
              >
                Fit width
              </button>
            </div>

            {/* Regenerate */}
            <div>
              {onRegenerate && (
                <button onClick={onRegenerate} className="text-[11px] text-[#8e8a96] hover:text-[var(--accent)] transition-colors">
                  Regenerate
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}

/* ---- Preview Chooser Popover ---- */
function PreviewChooserPopover({ anchorRect, onPreviewHere, onNewTab, onClose }: {
  anchorRect: DOMRect; onPreviewHere: () => void; onNewTab: () => void; onClose: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [alwaysDoThis, setAlwaysDoThis] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [visible, setVisible] = useState(false);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const isMobile = typeof window !== "undefined" && window.innerWidth < 720;

  // Animate in
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const animatedClose = () => {
    setVisible(false);
    setTimeout(onClose, 120);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); animatedClose(); }
      if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); setFocusedIndex(i => (i + 1) % 2); }
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); setFocusedIndex(i => (i + 1) % 2); }
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleChoice("here"); }
      if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); handleChoice("tab"); }
    };
    const clickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) animatedClose();
    };
    const scrollOrResize = () => animatedClose();
    window.addEventListener("keydown", handler);
    window.addEventListener("mousedown", clickOutside);
    window.addEventListener("scroll", scrollOrResize, true);
    window.addEventListener("resize", scrollOrResize);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("mousedown", clickOutside);
      window.removeEventListener("scroll", scrollOrResize, true);
      window.removeEventListener("resize", scrollOrResize);
    };
  }, [onClose, alwaysDoThis]);

  // Focus active item
  useEffect(() => {
    itemRefs.current[focusedIndex]?.focus();
  }, [focusedIndex]);

  const handleChoice = (mode: "here" | "tab") => {
    if (alwaysDoThis) {
      try { localStorage.setItem("pdfPreviewMode", mode); } catch {}
    }
    if (mode === "here") onPreviewHere();
    else onNewTab();
    animatedClose();
  };

  // Position: left-aligned to button, 6px below; flip above if near bottom
  const popoverH = 146;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const belowTop = anchorRect.bottom + 6;
  const flipUp = belowTop + popoverH > vh;
  const computedTop = flipUp ? (anchorRect.top - popoverH - 6) : belowTop;
  let computedLeft = anchorRect.left;
  // Keep within viewport
  if (computedLeft + 220 > vw) computedLeft = vw - 220 - 8;
  if (computedLeft < 8) computedLeft = 8;

  // Caret position (pointing at the button)
  const caretLeft = Math.max(16, Math.min(anchorRect.left - computedLeft + anchorRect.width / 2 - 5, 220 - 20));

  const popoverContent = (
    <div
      ref={popoverRef}
      className={isMobile ? "fixed inset-x-0 bottom-0" : "fixed"}
      style={{
        ...(isMobile ? {} : { top: computedTop, left: computedLeft, width: 220 }),
        zIndex: 100000,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : `translateY(${flipUp ? "4px" : "-4px"})`,
        transition: "opacity 120ms ease, transform 120ms ease",
      }}
    >
      {/* Caret */}
      {!isMobile && (
        <div
          style={{
            position: "absolute",
            [flipUp ? "bottom" : "top"]: -5,
            left: caretLeft,
            width: 10,
            height: 10,
            backgroundColor: "#1a1720",
            border: "1px solid rgba(255,255,255,0.08)",
            transform: `rotate(${flipUp ? "225deg" : "45deg"})`,
            clipPath: flipUp ? "polygon(100% 0, 100% 100%, 0 100%)" : "polygon(0 0, 100% 0, 0 100%)",
            zIndex: 1,
          }}
        />
      )}
      <div
        style={{
          backgroundColor: "#1a1720",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: isMobile ? "16px 16px 0 0" : 12,
          boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
          padding: isMobile ? "12px 16px 20px" : 6,
          position: "relative",
          zIndex: 2,
        }}
      >
        {isMobile && <div className="w-10 h-1 rounded-full bg-white/20 mx-auto mb-3" />}
        {/* Item 1: Preview here */}
        <button
          ref={el => { itemRefs.current[0] = el; }}
          onClick={() => handleChoice("here")}
          onMouseEnter={() => setFocusedIndex(0)}
          className="w-full flex items-center text-left outline-none"
          style={{
            height: 36,
            padding: "0 10px",
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 500,
            color: "#ece9f1",
            backgroundColor: focusedIndex === 0 ? "rgba(255,255,255,0.06)" : "transparent",
            boxShadow: focusedIndex === 0 ? "inset 0 0 0 1px var(--accent, #7c3aed)" : "none",
            transition: "background-color 80ms, box-shadow 80ms",
            gap: 10,
          }}
        >
          <FileText size={16} style={{ color: "#b8b3c4", flexShrink: 0 }} />
          <span>Preview here</span>
          <span style={{
            marginLeft: "auto",
            fontSize: 11,
            color: "#6f6a7a",
            backgroundColor: "rgba(255,255,255,0.05)",
            borderRadius: 10,
            padding: "2px 7px",
            height: 20,
            display: "inline-flex",
            alignItems: "center",
          }}>↵</span>
        </button>
        {/* Item 2: Open in new tab */}
        <button
          ref={el => { itemRefs.current[1] = el; }}
          onClick={() => handleChoice("tab")}
          onMouseEnter={() => setFocusedIndex(1)}
          className="w-full flex items-center text-left outline-none"
          style={{
            height: 36,
            padding: "0 10px",
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 500,
            color: "#ece9f1",
            backgroundColor: focusedIndex === 1 ? "rgba(255,255,255,0.06)" : "transparent",
            boxShadow: focusedIndex === 1 ? "inset 0 0 0 1px var(--accent, #7c3aed)" : "none",
            transition: "background-color 80ms, box-shadow 80ms",
            gap: 10,
          }}
        >
          <ExternalLink size={16} style={{ color: "#b8b3c4", flexShrink: 0 }} />
          <span>Open in new tab</span>
          <span style={{
            marginLeft: "auto",
            fontSize: 11,
            color: "#6f6a7a",
            backgroundColor: "rgba(255,255,255,0.05)",
            borderRadius: 10,
            padding: "2px 7px",
            height: 20,
            display: "inline-flex",
            alignItems: "center",
          }}>⇧↵</span>
        </button>
        {/* Divider */}
        <div style={{ height: 1, backgroundColor: "rgba(255,255,255,0.06)", margin: "6px 0" }} />
        {/* Always do this — visually subordinate, not a menu item */}
        <label
          htmlFor="pdf-always"
          className="flex items-center cursor-pointer select-none"
          style={{
            height: 32,
            padding: "0 10px",
            gap: 8,
            fontSize: 12.5,
            color: "#9c97a8",
          }}
        >
          <input
            type="checkbox"
            id="pdf-always"
            checked={alwaysDoThis}
            onChange={(e) => setAlwaysDoThis(e.target.checked)}
            style={{
              width: 14,
              height: 14,
              borderRadius: 4,
              accentColor: "var(--accent, #7c3aed)",
              cursor: "pointer",
            }}
          />
          Always do this
        </label>
      </div>
    </div>
  );

  return createPortal(
    <>
      {isMobile && <div className="fixed inset-0 bg-black/40 z-[99999]" onClick={animatedClose} />}
      {popoverContent}
    </>,
    document.body
  );
}

/* ---- File result card ---- */
function FileCard({ data, onRegenerate }: { data: NonNullable<Message["docData"]>; onRegenerate?: () => void }) {
  const color = DOC_TYPE_COLORS[data.type] || "#8b5cf6";
  const typeLabel = DOC_TYPE_LABELS[data.type] || data.type.toUpperCase();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [chooserRect, setChooserRect] = useState<DOMRect | null>(null);
  const previewBtnRef = useRef<HTMLButtonElement>(null);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = data.url + (data.url.includes("?") ? "&" : "?") + "download=1";
    a.download = data.filename;
    a.click();
    showToast("Downloading " + data.filename);
  };

  const handlePreviewClick = () => {
    if (data.type !== "pdf") {
      window.open(data.url, "_blank");
      return;
    }

    // Check saved preference — apply it directly
    let savedMode: string | null = null;
    try { savedMode = localStorage.getItem("pdfPreviewMode"); } catch {}

    if (savedMode) {
      if (savedMode === "here") setPreviewOpen(true);
      else window.open(data.url + "#toolbar=1&view=FitH", "_blank", "noopener");
      return;
    }

    // No saved preference — open chooser anchored to the split button wrapper
    const parentEl = previewBtnRef.current;
    if (parentEl) setChooserRect(parentEl.getBoundingClientRect());
    setChooserOpen(true);
  };

  const handlePreviewHere = () => {
    setPreviewOpen(true);
  };

  const handleNewTab = () => {
    window.open(data.url + "#toolbar=1&view=FitH", "_blank", "noopener");
  };


  return (
    <>
      <div className="mt-2 rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--bg-tertiary)] hover:border-[var(--accent)]/30 transition-colors" style={{ width: 420, maxWidth: "100%" }}>
        <div className="p-4 flex items-start gap-3">
          {/* Type icon */}
          <div className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0 relative" style={{ backgroundColor: `${color}15` }}>
            <FileText size={24} style={{ color }} />
            <span className="absolute -bottom-1 -right-1 text-[9px] font-bold px-1 py-0.5 rounded text-white" style={{ backgroundColor: color }}>
              {typeLabel}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            <span className="text-[14px] font-semibold text-[var(--text-primary)] truncate">
              {data.filename}
            </span>
            <span className="text-[12px] text-[var(--text-faint)]">
              {data.pages > 0 ? `${data.pages} page${data.pages > 1 ? "s" : ""}` : ""}
              {data.target_pages && data.fit_exact ? (
                <span className="ml-1 text-emerald-400">✓ exact</span>
              ) : data.target_pages && !data.fit_exact ? (
                <span className="ml-1 text-amber-400" title={`Couldn't fit exactly to ${data.target_pages} pages; content preserved`}>· asked {data.target_pages}</span>
              ) : null}
              {data.pages > 0 ? " · " : ""}{formatSize(data.size_bytes)}
            </span>
            {data.summary && (
              <span className="text-[12px] text-[var(--text-muted)] mt-0.5 line-clamp-1">{data.summary}</span>
            )}
          </div>
        </div>
        {/* Actions */}
        <div className="px-4 pb-3 flex items-center gap-1">
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-3 rounded-lg text-[12px] font-medium text-white transition-all hover:opacity-90"
            style={{ backgroundColor: color, height: 36 }}
          >
            <Download size={13} />
            Download
          </button>
          {data.type === "pdf" ? (
            <span
              ref={previewBtnRef as React.RefObject<HTMLSpanElement>}
              className="inline-flex items-stretch rounded-lg text-[12px] border border-[var(--border)] overflow-hidden"
              style={{ height: 36 }}
            >
              {/* Main "Preview" part */}
              <button
                onClick={handlePreviewClick}
                className="flex items-center gap-1.5 px-3 text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-hover)] transition-all"
                style={{ height: "100%" }}
              >
                <ExternalLink size={13} />
                Preview
              </button>
              {/* Vertical divider */}
              <span style={{ width: 1, backgroundColor: "rgba(255,255,255,0.1)", alignSelf: "stretch" }} />
              {/* Caret segment */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const parentEl = previewBtnRef.current;
                  if (parentEl) setChooserRect(parentEl.getBoundingClientRect());
                  setChooserOpen(true);
                }}
                className="flex items-center justify-center text-[var(--text-faint)] hover:text-[var(--accent)] hover:bg-[var(--bg-hover)] transition-all"
                style={{ width: 24, height: "100%" }}
              >
                <ChevronDown size={12} />
              </button>
            </span>
          ) : (
            <button
              ref={previewBtnRef}
              onClick={handlePreviewClick}
              className="flex items-center gap-1.5 px-3 rounded-lg text-[12px] text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-hover)] transition-all border border-[var(--border)]"
              style={{ height: 36 }}
            >
              <ExternalLink size={13} />
              Preview
            </button>
          )}
          {onRegenerate && (
            <button
              onClick={onRegenerate}
              className="flex items-center gap-1.5 px-3 rounded-lg text-[12px] text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-hover)] transition-all border border-[var(--border)]"
              style={{ height: 36 }}
            >
              <RefreshCw size={13} />
              Regenerate
            </button>
          )}
        </div>
      </div>
      {chooserOpen && chooserRect && (
        <PreviewChooserPopover
          anchorRect={chooserRect}
          onPreviewHere={handlePreviewHere}
          onNewTab={handleNewTab}
          onClose={() => setChooserOpen(false)}
        />
      )}
      {previewOpen && (
        <PdfPreviewModal url={data.url} filename={data.filename} pages={data.pages} onClose={() => setPreviewOpen(false)} onRegenerate={onRegenerate} />
      )}
    </>
  );
}

/* ---- Bare URL image fallback ---- */
function InlineImageFallback({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="mt-2 rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)] p-3 flex items-center gap-2" style={{ maxWidth: 512 }}>
        <ImageIcon size={16} className="text-[var(--text-faint)]" />
        <span className="text-[12px] text-[var(--text-muted)]">Image unavailable</span>
      </div>
    );
  }
  return (
    <div className="mt-2 rounded-xl overflow-hidden border border-[var(--border)]" style={{ maxWidth: 512 }}>
      <img src={url} alt="Image" className="w-full" onError={() => setFailed(true)} />
    </div>
  );
}

/* ---- Detect bare image URLs in content ---- */
function extractImageUrls(content: string): string[] {
  const regex = /https?:\/\/[^\s)]+\.(?:png|jpg|jpeg|webp|gif)/gi;
  return [...content.matchAll(regex)].map((m) => m[0]);
}

/* ---- Citation helper: make [1], [2] etc. clickable ---- */
function renderWithCitations(
  children: React.ReactNode,
  sources: SourceItem[],
  onHighlight: (idx: number | null) => void,
  lastClickedRef: React.MutableRefObject<number | null>,
): React.ReactNode {
  if (!children) return children;

  const handleCitationClick = (e: React.MouseEvent, idx: number, source: SourceItem) => {
    e.stopPropagation();
    e.preventDefault();
    if (lastClickedRef.current === idx) {
      // Second click (or already highlighted) — open URL
      window.open(source.url, "_blank", "noopener,noreferrer");
      lastClickedRef.current = null;
    } else {
      // First click — scroll to and highlight source
      lastClickedRef.current = idx;
      const el = document.querySelector(`[data-source-index="${idx}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      onHighlight(idx);
    }
  };

  const renderCitationChip = (idx: number, keyPrefix: string, charOffset: number) => {
    const source = sources[idx - 1];
    if (!source) return `[${idx}]`;
    const tooltip = source.published_at
      ? `${source.title} · ${source.published_at}`
      : source.title;
    return (
      <a
        key={`cite-${keyPrefix}-${charOffset}-${idx}`}
        href={source.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-[var(--accent-subtle)] text-[var(--accent)] text-[10px] font-bold hover:bg-[var(--accent)] hover:text-white transition-all duration-150 cursor-pointer no-underline"
        style={{ display: 'inline-flex', margin: '0 2px', verticalAlign: 'baseline' }}
        title={tooltip}
        onMouseEnter={() => onHighlight(idx)}
        onMouseLeave={() => onHighlight(null)}
        onClick={(e) => handleCitationClick(e, idx, source)}
      >
        {idx}
      </a>
    );
  };

  const processNode = (node: React.ReactNode): React.ReactNode => {
    if (typeof node === "string") {
      const parts: React.ReactNode[] = [];
      const regex = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
      let lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = regex.exec(node)) !== null) {
        if (lastIndex < match.index) {
          parts.push(node.slice(lastIndex, match.index));
        }

        const inner = match[1];
        if (inner.includes(",")) {
          // Comma-separated: [3, 5] -> render each as separate chip
          const nums = inner.split(",").map((s) => parseInt(s.trim(), 10));
          nums.forEach((idx) => {
            parts.push(renderCitationChip(idx, "multi", match!.index));
          });
        } else {
          const idx = parseInt(inner, 10);
          parts.push(renderCitationChip(idx, "single", match.index));
        }

        lastIndex = match.index + match[0].length;
      }

      if (lastIndex < node.length) {
        parts.push(node.slice(lastIndex));
      }

      return parts.length > 0 ? <>{parts}</> : node;
    }

    if (Array.isArray(node)) {
      return node.map((child, i) => <span key={i}>{processNode(child)}</span>);
    }

    // React elements with children
    if (node && typeof node === "object" && "props" in node) {
      const element = node as React.ReactElement<{ children?: React.ReactNode }>;
      if (element.props.children) {
        // Don't recurse into code blocks
        return node;
      }
    }

    return node;
  };

  if (Array.isArray(children)) {
    return children.map((child, i) => <span key={i}>{processNode(child)}</span>);
  }
  return processNode(children);
}

/* ---- Sources row ---- */
const SEARCH_ENGINE_DOMAINS = new Set(["duckduckgo.com", "bing.com", "google.com"]);

interface DedupedSource {
  domain: string;
  count: number;
  title: string;
  url: string;
  published_at?: string | null;
  firstCiteIndex: number;
  originalIndices: number[];
}

function SourcesRow({ sources, highlightIndex }: { sources: SourceItem[]; highlightIndex?: number | null }) {
  const [showAll, setShowAll] = useState(false);
  const MAX_VISIBLE = 6;

  const deduped = useMemo(() => {
    const domainMap = new Map<string, DedupedSource>();
    sources.forEach((src, i) => {
      const domain = src.domain || (() => { try { return new URL(src.url).hostname; } catch { return src.url; } })();
      if (SEARCH_ENGINE_DOMAINS.has(domain)) return;
      if (domainMap.has(domain)) {
        const existing = domainMap.get(domain)!;
        existing.count++;
        existing.originalIndices.push(i + 1);
      } else {
        domainMap.set(domain, {
          domain,
          count: 1,
          title: src.title,
          url: src.url,
          published_at: src.published_at,
          firstCiteIndex: i + 1,
          originalIndices: [i + 1],
        });
      }
    });
    return Array.from(domainMap.values()).sort((a, b) => a.firstCiteIndex - b.firstCiteIndex);
  }, [sources]);

  const visible = showAll ? deduped : deduped.slice(0, MAX_VISIBLE);
  const remaining = deduped.length - MAX_VISIBLE;

  const [faviconErrors, setFaviconErrors] = useState<Set<string>>(new Set());

  const globeFallback = (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--text-faint)]">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-2 animate-fade-in">
      <Globe size={12} className="text-[var(--text-faint)] shrink-0" />
      <span className="text-[11px] text-[var(--text-faint)] font-medium mr-0.5">Sources</span>
      {visible.map((src) => {
        const isHighlighted = src.originalIndices.includes(highlightIndex ?? -1);
        const tooltip = src.published_at
          ? `${src.title} · ${src.published_at}`
          : src.title;
        return (
          <a
            key={src.domain}
            href={src.url}
            target="_blank"
            rel="noopener noreferrer"
            data-source-index={src.firstCiteIndex}
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium transition-all duration-150 border ${
              isHighlighted
                ? "bg-[var(--accent-subtle)] border-[var(--accent)] text-[var(--accent)]"
                : "bg-[var(--bg-tertiary)] border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)]/50 hover:text-[var(--accent)]"
            }`}
            title={tooltip}
          >
            {faviconErrors.has(src.domain) ? (
              globeFallback
            ) : (
              <img
                src={`https://www.google.com/s2/favicons?domain=${src.domain}&sz=32`}
                alt=""
                width={12}
                height={12}
                className="rounded-sm"
                onError={() => setFaviconErrors((prev) => new Set(prev).add(src.domain))}
              />
            )}
            <span className="truncate max-w-[120px]">{src.domain}</span>
            {src.count > 1 && (
              <span className="text-[9px] font-bold opacity-60 -ml-0.5 align-super">&times;{src.count}</span>
            )}
          </a>
        );
      })}
      {remaining > 0 && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="px-2 py-1 rounded-full text-[11px] font-medium bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-faint)] hover:text-[var(--text-muted)] transition-colors"
        >
          +{remaining} more
        </button>
      )}
    </div>
  );
}

/* ---- Search info line (freshness header) ---- */
function SearchInfoLine({ sources, readCount }: { sources: SourceItem[]; readCount?: number | null }) {
  const info = useMemo(() => {
    const domainSet = new Set<string>();
    sources.forEach((src) => {
      const domain = src.domain || (() => { try { return new URL(src.url).hostname; } catch { return ""; } })();
      if (domain && !SEARCH_ENGINE_DOMAINS.has(domain)) domainSet.add(domain);
    });
    const n = domainSet.size;

    let readPart = "";
    if (typeof readCount === "number") {
      readPart = ` · read ${readCount}`;
    }

    let latestPart = "";
    const dates = sources
      .map((s) => s.published_at)
      .filter((d): d is string => !!d)
      .map((d) => new Date(d))
      .filter((d) => !isNaN(d.getTime()));
    if (dates.length > 0) {
      const latest = new Date(Math.max(...dates.map((d) => d.getTime())));
      const monthName = latest.toLocaleString("en-US", { month: "short" });
      const year = latest.getFullYear();
      latestPart = ` · latest ${monthName} ${year}`;
    }

    return `Searched the web · ${n} source${n !== 1 ? "s" : ""}${readPart}${latestPart}`;
  }, [sources, readCount]);

  return (
    <div className="flex items-center gap-2 py-0.5 animate-fade-in">
      <Globe size={11} className="text-[var(--text-faint)]" />
      <span className="text-[11px] text-[var(--text-faint)] font-medium">{info}</span>
    </div>
  );
}

/* ---- Connector sources row (Slack/Discord permalinks) ---- */
function ConnectorSourcesLine({ provider, sources }: { provider: "slack" | "discord"; sources: { url: string; channel: string; time: string }[] }) {
  const label = provider === "slack" ? "Slack" : "Discord";
  // Dedupe by channel, show channel · time
  const deduped = sources.slice(0, 6);
  return (
    <div className="flex items-center gap-2 py-0.5 animate-fade-in flex-wrap">
      {provider === "slack" ? <Hash size={11} className="text-[var(--text-faint)]" /> : <MessageSquare size={11} className="text-[var(--text-faint)]" />}
      <span className="text-[11px] text-[var(--text-faint)] font-medium">
        {label} · {deduped.map((s, i) => (
          <span key={i}>
            {i > 0 && " · "}
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:text-[var(--text-muted)] underline underline-offset-2">{s.channel || s.time || `[${i + 1}]`}</a>
          </span>
        ))}
      </span>
    </div>
  );
}

/* ---- Search status indicator ---- */
function SearchStatusLine({ text }: { text: string }) {
  const isError = text === "Web search unavailable";
  const isTimeout = text.includes("Taking longer");
  return (
    <div className="flex items-center gap-2 py-1 animate-fade-in">
      {isError ? (
        <AlertTriangle size={13} className="text-amber-400" />
      ) : (
        <Globe size={13} className="text-[var(--text-faint)]" />
      )}
      <span className={`text-[12px] font-medium ${isError ? "text-amber-400" : isTimeout ? "text-amber-300" : "text-[var(--text-muted)]"}`}>{text}</span>
      {!isError && <span className="inline-block w-1 h-1 rounded-full bg-[var(--accent)] animate-pulse" />}
    </div>
  );
}

/* ---- Usage info row with popover ---- */
function UsageInfoRow({ message }: { message: Message }) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const infoRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-faint)] mt-1 opacity-0 group-hover:opacity-100 transition-opacity cursor-default relative" style={{ fontVariantNumeric: "tabular-nums" }}>
      <span>{formatTokenCount(message.usage!.input_tokens)} in</span>
      <span>&middot;</span>
      <span>{formatTokenCount(message.usage!.output_tokens)} out</span>
      <span>&middot;</span>
      <span>{message.usage!.cost_usd < 0 ? "—" : `$${message.usage!.cost_usd.toFixed(4)}`}</span>
      <span>&middot;</span>
      <span>{(message.usage!.latency_ms / 1000).toFixed(1)}s</span>
      {/* Info button → popover */}
      <button
        ref={infoRef}
        onClick={() => setPopoverOpen(!popoverOpen)}
        className="ml-0.5 p-0.5 rounded hover:bg-[var(--bg-hover)] hover:text-[var(--text-muted)] transition-colors"
        title="Request details"
      >
        <Info size={10} />
      </button>
      {popoverOpen && (
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setPopoverOpen(false)} />
          <div className="absolute bottom-full left-0 mb-2 z-[9999] bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg shadow-lg shadow-black/30 p-3 min-w-[260px]">
            <div className="flex flex-col gap-1.5 text-[11px]">
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">Provider</span><span className="text-[var(--text-primary)]">{message.modelProvider || "niaai"}</span></div>
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">Requested model</span><span className="text-[var(--text-primary)] font-mono text-[10px]">{message.requestedModel || message.modelId || "—"}</span></div>
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">Served model</span><span className="text-[var(--text-primary)] font-mono text-[10px]">{message.servedModel || "—"}</span></div>
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">Request ID</span><span className="text-[var(--text-primary)] font-mono text-[10px]">{message.requestId || "—"}</span></div>
              <div className="border-t border-[var(--border)] my-0.5" />
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">Input tokens</span><span className="text-[var(--text-primary)]">{message.usage!.input_tokens.toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">Output tokens</span><span className="text-[var(--text-primary)]">{message.usage!.output_tokens.toLocaleString()}</span></div>
              {message.usage!.cached_input_tokens ? <div className="flex justify-between"><span className="text-[var(--text-muted)]">Cached</span><span className="text-[var(--text-primary)]">{message.usage!.cached_input_tokens.toLocaleString()}</span></div> : null}
              {message.usage!.reasoning_tokens ? <div className="flex justify-between"><span className="text-[var(--text-muted)]">Reasoning</span><span className="text-[var(--text-primary)]">{message.usage!.reasoning_tokens.toLocaleString()}</span></div> : null}
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">Latency</span><span className="text-[var(--text-primary)]">{(message.usage!.latency_ms / 1000).toFixed(2)}s</span></div>
              {message.usage!.ttft_ms != null && <div className="flex justify-between"><span className="text-[var(--text-muted)]">TTFT</span><span className="text-[var(--text-primary)]">{(message.usage!.ttft_ms / 1000).toFixed(2)}s</span></div>}
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">Cost</span><span className="text-[var(--accent)]">{message.usage!.cost_usd < 0 ? "—" : `$${message.usage!.cost_usd.toFixed(6)}`}</span></div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ErrorCard({ error, onAction }: {
  error: NonNullable<Message["errorData"]>;
  onAction?: (action: string) => void;
}) {
  const actionLabels: Record<string, { label: string; primary?: boolean }> = {
    use_gateway: { label: "Use NiaAI gateway", primary: true },
    pick_model: { label: "Pick another model", primary: true },
    open_settings: { label: "Open Settings" },
    retry: { label: "Retry" },
  };

  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-red-500/20 bg-red-500/5 max-w-md">
      <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-red-300">{error.title}</p>
        <p className="text-[12px] text-[var(--text-muted)] mt-0.5">{error.message}</p>
        {error.actions && error.actions.length > 0 && (
          <div className="flex items-center gap-2 mt-2.5">
            {error.actions.map((action) => {
              const info = actionLabels[action] || { label: action };
              return (
                <button
                  key={action}
                  onClick={() => onAction?.(action)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                    info.primary
                      ? "bg-[var(--accent)] text-white hover:opacity-90"
                      : "border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  {info.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function LinkCardsRow({ cards }: { cards: LinkCardData[] }) {
  if (!cards || cards.length === 0) return null;

  return (
    <div className="flex gap-2 flex-wrap mb-3">
      {cards.map((card, i) => (
        <a
          key={i}
          href={card.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex gap-2.5 p-2.5 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)] transition-colors max-w-[320px] min-w-[240px] group"
          title={card.url}
        >
          {card.thumbnail && (
            <div className="w-[60px] h-[60px] rounded-lg overflow-hidden shrink-0 bg-[var(--bg-elevated)]">
              <img
                src={card.thumbnail}
                alt=""
                className="w-full h-full object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <img
                src={card.favicon}
                alt=""
                className="w-3.5 h-3.5 rounded-sm"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
              <span className="text-[11px] text-[var(--text-faint)] truncate">{card.domain}</span>
            </div>
            <div className="text-[13px] font-medium text-[var(--text-primary)] line-clamp-1 group-hover:text-[var(--accent)]">
              {card.title}
            </div>
            {card.description && (
              <div className="text-[11px] text-[var(--text-muted)] line-clamp-2 mt-0.5 leading-tight">
                {card.description}
              </div>
            )}
            {card.error && (
              <div className="text-[11px] text-amber-400 mt-0.5">
                Couldn&apos;t fully read this page
              </div>
            )}
          </div>
          <ExternalLink size={12} className="text-[var(--text-faint)] shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity" />
        </a>
      ))}
    </div>
  );
}

/* ---- Info popover button for assistant message header ---- */
function InfoPopoverButton({ message }: { message: Message }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const u = message.usage;

  return (
    <span className="relative inline-flex items-center">
      <button
        ref={btnRef}
        onClick={() => setOpen(!open)}
        className="p-0.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-faint)] hover:text-[var(--text-muted)] transition-colors"
        title="Request details"
      >
        <Info size={10} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-2 z-[9999] bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg shadow-lg shadow-black/30 p-3 min-w-[260px]">
            <div className="flex flex-col gap-1.5 text-[11px]">
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">Provider</span><span className="text-[var(--text-primary)]">{message.modelProvider || "niaai"}</span></div>
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">Model ID</span><span className="text-[var(--text-primary)] font-mono text-[10px]">{message.requestedModel || message.modelId || "—"}</span></div>
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">Served model</span><span className="text-[var(--text-primary)] font-mono text-[10px]">{message.servedModel || "—"}</span></div>
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">Request ID</span><span className="text-[var(--text-primary)] font-mono text-[10px]">{message.requestId || "—"}</span></div>
              {u && (
                <>
                  <div className="border-t border-[var(--border)] my-0.5" />
                  <div className="flex justify-between"><span className="text-[var(--text-muted)]">Input tokens</span><span className="text-[var(--text-primary)]">{u.input_tokens.toLocaleString()}</span></div>
                  <div className="flex justify-between"><span className="text-[var(--text-muted)]">Output tokens</span><span className="text-[var(--text-primary)]">{u.output_tokens.toLocaleString()}</span></div>
                  {u.cached_input_tokens ? <div className="flex justify-between"><span className="text-[var(--text-muted)]">Cached</span><span className="text-[var(--text-primary)]">{u.cached_input_tokens.toLocaleString()}</span></div> : null}
                  {u.reasoning_tokens ? <div className="flex justify-between"><span className="text-[var(--text-muted)]">Reasoning</span><span className="text-[var(--text-primary)]">{u.reasoning_tokens.toLocaleString()}</span></div> : null}
                  <div className="flex justify-between"><span className="text-[var(--text-muted)]">Latency</span><span className="text-[var(--text-primary)]">{(u.latency_ms / 1000).toFixed(2)}s</span></div>
                  {u.ttft_ms != null && <div className="flex justify-between"><span className="text-[var(--text-muted)]">TTFT</span><span className="text-[var(--text-primary)]">{(u.ttft_ms / 1000).toFixed(2)}s</span></div>}
                  <div className="flex justify-between"><span className="text-[var(--text-muted)]">Cost</span><span className="text-[var(--accent)]">{u.cost_usd < 0 ? "—" : `$${u.cost_usd.toFixed(6)}`}</span></div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </span>
  );
}

export default function ChatMessage({ message, onRegenerate, onRegenerateImage, onRegenerateImageWithPrompt, onErrorAction, modelName }: ChatMessageProps) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const [liked, setLiked] = useState<"up" | "down" | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [imageGenStart] = useState(() => Date.now());
  const [highlightedSource, setHighlightedSource] = useState<number | null>(null);
  const lastClickedCiteRef = useRef<number | null>(null);

  // Make inline [1], [2] citation markers in content clickable
  const processedContent = useMemo(() => {
    if (!message.sources || message.sources.length === 0) return message.content;
    // The ReactMarkdown will handle rendering; we add links via the text renderer
    return message.content;
  }, [message.content, message.sources]);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    showToast("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReadAloud = useCallback(() => {
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(message.content);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    utteranceRef.current = utterance;
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }, [isSpeaking, message.content]);

  // Detect bare image URLs in content
  const bareImageUrls = !isUser && !message.imageData && !message.imageUrl ? extractImageUrls(message.content) : [];

  // User message: right-aligned bubble
  if (isUser) {
    return (
      <div className="flex justify-end animate-bubble-in">
        <div className="max-w-[80%] flex flex-col items-end gap-0.5">
          <div className="px-4 py-3 text-[13.5px] leading-[1.6] bg-[var(--bg-tertiary)] text-[var(--text-primary)]" style={{ borderRadius: "20px 20px 6px 20px" }}>
            {message.connector && (() => {
              const cp = typeof message.connector === "string" ? message.connector : message.connector.provider;
              const wn = typeof message.connector === "object" && message.connector?.workspaceName;
              return (
                <span className="inline-flex items-center gap-1 mr-1.5 text-[11px] font-medium text-[var(--accent)] align-middle">
                  {cp === "slack" ? <Hash size={11} /> : <MessageSquare size={11} />}
                  {cp === "slack" ? "Slack" : "Discord"}
                  {wn && <span className="opacity-70">· {wn}</span>}
                  <span className="text-[var(--text-faint)]">·</span>
                </span>
              );
            })()}
            {message.content}
          </div>
          {/* Attachments with extraction status */}
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-1">
              {message.attachments.map((file, i) => {
                const ua = message.uploadedAttachments?.find(u => u.name === file.name);
                const hasError = ua?.extractionError;
                const hasPages = ua?.pages && ua.pages > 0;
                const isOcr = ua?.ocr;
                return (
                  <div key={i} className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg text-[12px] text-[var(--text-muted)] font-medium">
                    {file.type === "application/pdf" ? (
                      <FileText size={12} className={hasError ? "text-red-400" : "text-[var(--accent)]"} />
                    ) : (
                      <Paperclip size={12} className="text-[var(--accent)]" />
                    )}
                    <span className="max-w-[150px] truncate">{file.name}</span>
                    {hasError && (
                      <span className="text-red-400 text-[10px]" title={ua.extractionError}>✕ Couldn&apos;t read</span>
                    )}
                    {!hasError && hasPages && (
                      <span className="text-emerald-400 text-[10px]">
                        ✓ {ua.pages} {ua.pages === 1 ? "page" : "pages"}{isOcr ? " (OCR)" : ""}
                      </span>
                    )}
                    {!hasError && !hasPages && ua?.chars != null && ua.chars > 0 && (
                      <span className="text-emerald-400 text-[10px]">✓ {Math.ceil(ua.chars / 1000)}k chars</span>
                    )}
                    {message.isUploading && !ua && (
                      <span className="text-yellow-400 text-[10px] animate-pulse">Reading…</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex items-center gap-1 mt-0.5">
            {message.via === "voice" && (
              <Mic size={10} className="text-[var(--accent)]" />
            )}
            <span className="text-[10px] text-[var(--text-faint)]">{message.timestamp}</span>
            <button onClick={handleCopy} className="p-1 rounded text-[var(--text-faint)] hover:text-[var(--accent)] transition-colors" title="Copy">
              {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="flex gap-3 animate-bubble-in group">
      {/* Gradient avatar */}
      <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#8b3dff] to-[#c13bd9] flex items-center justify-center shrink-0 mt-0.5 shadow-lg shadow-[rgba(139,61,255,0.2)]">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="white" opacity="0.9"/></svg>
      </div>

      <div className="flex flex-col gap-0.5 items-start max-w-[85%]">
        {/* Meta line */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-semibold text-[var(--text-muted)]">
            {message.modelProvider && message.modelProvider !== "niaai"
              ? message.modelProvider.charAt(0).toUpperCase() + message.modelProvider.slice(1)
              : "NiaAI"}
          </span>
          {message.via === "voice" && <Mic size={10} className="text-[var(--accent)]" />}
          <span className="text-[10px] text-[var(--text-faint)]">&middot; {message.modelLabel || modelName || "Fast"}</span>
          <InfoPopoverButton message={message} />
          {message.webSearchUsed && !message.connectorSearchUsed && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[var(--accent-subtle)] text-[var(--accent)] text-[9px] font-bold uppercase tracking-wide">
              <Globe size={9} />
              Web
            </span>
          )}
          {message.connectorSearchUsed && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide" style={{ background: message.connectorSearchUsed === "slack" ? "rgba(74,21,75,0.2)" : "rgba(88,101,242,0.2)", color: message.connectorSearchUsed === "slack" ? "#e0a8e0" : "#8b9bf7" }}>
              {message.connectorSearchUsed === "slack" ? <Hash size={9} /> : <MessageSquare size={9} />}
              {message.connectorSearchUsed === "slack" ? "Slack" : "Discord"}
            </span>
          )}
        </div>

        {/* Freshness header — replaces the spinner row once tokens start */}
        {message.webSearchUsed && !message.connectorSearchUsed && message.sources && message.sources.length > 0 && !message.searchStatus && (
          <SearchInfoLine sources={message.sources} readCount={message.searchReadCount} />
        )}

        {/* Connector sources row */}
        {message.connectorSearchUsed && message.connectorSources && message.connectorSources.length > 0 && !message.searchStatus && (
          <ConnectorSourcesLine provider={message.connectorSearchUsed} sources={message.connectorSources} />
        )}

        {/* Search status */}
        {message.searchStatus && (
          <SearchStatusLine text={message.searchStatus} />
        )}

        {/* Link cards */}
        {message.linkCards && message.linkCards.length > 0 && (
          <LinkCardsRow cards={message.linkCards} />
        )}

        {/* Shimmer status while empty stream (non-image) */}
        {message.isStreaming && message.content === "" && !message.imageStage && !message.searchStatus && (
          <div className="shimmer text-[13px] font-medium mb-1">Thinking...</div>
        )}

        {/* Image progress card */}
        {message.imageStage && (
          <ImageProgressCard stage={message.imageStage} startTime={imageGenStart} />
        )}

        {/* Image error card */}
        {message.imageError && (
          <ImageErrorCard error={message.imageError} onRetry={onRegenerateImage} />
        )}

        {/* Image result card */}
        {message.imageData && (
          <ImageCard data={message.imageData} onRegenerate={onRegenerateImage} onRegenerateWithPrompt={onRegenerateImageWithPrompt} />
        )}

        {/* Document progress card */}
        {message.docStage && (
          <FileProgressCard stage={message.docStage} startTime={imageGenStart} filename={message.docData?.filename} docType={message.docData?.type || "pdf"} />
        )}

        {/* Document error card */}
        {message.docError && (
          <ImageErrorCard error={message.docError} onRetry={onRegenerate} />
        )}

        {/* Document result card */}
        {message.docData && !message.docStage && (
          <FileCard data={message.docData} onRegenerate={onRegenerate} />
        )}

        {/* Error card */}
        {message.errorData && (
          <ErrorCard error={message.errorData} onAction={onErrorAction} />
        )}

        {/* Content (text) */}
        {message.content && !message.imageStage && (
          <div className="py-1 text-[13.5px] leading-[1.7] text-[var(--text-secondary)]">
            <div className="markdown-body">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ children }) => <h1 className="text-[18px] font-bold text-[var(--text-primary)] mt-4 mb-2 first:mt-0">{children}</h1>,
                  h2: ({ children }) => <h2 className="text-[16px] font-bold text-[var(--text-primary)] mt-4 mb-2 first:mt-0">{children}</h2>,
                  h3: ({ children }) => <h3 className="text-[14.5px] font-semibold text-[var(--text-primary)] mt-3 mb-1.5 first:mt-0">{children}</h3>,
                  p: ({ children }) => {
                    // Render [1], [2] etc. as clickable citation links when sources exist
                    if (message.sources && message.sources.length > 0) {
                      return <p className="mb-2 last:mb-0 leading-[1.7]">{renderWithCitations(children, message.sources, setHighlightedSource, lastClickedCiteRef)}</p>;
                    }
                    return <p className="mb-2 last:mb-0 leading-[1.7]">{children}</p>;
                  },
                  ul: ({ children }) => <ul className="list-disc list-outside ml-5 mb-2 space-y-1 last:mb-0">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal list-outside ml-5 mb-2 space-y-1 last:mb-0">{children}</ol>,
                  li: ({ children }) => {
                    if (message.sources && message.sources.length > 0) {
                      return <li className="leading-[1.6] pl-0.5">{renderWithCitations(children, message.sources, setHighlightedSource, lastClickedCiteRef)}</li>;
                    }
                    return <li className="leading-[1.6] pl-0.5">{children}</li>;
                  },
                  strong: ({ children }) => <strong className="font-semibold text-[var(--text-primary)]">{children}</strong>,
                  em: ({ children }) => <em className="italic">{children}</em>,
                  blockquote: ({ children }) => <blockquote className="border-l-2 border-[var(--accent)] pl-3 my-2 text-[var(--text-muted)] italic">{children}</blockquote>,
                  code: ({ className, children }) => {
                    const isBlock = className?.includes("language-");
                    if (isBlock) {
                      const lang = className?.replace("language-", "") || "";
                      return (
                        <div className="my-3 code-block">
                          {lang && (
                            <div className="code-block-header">
                              <span>{lang}</span>
                              <button onClick={handleCopy} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"><Copy size={12} /></button>
                            </div>
                          )}
                          <pre className="p-4 overflow-x-auto text-[13px] leading-relaxed"><code>{children}</code></pre>
                        </div>
                      );
                    }
                    return <code className="px-1.5 py-0.5 bg-[var(--accent-subtle)] text-[var(--accent)] rounded-md text-[12px] font-mono font-medium">{children}</code>;
                  },
                  pre: ({ children }) => <>{children}</>,
                  a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">{children}</a>,
                  table: ({ children }) => <div className="overflow-x-auto my-3"><table className="w-full border-collapse text-[13px]">{children}</table></div>,
                  thead: ({ children }) => <thead className="bg-[var(--bg-tertiary)]">{children}</thead>,
                  th: ({ children }) => <th className="px-3 py-2 text-left font-semibold text-[var(--text-primary)] border border-[var(--border)]">{children}</th>,
                  td: ({ children }) => <td className="px-3 py-2 border border-[var(--border)]">{children}</td>,
                  hr: () => <hr className="my-3 border-[var(--border)]" />,
                }}
              >
                {processedContent}
              </ReactMarkdown>
            </div>
            {message.isStreaming && (
              <span className="inline-block w-[2px] h-[16px] bg-[var(--accent)] ml-0.5 animate-cursor rounded-full align-text-bottom" />
            )}
          </div>
        )}

        {/* Sources row */}
        {!message.isStreaming && message.sources && message.sources.length > 0 && (
          <SourcesRow sources={message.sources} highlightIndex={highlightedSource} />
        )}

        {/* Legacy imageUrl fallback */}
        {message.imageUrl && !message.imageData && (
          <div className="mt-2 rounded-xl overflow-hidden border border-[var(--border)] max-w-sm">
            <img src={message.imageUrl} alt="Generated" className="w-full" />
          </div>
        )}

        {/* Bare URL image fallback */}
        {bareImageUrls.map((url) => (
          <InlineImageFallback key={url} url={url} />
        ))}

        {/* Per-message usage info (visible on hover) with info popover */}
        {message.usage && !message.isStreaming && (
          <UsageInfoRow message={message} />
        )}

        {/* Action row */}
        {!message.isStreaming && !message.imageStage && (
          <div className="flex items-center gap-0.5 mt-0.5">
            {[
              { icon: copied ? Check : Copy, action: handleCopy, active: copied, activeClass: "text-emerald-400", title: "Copy" },
              { icon: ThumbsUp, action: () => { setLiked(liked === "up" ? null : "up"); showToast("Feedback recorded"); }, active: liked === "up", activeClass: "text-[var(--accent)] bg-[var(--accent-subtle)]", title: "Good" },
              { icon: ThumbsDown, action: () => { setLiked(liked === "down" ? null : "down"); showToast("Feedback recorded"); }, active: liked === "down", activeClass: "text-red-400 bg-red-400/10", title: "Bad" },
              { icon: isSpeaking ? VolumeX : Volume2, action: handleReadAloud, active: isSpeaking, activeClass: "text-[var(--accent)] bg-[var(--accent-subtle)]", title: isSpeaking ? "Stop" : "Read aloud" },
              { icon: RotateCcw, action: onRegenerate || (() => {}), active: false, activeClass: "", title: "Regenerate" },
            ].map(({ icon: Icon, action, active, activeClass, title }) => (
              <button
                key={title}
                onClick={action}
                className={`p-1.5 rounded-lg transition-all duration-150 ${
                  active ? activeClass : "text-[var(--text-faint)] hover:text-[var(--accent)] hover:bg-[var(--bg-hover)]"
                }`}
                title={title}
              >
                <Icon size={13} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
