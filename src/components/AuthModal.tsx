"use client";

import { useState } from "react";
import { Sparkles, Mail, Lock, User, Eye, EyeOff, ArrowRight } from "lucide-react";

export interface UserData {
  name: string;
  email: string;
  createdAt: string;
}

interface AuthModalProps {
  onAuth: (user: UserData) => void;
}

export default function AuthModal({ onAuth }: AuthModalProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    setTimeout(() => {
      if (mode === "register") {
        if (!name.trim() || !email.trim() || !password.trim()) {
          setError("All fields are required");
          setLoading(false);
          return;
        }
        if (password.length < 6) {
          setError("Password must be at least 6 characters");
          setLoading(false);
          return;
        }
        // Check if user already exists
        const existing = localStorage.getItem(`nia_user_${email}`);
        if (existing) {
          setError("An account with this email already exists");
          setLoading(false);
          return;
        }
        // Register
        const user: UserData = { name: name.trim(), email: email.trim(), createdAt: new Date().toISOString() };
        localStorage.setItem(`nia_user_${email}`, JSON.stringify({ ...user, password }));
        localStorage.setItem("nia_current_user", JSON.stringify(user));
        onAuth(user);
      } else {
        if (!email.trim() || !password.trim()) {
          setError("Email and password are required");
          setLoading(false);
          return;
        }
        // Login
        const stored = localStorage.getItem(`nia_user_${email}`);
        if (!stored) {
          setError("No account found with this email");
          setLoading(false);
          return;
        }
        const parsed = JSON.parse(stored);
        if (parsed.password !== password) {
          setError("Incorrect password");
          setLoading(false);
          return;
        }
        const user: UserData = { name: parsed.name, email: parsed.email, createdAt: parsed.createdAt };
        localStorage.setItem("nia_current_user", JSON.stringify(user));
        onAuth(user);
      }
      setLoading(false);
    }, 400);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--bg-primary)]">
      {/* Background orbs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="welcome-orb welcome-orb-1" />
        <div className="welcome-orb welcome-orb-2" />
        <div className="welcome-orb welcome-orb-3" />
      </div>

      <div className="relative z-10 w-full max-w-md px-6">
        {/* Logo / Branding */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#8b3dff] to-[#c13bd9] flex items-center justify-center shadow-lg shadow-[#c13bd9]/30 mb-4">
            <Sparkles size={24} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">
            {mode === "login" ? "Welcome back" : "Create account"}
          </h1>
          <p className="text-[14px] text-[var(--text-muted)] mt-1">
            {mode === "login" ? "Sign in to continue to NiaAI" : "Get started with NiaAI"}
          </p>
        </div>

        {/* Form Card */}
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-2xl p-6 shadow-2xl shadow-black/20">
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "register" && (
              <div>
                <label className="block text-[12px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                  Full Name
                </label>
                <div className="relative">
                  <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="John Doe"
                    className="w-full pl-10 pr-4 py-3 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-xl text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent-border)] focus:outline-none transition-colors"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-[12px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                Email
              </label>
              <div className="relative">
                <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full pl-10 pr-4 py-3 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-xl text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent-border)] focus:outline-none transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-[12px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-11 py-3 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-xl text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent-border)] focus:outline-none transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)] hover:text-[var(--text-muted)] transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <p className="text-[13px] text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-[#8b3dff] to-[#c13bd9] text-white text-[14px] font-semibold hover:shadow-lg hover:shadow-[#c13bd9]/25 transition-all duration-300 active:scale-[0.98] disabled:opacity-60"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  {mode === "login" ? "Sign In" : "Create Account"}
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          <div className="mt-5 pt-4 border-t border-[var(--border)] text-center">
            <p className="text-[13px] text-[var(--text-muted)]">
              {mode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
              <button
                onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}
                className="text-[var(--accent)] font-semibold hover:underline"
              >
                {mode === "login" ? "Sign up" : "Sign in"}
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
