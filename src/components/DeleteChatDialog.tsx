"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Trash2, Loader2 } from "lucide-react";

interface DeleteChatDialogProps {
  chatId: string;
  chatTitle: string;
  onConfirm: (chatId: string) => void;
  onCancel: () => void;
}

export default function DeleteChatDialog({ chatId, chatTitle, onConfirm, onCancel }: DeleteChatDialogProps) {
  const [visible, setVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Animate in
  useEffect(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
  }, []);

  // Focus trap
  useEffect(() => {
    cancelRef.current?.focus();

    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        animatedClose();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        handleDelete();
        return;
      }
      // Trap focus within the dialog
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled])");
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleting]);

  const animatedClose = useCallback(() => {
    if (deleting) return;
    setVisible(false);
    setTimeout(onCancel, 160);
  }, [onCancel, deleting]);

  const handleDelete = useCallback(() => {
    if (deleting) return;
    setDeleting(true);
    // Small delay to show spinner, then confirm
    setTimeout(() => {
      onConfirm(chatId);
    }, 300);
  }, [chatId, onConfirm, deleting]);

  return createPortal(
    <div
      className="delete-dialog-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(8, 6, 12, 0.6)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        opacity: visible ? 1 : 0,
        transition: "opacity 160ms ease",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) animatedClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Delete chat"
        style={{
          width: 400,
          maxWidth: "90vw",
          padding: 24,
          borderRadius: 16,
          background: "#17141d",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          boxShadow: "0 24px 64px rgba(0, 0, 0, 0.5), 0 8px 24px rgba(0, 0, 0, 0.3)",
          transform: visible ? "scale(1)" : "scale(0.96)",
          opacity: visible ? 1 : 0,
          transition: "transform 160ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 160ms ease",
        }}
      >
        {/* Red trash icon */}
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            background: "rgba(255, 70, 90, 0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 16,
          }}
        >
          <Trash2 size={18} color="#ff465a" />
        </div>

        {/* Title */}
        <h2 style={{ fontSize: 17, fontWeight: 600, color: "#fff", margin: "0 0 8px" }}>
          Delete chat?
        </h2>

        {/* Body */}
        <p style={{ fontSize: 14, color: "#9a93a3", margin: "0 0 24px", lineHeight: 1.5 }}>
          <strong style={{ color: "#c4bdd0", fontWeight: 500 }}>{chatTitle}</strong> will be permanently deleted. This can&apos;t be undone.
        </p>

        {/* Actions */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button
            ref={cancelRef}
            onClick={animatedClose}
            disabled={deleting}
            style={{
              height: 40,
              padding: "0 20px",
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 500,
              color: "#fff",
              background: "transparent",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              cursor: deleting ? "not-allowed" : "pointer",
              opacity: deleting ? 0.5 : 1,
              transition: "background 150ms, border-color 150ms",
            }}
            onMouseEnter={(e) => { if (!deleting) { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)"; } }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)"; }}
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            style={{
              height: 40,
              padding: "0 20px",
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 500,
              color: "#fff",
              background: deleting ? "#b91c3d" : "#e5325a",
              border: "none",
              cursor: deleting ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
              transition: "background 150ms",
            }}
            onMouseEnter={(e) => { if (!deleting) e.currentTarget.style.background = "#c9294e"; }}
            onMouseLeave={(e) => { if (!deleting) e.currentTarget.style.background = "#e5325a"; }}
          >
            {deleting && <Loader2 size={14} className="animate-spin" />}
            Delete
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
