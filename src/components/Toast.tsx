"use client";

import { useState, useEffect, useCallback } from "react";
import { Check } from "lucide-react";

export interface ToastMessage {
  id: string;
  text: string;
  action?: { label: string; onClick: () => void };
}

let globalAddToast: ((text: string, opts?: { duration?: number; action?: { label: string; onClick: () => void } }) => void) | null = null;

export function showToast(text: string, opts?: { duration?: number; action?: { label: string; onClick: () => void } }) {
  globalAddToast?.(text, opts);
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((text: string, opts?: { duration?: number; action?: { label: string; onClick: () => void } }) => {
    const id = `toast-${Date.now()}`;
    const duration = opts?.duration ?? 1700;
    setToasts(prev => [...prev, { id, text, action: opts?.action }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duration);
  }, []);

  useEffect(() => {
    globalAddToast = addToast;
    return () => { globalAddToast = null; };
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 z-[300] flex flex-col items-center gap-2" style={{ left: "calc(252px + (100vw - 252px) / 2)", transform: "translateX(-50%)" }}>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="toast-enter flex items-center gap-2 px-4 py-2.5 rounded-full bg-[var(--bg-elevated)] text-[var(--text-primary)] text-[13px] font-medium shadow-lg border border-[var(--border)]"
        >
          <Check size={14} className="text-emerald-600 shrink-0" />
          {toast.text}
          {toast.action && (
            <button
              onClick={() => {
                toast.action!.onClick();
                setToasts(prev => prev.filter(t => t.id !== toast.id));
              }}
              className="ml-1 px-2 py-0.5 rounded-md text-[12px] font-semibold text-[var(--accent)] hover:bg-[var(--accent-subtle)] transition-colors"
            >
              {toast.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
