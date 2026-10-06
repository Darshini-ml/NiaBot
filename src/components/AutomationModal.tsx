"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  X,
  Clock,
  Trash2,
  Plus,
  ChevronDown,
  Check,
  Newspaper,
  Brain,
  TrendingUp,
  DollarSign,
  Mail,
  Calendar,
  Search,
  BookOpen,
  BarChart3,
  Bell,
  Zap,
  Target,
  Globe,
  FileText,
  Lightbulb,
  Heart,
  Play,
  AlertCircle,
} from "lucide-react";
import type {
  Automation,
  AutomationTemplate,
  TriggerType,
  NotificationSetting,
} from "@/lib/automations";
import { AUTOMATION_ICONS, AUTOMATION_COLORS } from "@/lib/automations";

// ---- Icon map ---------------------------------------------------------------

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Newspaper,
  Brain,
  TrendingUp,
  DollarSign,
  Mail,
  Calendar,
  Search,
  BookOpen,
  BarChart3,
  Bell,
  Zap,
  Target,
  Globe,
  FileText,
  Lightbulb,
  Heart,
};

// ---- Types ------------------------------------------------------------------

interface TriggerInput {
  type: TriggerType;
  time: string;
  weekdays: number[] | null;
  dayOfMonth: number | null;
  cron: string | null;
}

export interface AutomationFormData {
  name: string;
  icon: string;
  color: string;
  instructions: string;
  model: string;
  skills: string[];
  connectors: string[];
  notification: NotificationSetting;
  notify_email: string;
  triggers: TriggerInput[];
}

interface AutomationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: AutomationFormData) => void;
  automation?: Automation | null;
  template?: AutomationTemplate | null;
}

// ---- Constants --------------------------------------------------------------

const FREQUENCY_OPTIONS: { value: TriggerType; label: string }[] = [
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "cron", label: "Custom" },
];

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const SKILL_OPTIONS = [
  "Research",
  "Code",
  "Analyze",
  "Brainstorm",
  "Plan",
  "Slides",
  "Image",
];

const MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: "fast", label: "Fast" },
  { value: "balanced", label: "Balanced" },
  { value: "deep_think", label: "Deep Think" },
];

const NOTIFICATION_OPTIONS: { value: NotificationSetting; label: string }[] = [
  { value: "email_app", label: "Email + App" },
  { value: "app_only", label: "App only" },
  { value: "email_only", label: "Email only" },
  { value: "none", label: "None" },
];

function generateTimeOptions(): string[] {
  const times: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      times.push(
        `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
      );
    }
  }
  return times;
}

const TIME_OPTIONS = generateTimeOptions();

// ---- Helpers ----------------------------------------------------------------

function createEmptyTrigger(): TriggerInput {
  return {
    type: "daily",
    time: "09:00",
    weekdays: null,
    dayOfMonth: null,
    cron: null,
  };
}

function buildInitialState(
  automation?: Automation | null,
  template?: AutomationTemplate | null
): AutomationFormData {
  if (automation) {
    return {
      name: automation.name,
      icon: automation.icon,
      color: automation.color,
      instructions: automation.instructions,
      model: automation.model,
      skills: [...automation.skills],
      connectors: [...automation.connectors],
      notification: automation.notification,
      notify_email: (automation as any).notify_email ?? "",
      triggers: automation.triggers.map((t) => ({
        type: t.type,
        time: t.time,
        weekdays: t.weekdays ? [...t.weekdays] : null,
        dayOfMonth: t.dayOfMonth,
        cron: t.cron,
      })),
    };
  }

  if (template) {
    return {
      name: template.name,
      icon: template.icon,
      color: template.color,
      instructions: template.instructions,
      model: "balanced",
      skills: [...template.skills],
      connectors: [],
      notification: "app_only",
      notify_email: "",
      triggers: [
        {
          type: template.defaultSchedule.type,
          time: template.defaultSchedule.time,
          weekdays: template.defaultSchedule.weekdays
            ? [...template.defaultSchedule.weekdays]
            : null,
          dayOfMonth: null,
          cron: null,
        },
      ],
    };
  }

  return {
    name: "",
    icon: "Zap",
    color: AUTOMATION_COLORS[0],
    instructions: "",
    model: "balanced",
    skills: [],
    connectors: [],
    notification: "app_only",
    notify_email: "",
    triggers: [],
  };
}

// ---- Component --------------------------------------------------------------

export default function AutomationModal({
  isOpen,
  onClose,
  onSave,
  automation,
  template,
}: AutomationModalProps) {
  const [form, setForm] = useState<AutomationFormData>(() =>
    buildInitialState(automation, template)
  );
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [skillsPickerOpen, setSkillsPickerOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [testEmailStatus, setTestEmailStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [testEmailSending, setTestEmailSending] = useState(false);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [runElapsed, setRunElapsed] = useState(0);
  const runPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runStartRef = useRef<number>(0);

  const modalRef = useRef<HTMLDivElement>(null);
  const iconPickerRef = useRef<HTMLDivElement>(null);
  const skillsPickerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset form when modal opens or automation/template changes
  useEffect(() => {
    if (isOpen) {
      setForm(buildInitialState(automation, template));
      setDirty(false);
      setIconPickerOpen(false);
      setSkillsPickerOpen(false);
      setTestEmailStatus(null);
      setTestEmailSending(false);
      setRunStatus(null);
      setRunElapsed(0);
      if (runPollingRef.current) clearInterval(runPollingRef.current);
      if (runTimerRef.current) clearInterval(runTimerRef.current);
    }
    return () => {
      if (runPollingRef.current) clearInterval(runPollingRef.current);
      if (runTimerRef.current) clearInterval(runTimerRef.current);
    };
  }, [isOpen, automation, template]);

  // Auto-grow textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.max(
        140,
        textareaRef.current.scrollHeight
      )}px`;
    }
  }, [form.instructions]);

  // Close popovers on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        iconPickerOpen &&
        iconPickerRef.current &&
        !iconPickerRef.current.contains(e.target as Node)
      ) {
        setIconPickerOpen(false);
      }
      if (
        skillsPickerOpen &&
        skillsPickerRef.current &&
        !skillsPickerRef.current.contains(e.target as Node)
      ) {
        setSkillsPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [iconPickerOpen, skillsPickerOpen]);

  // Escape to close
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        handleClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  });

  const update = useCallback(
    (patch: Partial<AutomationFormData>) => {
      setForm((prev) => ({ ...prev, ...patch }));
      setDirty(true);
    },
    []
  );

  const handleClose = useCallback(() => {
    if (dirty) {
      const confirmed = window.confirm(
        "You have unsaved changes. Are you sure you want to close?"
      );
      if (!confirmed) return;
    }
    onClose();
  }, [dirty, onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        handleClose();
      }
    },
    [handleClose]
  );

  // ---- Trigger helpers ------------------------------------------------------

  const addTrigger = () => {
    update({ triggers: [...form.triggers, createEmptyTrigger()] });
  };

  const removeTrigger = (index: number) => {
    update({ triggers: form.triggers.filter((_, i) => i !== index) });
  };

  const updateTrigger = (index: number, patch: Partial<TriggerInput>) => {
    const updated = form.triggers.map((t, i) =>
      i === index ? { ...t, ...patch } : t
    );
    update({ triggers: updated });
  };

  // ---- Skills toggle --------------------------------------------------------

  const toggleSkill = (skill: string) => {
    const next = form.skills.includes(skill)
      ? form.skills.filter((s) => s !== skill)
      : [...form.skills, skill];
    update({ skills: next });
  };

  // ---- Test email -----------------------------------------------------------

  const handleTestEmail = async () => {
    if (!form.notify_email.trim()) return;
    setTestEmailSending(true);
    setTestEmailStatus(null);
    try {
      const res = await fetch("/api/automations/test-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.notify_email }),
      });
      if (res.ok) {
        setTestEmailStatus({ type: "success", message: "Sent!" });
      } else {
        const data = await res.json().catch(() => ({}));
        setTestEmailStatus({
          type: "error",
          message: data.error || `Failed (${res.status})`,
        });
      }
    } catch (err: any) {
      setTestEmailStatus({
        type: "error",
        message: err.message || "Network error",
      });
    } finally {
      setTestEmailSending(false);
    }
  };

  // ---- Run now --------------------------------------------------------------

  const handleRunNow = async () => {
    if (!automation?.id) return;
    setRunStatus("Queued");
    setRunElapsed(0);
    runStartRef.current = Date.now();

    // Start elapsed timer
    if (runTimerRef.current) clearInterval(runTimerRef.current);
    runTimerRef.current = setInterval(() => {
      setRunElapsed(Math.floor((Date.now() - runStartRef.current) / 1000));
    }, 1000);

    try {
      const res = await fetch(`/api/automations/${automation.id}/run`, {
        method: "POST",
      });
      if (!res.ok) {
        setRunStatus("Failed");
        if (runTimerRef.current) clearInterval(runTimerRef.current);
        return;
      }
    } catch {
      setRunStatus("Failed");
      if (runTimerRef.current) clearInterval(runTimerRef.current);
      return;
    }

    // Poll for status
    if (runPollingRef.current) clearInterval(runPollingRef.current);
    runPollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/automations/${automation.id}/runs?page=1`
        );
        if (!res.ok) return;
        const data = await res.json();
        const latestRun = data.runs?.[0] ?? data[0];
        if (!latestRun) return;

        const status: string = latestRun.status ?? latestRun.state ?? "";
        const normalized = status.toLowerCase();

        if (normalized.includes("queue")) {
          setRunStatus("Queued");
        } else if (normalized.includes("generat")) {
          setRunStatus("Generating");
        } else if (normalized.includes("sending") || normalized.includes("email")) {
          setRunStatus("Sending email");
        } else if (normalized.includes("running") || normalized.includes("progress")) {
          setRunStatus("Running");
        } else if (normalized.includes("done") || normalized.includes("complete") || normalized.includes("success")) {
          setRunStatus("Done");
          if (runPollingRef.current) clearInterval(runPollingRef.current);
          if (runTimerRef.current) clearInterval(runTimerRef.current);
        } else if (normalized.includes("fail") || normalized.includes("error")) {
          setRunStatus("Failed");
          if (runPollingRef.current) clearInterval(runPollingRef.current);
          if (runTimerRef.current) clearInterval(runTimerRef.current);
        } else {
          setRunStatus("Running");
        }
      } catch {
        // keep polling
      }
    }, 2000);
  };

  // ---- Validation -----------------------------------------------------------

  const canSave =
    form.name.trim().length > 0 &&
    form.triggers.length > 0 &&
    form.instructions.trim().length > 0;

  const handleSave = () => {
    if (!canSave) return;
    onSave(form);
  };

  // ---- Render ---------------------------------------------------------------

  if (!isOpen) return null;

  const IconComponent = ICON_MAP[form.icon] || Zap;
  const isEdit = !!automation;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.4)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        animation: "fadeIn 0.2s cubic-bezier(.2,.8,.2,1) forwards",
      }}
      onClick={handleBackdropClick}
      aria-label="Modal backdrop"
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? "Edit Automation" : "New Automation"}
        style={{
          width: "100%",
          maxWidth: 560,
          maxHeight: "90vh",
          overflowY: "auto",
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          borderRadius: 20,
          boxShadow: "var(--shadow-lg)",
          animation: "bubbleIn 0.25s cubic-bezier(.2,.8,.2,1) forwards",
        }}
        className="modal-mobile"
      >
        {/* ── Header ─────────────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "20px 24px 0 24px",
          }}
        >
          <h2
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: "var(--text-primary)",
              margin: 0,
            }}
          >
            {isEdit ? "Edit Automation" : "New Automation"}
          </h2>
          <button
            onClick={handleClose}
            aria-label="Close modal"
            style={{
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 8,
              border: "none",
              background: "transparent",
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: "20px 24px 24px" }}>
          {/* ── Row 1: Icon + Name ──────────────────────────────── */}
          <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
            {/* Icon picker button */}
            <div style={{ position: "relative" }} ref={iconPickerRef}>
              <button
                onClick={() => setIconPickerOpen(!iconPickerOpen)}
                aria-label="Pick icon and color"
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  border: "1px solid var(--border)",
                  background: `${form.color}18`,
                  color: form.color,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  flexShrink: 0,
                  transition: "all 200ms cubic-bezier(.2,.8,.2,1)",
                }}
              >
                <IconComponent size={22} />
              </button>

              {/* Icon + Color picker popover */}
              {iconPickerOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: 56,
                    left: 0,
                    zIndex: 110,
                    background: "var(--popover-bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 14,
                    padding: 14,
                    boxShadow: "var(--popover-shadow)",
                    width: 260,
                    animation:
                      "scaleIn 0.15s cubic-bezier(.2,.8,.2,1) forwards",
                  }}
                >
                  {/* Color row */}
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      marginBottom: 12,
                    }}
                  >
                    {AUTOMATION_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => {
                          update({ color: c });
                        }}
                        aria-label={`Color ${c}`}
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: "50%",
                          border:
                            form.color === c
                              ? `2px solid ${c}`
                              : "2px solid transparent",
                          background: c,
                          cursor: "pointer",
                          padding: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          transition: "all 200ms",
                        }}
                      >
                        {form.color === c && (
                          <Check size={13} style={{ color: "#fff" }} />
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Icons grid */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(8, 1fr)",
                      gap: 4,
                    }}
                  >
                    {AUTOMATION_ICONS.map((iconName) => {
                      const Ic = ICON_MAP[iconName];
                      if (!Ic) return null;
                      const selected = form.icon === iconName;
                      return (
                        <button
                          key={iconName}
                          onClick={() => {
                            update({ icon: iconName });
                            setIconPickerOpen(false);
                          }}
                          aria-label={`Icon ${iconName}`}
                          style={{
                            width: 30,
                            height: 30,
                            borderRadius: 8,
                            border: "none",
                            background: selected
                              ? `${form.color}20`
                              : "transparent",
                            color: selected
                              ? form.color
                              : "var(--text-secondary)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            transition: "all 200ms",
                          }}
                        >
                          <Ic size={16} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Name input */}
            <input
              type="text"
              value={form.name}
              onChange={(e) => update({ name: e.target.value })}
              placeholder="My Automation"
              aria-label="Automation name"
              style={{
                flex: 1,
                height: 48,
                borderRadius: 12,
                border: "1px solid var(--border)",
                background: "var(--bg-primary)",
                color: "var(--text-primary)",
                fontSize: 15,
                padding: "0 14px",
                outline: "none",
                transition: "border-color 200ms",
              }}
            />
          </div>

          {/* ── Triggers Section ───────────────────────────────── */}
          <div style={{ marginBottom: 20 }}>
            <label
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text-secondary)",
                marginBottom: 8,
                display: "block",
              }}
            >
              Triggers
            </label>

            {form.triggers.length === 0 ? (
              <button
                onClick={addTrigger}
                aria-label="Add trigger"
                style={{
                  width: "100%",
                  height: 48,
                  borderRadius: 12,
                  border: "2px dashed var(--border)",
                  background: "transparent",
                  color: "var(--text-muted)",
                  fontSize: 14,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  transition: "all 200ms",
                }}
              >
                <Plus size={16} />
                Add Trigger
              </button>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {form.triggers.map((trigger, idx) => (
                  <TriggerRow
                    key={idx}
                    trigger={trigger}
                    onChange={(patch) => updateTrigger(idx, patch)}
                    onRemove={() => removeTrigger(idx)}
                  />
                ))}
                <button
                  onClick={addTrigger}
                  aria-label="Add another trigger"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "8px 0",
                    border: "none",
                    background: "transparent",
                    color: "var(--accent)",
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  <Plus size={14} />
                  Add Trigger
                </button>
              </div>
            )}
          </div>

          {/* ── Instructions ───────────────────────────────────── */}
          <div style={{ marginBottom: 20 }}>
            <label
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text-secondary)",
                marginBottom: 8,
                display: "block",
              }}
            >
              Instructions
            </label>
            <div
              style={{
                borderRadius: 12,
                border: "1px solid var(--border)",
                background: "var(--bg-primary)",
                overflow: "hidden",
                transition: "border-color 200ms",
              }}
            >
              <textarea
                ref={textareaRef}
                value={form.instructions}
                onChange={(e) => update({ instructions: e.target.value })}
                placeholder="Read my unread emails and summarize\u2026"
                aria-label="Automation instructions"
                style={{
                  width: "100%",
                  minHeight: 140,
                  padding: "12px 14px",
                  border: "none",
                  background: "transparent",
                  color: "var(--text-primary)",
                  fontSize: 14,
                  lineHeight: 1.6,
                  resize: "none",
                  outline: "none",
                  fontFamily: "inherit",
                }}
              />
              {/* Footer bar inside the instructions box */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 14px",
                  borderTop: "1px solid var(--border-subtle)",
                }}
              >
                {/* Skills picker */}
                <div style={{ position: "relative" }} ref={skillsPickerRef}>
                  <button
                    onClick={() => setSkillsPickerOpen(!skillsPickerOpen)}
                    aria-label="Select skills"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "4px 10px",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "var(--bg-secondary)",
                      color: "var(--text-secondary)",
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: "pointer",
                      transition: "all 200ms",
                    }}
                  >
                    <Zap size={13} />
                    Skills
                    {form.skills.length > 0 && (
                      <span
                        style={{
                          background: "var(--accent-subtle)",
                          color: "var(--accent)",
                          borderRadius: 10,
                          padding: "1px 6px",
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        {form.skills.length}
                      </span>
                    )}
                    <ChevronDown size={12} />
                  </button>

                  {skillsPickerOpen && (
                    <div
                      style={{
                        position: "absolute",
                        bottom: 36,
                        left: 0,
                        zIndex: 110,
                        background: "var(--popover-bg)",
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        padding: 8,
                        boxShadow: "var(--popover-shadow)",
                        minWidth: 180,
                        animation:
                          "scaleIn 0.15s cubic-bezier(.2,.8,.2,1) forwards",
                      }}
                    >
                      {SKILL_OPTIONS.map((skill) => {
                        const active = form.skills.includes(skill);
                        return (
                          <button
                            key={skill}
                            onClick={() => toggleSkill(skill)}
                            aria-label={`${active ? "Remove" : "Add"} skill ${skill}`}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              width: "100%",
                              padding: "7px 10px",
                              borderRadius: 8,
                              border: "none",
                              background: active
                                ? "var(--accent-subtle)"
                                : "transparent",
                              color: active
                                ? "var(--accent)"
                                : "var(--text-secondary)",
                              fontSize: 13,
                              cursor: "pointer",
                              textAlign: "left",
                              transition: "all 200ms",
                            }}
                          >
                            <span
                              style={{
                                width: 18,
                                height: 18,
                                borderRadius: 4,
                                border: active
                                  ? "none"
                                  : "1px solid var(--border)",
                                background: active
                                  ? "var(--accent)"
                                  : "transparent",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                              }}
                            >
                              {active && (
                                <Check
                                  size={12}
                                  style={{ color: "#fff" }}
                                />
                              )}
                            </span>
                            {skill}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Model select */}
                <select
                  value={form.model}
                  onChange={(e) => update({ model: e.target.value })}
                  aria-label="Select model"
                  style={{
                    padding: "4px 10px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--bg-secondary)",
                    color: "var(--text-secondary)",
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: "pointer",
                    outline: "none",
                    appearance: "none",
                    WebkitAppearance: "none",
                    paddingRight: 24,
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%237a7285' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
                    backgroundRepeat: "no-repeat",
                    backgroundPosition: "right 6px center",
                  }}
                >
                  {MODEL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* ── Notification ───────────────────────────────────── */}
          <div style={{ marginBottom: 24 }}>
            <label
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text-secondary)",
                marginBottom: 8,
                display: "block",
              }}
            >
              Notification
            </label>
            <select
              value={form.notification}
              onChange={(e) =>
                update({
                  notification: e.target.value as NotificationSetting,
                })
              }
              aria-label="Notification setting"
              style={{
                width: "100%",
                height: 40,
                borderRadius: 12,
                border: "1px solid var(--border)",
                background: "var(--bg-primary)",
                color: "var(--text-primary)",
                fontSize: 14,
                padding: "0 14px",
                outline: "none",
                cursor: "pointer",
                appearance: "none",
                WebkitAppearance: "none",
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%237a7285' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 12px center",
              }}
            >
              {NOTIFICATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* ── Recipient Email ──────────────────────────────── */}
          <div style={{ marginBottom: 24 }}>
            <label
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text-secondary)",
                marginBottom: 8,
                display: "block",
              }}
            >
              Recipient Email
            </label>
            <input
              type="email"
              value={form.notify_email}
              onChange={(e) => update({ notify_email: e.target.value })}
              placeholder="you@example.com"
              aria-label="Recipient email"
              style={{
                width: "100%",
                height: 40,
                borderRadius: 12,
                border: "1px solid var(--border)",
                background: "var(--bg-primary)",
                color: "var(--text-primary)",
                fontSize: 14,
                padding: "0 14px",
                outline: "none",
                transition: "border-color 200ms",
                boxSizing: "border-box",
              }}
            />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginTop: 8,
              }}
            >
              <button
                onClick={handleTestEmail}
                disabled={testEmailSending || !form.notify_email.trim()}
                aria-label="Send test email"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 0",
                  border: "none",
                  background: "transparent",
                  color:
                    testEmailSending || !form.notify_email.trim()
                      ? "var(--text-faint)"
                      : "var(--accent)",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor:
                    testEmailSending || !form.notify_email.trim()
                      ? "not-allowed"
                      : "pointer",
                  transition: "all 200ms",
                }}
              >
                <Mail size={14} />
                {testEmailSending ? "Sending\u2026" : "Send test email"}
              </button>
              {testEmailStatus && (
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color:
                      testEmailStatus.type === "success"
                        ? "var(--color-green, #22c55e)"
                        : "var(--color-red, #ef4444)",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  {testEmailStatus.type === "error" && (
                    <AlertCircle size={12} />
                  )}
                  {testEmailStatus.message}
                </span>
              )}
            </div>
          </div>

          {/* ── Footer ─────────────────────────────────────────── */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 10,
            }}
          >
            <button
              onClick={handleClose}
              aria-label="Cancel"
              style={{
                height: 40,
                padding: "0 20px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text-secondary)",
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
                transition: "all 200ms cubic-bezier(.2,.8,.2,1)",
              }}
            >
              Cancel
            </button>
            {isEdit && (
              <>
                <button
                  onClick={handleRunNow}
                  disabled={runStatus === "Queued" || runStatus === "Running" || runStatus === "Generating" || runStatus === "Sending email"}
                  aria-label="Run now"
                  style={{
                    height: 40,
                    padding: "0 16px",
                    borderRadius: 10,
                    border: "none",
                    background: "transparent",
                    color: "var(--accent)",
                    fontSize: 14,
                    fontWeight: 500,
                    cursor:
                      runStatus === "Queued" || runStatus === "Running" || runStatus === "Generating" || runStatus === "Sending email"
                        ? "not-allowed"
                        : "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    transition: "all 200ms cubic-bezier(.2,.8,.2,1)",
                    opacity:
                      runStatus === "Queued" || runStatus === "Running" || runStatus === "Generating" || runStatus === "Sending email"
                        ? 0.6
                        : 1,
                  }}
                >
                  <Play size={14} />
                  Run now
                </button>
                {runStatus && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "4px 10px",
                      borderRadius: 20,
                      fontSize: 12,
                      fontWeight: 500,
                      background:
                        runStatus === "Done"
                          ? "rgba(34,197,94,0.12)"
                          : runStatus === "Failed"
                          ? "rgba(239,68,68,0.12)"
                          : "var(--accent-subtle)",
                      color:
                        runStatus === "Done"
                          ? "var(--color-green, #22c55e)"
                          : runStatus === "Failed"
                          ? "var(--color-red, #ef4444)"
                          : "var(--accent)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {runStatus === "Failed" && <AlertCircle size={12} />}
                    {runStatus}
                    {(runStatus === "Running" || runStatus === "Generating" || runStatus === "Sending email") &&
                      ` ${runElapsed}s`}
                  </span>
                )}
              </>
            )}
            <button
              onClick={handleSave}
              disabled={!canSave}
              aria-label="Save automation"
              style={{
                height: 40,
                padding: "0 24px",
                borderRadius: 10,
                border: "none",
                background: canSave
                  ? "var(--accent-gradient)"
                  : "var(--bg-hover)",
                color: canSave ? "#fff" : "var(--text-faint)",
                fontSize: 14,
                fontWeight: 600,
                cursor: canSave ? "pointer" : "not-allowed",
                transition: "all 200ms cubic-bezier(.2,.8,.2,1)",
                opacity: canSave ? 1 : 0.6,
              }}
            >
              Save
            </button>
          </div>
        </div>
      </div>

      {/* ── Mobile full-screen override ─────────────────────── */}
      <style>{`
        @media (max-width: 639px) {
          .modal-mobile {
            max-width: 100% !important;
            width: 100% !important;
            height: 100vh !important;
            max-height: 100vh !important;
            border-radius: 0 !important;
          }
        }
      `}</style>
    </div>
  );
}

// ---- TriggerRow sub-component -----------------------------------------------

function TriggerRow({
  trigger,
  onChange,
  onRemove,
}: {
  trigger: TriggerInput;
  onChange: (patch: Partial<TriggerInput>) => void;
  onRemove: () => void;
}) {
  const selectStyle: React.CSSProperties = {
    height: 36,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
    fontSize: 13,
    padding: "0 10px",
    outline: "none",
    cursor: "pointer",
    appearance: "none" as const,
    WebkitAppearance: "none" as const,
    paddingRight: 22,
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%237a7285' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 6px center",
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: 10,
        borderRadius: 12,
        border: "1px solid var(--border-subtle)",
        background: "var(--bg-primary)",
      }}
    >
      {/* Clock icon tile */}
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          background: "var(--accent-subtle)",
          color: "var(--accent)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
        aria-hidden="true"
      >
        <Clock size={16} />
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {/* Frequency select */}
          <select
            value={trigger.type}
            onChange={(e) => {
              const type = e.target.value as TriggerType;
              const patch: Partial<TriggerInput> = { type };
              if (type !== "weekly") patch.weekdays = null;
              if (type !== "monthly") patch.dayOfMonth = null;
              if (type !== "cron") patch.cron = null;
              onChange(patch);
            }}
            aria-label="Trigger frequency"
            style={selectStyle}
          >
            {FREQUENCY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* Time picker -- shown for all except cron */}
          {trigger.type !== "cron" && (
            <>
              <span
                style={{
                  fontSize: 13,
                  color: "var(--text-muted)",
                }}
              >
                at
              </span>
              <select
                value={trigger.time}
                onChange={(e) => onChange({ time: e.target.value })}
                aria-label="Trigger time"
                style={{ ...selectStyle, width: 90 }}
              >
                {TIME_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>

        {/* Weekly: weekday chips */}
        {trigger.type === "weekly" && (
          <div style={{ display: "flex", gap: 4 }}>
            {WEEKDAY_LABELS.map((label, dayIdx) => {
              const active = (trigger.weekdays ?? []).includes(dayIdx);
              return (
                <button
                  key={dayIdx}
                  onClick={() => {
                    const current = trigger.weekdays ?? [];
                    const next = active
                      ? current.filter((d) => d !== dayIdx)
                      : [...current, dayIdx];
                    onChange({ weekdays: next.length > 0 ? next : null });
                  }}
                  aria-label={`${label} ${active ? "selected" : "unselected"}`}
                  aria-pressed={active}
                  style={{
                    width: 34,
                    height: 28,
                    borderRadius: 6,
                    border: active
                      ? "1px solid var(--accent)"
                      : "1px solid var(--border)",
                    background: active ? "var(--accent-subtle)" : "transparent",
                    color: active ? "var(--accent)" : "var(--text-muted)",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 200ms",
                    padding: 0,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}

        {/* Monthly: day-of-month select */}
        {trigger.type === "monthly" && (
          <select
            value={trigger.dayOfMonth ?? 1}
            onChange={(e) =>
              onChange({ dayOfMonth: parseInt(e.target.value, 10) })
            }
            aria-label="Day of month"
            style={{ ...selectStyle, width: 130 }}
          >
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                Day {d}
              </option>
            ))}
          </select>
        )}

        {/* Custom cron */}
        {trigger.type === "cron" && (
          <div>
            <input
              type="text"
              value={trigger.cron ?? ""}
              onChange={(e) => onChange({ cron: e.target.value })}
              placeholder="*/15 * * * *"
              aria-label="Cron expression"
              style={{
                height: 36,
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--bg-secondary)",
                color: "var(--text-primary)",
                fontSize: 13,
                padding: "0 10px",
                outline: "none",
                fontFamily: "var(--font-geist-mono), monospace",
                width: "100%",
              }}
            />
            <p
              style={{
                fontSize: 11,
                color: "var(--text-faint)",
                marginTop: 4,
                marginBottom: 0,
              }}
            >
              Standard cron format: minute hour day month weekday
            </p>
          </div>
        )}
      </div>

      {/* Remove button */}
      <button
        onClick={onRemove}
        aria-label="Remove trigger"
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          border: "none",
          background: "transparent",
          color: "var(--text-muted)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          flexShrink: 0,
          transition: "color 200ms",
        }}
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}
