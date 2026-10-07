"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Plug,
  Plus,
  MoreHorizontal,
  Trash2,
  MessageSquare,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ChevronLeft,
  Info,
  Settings,
  X,
  PauseCircle,
} from "lucide-react";
import { showToast } from "./Toast";

// ── Types ────────────────────────────────────────────────────────────────────

interface ConnectorInfo {
  id: string;
  provider: "slack" | "discord";
  external_id: string;
  external_name: string;
  account_label: string;
  enabled: boolean;
  status: string;
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ProviderConfig {
  slack: boolean;
  discord: boolean;
  encryption: boolean;
}

interface ConnectorsPageProps {
  onBack?: () => void;
  onNewChat?: (seedPrompt: string, connector?: "slack" | "discord") => void;
  onOpenDetail?: (provider: "slack" | "discord") => void;
  userId?: string;
}

// ── Provider metadata ────────────────────────────────────────────────────────

const PROVIDERS: Record<string, {
  name: string;
  description: string;
  icon: string;
  color: string;
  notConfiguredMsg: string;
}> = {
  slack: {
    name: "Slack",
    description: "Read and search Slack messages, channels, and conversations",
    icon: "\u{1F4AC}",
    color: "#E01E5A",
    notConfiguredMsg: "Slack connector isn't set up on this server yet",
  },
  discord: {
    name: "Discord",
    description: "Read and search Discord channels and messages",
    icon: "\u{1F3AE}",
    color: "#5865F2",
    notConfiguredMsg: "Discord connector isn't set up on this server yet",
  },
};

// ── Component ────────────────────────────────────────────────────────────────

export default function ConnectorsPage({ onBack, onNewChat, onOpenDetail }: ConnectorsPageProps) {
  const [connectors, setConnectors] = useState<ConnectorInfo[]>([]);
  const [config, setConfig] = useState<ProviderConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [manageModal, setManageModal] = useState<string | null>(null);
  const [uninstallConfirm, setUninstallConfirm] = useState<string | null>(null);
  const [uninstalling, setUninstalling] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const menuBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const fetchConnectors = useCallback(async () => {
    try {
      const res = await fetch("/api/connectors");
      if (res.ok) {
        const data = await res.json();
        setConnectors(data.connectors || []);
      }
    } catch (err) {
      console.error("Failed to fetch connectors:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    async function loadConfig() {
      try {
        const res = await fetch("/api/connectors/config");
        if (res.ok) {
          const data = await res.json();
          setConfig(data);
        }
      } catch { /* silent */ }
    }
    loadConfig();
  }, []);

  useEffect(() => {
    fetchConnectors();
  }, [fetchConnectors]);

  // OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const connError = params.get("connectorError");
    const errorDetail = params.get("detail");

    if (connected || connError) {
      const url = new URL(window.location.href);
      url.searchParams.delete("connected");
      url.searchParams.delete("connectorError");
      url.searchParams.delete("connectorSuccess");
      url.searchParams.delete("detail");
      url.searchParams.delete("view");
      window.history.replaceState({}, "", url.toString());

      if (connected) {
        const name = connected === "slack" ? "Slack" : connected === "discord" ? "Discord" : connected;
        showToast(`${name} connected successfully`);
        fetchConnectors();
      }
      if (connError) {
        const errorMessages: Record<string, string> = {
          discord_denied: "Discord authorization was cancelled",
          slack_denied: "Slack authorization was cancelled",
          missing_params: "OAuth callback missing required parameters",
          invalid_state: "OAuth session expired — please try again",
          token_exchange_failed: "Failed to exchange authorization code — check your client secret",
          no_access_token: "Discord did not return an access token",
          user_fetch_failed: "Could not fetch your Discord profile",
          db_insert_failed: "Failed to save connector — check server logs",
          no_user_token: "Slack did not return a user token — reinstall the app with user scopes",
          not_configured: "Connector is not configured on this server",
          slack_exchange_failed: "Slack token exchange failed",
          discord_exchange_failed: "Discord token exchange failed",
        };
        let msg = errorMessages[connError] || `Connection failed: ${connError.replace(/_/g, " ")}`;
        if (errorDetail) msg += ` — ${decodeURIComponent(errorDetail)}`;
        showToast(msg, { type: "error" });
      }
    }
  }, [fetchConnectors]);

  // Close menu on Escape
  useEffect(() => {
    if (!menuOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(null);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [menuOpen]);

  const handleConnect = (provider: string) => {
    const url = `/api/connectors/${provider}/start`;
    const w = 600;
    const h = 700;
    const left = window.screenX + (window.innerWidth - w) / 2;
    const top = window.screenY + (window.innerHeight - h) / 2;
    const popup = window.open(url, `${provider}_oauth`, `width=${w},height=${h},left=${left},top=${top},popup=1`);

    // If popup is blocked, fall back to full-page redirect
    if (!popup || popup.closed) {
      window.location.href = url;
      return;
    }

    // Listen for message from the OAuth callback page
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "oauth_complete" && e.data?.provider === provider) {
        window.removeEventListener("message", handler);
        if (e.data.success) {
          setConnectError(null);
          showToast(`${PROVIDERS[provider]?.name || provider} connected successfully`);
          fetchConnectors();
        } else {
          const errMsg = e.data.error || `Failed to connect ${provider}`;
          setConnectError(errMsg);
          showToast(errMsg, { type: "error" });
        }
      }
    };
    window.addEventListener("message", handler);

    // Also poll in case postMessage doesn't work (popup closes without sending)
    const interval = setInterval(() => {
      if (popup.closed) {
        clearInterval(interval);
        window.removeEventListener("message", handler);
        // Refresh connectors in case it succeeded
        fetchConnectors();
      }
    }, 500);
  };

  /** Disconnect a single workspace by connector id, or all for a provider */
  const handleDisconnect = async (provider: string, connectorId?: string) => {
    setUninstalling(true);
    try {
      const url = connectorId
        ? `/api/connectors/${provider}?id=${connectorId}`
        : `/api/connectors/${provider}`;
      await fetch(url, { method: "DELETE" });
      setConnectors((prev) =>
        connectorId
          ? prev.filter((c) => c.id !== connectorId)
          : prev.filter((c) => c.provider !== provider),
      );
      showToast(`${PROVIDERS[provider]?.name || provider} disconnected`);
    } catch (err) {
      console.error("Failed to disconnect:", err);
      showToast("Failed to disconnect");
    }
    setUninstalling(false);
    setUninstallConfirm(null);
    setMenuOpen(null);
  };

  /** Toggle a single workspace by connector id */
  const handleToggle = async (provider: string, enabled: boolean, connectorId?: string) => {
    // Optimistic update
    setConnectors((prev) =>
      prev.map((c) => {
        if (connectorId) return c.id === connectorId ? { ...c, enabled } : c;
        return c.provider === provider ? { ...c, enabled } : c;
      }),
    );
    try {
      await fetch(`/api/connectors/${provider}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, id: connectorId }),
      });
    } catch (err) {
      // Revert
      setConnectors((prev) =>
        prev.map((c) => {
          if (connectorId) return c.id === connectorId ? { ...c, enabled: !enabled } : c;
          return c.provider === provider ? { ...c, enabled: !enabled } : c;
        }),
      );
      console.error("Failed to toggle:", err);
    }
  };

  const handleTryInChat = (provider: string) => {
    const seedPrompts: Record<string, string> = {
      slack: "Summarize #general from the last 7 days",
      discord: "What happened in #general this week?",
    };
    onNewChat?.(seedPrompts[provider] || "", provider as "slack" | "discord");
    setMenuOpen(null);
  };

  const openMenu = (key: string) => {
    const btn = menuBtnRefs.current[key];
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, left: rect.right - 192 });
    setMenuOpen(menuOpen === key ? null : key);
  };

  const getConnector = (provider: string) => connectors.find((c) => c.provider === provider);
  const getConnectorsForProvider = (provider: string) => connectors.filter((c) => c.provider === provider);

  const isProviderConfigured = (provider: string): boolean => {
    if (!config) return true;
    if (!config.encryption) return false;
    return (config as unknown as Record<string, boolean>)[provider] ?? false;
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const formatFullDate = (dateStr: string | null) => {
    if (!dateStr) return "N/A";
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  };

  // ── Status chip helper ──
  const renderStatusChip = (connector: ConnectorInfo | undefined, needsReauth: boolean) => {
    if (!connector) return null;
    if (needsReauth) {
      return (
        <span className="flex items-center gap-1 text-[11px] text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full">
          <AlertTriangle size={11} />
          Reconnect required
        </span>
      );
    }
    if (!connector.enabled) {
      return (
        <span className="flex items-center gap-1 text-[11px] text-[var(--text-faint)] bg-[var(--bg-hover)] px-2 py-0.5 rounded-full">
          <PauseCircle size={11} />
          Paused
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">
        <CheckCircle2 size={11} />
        Connected
      </span>
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto" style={{ background: "var(--bg-primary)" }}>
      {/* Header */}
      <div className="sticky top-0 z-10 px-6 py-4 border-b border-[var(--border)]" style={{ background: "var(--bg-primary)" }}>
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] transition-colors"
            >
              <ChevronLeft size={18} />
            </button>
          )}
          <Plug size={20} className="text-[var(--accent)]" />
          <div>
            <h1 className="text-[18px] font-semibold text-[var(--text-primary)]">Connectors</h1>
            <p className="text-[12px] text-[var(--text-muted)]">Connect your workspace to read and search messages</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto w-full px-6 py-6 space-y-3">
        {loading ? (
          <div className="text-center py-12 text-[var(--text-muted)] text-[13px]">Loading connectors...</div>
        ) : (
          Object.entries(PROVIDERS).map(([key, meta]) => {
            const providerConnectors = getConnectorsForProvider(key);
            const isConnected = providerConnectors.length > 0;
            const configured = isProviderConfigured(key);

            return (
              <div
                key={key}
                className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] transition-all duration-150 hover:border-[var(--accent-border)]"
              >
                {/* Provider header */}
                <div className="flex items-center gap-4 px-5 py-4">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-lg shrink-0"
                    style={{ background: `${meta.color}18`, border: `1px solid ${meta.color}30` }}
                  >
                    {meta.icon}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onOpenDetail?.(key as "slack" | "discord")}
                        className="text-[14px] font-semibold text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors"
                      >
                        {meta.name}
                      </button>
                      {isConnected && (
                        <span className="text-[11px] text-[var(--text-faint)] bg-[var(--bg-hover)] px-2 py-0.5 rounded-full">
                          {providerConnectors.length} workspace{providerConnectors.length > 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-[var(--text-muted)] mt-0.5">{meta.description}</p>
                    {!configured && !isConnected && (
                      <div className="flex items-center gap-1.5 mt-2 text-[11px] text-amber-400/80">
                        <Info size={12} />
                        <span>{meta.notConfiguredMsg}</span>
                      </div>
                    )}
                    {connectError && !isConnected && (
                      <div className="flex items-center gap-1.5 mt-2 text-[11px] text-red-400">
                        <AlertTriangle size={12} />
                        <span className="break-all">{connectError}</span>
                        <button onClick={() => setConnectError(null)} className="ml-1 hover:text-red-300"><X size={10} /></button>
                      </div>
                    )}
                  </div>

                  {!isConnected && (
                    <button
                      onClick={() => handleConnect(key)}
                      disabled={!configured}
                      className="px-3.5 py-1.5 rounded-lg text-[13px] font-medium text-white transition-all duration-150 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                      style={{ background: meta.color }}
                    >
                      Connect
                    </button>
                  )}
                </div>

                {/* Per-workspace rows */}
                {providerConnectors.length > 0 && (
                  <div className="border-t border-[var(--border)]">
                    {providerConnectors.map((connector) => {
                      const needsReauth = connector.status === "needs_reauth";
                      const isEnabled = connector.enabled;
                      return (
                        <div
                          key={connector.id}
                          className="flex items-center gap-3 px-5 py-3 border-b border-[var(--border)] last:border-b-0"
                        >
                          {/* Workspace avatar */}
                          <div
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-[13px] font-semibold text-white shrink-0"
                            style={{ background: meta.color }}
                          >
                            {(connector.external_name || connector.external_id).charAt(0).toUpperCase()}
                          </div>

                          {/* Workspace info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">
                                {connector.external_name || connector.external_id}
                              </span>
                              {renderStatusChip(connector, needsReauth)}
                            </div>
                            {connector.account_label && (
                              <p className="text-[11px] text-[var(--text-faint)] truncate mt-0.5">
                                {connector.account_label}
                                {connector.last_used_at && ` · Last used ${formatDate(connector.last_used_at)}`}
                              </p>
                            )}
                          </div>

                          {/* Per-workspace actions */}
                          {needsReauth ? (
                            <button
                              onClick={() => handleConnect(key)}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] font-medium text-white hover:opacity-90 shrink-0"
                              style={{ background: "#f59e0b" }}
                            >
                              <RefreshCw size={12} />
                              Reconnect
                            </button>
                          ) : (
                            <>
                              <button
                                onClick={() => handleToggle(key, !isEnabled, connector.id)}
                                className="relative w-9 h-5 rounded-full transition-colors duration-200 shrink-0"
                                style={{
                                  background: isEnabled ? "var(--accent)" : "var(--bg-hover)",
                                  border: `1px solid ${isEnabled ? "var(--accent)" : "var(--border)"}`,
                                }}
                                title={isEnabled ? "Pause" : "Resume"}
                              >
                                <div
                                  className="absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-transform duration-200"
                                  style={{ transform: isEnabled ? "translateX(17px)" : "translateX(2px)" }}
                                />
                              </button>
                              <button
                                ref={(el) => { menuBtnRefs.current[connector.id] = el; }}
                                onClick={() => openMenu(connector.id)}
                                className="p-1 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] transition-colors shrink-0"
                              >
                                <MoreHorizontal size={15} />
                              </button>
                            </>
                          )}
                        </div>
                      );
                    })}

                    {/* Add another workspace */}
                    <button
                      onClick={() => handleConnect(key)}
                      disabled={!configured}
                      className="w-full flex items-center gap-2 px-5 py-2.5 text-[12px] text-[var(--accent)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-40"
                    >
                      <Plus size={14} />
                      Add another workspace
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Info note */}
        <div className="mt-6 px-4 py-3 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-[12px] text-[var(--text-muted)] leading-relaxed">
          <p>
            <strong className="text-[var(--text-secondary)]">How it works:</strong> Connectors let NiaAI read messages from your
            connected workspaces. When you ask about a channel or workspace activity, NiaAI will automatically search and
            summarize the relevant messages.
          </p>
          <p className="mt-2">
            Existing bot integrations (Slack @mention, Discord bot) are unaffected &mdash; those are configured separately in
            Settings.
          </p>
        </div>
      </div>

      {/* ── Portal: "..." dropdown menu (menuOpen = connector.id) ── */}
      {menuOpen && menuPos && (() => {
        const menuConnector = connectors.find(c => c.id === menuOpen);
        if (!menuConnector) return null;
        return createPortal(
          <>
            <div className="fixed inset-0 z-[9998]" onClick={() => setMenuOpen(null)} />
            <div
              className="fixed z-[9999] w-48 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] shadow-xl py-1"
              style={{ top: menuPos.top, left: menuPos.left, animation: "scaleIn 120ms cubic-bezier(.2,.8,.2,1)" }}
            >
              <button
                onClick={() => handleTryInChat(menuConnector.provider)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                <MessageSquare size={14} />
                Try in chat
              </button>
              <button
                onClick={() => { setMenuOpen(null); onOpenDetail?.(menuConnector.provider); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                <Settings size={14} />
                Manage
              </button>
              <div className="mx-2 my-1 border-t border-[var(--border)]" />
              <button
                onClick={() => { setUninstallConfirm(menuOpen); setMenuOpen(null); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-red-400 hover:bg-[var(--bg-hover)] transition-colors"
              >
                <Trash2 size={14} />
                Disconnect workspace
              </button>
            </div>
          </>,
          document.body,
        );
      })()}

      {/* ── Manage modal ── */}
      {manageModal && (() => {
        const connector = getConnector(manageModal);
        const meta = PROVIDERS[manageModal];
        if (!connector || !meta) return null;
        return createPortal(
          <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50" onClick={() => setManageModal(null)}>
            <div
              className="w-[420px] max-h-[80vh] rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] shadow-2xl overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
              style={{ animation: "scaleIn 150ms cubic-bezier(.2,.8,.2,1)" }}
            >
              {/* Modal header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
                <div className="flex items-center gap-2.5">
                  <span className="text-lg">{meta.icon}</span>
                  <span className="text-[15px] font-semibold text-[var(--text-primary)]">{meta.name}</span>
                  {renderStatusChip(connector, connector.status === "needs_reauth")}
                </div>
                <button onClick={() => setManageModal(null)} className="p-1 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)]">
                  <X size={16} />
                </button>
              </div>

              {/* Modal body */}
              <div className="px-5 py-4 space-y-4">
                <div className="space-y-3">
                  <div className="flex justify-between text-[13px]">
                    <span className="text-[var(--text-muted)]">Workspace</span>
                    <span className="text-[var(--text-primary)] font-medium">{connector.external_name || connector.external_id}</span>
                  </div>
                  <div className="flex justify-between text-[13px]">
                    <span className="text-[var(--text-muted)]">Connected</span>
                    <span className="text-[var(--text-primary)]">{formatFullDate(connector.created_at)}</span>
                  </div>
                  <div className="flex justify-between text-[13px]">
                    <span className="text-[var(--text-muted)]">Last used</span>
                    <span className="text-[var(--text-primary)]">{connector.last_used_at ? formatFullDate(connector.last_used_at) : "Never"}</span>
                  </div>
                  <div className="flex justify-between text-[13px]">
                    <span className="text-[var(--text-muted)]">Status</span>
                    <span className="text-[var(--text-primary)]">{connector.enabled ? "Active" : "Paused"}</span>
                  </div>
                </div>

                {/* Scopes */}
                {connector.scopes.length > 0 && (
                  <div>
                    <p className="text-[12px] text-[var(--text-muted)] mb-2">Granted scopes</p>
                    <div className="flex flex-wrap gap-1.5">
                      {connector.scopes.map((scope) => (
                        <span key={scope} className="px-2 py-0.5 rounded text-[11px] bg-[var(--bg-hover)] text-[var(--text-secondary)] font-mono">
                          {scope}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Modal footer */}
              <div className="flex items-center gap-2 px-5 py-3 border-t border-[var(--border)]">
                <button
                  onClick={() => { setManageModal(null); handleConnect(manageModal); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium text-[var(--text-primary)] border border-[var(--border)] hover:bg-[var(--bg-hover)] transition-colors"
                >
                  <RefreshCw size={13} />
                  Reconnect
                </button>
                <div className="flex-1" />
                <button
                  onClick={() => setManageModal(null)}
                  className="px-3 py-1.5 rounded-lg text-[13px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>,
          document.body,
        );
      })()}

      {/* ── Disconnect confirm dialog (uninstallConfirm = connector.id) ── */}
      {uninstallConfirm && (() => {
        const confirmConnector = connectors.find(c => c.id === uninstallConfirm);
        const providerName = confirmConnector ? PROVIDERS[confirmConnector.provider]?.name : "Connector";
        const workspaceName = confirmConnector?.external_name || "";
        return createPortal(
          <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/50" onClick={() => !uninstalling && setUninstallConfirm(null)}>
            <div
              className="w-[380px] rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              style={{ animation: "scaleIn 150ms cubic-bezier(.2,.8,.2,1)" }}
            >
              <div className="px-5 py-4">
                <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
                  Disconnect {workspaceName || providerName}?
                </h3>
                <p className="text-[13px] text-[var(--text-muted)] mt-2 leading-relaxed">
                  This will revoke NiaAI&apos;s access to {workspaceName ? `the ${workspaceName} workspace` : `your ${providerName} workspace`} and delete the stored token.
                  You&apos;ll need to go through the authorization flow again to reconnect.
                </p>
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border)]">
                <button
                  onClick={() => setUninstallConfirm(null)}
                  disabled={uninstalling}
                  className="px-3 py-1.5 rounded-lg text-[13px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => confirmConnector && handleDisconnect(confirmConnector.provider, confirmConnector.id)}
                  disabled={uninstalling}
                  className="px-3 py-1.5 rounded-lg text-[13px] font-medium text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-50"
                >
                  {uninstalling ? "Removing..." : "Disconnect"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        );
      })()}
    </div>
  );
}
