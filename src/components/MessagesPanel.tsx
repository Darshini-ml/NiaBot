"use client";

import { useState } from "react";
import {
  Mail,
  X,
  Send,
  MailOpen,
  Star,
  Trash2,
  Clock,
  ArrowLeft,
  User,
} from "lucide-react";

interface EmailMessage {
  id: string;
  from: string;
  avatar: string;
  subject: string;
  preview: string;
  body: string;
  time: string;
  read: boolean;
  starred: boolean;
}

const initialMessages: EmailMessage[] = [
  {
    id: "1",
    from: "NiaAI Team",
    avatar: "N",
    subject: "Welcome to NiaAI Premium!",
    preview: "Thank you for upgrading to Premium. Here's what you get...",
    body: "Thank you for upgrading to NiaAI Premium! You now have access to:\n\n- All AI models including SuperNexus\n- Unlimited web searches\n- Priority image generation\n- Advanced automation features\n- 24/7 priority support\n\nWe're excited to have you on board!",
    time: "Just now",
    read: false,
    starred: false,
  },
  {
    id: "2",
    from: "System Alert",
    avatar: "S",
    subject: "Monthly Usage Report",
    preview: "Your October usage summary is ready to view...",
    body: "Your October usage report:\n\n- Chat messages: 1,247\n- Images generated: 56\n- Web searches: 189\n- Files analyzed: 34\n- Voice conversations: 12\n\nYou're in the top 10% of users this month!",
    time: "2 hours ago",
    read: false,
    starred: true,
  },
  {
    id: "3",
    from: "NiaAI Updates",
    avatar: "U",
    subject: "New Feature: Multi-Agent Mode",
    preview: "We've launched multi-agent collaboration...",
    body: "Exciting news! Multi-Agent Mode is now available. You can now:\n\n- Run multiple AI agents simultaneously\n- Agents collaborate on complex tasks\n- Each agent specializes in different domains\n\nTry it by enabling 'Multi-Agent' in your chat settings.",
    time: "Yesterday",
    read: true,
    starred: false,
  },
  {
    id: "4",
    from: "Support",
    avatar: "H",
    subject: "Re: API Integration Help",
    preview: "Thanks for reaching out! Here's a guide...",
    body: "Hi there!\n\nRegarding your API integration question, here's a quick guide:\n\n1. Get your API key from Settings > API Keys\n2. Use the /v1/chat/completions endpoint\n3. Set the Authorization header with Bearer token\n\nLet us know if you need further assistance.",
    time: "2 days ago",
    read: true,
    starred: false,
  },
];

export default function MessagesPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<EmailMessage[]>(initialMessages);
  const [selectedMessage, setSelectedMessage] = useState<EmailMessage | null>(null);
  const [replyText, setReplyText] = useState("");
  const unreadCount = messages.filter((m) => !m.read).length;

  const openMessage = (msg: EmailMessage) => {
    setSelectedMessage(msg);
    setMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, read: true } : m))
    );
  };

  const toggleStar = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, starred: !m.starred } : m))
    );
  };

  const deleteMessage = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setMessages((prev) => prev.filter((m) => m.id !== id));
    if (selectedMessage?.id === id) setSelectedMessage(null);
  };

  const sendReply = () => {
    if (!replyText.trim()) return;
    setReplyText("");
    // In a real app, this would send via API
  };

  const getAvatarColor = (name: string) => {
    const colors = [
      "from-[#8b3dff] to-[#c13bd9]",
      "from-blue-500 to-blue-400",
      "from-emerald-500 to-emerald-400",
      "from-amber-500 to-amber-400",
    ];
    return colors[name.charCodeAt(0) % colors.length];
  };

  return (
    <div className="relative">
      <button
        onClick={() => {
          setIsOpen(!isOpen);
          setSelectedMessage(null);
        }}
        className="relative p-2 rounded-lg hover:bg-[var(--bg-hover)] transition-all duration-150 text-[var(--text-muted)] hover:text-[var(--accent)]"
      >
        <Mail size={17} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center text-[9px] font-bold text-white bg-[var(--accent)] rounded-full px-1 ring-2 ring-[var(--bg-primary)]">
            {unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
        <div className="fixed inset-0 z-40" onClick={() => { setIsOpen(false); setSelectedMessage(null); }} />
        <div className="absolute top-full right-0 mt-2 w-[420px] bg-[var(--bg-elevated)] border border-[var(--border)] rounded-2xl overflow-hidden z-50 animate-scale-in shadow-2xl shadow-black/40 max-h-[520px] flex flex-col">
          {selectedMessage ? (
            /* Message Detail View */
            <>
              <div className="p-4 border-b border-[var(--border)] flex items-center gap-2">
                <button
                  onClick={() => setSelectedMessage(null)}
                  className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] transition-colors text-[var(--text-muted)]"
                >
                  <ArrowLeft size={16} />
                </button>
                <h3 className="text-[14px] font-bold text-[var(--text-primary)] truncate flex-1">
                  {selectedMessage.subject}
                </h3>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] transition-colors text-[var(--text-muted)]"
                >
                  <X size={15} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <div className="flex items-center gap-3 mb-4">
                  <div
                    className={`w-10 h-10 rounded-full bg-gradient-to-br ${getAvatarColor(
                      selectedMessage.from
                    )} flex items-center justify-center text-white text-[14px] font-bold`}
                  >
                    {selectedMessage.avatar}
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold text-[var(--text-primary)]">
                      {selectedMessage.from}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      {selectedMessage.time}
                    </p>
                  </div>
                </div>
                <div className="text-[13px] text-[var(--text-secondary)] leading-relaxed whitespace-pre-line">
                  {selectedMessage.body}
                </div>
              </div>
              {/* Reply */}
              <div className="p-3 border-t border-[var(--border)]">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && sendReply()}
                    placeholder="Type a reply..."
                    className="flex-1 px-3 py-2 bg-[var(--bg-tertiary)] rounded-xl text-[13px] border border-[var(--border)] focus:border-[var(--accent-border)] focus:outline-none placeholder:text-[var(--text-faint)] text-[var(--text-primary)] transition-all"
                  />
                  <button
                    onClick={sendReply}
                    disabled={!replyText.trim()}
                    className={`p-2 rounded-lg transition-all ${
                      replyText.trim()
                        ? "bg-[var(--accent)] text-white hover:opacity-90"
                        : "text-[var(--text-faint)] cursor-not-allowed"
                    }`}
                  >
                    <Send size={15} />
                  </button>
                </div>
              </div>
            </>
          ) : (
            /* Messages List View */
            <>
              <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-[14px] font-bold text-[var(--text-primary)]">
                    Messages
                  </h3>
                  {unreadCount > 0 && (
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-[var(--accent-subtle)] text-[var(--accent)]">
                      {unreadCount} new
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] transition-colors text-[var(--text-muted)]"
                >
                  <X size={15} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10">
                    <MailOpen
                      size={32}
                      className="text-[var(--text-faint)] mb-3"
                    />
                    <p className="text-[13px] text-[var(--text-muted)] font-medium">
                      No messages
                    </p>
                  </div>
                ) : (
                  messages.map((msg) => (
                    <div
                      key={msg.id}
                      onClick={() => openMessage(msg)}
                      className={`flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-all duration-200 group ${
                        msg.read
                          ? "hover:bg-[var(--bg-hover)]"
                          : "bg-[var(--accent-subtle)]/20 hover:bg-[var(--bg-hover)]"
                      }`}
                    >
                      <div
                        className={`w-9 h-9 rounded-full bg-gradient-to-br ${getAvatarColor(
                          msg.from
                        )} flex items-center justify-center text-white text-[12px] font-bold shrink-0`}
                      >
                        {msg.avatar}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p
                            className={`text-[13px] truncate ${
                              msg.read
                                ? "text-[var(--text-secondary)] font-medium"
                                : "text-[var(--text-primary)] font-semibold"
                            }`}
                          >
                            {msg.from}
                          </p>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className="text-[10px] text-[var(--text-faint)]">
                              {msg.time}
                            </span>
                            {!msg.read && (
                              <span className="w-2 h-2 rounded-full bg-[var(--accent)]" />
                            )}
                          </div>
                        </div>
                        <p
                          className={`text-[12px] truncate ${
                            msg.read
                              ? "text-[var(--text-muted)]"
                              : "text-[var(--text-secondary)] font-medium"
                          }`}
                        >
                          {msg.subject}
                        </p>
                        <p className="text-[11px] text-[var(--text-faint)] truncate mt-0.5">
                          {msg.preview}
                        </p>
                      </div>
                      <div className="flex flex-col items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150 shrink-0">
                        <button
                          onClick={(e) => toggleStar(e, msg.id)}
                          className="p-1 rounded hover:bg-[var(--bg-active)] transition-colors"
                        >
                          <Star
                            size={12}
                            className={
                              msg.starred
                                ? "text-amber-400 fill-amber-400"
                                : "text-[var(--text-faint)]"
                            }
                          />
                        </button>
                        <button
                          onClick={(e) => deleteMessage(e, msg.id)}
                          className="p-1 rounded hover:bg-red-500/10 transition-colors"
                        >
                          <Trash2 size={12} className="text-[var(--text-faint)] hover:text-red-400" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
        </>
      )}
    </div>
  );
}
