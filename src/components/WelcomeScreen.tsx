"use client";

import { useState, useEffect } from "react";
import { Image, Lightbulb, ListChecks, FileSearch, Layout, Code } from "lucide-react";
import PlasmaRing from "./PlasmaRing";

export type TaskType = "image" | "brainstorm" | "plan" | "analyze" | "slides" | "code" | null;

interface WelcomeScreenProps {
  onSuggestionClick: (text: string) => void;
  userName?: string;
  projectName?: string;
  isGenerating?: boolean;
  activeTask?: TaskType;
  onSelectTask?: (task: TaskType) => void;
  onOpenFilePicker?: () => void;
  hasChats?: boolean;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/* All 6 task actions as uniform chips */
const allChips: { label: string; icon: typeof Image; task: TaskType }[] = [
  { label: "Create image", icon: Image, task: "image" },
  { label: "Brainstorm", icon: Lightbulb, task: "brainstorm" },
  { label: "Make a plan", icon: ListChecks, task: "plan" },
  { label: "Analyze file", icon: FileSearch, task: "analyze" },
  { label: "Make slides", icon: Layout, task: "slides" },
  { label: "Generate code", icon: Code, task: "code" },
];

const starterPrompts: Record<string, string[]> = {
  image: ["A futuristic cityscape at sunset", "Portrait of a cat in watercolor style", "Abstract geometric pattern in neon colors", "Cozy cabin in snowy mountains"],
  brainstorm: ["Side projects I can build this weekend", "Marketing strategies for a new SaaS product", "Creative date night ideas", "Ways to improve team productivity"],
  plan: ["Launch plan for a mobile app", "Study schedule for certification exams", "Content calendar for social media", "Migration plan from monolith to microservices"],
  analyze: ["Summarize this PDF in 5 bullets", "What are the key numbers in this report?", "Explain this diagram", "Find errors in this document"],
  slides: ["Quarterly business review presentation", "Startup pitch deck for investors", "Technical architecture overview", "Onboarding training for new hires"],
  code: ["Build a REST API with authentication", "React component with drag and drop", "Python script to parse CSV files", "SQL query to find duplicate records"],
};

export default function WelcomeScreen({ onSuggestionClick, userName, isGenerating, activeTask, onSelectTask, onOpenFilePicker, hasChats }: WelcomeScreenProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;

  const firstName = userName?.split(" ")[0] || "Darshini";

  const handleChipClick = (chip: typeof allChips[0]) => {
    if (chip.task === "analyze") {
      onSelectTask?.("analyze");
      onOpenFilePicker?.();
    } else {
      onSelectTask?.(activeTask === chip.task ? null : chip.task);
    }
  };

  const currentPrompts = activeTask ? starterPrompts[activeTask] || [] : [];

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 relative" style={{ minHeight: 0, overflowY: "auto", overflowX: "hidden", animation: "fadeUp 450ms ease-out" }}>
      <div className="relative z-10 flex flex-col items-center w-full" style={{ maxWidth: 920 }}>
        {/* Plasma Ring — responsive size */}
        <div className="welcome-stagger-1 opacity-0" style={{ marginBottom: 20 }}>
          <PlasmaRing size={Math.min(140, typeof window !== "undefined" ? window.innerHeight * 0.14 : 140)} isResponding={isGenerating} />
        </div>

        {/* Greeting */}
        <p className="welcome-stagger-2 opacity-0 text-[14px] text-[var(--text-muted)]" style={{ marginBottom: 8 }}>
          {getGreeting()}, {firstName}
        </p>

        {/* Main heading — tighter clamp */}
        <h1
          className="welcome-stagger-3 opacity-0 mb-5 text-center"
          style={{
            fontFamily: "var(--font-instrument-serif), 'Instrument Serif', 'Playfair Display', Georgia, serif",
            fontWeight: 400,
            fontSize: "clamp(28px, 3.4vw, 40px)",
            lineHeight: 1.05,
            letterSpacing: "-0.025em",
            color: "var(--text-primary)",
            textWrap: "balance",
          }}
        >
          Ready to <span className="text-gradient" style={{ fontStyle: "italic" }}>create</span> something new?
        </h1>

        {/* Unified 6 task chips — 2 rows of 3 */}
        <div className="welcome-stagger-4 opacity-0 grid grid-cols-3 gap-3 mb-4 w-full" style={{ maxWidth: 700 }}>
          {allChips.map((chip) => (
            <button
              key={chip.label}
              onClick={() => handleChipClick(chip)}
              className={`quick-chip flex items-center gap-2 px-3 text-[13px] font-medium justify-center ${
                activeTask === chip.task ? "active" : "text-[var(--text-secondary)]"
              }`}
              style={{ height: 40 }}
            >
              <chip.icon size={14} className="opacity-60 shrink-0" />
              {chip.label}
            </button>
          ))}
        </div>

        {/* Starter prompts for selected task */}
        {activeTask && currentPrompts.length > 0 && (
          <div className="welcome-stagger-4 opacity-0 flex flex-wrap items-center justify-center gap-2 mb-5 max-w-xl">
            {currentPrompts.map((prompt) => (
              <button
                key={prompt}
                onClick={() => onSuggestionClick(prompt)}
                className="px-3 py-1.5 text-[12px] rounded-full border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
              >
                {prompt}
              </button>
            ))}
          </div>
        )}

        {/* Empty-state hint when no chats and no task selected */}
        {!activeTask && !hasChats && (
          <p className="welcome-stagger-5 opacity-0 text-[13px] text-[var(--text-muted)] text-center mb-3">
            Try: &ldquo;Brainstorm weekend project ideas&rdquo; or &ldquo;Create a pitch deck for my startup&rdquo;
          </p>
        )}
      </div>
    </div>
  );
}
