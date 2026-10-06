"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type CSSProperties,
} from "react";
import PlasmaRing from "@/components/PlasmaRing";
import {
  X,
  Mic,
  MicOff,
  Settings,
  Play,
  ChevronDown,
  ChevronUp,
  Volume2,
  Activity,
  Loader2,
  Globe,
} from "lucide-react";

/* ──────────────────────────── Types ──────────────────────────── */

type VoiceState = "idle" | "listening" | "thinking" | "speaking";
type AutoSendDelay = 0.8 | 1.5 | "manual";

interface VoiceModeProps {
  isOpen: boolean;
  onClose: () => void;
  onSendMessage: (text: string, via: "voice") => void;
  onInterrupt: () => void;
  selectedModel?: { id: string; name: string };
  onModelChange?: (model: any) => void;
  aiResponse?: string;
  aiIsStreaming?: boolean;
  isGenerating?: boolean;
}

const VOICES = ["Alloy", "Echo", "Fable", "Onyx", "Nova", "Shimmer"] as const;

const LANGUAGES = [
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "es-ES", label: "Spanish" },
  { code: "fr-FR", label: "French" },
  { code: "de-DE", label: "German" },
  { code: "ja-JP", label: "Japanese" },
  { code: "zh-CN", label: "Chinese (Simplified)" },
  { code: "ko-KR", label: "Korean" },
  { code: "pt-BR", label: "Portuguese (BR)" },
  { code: "it-IT", label: "Italian" },
];

/* ──────────────────────────── Component ──────────────────────────── */

export default function VoiceMode({
  isOpen,
  onClose,
  onSendMessage,
  onInterrupt,
  selectedModel,
  onModelChange,
  aiResponse,
  aiIsStreaming,
  isGenerating,
}: VoiceModeProps) {
  /* ── Core state ── */
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [audioLevel, setAudioLevel] = useState(0);
  const [partialTranscript, setPartialTranscript] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [isMuted, setIsMuted] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  /* ── Settings state ── */
  const [selectedVoice, setSelectedVoice] = useState<string>("Alloy");
  const [speed, setSpeed] = useState(1.0);
  const [autoSendDelay, setAutoSendDelay] = useState<AutoSendDelay>(1.5);
  const [language, setLanguage] = useState("en-US");

  /* ── Refs ── */
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceStateRef = useRef(voiceState);
  const isMutedRef = useRef(isMuted);
  const prevAiResponseRef = useRef<string | undefined>(undefined);
  const spokenLengthRef = useRef(0);
  const overlayRef = useRef<HTMLDivElement>(null);
  const pushToTalkRef = useRef(false);

  // Keep refs in sync
  useEffect(() => {
    voiceStateRef.current = voiceState;
  }, [voiceState]);
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  /* ──────────────────── Audio Level Monitoring ──────────────────── */

  const startAudioMonitoring = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const ctx = new AudioContext();
      audioContextRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.fftSize);

      const tick = () => {
        analyser.getByteTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const v = (dataArray[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        // Clamp to 0-1, apply some gain so speech registers well
        const level = Math.min(1, rms * 3);
        if (!isMutedRef.current) {
          setAudioLevel(level);
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      // Mic access denied — continue without audio level
    }
  }, []);

  const stopAudioMonitoring = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevel(0);
  }, []);

  /* ──────────────────── Speech Recognition (STT) ──────────────────── */

  const startRecognition = useCallback(() => {
    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return;

    const recognition: SpeechRecognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = language;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let final = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      setPartialTranscript(interim);
      if (final) {
        setFinalTranscript(final);
      }

      // Barge-in: if AI is speaking and user starts talking
      if (voiceStateRef.current === "speaking" && (interim || final)) {
        speechSynthesis.cancel();
        onInterrupt();
        setVoiceState("listening");
        spokenLengthRef.current = 0;
      }

      // Reset silence timer for auto-send
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }

      if (interim && voiceStateRef.current === "listening") {
        const delayMs =
          autoSendDelay === "manual" ? null : autoSendDelay * 1000;
        if (delayMs !== null) {
          silenceTimerRef.current = setTimeout(() => {
            // Silence detected — send accumulated transcript
            const text = final || interim;
            if (text.trim()) {
              onSendMessage(text.trim(), "voice");
              setVoiceState("thinking");
              setPartialTranscript("");
              setFinalTranscript("");
            }
          }, delayMs);
        }
      }

      // If final result came in and auto-send is active
      if (final && voiceStateRef.current === "listening") {
        const delayMs =
          autoSendDelay === "manual" ? null : autoSendDelay * 1000;
        if (delayMs !== null) {
          if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = setTimeout(() => {
            if (final.trim()) {
              onSendMessage(final.trim(), "voice");
              setVoiceState("thinking");
              setPartialTranscript("");
              setFinalTranscript("");
            }
          }, delayMs);
        }
      }
    };

    recognition.onerror = () => {
      // Restart on error if still listening
      if (voiceStateRef.current === "listening") {
        try {
          recognition.stop();
        } catch {}
        setTimeout(() => {
          if (voiceStateRef.current === "listening") {
            startRecognition();
          }
        }, 300);
      }
    };

    recognition.onend = () => {
      // Auto-restart if still in listening or speaking state
      if (
        voiceStateRef.current === "listening" ||
        voiceStateRef.current === "speaking"
      ) {
        setTimeout(() => {
          if (
            voiceStateRef.current === "listening" ||
            voiceStateRef.current === "speaking"
          ) {
            startRecognition();
          }
        }, 100);
      }
    };

    recognition.start();
    recognitionRef.current = recognition;
  }, [language, autoSendDelay, onSendMessage, onInterrupt]);

  const stopRecognition = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  /* ──────────────────── TTS (Speech Synthesis) ──────────────────── */

  const speak = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = speed;
      utterance.lang = language;

      // Try to find a matching voice
      const voices = speechSynthesis.getVoices();
      const match = voices.find(
        (v) =>
          v.name.toLowerCase().includes(selectedVoice.toLowerCase()) &&
          v.lang.startsWith(language.split("-")[0])
      );
      if (match) utterance.voice = match;

      utterance.onend = () => {
        if (voiceStateRef.current === "speaking") {
          setVoiceState("listening");
          setAudioLevel(0);
        }
      };

      // Drive audioLevel from TTS using a polling approach
      const ttsLevelInterval = setInterval(() => {
        if (!speechSynthesis.speaking) {
          clearInterval(ttsLevelInterval);
          return;
        }
        // Simulate TTS amplitude with subtle variation
        if (voiceStateRef.current === "speaking") {
          setAudioLevel(0.3 + Math.random() * 0.4);
        }
      }, 100);

      utterance.onend = () => {
        clearInterval(ttsLevelInterval);
        if (voiceStateRef.current === "speaking") {
          setVoiceState("listening");
          setAudioLevel(0);
          spokenLengthRef.current = 0;
        }
      };

      speechSynthesis.speak(utterance);
    },
    [speed, language, selectedVoice]
  );

  /* ──────────────────── State Machine Transitions ──────────────────── */

  // When voice mode opens: idle -> listening
  useEffect(() => {
    if (isOpen && voiceState === "idle") {
      setVoiceState("listening");
      setPartialTranscript("");
      setFinalTranscript("");
      spokenLengthRef.current = 0;
      startAudioMonitoring();
      startRecognition();
    }
    if (!isOpen && voiceState !== "idle") {
      handleEnd();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // AI response starts streaming: thinking -> speaking
  useEffect(() => {
    if (voiceState === "thinking" && aiIsStreaming && aiResponse) {
      setVoiceState("speaking");
    }
  }, [voiceState, aiIsStreaming, aiResponse]);

  // AI response completes: speak the text
  useEffect(() => {
    if (!aiResponse) return;
    if (voiceState !== "speaking") return;

    // Only speak new content
    const newContent = aiResponse.slice(spokenLengthRef.current);
    if (newContent && !aiIsStreaming) {
      speak(newContent);
      spokenLengthRef.current = aiResponse.length;
    }
  }, [aiResponse, aiIsStreaming, voiceState, speak]);

  // isGenerating turned on: go to thinking
  useEffect(() => {
    if (isGenerating && voiceState === "listening") {
      // If we have transcript but haven't sent it yet, this means
      // parent triggered generation
      setVoiceState("thinking");
    }
  }, [isGenerating, voiceState]);

  // isGenerating turned off and we were speaking: done
  useEffect(() => {
    if (
      !isGenerating &&
      !aiIsStreaming &&
      voiceState === "speaking" &&
      !speechSynthesis.speaking
    ) {
      setVoiceState("listening");
      spokenLengthRef.current = 0;
    }
  }, [isGenerating, aiIsStreaming, voiceState]);

  /* ──────────────────── End / Cleanup ──────────────────── */

  const handleEnd = useCallback(() => {
    speechSynthesis.cancel();
    stopRecognition();
    stopAudioMonitoring();
    setVoiceState("idle");
    setPartialTranscript("");
    setFinalTranscript("");
    setShowSettings(false);
    setShowTranscript(false);
    setAudioLevel(0);
    spokenLengthRef.current = 0;
    onClose();
  }, [onClose, stopRecognition, stopAudioMonitoring]);

  /* ──────────────────── Mute Toggle ──────────────────── */

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      if (streamRef.current) {
        streamRef.current
          .getAudioTracks()
          .forEach((t) => (t.enabled = !next));
      }
      if (next) {
        setAudioLevel(0);
      }
      return next;
    });
  }, []);

  /* ──────────────────── Push-to-Talk (Space) ──────────────────── */

  const handleManualSend = useCallback(() => {
    const text = (finalTranscript || partialTranscript).trim();
    if (text) {
      onSendMessage(text, "voice");
      setVoiceState("thinking");
      setPartialTranscript("");
      setFinalTranscript("");
    }
  }, [finalTranscript, partialTranscript, onSendMessage]);

  /* ──────────────────── Keyboard ──────────────────── */

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleEnd();
      }
      if (
        e.key === " " &&
        autoSendDelay === "manual" &&
        !pushToTalkRef.current
      ) {
        e.preventDefault();
        pushToTalkRef.current = true;
        // Start listening actively (visual cue)
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === " " && autoSendDelay === "manual" && pushToTalkRef.current) {
        e.preventDefault();
        pushToTalkRef.current = false;
        handleManualSend();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [isOpen, autoSendDelay, handleEnd, handleManualSend]);

  /* ──────────────────── Voice Preview ──────────────────── */

  const previewVoice = useCallback(
    (voiceName: string) => {
      speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(
        `Hi, I'm ${voiceName}. How can I help you today?`
      );
      utter.rate = speed;
      const voices = speechSynthesis.getVoices();
      const match = voices.find((v) =>
        v.name.toLowerCase().includes(voiceName.toLowerCase())
      );
      if (match) utter.voice = match;
      speechSynthesis.speak(utter);
    },
    [speed]
  );

  /* ──────────────────── Ring wrapper style ──────────────────── */

  const ringWrapperStyle = useMemo<CSSProperties>(
    () => ({
      transform: `scale(${1 + audioLevel * 0.15})`,
      filter: `drop-shadow(0 0 ${40 + audioLevel * 30}px rgba(220,80,255,${0.45 + audioLevel * 0.3}))`,
      transition: "transform 80ms ease-out, filter 80ms ease-out",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }),
    [audioLevel]
  );

  /* ──────────────────── State label rendering ──────────────────── */

  const renderStateLabel = () => {
    switch (voiceState) {
      case "listening":
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "var(--accent)",
                animation: "statusDotPulse 1.4s ease-in-out infinite",
              }}
            />
            <span style={{ color: "var(--accent)", fontWeight: 500 }}>
              Listening...
            </span>
          </div>
        );
      case "thinking":
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Loader2
              size={16}
              style={{
                color: "var(--accent)",
                animation: "spin 1s linear infinite",
              }}
            />
            <span style={{ color: "var(--text-secondary)", fontWeight: 500 }}>
              Thinking...
            </span>
          </div>
        );
      case "speaking":
        return (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 6,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Activity
                size={16}
                style={{
                  color: "var(--accent)",
                  animation: "statusDotPulse 0.6s ease-in-out infinite",
                }}
              />
              <span
                style={{ color: "var(--text-secondary)", fontWeight: 500 }}
              >
                Speaking...
              </span>
            </div>
            <button
              onClick={() => {
                speechSynthesis.cancel();
                onInterrupt();
                setVoiceState("listening");
                spokenLengthRef.current = 0;
              }}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                fontSize: 13,
                cursor: "pointer",
                padding: "4px 8px",
                borderRadius: 6,
              }}
            >
              Tap to interrupt
            </button>
          </div>
        );
      default:
        return null;
    }
  };

  /* ──────────────────── Render guard ──────────────────── */

  if (!isOpen) return null;

  /* ──────────────────── JSX ──────────────────── */

  return (
    <div
      ref={overlayRef}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        background: "rgba(8,6,12,0.92)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        animation: "voiceModeEnter 200ms cubic-bezier(.2,.8,.2,1) forwards",
        fontFamily:
          "var(--font-geist-sans), system-ui, -apple-system, sans-serif",
      }}
    >
      <style>{`
        @keyframes voiceModeEnter {
          from { opacity: 0; transform: scale(0.97); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes soundWave {
          0%, 100% { transform: scaleY(0.4); }
          50%      { transform: scaleY(1); }
        }
        @keyframes settingsSlideUp {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
      `}</style>

      {/* ── Plasma Ring ── */}
      <div style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24, minHeight: 0 }}>
        <div style={ringWrapperStyle}>
          <PlasmaRing
            size={220}
            isResponding={voiceState === "speaking" || voiceState === "thinking"}
          />
        </div>

        {/* ── State Label ── */}
        <div style={{ fontSize: 16, textAlign: "center" }}>
          {renderStateLabel()}
        </div>

        {/* ── Live partial transcript ── */}
        {(partialTranscript || finalTranscript) && voiceState === "listening" && (
          <div
            style={{
              fontSize: 16,
              color: "var(--text-secondary)",
              textAlign: "center",
              maxWidth: 500,
              padding: "0 24px",
              lineHeight: 1.5,
            }}
          >
            {finalTranscript || partialTranscript}
          </div>
        )}

        {/* ── Manual send hint ── */}
        {autoSendDelay === "manual" && voiceState === "listening" && (
          <div
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              textAlign: "center",
            }}
          >
            Hold <kbd style={{
              background: "rgba(255,255,255,0.08)",
              padding: "2px 8px",
              borderRadius: 4,
              fontSize: 11,
              border: "1px solid rgba(255,255,255,0.12)",
            }}>Space</kbd> to talk, release to send
          </div>
        )}

        {/* ── AI reply transcript (collapsible) ── */}
        {aiResponse && (
          <div style={{ width: "100%", maxWidth: 500, padding: "0 24px" }}>
            <button
              onClick={() => setShowTranscript(!showTranscript)}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                fontSize: 13,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
                margin: "0 auto",
                padding: "4px 8px",
              }}
            >
              {showTranscript ? (
                <ChevronUp size={14} />
              ) : (
                <ChevronDown size={14} />
              )}
              {showTranscript ? "Hide transcript" : "Show transcript"}
            </button>
            {showTranscript && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 14,
                  color: "var(--text-secondary)",
                  lineHeight: 1.6,
                  maxHeight: 200,
                  overflowY: "auto",
                  textAlign: "center",
                }}
              >
                {aiResponse}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Bottom Controls ── */}
      <div
        style={{
          flexShrink: 0,
          padding: "24px 0 40px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          width: "100%",
        }}
      >
        {/* Model pill */}
        {selectedModel && (
          <button
            onClick={() => onModelChange?.(selectedModel)}
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 9999,
              padding: "4px 14px",
              fontSize: 12,
              color: "var(--text-muted)",
              cursor: onModelChange ? "pointer" : "default",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            {selectedModel.name}
          </button>
        )}

        {/* Action buttons row */}
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {/* Mute */}
          <button
            onClick={toggleMute}
            aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              border: "1px solid rgba(255,255,255,0.1)",
              background: isMuted
                ? "rgba(255,80,80,0.15)"
                : "rgba(255,255,255,0.06)",
              color: isMuted ? "var(--error)" : "var(--text-secondary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
          </button>

          {/* End */}
          <button
            onClick={handleEnd}
            aria-label="End voice mode"
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              border: "none",
              background: "var(--error)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              boxShadow: "0 0 20px rgba(239,68,68,0.3)",
            }}
          >
            <X size={24} />
          </button>

          {/* Settings */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            aria-label="Voice settings"
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              border: "1px solid rgba(255,255,255,0.1)",
              background: showSettings
                ? "rgba(255,255,255,0.12)"
                : "rgba(255,255,255,0.06)",
              color: "var(--text-secondary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <Settings size={20} />
          </button>
        </div>

        {/* Esc hint */}
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
          Press <kbd style={{
            background: "rgba(255,255,255,0.08)",
            padding: "1px 6px",
            borderRadius: 3,
            fontSize: 10,
            border: "1px solid rgba(255,255,255,0.12)",
          }}>Esc</kbd> to end
        </div>
      </div>

      {/* ── Settings Panel (slide-up) ── */}
      {showSettings && (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            background: "rgba(18,14,22,0.98)",
            borderTop: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "20px 20px 0 0",
            padding: "24px 24px 40px",
            maxHeight: "60vh",
            overflowY: "auto",
            animation: "settingsSlideUp 250ms cubic-bezier(.2,.8,.2,1) forwards",
          }}
        >
          <div
            style={{
              maxWidth: 420,
              margin: "0 auto",
              display: "flex",
              flexDirection: "column",
              gap: 24,
            }}
          >
            {/* Header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                }}
              >
                Voice Settings
              </span>
              <button
                onClick={() => setShowSettings(false)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  padding: 4,
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Voice selector */}
            <div>
              <label
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--text-secondary)",
                  marginBottom: 8,
                  display: "block",
                }}
              >
                <Volume2
                  size={14}
                  style={{ display: "inline", marginRight: 6, verticalAlign: "middle" }}
                />
                Voice
              </label>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 8,
                }}
              >
                {VOICES.map((v) => (
                  <div
                    key={v}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <button
                      onClick={() => setSelectedVoice(v)}
                      style={{
                        flex: 1,
                        padding: "8px 0",
                        borderRadius: 8,
                        border:
                          selectedVoice === v
                            ? "1px solid var(--accent)"
                            : "1px solid rgba(255,255,255,0.08)",
                        background:
                          selectedVoice === v
                            ? "rgba(139,61,255,0.12)"
                            : "rgba(255,255,255,0.04)",
                        color:
                          selectedVoice === v
                            ? "var(--accent)"
                            : "var(--text-secondary)",
                        fontSize: 13,
                        cursor: "pointer",
                        fontWeight: selectedVoice === v ? 600 : 400,
                      }}
                    >
                      {v}
                    </button>
                    <button
                      onClick={() => previewVoice(v)}
                      aria-label={`Preview ${v}`}
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: "50%",
                        border: "1px solid rgba(255,255,255,0.08)",
                        background: "rgba(255,255,255,0.04)",
                        color: "var(--text-muted)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                    >
                      <Play size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Speed slider */}
            <div>
              <label
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--text-secondary)",
                  marginBottom: 8,
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span>Speed</span>
                <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                  {speed.toFixed(1)}x
                </span>
              </label>
              <input
                type="range"
                min={0.8}
                max={1.5}
                step={0.1}
                value={speed}
                onChange={(e) => setSpeed(parseFloat(e.target.value))}
                style={{
                  width: "100%",
                  accentColor: "var(--accent)",
                  height: 4,
                  cursor: "pointer",
                }}
              />
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 11,
                  color: "var(--text-muted)",
                  marginTop: 4,
                }}
              >
                <span>0.8x</span>
                <span>1.5x</span>
              </div>
            </div>

            {/* Auto-send after silence */}
            <div>
              <label
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--text-secondary)",
                  marginBottom: 8,
                  display: "block",
                }}
              >
                Auto-send after silence
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                {(
                  [
                    { value: 0.8, label: "0.8s" },
                    { value: 1.5, label: "1.5s" },
                    { value: "manual", label: "Manual" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={String(opt.value)}
                    onClick={() =>
                      setAutoSendDelay(opt.value as AutoSendDelay)
                    }
                    style={{
                      flex: 1,
                      padding: "8px 0",
                      borderRadius: 8,
                      border:
                        autoSendDelay === opt.value
                          ? "1px solid var(--accent)"
                          : "1px solid rgba(255,255,255,0.08)",
                      background:
                        autoSendDelay === opt.value
                          ? "rgba(139,61,255,0.12)"
                          : "rgba(255,255,255,0.04)",
                      color:
                        autoSendDelay === opt.value
                          ? "var(--accent)"
                          : "var(--text-secondary)",
                      fontSize: 13,
                      cursor: "pointer",
                      fontWeight: autoSendDelay === opt.value ? 600 : 400,
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Language selector */}
            <div>
              <label
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--text-secondary)",
                  marginBottom: 8,
                  display: "block",
                }}
              >
                <Globe
                  size={14}
                  style={{ display: "inline", marginRight: 6, verticalAlign: "middle" }}
                />
                Language
              </label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.04)",
                  color: "var(--text-primary)",
                  fontSize: 13,
                  cursor: "pointer",
                  appearance: "none",
                  WebkitAppearance: "none",
                  backgroundImage:
                    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236e6e7a' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")",
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "right 12px center",
                }}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code} style={{ background: "#1a141d" }}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
