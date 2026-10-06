"use client";

import { useState } from "react";
import {
  Bell,
  X,
  CheckCheck,
  Clock,
  Trash2,
} from "lucide-react";

interface Notification {
  id: string;
  type: "info" | "success" | "warning" | "ai";
  title: string;
  message: string;
  time: string;
  read: boolean;
  icon?: typeof Bell;
}

const initialNotifications: Notification[] = [];

export default function NotificationsPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAsRead = (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  };

  const markAllAsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const deleteNotification = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  const clearAll = () => {
    setNotifications([]);
  };

  const filtered =
    filter === "unread" ? notifications.filter((n) => !n.read) : notifications;

  const getTypeColor = (type: string) => {
    switch (type) {
      case "success":
        return "text-emerald-400 bg-emerald-400/10";
      case "warning":
        return "text-amber-400 bg-amber-400/10";
      case "ai":
        return "text-[var(--accent)] bg-[var(--accent-subtle)]";
      default:
        return "text-blue-400 bg-blue-400/10";
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-lg hover:bg-[var(--bg-hover)] transition-all duration-150 text-[var(--text-muted)] hover:text-[var(--accent)]"
      >
        <Bell size={17} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center text-[9px] font-bold text-white bg-red-500 rounded-full px-1 ring-2 ring-[var(--bg-primary)] animate-pulse">
            {unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
        <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
        <div className="absolute top-full right-0 mt-2 w-96 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-2xl overflow-hidden z-50 animate-scale-in shadow-2xl shadow-black/40 max-h-[500px] flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-[14px] font-bold text-[var(--text-primary)]">
                Notifications
              </h3>
              {unreadCount > 0 && (
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-red-500/10 text-red-400">
                  {unreadCount} new
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] transition-colors text-[var(--text-muted)] hover:text-[var(--accent)]"
                  title="Mark all as read"
                >
                  <CheckCheck size={15} />
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  onClick={clearAll}
                  className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors text-[var(--text-muted)] hover:text-red-400"
                  title="Clear all"
                >
                  <Trash2 size={15} />
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] transition-colors text-[var(--text-muted)]"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="flex px-4 pt-3 pb-1 gap-2">
            {(["all", "unread"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all duration-200 ${
                  filter === f
                    ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                {f === "all" ? "All" : `Unread (${unreadCount})`}
              </button>
            ))}
          </div>

          {/* Notifications List */}
          <div className="flex-1 overflow-y-auto p-2">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <Bell size={32} className="text-[var(--text-faint)] mb-3" />
                <p className="text-[13px] text-[var(--text-muted)] font-medium">
                  {filter === "unread"
                    ? "No unread notifications"
                    : "No notifications yet"}
                </p>
              </div>
            ) : (
              filtered.map((notif) => {
                const IconComp = notif.icon || Bell;
                return (
                  <div
                    key={notif.id}
                    onClick={() => markAsRead(notif.id)}
                    className={`flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-all duration-200 group ${
                      notif.read
                        ? "hover:bg-[var(--bg-hover)]"
                        : "bg-[var(--accent-subtle)]/30 hover:bg-[var(--bg-hover)]"
                    }`}
                  >
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${getTypeColor(
                        notif.type
                      )}`}
                    >
                      <IconComp size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p
                          className={`text-[13px] font-semibold truncate ${
                            notif.read
                              ? "text-[var(--text-secondary)]"
                              : "text-[var(--text-primary)]"
                          }`}
                        >
                          {notif.title}
                        </p>
                        {!notif.read && (
                          <span className="w-2 h-2 rounded-full bg-[var(--accent)] shrink-0" />
                        )}
                      </div>
                      <p className="text-[12px] text-[var(--text-muted)] line-clamp-2 mt-0.5">
                        {notif.message}
                      </p>
                      <div className="flex items-center gap-1 mt-1.5">
                        <Clock size={10} className="text-[var(--text-faint)]" />
                        <span className="text-[10px] text-[var(--text-faint)] font-medium">
                          {notif.time}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteNotification(notif.id);
                      }}
                      className="p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-red-500/10 transition-all duration-150 text-[var(--text-faint)] hover:text-red-400"
                    >
                      <X size={12} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
        </>
      )}
    </div>
  );
}
