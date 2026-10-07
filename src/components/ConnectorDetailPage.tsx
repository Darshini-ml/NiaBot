"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ArrowRight,
  MoreHorizontal,
  Trash2,
  MessageSquare,
  Info,
  X,
  Plus,
  Hash,
  CheckCircle2,
} from "lucide-react";
import { showToast } from "./Toast";

// ── Types ────────────────────────────────────────────────────────────────────

interface Account {
  id: string;
  externalId: string;
  externalName: string;
  accountLabel: string;
  isPrimary: boolean;
  connectedAt: string;
  enabled: boolean;
  status: string;
  scopes: string[];
  lastUsedAt: string | null;
}

interface ConnectorDetailPageProps {
  provider: "slack" | "discord";
  onBack: () => void;
  onNewChat: (seedPrompt: string, connector: "slack" | "discord", accountId?: string, accountName?: string) => void;
  onOpenConnectors: () => void;
}

// ── Provider metadata ────────────────────────────────────────────────────────

const PROVIDER_META: Record<string, {
  name: string;
  subtitle: string;
  description: string;
  icon: string;
  color: string;
  gradientFrom: string;
  gradientTo: string;
  prompts: string[];
}> = {
  slack: {
    name: "Slack",
    subtitle: "Read and manage Slack",
    description: "NiaAI can read your Slack messages, search conversations, and summarize channel activity when you ask about your workspace.",
    icon: "\u{1F4AC}",
    color: "#E01E5A",
    gradientFrom: "rgba(224, 30, 90, 0.08)",
    gradientTo: "rgba(224, 30, 90, 0.02)",
    prompts: [
      "Summarize what mattered most in [channel] over the last 7 days and list decisions plus owners plus next steps",
      "Draft a crisp reply in the same tone as the channel for the last customer escalation message in [channel]",
      "Build a 30 minute meeting agenda based on the top themes from this morning\u2019s discussion in [channel]",
    ],
  },
  discord: {
    name: "Discord",
    subtitle: "Read and manage Discord",
    description: "NiaAI can read your Discord messages, search channels, and summarize server activity when you ask about your workspace.",
    icon: "\u{1F3AE}",
    color: "#5865F2",
    gradientFrom: "rgba(88, 101, 242, 0.08)",
    gradientTo: "rgba(88, 101, 242, 0.02)",
    prompts: [
      "Summarize what mattered most in [channel] over the last 7 days and list decisions plus owners plus next steps",
      "Draft a crisp reply matching the server\u2019s tone for the last support question in [channel]",
      "Build a 30 minute meeting agenda based on the top themes from this morning\u2019s discussion in [channel]",
    ],
  },
};

// ── Component ────────────────────────────────────────────────────────────────

export default function ConnectorDetailPage({
  provider,
  onBack,
  onNewChat,
  onOpenConnectors,
}: ConnectorDetailPageProps) {
  const meta = PROVIDER_META[provider];
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState<string | null>(null); // "header" or account id
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [uninstallConfirm, setUninstallConfirm] = useState(false);
  const [disconnectConfirm, setDisconnectConfirm] = useState<string | null>(null);
  const [uninstalling, setUninstalling] = useState(false);
  const [channelPicker, setChannelPicker] = useState<{ promptIdx: number } | null>(null);
  const [channels, setChannels] = useState<{ name: string; id: string }[]>([]);
  const [channelSearch, setChannelSearch] = useState("");
  const [channelsLoading, setChannelsLoading] = useState(false);
  const menuBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const fetchDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/connectors/${provider}`);
      if (res.ok) {
        const data = await res.json();
        setInstalled(data.installed);
        setAccounts(data.accounts || []);
      }
    } catch {
      console.error("Failed to fetch connector detail");
    } finally {
      setLoading(false);
    }
  }, [provider]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  // OAuth callback detection
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    if (connected === provider) {
      const url = new URL(window.location.href);
      url.searchParams.delete("connected");
      url.searchParams.delete("view");
      window.history.replaceState({}, "", url.toString());
      showToast(`${meta.name} installed`);
      fetchDetail();
    }
  }, [provider, meta.name, fetchDetail]);

  // Close menu on Escape
  useEffect(() => {
    if (!menuOpen && !channelPicker) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(null);
        setChannelPicker(null);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [menuOpen, channelPicker]);

  const handleInstall = () => {
    window.location.href = `/api/connectors/${provider}/start`;
  };

  const handleUninstall = async () => {
    setUninstalling(true);
    try {
      await fetch(`/api/connectors/${provider}`, { method: "DELETE" });
      setInstalled(false);
      setAccounts([]);
      showToast(`${meta.name} uninstalled`);
    } catch {
      showToast("Failed to uninstall");
    }
    setUninstalling(false);
    setUninstallConfirm(false);
    setMenuOpen(null);
  };

  const handleDisconnectAccount = async (externalId: string) => {
    setUninstalling(true);
    try {
      const res = await fetch(`/api/connectors/${provider}?externalId=${encodeURIComponent(externalId)}`, { method: "DELETE" });
      const data = await res.json();
      if (data.remainingAccounts === 0) {
        setInstalled(false);
        setAccounts([]);
        showToast(`${meta.name} uninstalled (last account removed)`);
      } else {
        setAccounts((prev) => prev.filter((a) => a.externalId !== externalId));
        showToast("Account disconnected");
      }
    } catch {
      showToast("Failed to disconnect");
    }
    setUninstalling(false);
    setDisconnectConfirm(null);
  };

  const primaryAccount = accounts.find((a) => a.enabled) || accounts[0];

  const handlePromptClick = (promptIdx: number) => {
    const prompt = meta.prompts[promptIdx];
    if (prompt.includes("[channel]")) {
      // Open channel picker
      setChannelPicker({ promptIdx });
      setChannelSearch("");
      if (channels.length === 0) {
        setChannelsLoading(true);
        fetch(`/api/connectors/${provider}/channels`)
          .then((r) => r.json())
          .then((d) => setChannels(d.channels || []))
          .catch(() => {})
          .finally(() => setChannelsLoading(false));
      }
    } else {
      onNewChat(prompt, provider, primaryAccount?.id, primaryAccount?.externalName);
    }
  };

  const handleChannelSelect = (channelName: string) => {
    if (channelPicker === null) return;
    const prompt = meta.prompts[channelPicker.promptIdx].replace("[channel]", `#${channelName}`);
    setChannelPicker(null);
    onNewChat(prompt, provider, primaryAccount?.id, primaryAccount?.externalName);
  };

  const openMenu = (key: string) => {
    const btn = menuBtnRefs.current[key];
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, left: rect.right - 192 });
    setMenuOpen(menuOpen === key ? null : key);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const filteredChannels = channels.filter((ch) =>
    ch.name.toLowerCase().includes(channelSearch.toLowerCase()),
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ background: "var(--bg-primary)" }}>
        <span className="text-[13px] text-[var(--text-muted)]">Loading...</span>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto" style={{ background: "var(--bg-primary)" }}>
      {/* Header */}
      <div className="sticky top-0 z-10 px-6 py-4 border-b border-[var(--border)]" style={{ background: "var(--bg-primary)" }}>
        <div className="max-w-[680px] mx-auto flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] transition-colors"
          >
            <ChevronLeft size={18} />
          </button>

          <span className="text-lg mr-1">{meta.icon}</span>
          <div className="flex-1 min-w-0">
            <h1 className="text-[18px] font-semibold text-[var(--text-primary)]">{meta.name}</h1>
            <p className="text-[12px] text-[var(--text-muted)]">{meta.subtitle}</p>
          </div>

          {/* Install / Installed button */}
          {installed ? (
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium text-[var(--text-muted)] bg-[var(--bg-hover)] cursor-default">
                <CheckCircle2 size={14} />
                Installed
              </span>
              <button
                ref={(el) => { menuBtnRefs.current["header"] = el; }}
                onClick={() => openMenu("header")}
                className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] transition-colors"
              >
                <MoreHorizontal size={16} />
              </button>
            </div>
          ) : (
            <button
              onClick={handleInstall}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold text-white transition-all duration-150 hover:opacity-90"
              style={{ background: "#000" }}
            >
              <Plus size={14} />
              Install plugin
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-[680px] mx-auto w-full px-6 py-6 space-y-6">
        {/* Hero card with suggestion prompts */}
        <div
          className="rounded-2xl p-6 space-y-3"
          style={{
            background: `linear-gradient(135deg, ${meta.gradientFrom}, ${meta.gradientTo})`,
            border: `1px solid ${meta.color}15`,
          }}
        >
          {meta.prompts.map((prompt, idx) => (
            <button
              key={idx}
              onClick={() => installed ? handlePromptClick(idx) : handleInstall()}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white/80 dark:bg-[var(--bg-secondary)] border border-[var(--border)] hover:border-[var(--accent-border)] transition-all duration-150 text-left group"
              style={{ backdropFilter: "blur(8px)" }}
            >
              <span className="text-sm shrink-0">{meta.icon}</span>
              <span className="flex-1 min-w-0 text-[13px] text-[var(--text-primary)] leading-snug">
                <strong className="font-semibold">{meta.name}</strong>{" "}
                {prompt.replace("[channel]", "#channel")}
              </span>
              <span
                className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-colors group-hover:bg-[var(--accent)] group-hover:text-white"
                style={{ background: `${meta.color}12`, color: meta.color }}
              >
                <ArrowRight size={14} />
              </span>
            </button>
          ))}
        </div>

        {/* Description */}
        <p className="text-[13px] text-[var(--text-muted)] leading-relaxed px-1">{meta.description}</p>

        {/* Apps section */}
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">
            Apps <span className="text-[var(--text-faint)] font-normal">1</span>
          </h2>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)]">
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="text-lg">{meta.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] font-medium text-[var(--text-primary)]">{meta.name}</span>
                  <button className="text-[var(--text-faint)] hover:text-[var(--text-muted)] transition-colors" title={meta.description}>
                    <Info size={12} />
                  </button>
                </div>
                <p className="text-[11px] text-[var(--text-muted)] truncate">{meta.description}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Connected accounts section */}
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">
            Connected accounts
          </h2>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden">
            {accounts.length > 0 ? (
              <>
                {accounts.map((account) => (
                  <div
                    key={account.id}
                    className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] last:border-b-0"
                  >
                    {/* Avatar initial */}
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-semibold text-white shrink-0"
                      style={{ background: "#22c55e" }}
                    >
                      {(account.accountLabel || account.externalName || "?")[0].toUpperCase()}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">
                          {account.accountLabel || account.externalName}
                        </span>
                        {account.isPrimary && (
                          <span className="text-[10px] font-medium text-[var(--accent)] bg-[rgba(124,58,237,0.1)] px-1.5 py-0.5 rounded">
                            Primary
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[var(--text-faint)]">
                        {account.externalName}
                        {account.connectedAt && ` \u00B7 Connected ${formatDate(account.connectedAt)}`}
                      </p>
                    </div>

                    {/* Account menu */}
                    <button
                      ref={(el) => { menuBtnRefs.current[account.id] = el; }}
                      onClick={() => openMenu(account.id)}
                      className="p-1 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] transition-colors"
                    >
                      <MoreHorizontal size={14} />
                    </button>
                  </div>
                ))}
              </>
            ) : (
              <div className="px-4 py-6 text-center text-[13px] text-[var(--text-muted)]">
                No accounts connected yet
              </div>
            )}

            {/* Add another account */}
            <button
              onClick={handleInstall}
              className="w-full flex items-center gap-2.5 px-4 py-3 text-[13px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors border-t border-[var(--border)]"
            >
              <Plus size={14} />
              Connect another account
            </button>
          </div>
        </div>
      </div>

      {/* ── Portal: header "..." menu ── */}
      {menuOpen === "header" && menuPos && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setMenuOpen(null)} />
          <div
            className="fixed z-[9999] w-48 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] shadow-xl py-1"
            style={{ top: menuPos.top, left: menuPos.left, animation: "scaleIn 120ms cubic-bezier(.2,.8,.2,1)" }}
          >
            <button
              onClick={() => { setMenuOpen(null); onNewChat(`Summarize #general from the last 7 days`, provider, primaryAccount?.id, primaryAccount?.externalName); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <MessageSquare size={14} />
              Try in chat
            </button>
            <div className="mx-2 my-1 border-t border-[var(--border)]" />
            <button
              onClick={() => { setUninstallConfirm(true); setMenuOpen(null); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-red-400 hover:bg-[var(--bg-hover)] transition-colors"
            >
              <Trash2 size={14} />
              Uninstall
            </button>
          </div>
        </>,
        document.body,
      )}

      {/* ── Portal: account "..." menu ── */}
      {menuOpen && menuOpen !== "header" && menuPos && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setMenuOpen(null)} />
          <div
            className="fixed z-[9999] w-48 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] shadow-xl py-1"
            style={{ top: menuPos.top, left: menuPos.left, animation: "scaleIn 120ms cubic-bezier(.2,.8,.2,1)" }}
          >
            {accounts.length > 1 && (() => {
              const acct = accounts.find((a) => a.id === menuOpen);
              return !acct?.isPrimary ? (
                <button
                  onClick={() => { /* TODO: set as primary API */ setMenuOpen(null); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                >
                  <CheckCircle2 size={14} />
                  Set as primary
                </button>
              ) : null;
            })()}
            <div className="mx-2 my-1 border-t border-[var(--border)]" />
            <button
              onClick={() => { setDisconnectConfirm(menuOpen); setMenuOpen(null); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-red-400 hover:bg-[var(--bg-hover)] transition-colors"
            >
              <Trash2 size={14} />
              Disconnect
            </button>
          </div>
        </>,
        document.body,
      )}

      {/* ── Uninstall confirm dialog ── */}
      {uninstallConfirm && createPortal(
        <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/50" onClick={() => !uninstalling && setUninstallConfirm(false)}>
          <div
            className="w-[380px] rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            style={{ animation: "scaleIn 150ms cubic-bezier(.2,.8,.2,1)" }}
          >
            <div className="px-5 py-4">
              <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
                Uninstall {meta.name}?
              </h3>
              <p className="text-[13px] text-[var(--text-muted)] mt-2 leading-relaxed">
                This will revoke NiaAI&apos;s access to all {meta.name} accounts, delete stored tokens, and remove
                it from the composer and sidebar. You&apos;ll need to go through the full authorization flow again.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border)]">
              <button
                onClick={() => setUninstallConfirm(false)}
                disabled={uninstalling}
                className="px-3 py-1.5 rounded-lg text-[13px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleUninstall}
                disabled={uninstalling}
                className="px-3 py-1.5 rounded-lg text-[13px] font-medium text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                {uninstalling ? "Removing..." : "Uninstall"}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* ── Disconnect account confirm dialog ── */}
      {disconnectConfirm && createPortal(
        <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/50" onClick={() => !uninstalling && setDisconnectConfirm(null)}>
          <div
            className="w-[380px] rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            style={{ animation: "scaleIn 150ms cubic-bezier(.2,.8,.2,1)" }}
          >
            <div className="px-5 py-4">
              <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">Disconnect account?</h3>
              <p className="text-[13px] text-[var(--text-muted)] mt-2 leading-relaxed">
                This will revoke access for this account and delete its token.
                {accounts.length <= 1 && " Since this is the last account, it will also uninstall the plugin."}
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border)]">
              <button
                onClick={() => setDisconnectConfirm(null)}
                disabled={uninstalling}
                className="px-3 py-1.5 rounded-lg text-[13px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const acct = accounts.find((a) => a.id === disconnectConfirm);
                  if (acct) handleDisconnectAccount(acct.externalId);
                }}
                disabled={uninstalling}
                className="px-3 py-1.5 rounded-lg text-[13px] font-medium text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                {uninstalling ? "Removing..." : "Disconnect"}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* ── Channel picker modal ── */}
      {channelPicker && createPortal(
        <div className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/50" onClick={() => setChannelPicker(null)}>
          <div
            className="w-[360px] max-h-[420px] rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
            style={{ animation: "scaleIn 150ms cubic-bezier(.2,.8,.2,1)" }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
              <span className="text-[14px] font-semibold text-[var(--text-primary)]">Select a channel</span>
              <button onClick={() => setChannelPicker(null)} className="p-1 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)]">
                <X size={14} />
              </button>
            </div>
            <div className="px-3 py-2">
              <input
                type="text"
                value={channelSearch}
                onChange={(e) => setChannelSearch(e.target.value)}
                placeholder="Search channels..."
                className="w-full px-3 py-1.5 rounded-lg text-[13px] bg-[var(--bg-primary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)]"
                autoFocus
              />
            </div>
            <div className="flex-1 overflow-y-auto px-1 pb-2">
              {channelsLoading ? (
                <div className="px-3 py-4 text-center text-[12px] text-[var(--text-muted)]">Loading channels...</div>
              ) : filteredChannels.length === 0 ? (
                <div className="px-3 py-4 text-center text-[12px] text-[var(--text-muted)]">No channels found</div>
              ) : (
                filteredChannels.map((ch) => (
                  <button
                    key={ch.id}
                    onClick={() => handleChannelSelect(ch.name)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                  >
                    <Hash size={13} className="text-[var(--text-faint)] shrink-0" />
                    {ch.name}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
