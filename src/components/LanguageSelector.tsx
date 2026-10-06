"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check, Search, Globe } from "lucide-react";

export interface Language {
  code: string;
  name: string;
  nativeName: string;
  flag: string;
}

export const languages: Language[] = [
  { code: "en", name: "English", nativeName: "English", flag: "🇺🇸" },
  { code: "es", name: "Spanish", nativeName: "Español", flag: "🇪🇸" },
  { code: "fr", name: "French", nativeName: "Français", flag: "🇫🇷" },
  { code: "de", name: "German", nativeName: "Deutsch", flag: "🇩🇪" },
  { code: "it", name: "Italian", nativeName: "Italiano", flag: "🇮🇹" },
  { code: "pt", name: "Portuguese", nativeName: "Português", flag: "🇧🇷" },
  { code: "ru", name: "Russian", nativeName: "Русский", flag: "🇷🇺" },
  { code: "zh", name: "Chinese", nativeName: "中文", flag: "🇨🇳" },
  { code: "ja", name: "Japanese", nativeName: "日本語", flag: "🇯🇵" },
  { code: "ko", name: "Korean", nativeName: "한국어", flag: "🇰🇷" },
  { code: "ar", name: "Arabic", nativeName: "العربية", flag: "🇸🇦" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी", flag: "🇮🇳" },
  { code: "te", name: "Telugu", nativeName: "తెలుగు", flag: "🇮🇳" },
  { code: "ta", name: "Tamil", nativeName: "தமிழ்", flag: "🇮🇳" },
  { code: "bn", name: "Bengali", nativeName: "বাংলা", flag: "🇧🇩" },
  { code: "tr", name: "Turkish", nativeName: "Türkçe", flag: "🇹🇷" },
  { code: "vi", name: "Vietnamese", nativeName: "Tiếng Việt", flag: "🇻🇳" },
  { code: "th", name: "Thai", nativeName: "ภาษาไทย", flag: "🇹🇭" },
  { code: "nl", name: "Dutch", nativeName: "Nederlands", flag: "🇳🇱" },
  { code: "pl", name: "Polish", nativeName: "Polski", flag: "🇵🇱" },
  { code: "sv", name: "Swedish", nativeName: "Svenska", flag: "🇸🇪" },
  { code: "uk", name: "Ukrainian", nativeName: "Українська", flag: "🇺🇦" },
  { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia", flag: "🇮🇩" },
  { code: "ms", name: "Malay", nativeName: "Bahasa Melayu", flag: "🇲🇾" },
  { code: "fil", name: "Filipino", nativeName: "Filipino", flag: "🇵🇭" },
  { code: "he", name: "Hebrew", nativeName: "עברית", flag: "🇮🇱" },
  { code: "cs", name: "Czech", nativeName: "Čeština", flag: "🇨🇿" },
  { code: "ro", name: "Romanian", nativeName: "Română", flag: "🇷🇴" },
  { code: "da", name: "Danish", nativeName: "Dansk", flag: "🇩🇰" },
  { code: "no", name: "Norwegian", nativeName: "Norsk", flag: "🇳🇴" },
];

interface LanguageSelectorProps {
  selectedLanguage: Language;
  onLanguageChange: (lang: Language) => void;
}

export default function LanguageSelector({
  selectedLanguage,
  onLanguageChange,
}: LanguageSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && searchRef.current) {
      searchRef.current.focus();
    }
  }, [isOpen]);

  const filtered = languages.filter(
    (lang) =>
      lang.name.toLowerCase().includes(search.toLowerCase()) ||
      lang.nativeName.toLowerCase().includes(search.toLowerCase()) ||
      lang.code.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-[var(--bg-hover)] transition-all duration-150 text-[13px] font-semibold text-[var(--text-secondary)]"
        title="Language"
      >
        <Globe size={15} className="text-[var(--text-muted)]" />
        <span className="text-[12px] font-bold">
          {selectedLanguage.code.toUpperCase()}
        </span>
      </button>

      {isOpen && (
        <>
        <div className="fixed inset-0 z-40" onClick={() => { setIsOpen(false); setSearch(""); }} />
        <div className="absolute top-full right-0 mt-2 w-80 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-2xl overflow-hidden z-50 animate-scale-in shadow-2xl shadow-black/40 max-h-[420px] flex flex-col">
          {/* Header */}
          <div className="p-3 border-b border-[var(--border)]">
            <div className="flex items-center gap-2 mb-3">
              <Globe size={15} className="text-[var(--accent)]" />
              <h3 className="text-[13px] font-bold text-[var(--text-primary)]">
                Select Language
              </h3>
              <span className="text-[11px] text-[var(--text-muted)]">
                {languages.length} available
              </span>
            </div>
            {/* Search */}
            <div className="relative">
              <Search
                size={13}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"
              />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search languages..."
                className="w-full pl-8 pr-3 py-2 bg-[var(--bg-tertiary)] rounded-xl text-[12px] border border-[var(--border)] focus:border-[var(--accent-border)] focus:outline-none placeholder:text-[var(--text-faint)] text-[var(--text-primary)] transition-all"
              />
            </div>
          </div>

          {/* Language List */}
          <div className="flex-1 overflow-y-auto p-1.5">
            {filtered.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-[12px] text-[var(--text-muted)]">
                  No language found
                </p>
              </div>
            ) : (
              filtered.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => {
                    onLanguageChange(lang);
                    setIsOpen(false);
                    setSearch("");
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 text-left ${
                    selectedLanguage.code === lang.code
                      ? "bg-[var(--accent-subtle)]"
                      : "hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  <span className="text-[18px] w-7 text-center">{lang.flag}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-[var(--text-primary)]">
                      {lang.name}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      {lang.nativeName}
                    </p>
                  </div>
                  <span className="text-[11px] text-[var(--text-faint)] font-mono">
                    {lang.code}
                  </span>
                  {selectedLanguage.code === lang.code && (
                    <div className="w-5 h-5 rounded-full bg-[var(--accent)] flex items-center justify-center">
                      <Check size={11} className="text-white" />
                    </div>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
        </>
      )}
    </div>
  );
}
